const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { verifyConnectorWithBrowserHelper } = require("../../electron/browser/browser-helper-verifier.cjs");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const vm = require("node:vm");

function stagedHelper(t, options = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let request;
  const child = Object.assign(new EventEmitter(), { pid: 4321, exitCode: null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough() });
  child.stdin = new Writable({ write(bytes, _encoding, done) {
    const message = JSON.parse(bytes.toString());
    if (message.type === "shutdown") { child.exitCode = 0; child.emit("exit", 0, null); }
    else request = message;
    done();
  } });
  child.kill = () => { child.signalCode = "SIGTERM"; child.emit("exit", null, "SIGTERM"); return true; };
  const filename = require.resolve("../../electron/browser/browser-helper-verifier.cjs");
  const sandbox = { module: { exports: {} }, process, setTimeout, clearTimeout, DOMException,
    require: id => id === "node:child_process" ? { spawn: () => child }
      : id.startsWith(".") ? require(path.resolve(path.dirname(filename), id)) : require(id) };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  const pending = sandbox.module.exports.runBrowserHelperOperation({
    helper: { executable: "fixture", script: "fixture" }, descriptorPath: "/fixture", appName: "Fixture", operation: "inspect",
    ...options,
  });
  void pending.catch(() => {});
  const send = value => child.stdout.write(`${JSON.stringify(value)}\n`);
  send({ type: "ready" });
  return { pending, child, send: value => send({ id: request.id, ...value }) };
}

test("helper connection, controls and each inspection get fresh timers beyond ninety seconds", async t => {
  const f = stagedHelper(t);
  for (const [sequence, stage, elapsed] of [[1, "connection", 119000], [2, "controls", 119000], [3, "inspection", 59000], [4, "inspection", 59000]]) {
    f.send({ type: "stage", sequence, stage });
    t.mock.timers.tick(elapsed);
    assert.equal(f.child.exitCode, null);
  }
  f.send({ type: "result", value: { authenticated: true } });
  assert.equal((await f.pending).value.authenticated, true);
  assert.equal(f.child.exitCode, 0);
});

test("check progress is ordered and preserves typed blocked errors across the helper boundary", async t => {
  const phases = [];
  const f = stagedHelper(t, { operation: "smoke", onCheck: phase => phases.push(phase) });
  f.send({ type: "check", phase: "connection" });
  f.send({ type: "error", name: "ChatGptWebAdapterError", message: "dispatch paused", code: "queue_blocked_send_outcome_unknown",
    status: 503, retryable: false, errorType: "server_error", diagnosticRef: "diag-" + "a".repeat(24) });
  await assert.rejects(f.pending, error => {
    assert.equal(error.code, "queue_blocked_send_outcome_unknown");
    assert.equal(error.status, 503);
    assert.equal(error.retryable, false);
    assert.equal(error.diagnosticRef, "diag-" + "a".repeat(24));
    return true;
  });
  assert.deepEqual(phases, ["connection"]);
  assert.equal(f.child.exitCode, 0);
});

test("out-of-order check progress cannot establish connection proof", async t => {
  const f = stagedHelper(t, { operation: "smoke", onCheck: () => assert.fail("unverified progress") });
  f.send({ type: "check", phase: "dispatch" });
  await assert.rejects(f.pending, /out of order/);
});

test("cleanup observer failure retains the primary category and still stops the helper", async t => {
  const f = stagedHelper(t, { onStage: stage => { if (stage === "cleanup") throw new Error("cleanup observer failed"); } });
  f.send({ type: "error", message: "cancelled", name: "AbortError", status: 499, code: "client_cancelled", retryable: false });
  await assert.rejects(f.pending, error => {
    assert.equal(error.code, "client_cancelled");
    assert.match(error.cleanupMessage, /cleanup observer failed/);
    assert.match(error.operationId, /^inspect-/);
    return true;
  });
  assert.equal(f.child.exitCode, 0);
});

test("malformed helper error fields cannot cross the public boundary", async t => {
  const f = stagedHelper(t);
  f.send({ type: "error", message: "token=private", code: { nested: "unsafe" }, status: 200, retryable: "yes", diagnosticRef: "private path" });
  await assert.rejects(f.pending, error => {
    assert.equal(error.message.includes("private"), false);
    for (const field of ["code", "status", "retryable", "diagnosticRef"]) assert.equal(error[field], undefined);
    return true;
  });
});

test("running transfers timeout ownership to the worker without a maintenance or generation cap", async t => {
  const f = stagedHelper(t);
  f.send({ type: "stage", sequence: 1, stage: "running" });
  t.mock.timers.tick(31 * 60_000);
  assert.equal(f.child.exitCode, null);
  f.send({ type: "error", message: "worker primitive timed out" });
  await assert.rejects(f.pending, /worker primitive timed out/);
});

test("a live but stalled helper times out its stage", async t => {
  const f = stagedHelper(t);
  f.send({ type: "stage", sequence: 1, stage: "inspection" });
  t.mock.timers.tick(60_000);
  await assert.rejects(f.pending, /inspection stage timed out/);
  assert.equal(f.child.exitCode, 0);
});

test("helper process loss fails immediately, independently of its stage timer", async t => {
  const lost = stagedHelper(t);
  lost.child.exitCode = 17;
  lost.child.emit("exit", 17, null);
  await assert.rejects(lost.pending, /exited with status 17/);
});

for (const useSavedChats of [false, true]) test(`launcher verification delegates exact connector and chat-saving selection (saved=${useSavedChats})`, async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-helper-verify-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "helper.cjs");
  fs.writeFileSync(script, `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
    send({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type === "shutdown") process.exit(0);
      if (message.type !== "verify") return;
      if (message.config.appName !== "Codex Native2") process.exit(2);
      if (message.config.browserHostDescriptorPath !== "/runtime/launcher-browser.json") process.exit(3);
      if (message.config.useSavedChats !== ${useSavedChats}) process.exit(4);
      send({ type: "result", id: message.id, text: message.config.appName });
    });
  `);

  const result = await verifyConnectorWithBrowserHelper({
    helper: { executable: process.execPath, script },
    descriptorPath: "/runtime/launcher-browser.json",
    appName: "Codex Native2",
    useSavedChats,
    logger: { info() {} },
  });

  assert.deepEqual(result, { ok: true, appName: "Codex Native2" });
});

test("launcher verification consumes a helper input EOF after the result", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-helper-eof-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "helper.cjs");
  fs.writeFileSync(script, `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
    send({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type !== "verify") return;
      send({ type: "result", id: message.id, text: message.config.appName });
      process.stdin.destroy();
      setTimeout(() => process.exit(0), 100);
    });
  `);

  const result = await verifyConnectorWithBrowserHelper({
    helper: { executable: process.execPath, script },
    descriptorPath: "/runtime/launcher-browser.json",
    appName: "Codex Native2",
    logger: { info() {} },
  });

  assert.deepEqual(result, { ok: true, appName: "Codex Native2" });
});

test("launcher verification preserves the helper error class and correlation id", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-helper-error-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "helper.cjs");
  fs.writeFileSync(script, `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
    send({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type === "shutdown") process.exit(0);
      if (message.type !== "verify") return;
      send({
        type: "error",
        id: message.id,
        name: "ChatGptPersistentBrowserStateError",
        message: "connector proof cleanup failed",
      });
    });
  `);

  await assert.rejects(
    verifyConnectorWithBrowserHelper({
      helper: { executable: process.execPath, script },
      descriptorPath: "/runtime/launcher-browser.json",
      appName: "Codex Native2",
      logger: { info() {} },
    }),
    (error) => {
      assert.equal(error.name, "ChatGptPersistentBrowserStateError");
      assert.equal(error.message, "connector proof cleanup failed");
      assert.match(error.operationId, /^verify-[a-f0-9]{24}$/);
      return true;
    },
  );
});
