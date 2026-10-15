const { validateRequestScheduling } = require("../../shared/request-scheduler.cjs");

// Serialize the whole transaction, including live application and publication.
// Persistence is authoritative; a failed apply must not masquerade as a failed save.
function createQueueSettingsSaver({ stateStore, getQueue, publish, assertActive }) {
  let tail = Promise.resolve();
  return (value, expectedRevision) => {
    const operation = tail.then(async () => {
      await assertActive();
      const settings = validateRequestScheduling(value);
      const current = stateStore.read();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.requestSchedulingRevision) {
        throw new Error("Queue settings changed. Reopen the page before saving your changes.");
      }
      const persistedRevision = expectedRevision + 1;
      const state = stateStore.update({ requestScheduling: settings, requestSchedulingRevision: persistedRevision });
      const queue = getQueue();
      let applyState = queue ? "applied" : "pending-start";
      let appliedRevision = queue?.snapshot().configRevision ?? null;
      try {
        if (queue) {
          const applied = await queue.updateSettings(settings, persistedRevision);
          appliedRevision = applied.configRevision;
          if (appliedRevision !== persistedRevision) applyState = "apply-failed";
        }
      } catch { applyState = "apply-failed"; appliedRevision = queue?.snapshot().configRevision ?? null; }
      publish(state);
      return { state, persistedRevision, appliedRevision, applyState };
    });
    tail = operation.catch(() => {});
    return operation;
  };
}
module.exports = { createQueueSettingsSaver };
