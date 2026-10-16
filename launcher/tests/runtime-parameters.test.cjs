const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_RUNTIME_PARAMETERS: defaults, normalizeRuntimeParameters, validateRuntimeParameters } = require("../shared/runtime-parameters.cjs");
const { createQueueSettingsSaver } = require("../electron/runtime/queue-settings.cjs");

test("runtime defaults and choices require explicit user provenance across upgrades", () => {
  assert.deepEqual(normalizeRuntimeParameters({ ...defaults, idleTabMinutes: 120 }).runtimeParameters, defaults);
  const migrated = normalizeRuntimeParameters({ ...defaults, idleTabMinutes: 120, maxRetries: 0 }, { idleTabMinutes: "user", maxRetries: "default" });
  assert.equal(migrated.runtimeParameters.idleTabMinutes, 120);
  assert.equal(migrated.runtimeParameters.maxRetries, 3);
  assert.equal(normalizeRuntimeParameters({ idleTabMinutes: -1 }, { idleTabMinutes: "user" }).runtimeParameters.idleTabMinutes, 30);
  for (const invalid of [{ ...defaults, retainedTabTarget: 32 }, { ...defaults, attachmentMinutes: 0 }, { ...defaults, maxRetries: 4 }, { ...defaults, foreign: true }, {}]) {
    assert.throws(() => validateRuntimeParameters(invalid));
  }
});

test("one revision commits scheduling and runtime choices before publishing their live snapshot", async () => {
  let state = { requestScheduling: { maxConcurrent: 4, queueTimeoutMinutes: 15, minSendIntervalSeconds: 3 }, requestSchedulingRevision: 1, ...normalizeRuntimeParameters() };
  const events = [];
  const save = createQueueSettingsSaver({
    stateStore: { read: () => state, update: patch => (state = { ...state, ...patch }) },
    assertActive() {}, publish: value => events.push(["published", value.runtimeParameters.idleTabMinutes]),
    getQueue: () => ({ snapshot: () => ({ configRevision: 1 }), updateSettings: async (_settings, revision) => ({ configRevision: revision }) }),
    applyRuntimeParameters: async value => { assert.equal(state.runtimeParameters, value); events.push(["applied", value.idleTabMinutes]); },
  });
  const result = await save(state.requestScheduling, 1, { ...defaults, idleTabMinutes: 60 });
  assert.equal(result.applyState, "applied");
  assert.equal(state.runtimeParameterSources.idleTabMinutes, "user");
  assert.equal(state.runtimeParameterSources.stallMinutes, "default");
  assert.deepEqual(events, [["applied", 60], ["published", 60]]);
  await assert.rejects(save(state.requestScheduling, 1, defaults), /changed/);
  await assert.rejects(save(state.requestScheduling, 2, { ...defaults, maxRetries: 4 }), /Invalid/);
  assert.equal(state.requestSchedulingRevision, 2);
});

test("failed descriptor publication remains a saved but unapplied result", async () => {
  let state = { requestSchedulingRevision: 1, ...normalizeRuntimeParameters() };
  const save = createQueueSettingsSaver({ stateStore: { read: () => state, update: patch => (state = { ...state, ...patch }) },
    assertActive() {}, publish() {}, getQueue: () => null, applyRuntimeParameters() { throw new Error("fixture disk failure"); } });
  const result = await save({ maxConcurrent: 4, queueTimeoutMinutes: 15, minSendIntervalSeconds: 3 }, 1, { ...defaults, maxRetries: 0 });
  assert.equal(result.applyState, "apply-failed");
  assert.equal(state.runtimeParameters.maxRetries, 0);
});
