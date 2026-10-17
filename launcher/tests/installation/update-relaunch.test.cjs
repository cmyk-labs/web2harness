const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const workerPath = path.resolve(__dirname, "../../electron/installation/update-worker.cjs");

function worker(spawn, runInstaller = () => ({ status: 0 })) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(workerPath, "utf8"), {
    module, __dirname: path.dirname(workerPath),
    require: name => name === "node:child_process" ? { spawn, spawnSync: runInstaller } : createRequire(workerPath)(name),
    process: { pid: process.pid, argv: [], kill() { throw Object.assign(new Error("fixture absent parent"), { code: "ESRCH" }); } },
    setTimeout, clearTimeout,
  }, { filename: workerPath });
  return module.exports;
}

test("relaunch waits for spawn and forwards asynchronous errors with their original details", async () => {
  const child = new EventEmitter();
  let unref = false;
  child.unref = () => { unref = true; };
  const api = worker((_bin, _args, options) => { assert.equal(options.windowsHide, true); return child; });
  let completed = false;
  const launched = api.launch("fixture.exe").then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(unref, false);
  child.emit("spawn");
  await launched;
  assert.equal(unref, true);

  const failure = Object.assign(new Error("fixture launch denied"), { code: "EACCES", syscall: "spawn fixture.exe" });
  const rejected = api.launch("fixture.exe");
  const check = assert.rejects(rejected, error => error === failure);
  child.emit("error", failure);
  await check;
});

test("worker logs asynchronous relaunch failure, attempts recovery and retains evidence", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w2h-relaunch-fixture-"));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.match(path.basename(root), /^w2h-relaunch-fixture-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, "installer.exe"), target = path.join(root, "app.exe");
  const tempRoot = path.join(root, "staging");
  fs.mkdirSync(tempRoot);
  fs.writeFileSync(source, "fixture installer, never executed");
  fs.writeFileSync(target, "fixture application, never executed");
  const logPath = path.join(root, "update-worker.log"), jobPath = path.join(root, "job.json");
  fs.writeFileSync(jobPath, JSON.stringify({ source, target, tempRoot, logPath, platform: "win32", version: "fixture", parentPid: 1 }));
  const failure = Object.assign(new Error("fixture launch denied"), { code: "EACCES" });
  let launches = 0;
  const api = worker(() => {
    launches++;
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => child.emit("error", failure));
    return child;
  });
  await assert.rejects(api.main(jobPath), error => error === failure);
  assert.equal(launches, 2, "the failed restart must enter the existing recovery path");
  const log = fs.readFileSync(logPath, "utf8");
  assert.match(log, /update failed:.*EACCES/);
  assert.match(log, /recovery launch failed:.*EACCES/);
  assert.doesNotMatch(log, /installed and relaunched|relaunch process started/);
  assert.equal(fs.existsSync(tempRoot), true, "failed jobs keep staging evidence");
});
