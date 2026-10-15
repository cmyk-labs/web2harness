const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createQueueSettingsSaver } = require("../electron/runtime/queue-settings.cjs");
const settings = { maxConcurrent: 4, queueTimeoutMinutes: 15, minSendIntervalSeconds: 3 };
function fixture(queue = null) {
  let state = { requestScheduling: settings, requestSchedulingRevision: 1 };
  let licensed = true;
  const published = [];
  const save = createQueueSettingsSaver({
    stateStore: { read: () => state, update: value => (state = { ...state, ...value }) },
    getQueue: () => queue, publish: value => published.push(value),
    assertActive: async () => { if (!licensed) throw new Error("License inactive"); },
  });
  return { save, published, state: () => state, expire: () => { licensed = false; } };
}
test("settings persistence and runtime application report distinct outcomes", async () => {
  const stopped = fixture();
  assert.deepEqual(await stopped.save(settings, 1), { state: stopped.state(), persistedRevision: 2, appliedRevision: null, applyState: "pending-start" });
  const failed = fixture({ snapshot: () => ({ configRevision: 1 }), updateSettings: async () => { throw new Error("fixture apply failed"); } });
  const result = await failed.save({ ...settings, maxConcurrent: 2 }, 1);
  assert.equal(result.applyState, "apply-failed");
  assert.equal(result.persistedRevision, 2); assert.equal(result.appliedRevision, 1);
  assert.equal(failed.state().requestScheduling.maxConcurrent, 2);
  assert.deepEqual(failed.published, [result.state]);
});
test("concurrent stale drafts cannot overwrite a saved revision", async () => {
  let release;
  const applying = new Promise(resolve => { release = resolve; });
  const f = fixture({ snapshot: () => ({ configRevision: 1 }), updateSettings: async (_settings, revision) => { await applying; return { configRevision: revision }; } });
  const first = f.save({ ...settings, maxConcurrent: 2 }, 1);
  const second = f.save({ ...settings, maxConcurrent: 3 }, 1);
  const refused = assert.rejects(second, /changed/);
  release();
  assert.equal((await first).applyState, "applied");
  await refused;
  assert.equal(f.state().requestScheduling.maxConcurrent, 2);
  assert.equal(f.published.length, 1);
});
test("invalid settings and expired license preserve the persisted state", async () => {
  const f = fixture();
  await assert.rejects(f.save({ ...settings, minSendIntervalSeconds: 0 }, 1));
  f.expire();
  await assert.rejects(f.save(settings, 1), /License inactive/);
  assert.equal(f.state().requestSchedulingRevision, 1);
  assert.equal(f.published.length, 0);
});
