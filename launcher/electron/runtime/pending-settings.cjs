const { PREFERENCE_KEYS, settingsForEditing, validatePendingSettings } = require("../../shared/pending-settings.cjs");
const { validateRequestScheduling } = require("../../shared/request-scheduler.cjs");
const { validateRuntimeParameters, runtimeParameterSourcesForSave } = require("../../shared/runtime-parameters.cjs");

// Serialize saves and explicit application; keep pending values out of runtime state.
function createPendingSettings({ stateStore, license, ready, assertIdle, publish, applyPreference, applyQueue }) {
  let tail = Promise.resolve();
  const serialize = action => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
  const update = patch => { const state = stateStore.update(patch); publish(state); return state; };
  const hasPending = () => Object.keys(stateStore.read().pendingSettings ?? {}).length > 0;
  async function defer() {
    try { return hasPending() || !ready() || (await license.status()).state !== "active"; }
    catch { return true; }
  }
  function validatePreference(key, value) {
    if (!PREFERENCE_KEYS.includes(key) || typeof value !== "boolean") throw new Error("Invalid preference");
    const state = settingsForEditing(stateStore.read());
    if (state.browserInteractionMode === "manual" && key !== "useSavedChats") {
      throw new Error("This preference is unavailable in Zero Risk mode / 手动模式不支持此设置");
    }
    if (key === "experimentalContextTripleBudget" && value && !state.experimentalContextFiles) {
      throw new Error("Enable Context as File before triple budget / 请先开启上下文文件");
    }
  }
  const clear = keys => {
    const pendingSettings = { ...stateStore.read().pendingSettings };
    for (const key of keys) delete pendingSettings[key];
    return update({ pendingSettings });
  };
  return {
    preference: (key, value) => serialize(async () => {
      validatePreference(key, value);
      if (!await defer()) { await license.assertActive(); return applyPreference(key, value); }
      const pendingSettings = { ...stateStore.read().pendingSettings, [key]: value };
      if (key === "experimentalContextFiles" && !value) pendingSettings.experimentalContextTripleBudget = false;
      return update({ pendingSettings: validatePendingSettings(pendingSettings) });
    }),
    queue: (value, expectedRevision, parameters, edits) => serialize(async () => {
      const settings = validateRequestScheduling(value);
      const current = stateStore.read(), desired = settingsForEditing(current);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.requestSchedulingRevision) {
        throw new Error("Settings changed. Reopen the page before saving / 设置已变更，请重新打开页面后保存。");
      }
      const runtimeParameters = parameters === undefined ? undefined : validateRuntimeParameters(parameters);
      if (edits !== undefined && !runtimeParameters) throw new Error("Runtime parameter edits require values");
      const sources = runtimeParameters && runtimeParameterSourcesForSave(desired.runtimeParameters,
        desired.runtimeParameterSources, runtimeParameters, edits);
      if (!await defer()) return applyQueue(settings, expectedRevision, runtimeParameters, edits);
      const state = update({ requestSchedulingRevision: expectedRevision + 1,
        pendingSettings: validatePendingSettings({ ...current.pendingSettings, requestScheduling: settings,
          ...(runtimeParameters ? { runtimeParameters, runtimeParameterSources: sources } : {}) }) });
      return { state, persistedRevision: state.requestSchedulingRevision, appliedRevision: null, applyState: "pending-activation" };
    }),
    apply: () => serialize(async () => {
      await license.assertActive();
      if (!ready()) throw new Error("Initialize the connection before applying saved settings / 请先完成连接配置");
      assertIdle();
      for (const key of PREFERENCE_KEYS) {
        const pending = stateStore.read().pendingSettings ?? {};
        if (!Object.hasOwn(pending, key)) continue;
        validatePreference(key, pending[key]);
        await license.assertActive(); assertIdle();
        await applyPreference(key, pending[key]);
        clear([key]);
      }
      const state = stateStore.read(), pending = state.pendingSettings ?? {};
      if (pending.requestScheduling || pending.runtimeParameters) {
        await license.assertActive(); assertIdle();
        const result = await applyQueue(pending.requestScheduling ?? state.requestScheduling,
          state.requestSchedulingRevision, pending.runtimeParameters, pending.runtimeParameterSources);
        if (result.applyState === "apply-failed") throw new Error("Saved settings could not be applied; retry after checking the runtime / 设置应用失败，请检查运行状态后重试");
        clear(["requestScheduling", "runtimeParameters", "runtimeParameterSources"]);
      }
      return stateStore.read();
    }),
  };
}
module.exports = { createPendingSettings };
