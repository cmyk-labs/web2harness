const test = require("node:test");
const assert = require("node:assert/strict");
const { StartupState } = require("../../electron/startup-state.cjs");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const main = fs.readFileSync(path.join(__dirname, "../../electron/main.cjs"), "utf8");

test("initial shell snapshot is available without runtime or browser construction", async () => {
  let snapshot;
  const state = { language: "en", onboardingComplete: true };
  vm.runInNewContext(main.slice(main.indexOf('handle("launcher:snapshot",'), main.indexOf('handle("launcher:set-language",')), {
    handle: (_channel, handler) => { snapshot = handler; },
    startup: new StartupState(), startupFailed: false, runtimeHost: null, browserHost: null,
    LAUNCHER_PROFILE: { kind: "development", codexHome: "/fixture/codex" }, CORE_HOME: "/fixture/core",
    launcherUserData: "/fixture/launcher", stateStore: { read: () => state }, logger: { recent: () => [] },
    GITHUB_URL: "", projectLinks: require("../../electron/project-links.cjs").projectLinks,
    CONNECTORS_URL: "", TUNNELS_URL: "", KEYS_URL: "",
    process: { platform: "win32" }, app: { isPackaged: true, getVersion: () => "test" },
    smokePassedThisSession: false, smokePassedForCurrentVersion: () => false, lastOperation: null, updateController: null,
  });
  const result = await snapshot();
  assert.equal(result.state, state);
  assert.equal(result.startup.status, "preparing");
  assert.equal(result.browser, null);
});

test("quit waits for the installation transaction and prevents startup continuation", async () => {
  let finish;
  const calls = [];
  const sandbox = {
    shutdownInProgress: false, exitCommitted: false, quitting: false,
    runtimePreparation: new Promise(resolve => { finish = resolve; }), runtimeHost: null, browserHost: null, browserControl: null,
    runtimeSupervisor: { shutdown: async () => calls.push("shutdown") },
    stopCatalogVerificationMonitor() {}, app: { quit: () => calls.push("quit") },
    showMainWindow() {}, publishOperation: () => assert.fail("Quit should succeed"),
  };
  vm.runInNewContext(main.slice(main.indexOf("async function requestQuit()"), main.indexOf("async function start()")), sandbox);
  const quitting = sandbox.requestQuit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sandbox.quitting, true);
  assert.deepEqual(calls, []);
  finish();
  assert.equal((await quitting).ok, true);
  assert.deepEqual(calls, ["shutdown", "quit"]);
});

for (const smoke of [false, true]) test(`preparation failure preserves diagnostics only for interactive startup (smoke=${smoke})`, async () => {
  const calls = [];
  const startup = new StartupState();
  const sandbox = {
    start: async () => { throw new Error("Fixture disk error"); }, startup, startupFailed: false,
    startupLogger: { error: () => calls.push("logged"), warn() {} }, rendererLoaded: true, quitting: false,
    mainWindow: { isDestroyed: () => false }, browserHost: { destroy: () => calls.push("browser closed") },
    browserControl: { close: async () => calls.push("control closed") },
    fs: { appendFileSync() {} }, path, app: { getPath: () => "/fixture/logs", exit: () => calls.push("exited") },
    process: { argv: smoke ? ["--launcher-smoke-test"] : [] }, showMainWindow: () => calls.push("shown"),
  };
  vm.runInNewContext(main.slice(main.indexOf("void start().catch(")), sandbox);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(startup.snapshot().status, "failed");
  assert.deepEqual(calls, ["logged", "browser closed", "control closed", smoke ? "exited" : "shown"]);
  if (!smoke) assert.equal(sandbox.browserHost, null);
});

test("settings and diagnostics remain available while runtime actions fail closed until initialization completes", () => {
  const events = [];
  const startup = new StartupState(state => events.push(state));
  for (const status of ["preparing", "failed"]) {
    if (status === "failed") startup.fail(new Error("Access denied"));
    for (const channel of ["snapshot", "set-language", "logs", "export-logs", "window-state", "set-preference"]) {
      assert.doesNotThrow(() => startup.assertAvailable(`launcher:${channel}`));
    }
    for (const channel of ["setup-core", "browser-login", "doctor", "uninstall-integration", "new-runtime-operation"]) {
      assert.throws(() => startup.assertAvailable(`launcher:${channel}`), /Workspace/);
    }
  }
  startup.update({ stage: "verifying-copy", elapsedMs: 10, completedFiles: 2, totalFiles: 5 });
  assert.equal(startup.snapshot().status, "preparing");
  assert.equal(events.at(-1).completedFiles, 2);
  startup.ready();
  assert.doesNotThrow(() => startup.assertAvailable("launcher:setup-core"));
});
