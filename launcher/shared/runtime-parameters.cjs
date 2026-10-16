"use strict";

const options = require("./runtime-parameter-options.json");
const RUNTIME_PARAMETER_CHOICES = Object.freeze(Object.fromEntries(
  Object.entries(options.choices).map(([key, values]) => [key, Object.freeze(values)])));
const DEFAULT_RUNTIME_PARAMETERS = Object.freeze(options.defaults);
function validateRuntimeParameters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_RUNTIME_PARAMETERS, key))) {
    throw new Error("Invalid runtime parameters / 运行参数无效");
  }
  const result = {};
  for (const [key, choices] of Object.entries(RUNTIME_PARAMETER_CHOICES)) {
    if (!choices.includes(value[key])) throw new Error(`Invalid runtime parameter / 运行参数无效: ${key}`);
    result[key] = value[key];
  }
  return result;
}
function normalizeRuntimeParameters(values, sources) {
  const runtimeParameters = {}, runtimeParameterSources = {};
  for (const [key, fallback] of Object.entries(DEFAULT_RUNTIME_PARAMETERS)) {
    const user = sources?.[key] === "user" && RUNTIME_PARAMETER_CHOICES[key].includes(values?.[key]);
    runtimeParameters[key] = user ? values[key] : fallback;
    runtimeParameterSources[key] = user ? "user" : "default";
  }
  return { runtimeParameters, runtimeParameterSources };
}
module.exports = { DEFAULT_RUNTIME_PARAMETERS, RUNTIME_PARAMETER_CHOICES, validateRuntimeParameters, normalizeRuntimeParameters };
