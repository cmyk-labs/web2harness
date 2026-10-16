const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const contract = require("../../shared/browser-surface-ipc.cjs");
const { StartupState } = require("../../electron/startup-state.cjs");

test("browser surface IPC preserves startup null, validates input and forwards ready state", async () => {
  const main = fs.readFileSync(path.join(__dirname, "../../electron/main.cjs"), "utf8");
  let handler;
  const scope = { ...contract, browserHost: null, handle(channel, callback) {
    assert.equal(channel, contract.BROWSER_SURFACE_ACTIVE_CHANNEL); handler = callback;
  } };
  vm.runInNewContext(main.slice(main.indexOf("handle(BROWSER_SURFACE_ACTIVE_CHANNEL,"), main.indexOf('handle("launcher:browser-show",')), scope);
  const startup = new StartupState();
  startup.assertAvailable(contract.BROWSER_SURFACE_ACTIVE_CHANNEL);
  const preloadPath = path.join(__dirname, "../../electron/preload.cjs");
  let api;
  vm.runInNewContext(fs.readFileSync(preloadPath, "utf8"), { require: name => name === "electron" ? {
    contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
    ipcRenderer: { invoke: async (channel, value) => {
      assert.equal(channel, contract.BROWSER_SURFACE_ACTIVE_CHANNEL); return handler({}, value);
    } },
  } : assert.fail(`Sandboxed preload cannot require ${name}`) });
  assert.equal(await api.setBrowserSurfaceActive(true), null);
  await assert.rejects(api.setBrowserSurfaceActive("true"), /must be a boolean/);
  const state = { visible: false, status: "ready", tabs: [] };
  scope.browserHost = { setSurfaceActive(active) { state.visible = active; return state; } };
  assert.equal(await api.setBrowserSurfaceActive(true), state);
  assert.equal(state.visible, true);
  assert.equal(await api.setBrowserSurfaceActive(false), state);
  assert.equal(state.visible, false);
});
