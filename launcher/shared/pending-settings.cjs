const { validateRequestScheduling } = require("./request-scheduler.cjs");
const { validateRuntimeParameters, runtimeParameterSourcesForSave } = require("./runtime-parameters.cjs");

const PREFERENCE_KEYS = Object.freeze([
  "experimentalContextFiles", "experimentalContextTripleBudget", "experimentalSkillAttachments",
  "experimentalFreshConversationPerTurn", "useSavedChats",
]);
function validatePendingSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved settings");
  const allowed = [...PREFERENCE_KEYS, "requestScheduling", "runtimeParameters", "runtimeParameterSources"];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unknown saved setting");
  const result = {};
  for (const key of PREFERENCE_KEYS) if (Object.hasOwn(value, key)) {
    if (typeof value[key] !== "boolean") throw new Error(`Invalid saved setting: ${key}`);
    result[key] = value[key];
  }
  if (value.requestScheduling !== undefined) result.requestScheduling = validateRequestScheduling(value.requestScheduling);
  if (value.runtimeParameters !== undefined) {
    result.runtimeParameters = validateRuntimeParameters(value.runtimeParameters);
    result.runtimeParameterSources = runtimeParameterSourcesForSave(undefined, undefined,
      result.runtimeParameters, value.runtimeParameterSources);
  } else if (value.runtimeParameterSources !== undefined) throw new Error("Saved parameter sources require values");
  return result;
}
// Only settings pages overlay the pending values. Runtime readers keep using applied state.
function settingsForEditing(state) { return { ...state, ...state.pendingSettings }; }
module.exports = { PREFERENCE_KEYS, validatePendingSettings, settingsForEditing };
