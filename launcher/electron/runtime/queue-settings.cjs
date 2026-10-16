const { validateRequestScheduling } = require("../../shared/request-scheduler.cjs");
const { validateRuntimeParameters, runtimeParameterSourcesForSave } = require("../../shared/runtime-parameters.cjs");

// Serialize the whole transaction, including live application and publication.
// Persistence is authoritative; a failed apply must not masquerade as a failed save.
function createQueueSettingsSaver({ stateStore, getQueue, publish, assertActive, applyRuntimeParameters }) {
  let tail = Promise.resolve();
  return (value, expectedRevision, parameters, parameterEdits) => {
    const operation = tail.then(async () => {
      await assertActive();
      const settings = validateRequestScheduling(value);
      const runtimeParameters = parameters === undefined ? undefined : validateRuntimeParameters(parameters);
      if (parameterEdits !== undefined && !runtimeParameters) throw new Error("Runtime parameter edits require values / 运行参数修改需要提供数值");
      const current = stateStore.read();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.requestSchedulingRevision) {
        throw new Error("Settings changed. Reopen the page before saving / 设置已变更，请重新打开页面后保存。");
      }
      const persistedRevision = expectedRevision + 1;
      const runtimeParameterSources = runtimeParameters
        ? runtimeParameterSourcesForSave(current.runtimeParameters, current.runtimeParameterSources, runtimeParameters, parameterEdits)
        : undefined;
      const state = stateStore.update({ requestScheduling: settings, requestSchedulingRevision: persistedRevision,
        ...(runtimeParameters ? { runtimeParameters, runtimeParameterSources } : {}) });
      const queue = getQueue();
      let applyState = queue ? "applied" : "pending-start";
      let appliedRevision = queue?.snapshot().configRevision ?? null;
      try {
        if (runtimeParameters) await applyRuntimeParameters?.(runtimeParameters);
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
