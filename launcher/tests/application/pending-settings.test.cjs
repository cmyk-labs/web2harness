const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStateStore } = require("../../electron/state.cjs");
const { createPendingSettings } = require("../../electron/runtime/pending-settings.cjs");
const { createQueueSettingsSaver } = require("../../electron/runtime/queue-settings.cjs");
const { guardLicensedIpc } = require("../../electron/license-access.cjs");
const { settingsForEditing } = require("../../shared/pending-settings.cjs");
const { StartupState } = require("../../electron/startup-state.cjs");

function fixture(t, status = "missing") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "w2h-pending-settings-"));
  const filename = path.join(directory, "state.json");
  t.after(() => { if (fs.existsSync(filename)) fs.unlinkSync(filename); fs.rmdirSync(directory); });
  const stateStore = createStateStore(filename), effects = [];
  let ready = false, busy = false, failKey, expireAfter;
  const license = { status: async () => ({ state: status }), assertActive: async () => {
    if (status !== "active") throw new Error("license inactive");
  } };
  const queue = { snapshot: () => ({ configRevision: 1 }), updateSettings: async (settings, revision) => {
    effects.push(["queue", settings]); return { configRevision: revision };
  } };
  const applyQueue = createQueueSettingsSaver({ stateStore, getQueue: () => queue, assertActive: license.assertActive,
    applyRuntimeParameters: async parameters => effects.push(["parameters", parameters]), publish() {} });
  const controller = createPendingSettings({ stateStore, license, ready: () => ready,
    assertIdle: () => { if (busy) throw new Error("busy"); }, publish() {}, applyQueue,
    applyPreference: async (key, value) => {
      if (key === failKey) throw new Error("apply failed");
      effects.push([key, value]);
      const state = stateStore.update({ [key]: value });
      if (key === expireAfter) status = "expired";
      return state;
    } });
  return { controller, stateStore, effects, license, filename, activate() { status = "active"; ready = true; },
    busy(value) { busy = value; }, fail(key) { failKey = key; }, expireAfter(key) { expireAfter = key; } };
}

for (const status of ["missing", "expired", "invalid", "wrong-device", "clock-error"]) {
  test(`${status}: settings survive restart without changing active values or permitting use`, async t => {
    const f = fixture(t, status), before = f.stateStore.read();
    for (const [key, value] of [["experimentalContextFiles", true], ["experimentalContextTripleBudget", true],
      ["experimentalSkillAttachments", true], ["experimentalFreshConversationPerTurn", true], ["useSavedChats", true]]) {
      await f.controller.preference(key, value);
    }
    const result = await f.controller.queue({ ...before.requestScheduling, maxConcurrent: 2 }, 1,
      { ...before.runtimeParameters, maxRetries: 1 }, { maxRetries: "user" });
    assert.equal(result.applyState, "pending-activation");
    assert.equal(f.effects.length, 0);
    const loaded = createStateStore(f.filename).read(), edit = settingsForEditing(loaded);
    assert.deepEqual(loaded.runtimeParameters, before.runtimeParameters);
    assert.deepEqual(loaded.requestScheduling, before.requestScheduling);
    assert.equal(loaded.useSavedChats, false);
    assert.equal(edit.useSavedChats, true); assert.equal(edit.runtimeParameters.maxRetries, 1);
    assert.equal(edit.requestScheduling.maxConcurrent, 2); assert.equal(edit.experimentalContextTripleBudget, true);
    await assert.rejects(f.controller.apply(), /license/);
    await assert.rejects(guardLicensedIpc(f.license, "launcher:browser-show", () => f.effects.push("browser"))({}), /license/);
    assert.equal(f.effects.length, 0);
    f.activate();
    await f.controller.apply();
    assert.deepEqual(f.stateStore.read().pendingSettings, {});
    assert.equal(f.stateStore.read().runtimeParameters.maxRetries, 1);
    assert.equal(f.stateStore.read().useSavedChats, true);
    assert.equal(f.effects.filter(([key]) => key === "queue").length, 1);
  });
}
test("local preferences stay available before startup; execution and unknown keys remain guarded", async () => {
  const inactive = { assertActive: async () => { throw new Error("license"); } };
  const startup = new StartupState();
  for (const channel of ["autostart", "queue-status", "queue-settings", "context-files", "context-budget", "skill-attachments", "fresh-conversation-per-turn", "use-saved-chats"]) {
    startup.assertAvailable(`launcher:${channel}`);
    assert.equal(await guardLicensedIpc(inactive, `launcher:${channel}`, () => "local")({}), "local");
  }
  for (const key of ["keepRunningOnClose", "showBrowserDuringTurns", "logPageSize"])
    assert.equal(await guardLicensedIpc(inactive, "launcher:set-preference", () => "local")({}, key, false), "local");
  await assert.rejects(guardLicensedIpc(inactive, "launcher:set-preference", () => "bad")({}, "unknown", true));
  assert.throws(() => startup.assertAvailable("launcher:apply-pending-settings"));
});
test("ready licensed preferences retain immediate application; not-ready saves stay pending", async t => {
  const f = fixture(t, "active");
  await f.controller.preference("useSavedChats", true);
  assert.equal(f.effects.length, 0);
  f.activate(); await f.controller.apply();
  await f.controller.preference("useSavedChats", false);
  assert.equal(f.stateStore.read().useSavedChats, false);
  assert.deepEqual(f.stateStore.read().pendingSettings, {});
});
test("invalid input and stale concurrent saves preserve the accepted draft", async t => {
  const f = fixture(t), before = f.stateStore.read();
  await assert.rejects(f.controller.preference("keepRunningOnClose", true));
  await assert.rejects(f.controller.preference("useSavedChats", "true"));
  await assert.rejects(f.controller.queue({ ...before.requestScheduling, maxConcurrent: 99 }, 1));
  const first = f.controller.queue({ ...before.requestScheduling, maxConcurrent: 2 }, 1);
  const second = assert.rejects(f.controller.queue({ ...before.requestScheduling, maxConcurrent: 3 }, 1), /changed/);
  await first; await second;
  assert.equal(settingsForEditing(f.stateStore.read()).requestScheduling.maxConcurrent, 2);
  assert.equal(f.effects.length, 0);
});
test("partial application and mid-apply expiry retain remaining settings for retry", async t => {
  const f = fixture(t);
  await f.controller.preference("experimentalSkillAttachments", true);
  await f.controller.preference("useSavedChats", true);
  f.activate(); f.expireAfter("experimentalSkillAttachments");
  await assert.rejects(f.controller.apply(), /license/);
  assert.equal(f.stateStore.read().experimentalSkillAttachments, true);
  assert.equal(f.stateStore.read().useSavedChats, false);
  assert.deepEqual(f.stateStore.read().pendingSettings, { useSavedChats: true });
  f.activate(); f.fail("useSavedChats");
  await assert.rejects(f.controller.apply(), /apply failed/);
  assert.deepEqual(f.stateStore.read().pendingSettings, { useSavedChats: true });
  f.fail(null); f.busy(true); await assert.rejects(f.controller.apply(), /busy/);
  f.busy(false); await f.controller.apply();
  assert.deepEqual(f.stateStore.read().pendingSettings, {});
});
test("mode capabilities and context-file dependencies still constrain saved preferences", async t => {
  const f = fixture(t);
  await f.controller.preference("experimentalContextFiles", false);
  await assert.rejects(f.controller.preference("experimentalContextTripleBudget", true), /Context as File/);
  assert.equal(settingsForEditing(f.stateStore.read()).experimentalContextTripleBudget, false);
  f.stateStore.update({ browserInteractionMode: "manual" });
  await assert.rejects(f.controller.preference("experimentalSkillAttachments", true), /Zero Risk/);
  await f.controller.preference("useSavedChats", true);
});
