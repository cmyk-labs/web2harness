const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createLicenseController } = require("../../electron/license-controller.cjs");
const { StartupState } = require("../../electron/startup-state.cjs");
const { redactText } = require("../../electron/logging.cjs");

function fixture(response) {
  const invocations = [];
  const controller = createLicenseController({ app: { isPackaged: false }, sourceRoot: process.cwd(), coreHome: "/fixture/owned-home", spawnChild(executable, args, options) {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let input = "";
    child.stdin.on("data", chunk => { input += chunk; });
    child.stdin.on("finish", () => setImmediate(() => {
      invocations.push({ executable, args, options, input });
      const result = response(input);
      child.stdout.end(JSON.stringify(result.status)); child.stderr.end();
      child.emit("close", result.exitCode || 0);
    }));
    return child;
  } });
  return { controller, invocations };
}

test("activation wait is released only by a successful verifier result; credentials use stdin", async () => {
  const code = "W2H1.fixture.signature";
  const { controller, invocations } = fixture(input => ({ status: { state: input === code ? "active" : "missing", deviceCode: "fixture" } }));
  let continued = false;
  const waiting = controller.waitForActivation().then(() => { continued = true; });
  assert.equal((await controller.status()).state, "missing");
  assert.equal(continued, false);
  assert.equal((await controller.import(code)).state, "active");
  await waiting;
  assert.equal(continued, true);
  assert.ok(invocations.every(call => !call.args.some(arg => arg.includes(code))));
  assert.ok(invocations.some(call => call.input === code));
  assert.ok(invocations.every(call => call.options.windowsHide));
});

test("malformed input never launches a verifier and a failed child cannot report active", async () => {
  const { controller, invocations } = fixture(() => ({ status: { state: "active", deviceCode: "fixture" }, exitCode: 1 }));
  await assert.rejects(controller.import("x".repeat(8193)), /Invalid license input/);
  assert.equal(invocations.length, 0);
  await assert.rejects(controller.status(), /Unable to read/);
});

test("activation IPC stays available before initialization; code is redacted from logs", () => {
  const startup = new StartupState();
  assert.doesNotThrow(() => startup.assertAvailable("launcher:license-status"));
  assert.doesNotThrow(() => startup.assertAvailable("launcher:license-import"));
  assert.throws(() => startup.assertAvailable("launcher:setup-core"));
  assert.equal(redactText("license W2H1.payload.signature"), "license [license]");
});
