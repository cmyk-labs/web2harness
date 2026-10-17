"use strict";
const options = require("./context-budget-options.json");
const keys = Object.keys(options.defaults);
function validContextWindow(value) {
  return Number.isSafeInteger(value) && value >= options.minimumWindow && value <= options.maximumWindow;
}
function normalizeContextWindows(config = {}) {
  const contextWindows = {}, contextWindowSources = {};
  for (const key of keys) {
    const user = config.contextWindowSources?.[key] === "user";
    if (user && !validContextWindow(config.contextWindows?.[key])) {
      throw new Error(`Invalid context window / 上下文窗口无效: ${key} (${options.minimumWindow}–${options.maximumWindow})`);
    }
    contextWindows[key] = user ? config.contextWindows[key] : options.defaults[key];
    contextWindowSources[key] = user ? "user" : "default";
  }
  return { contextWindows, contextWindowSources };
}
// A patch carries explicit intent, including selecting the default value manually.
function applyContextWindowEdits(config, edits) {
  if (!edits || typeof edits !== "object" || Array.isArray(edits)
    || !Object.keys(edits).length || Object.keys(edits).some(key => !keys.includes(key))) {
    throw new Error("Invalid context window edits / 上下文窗口修改无效");
  }
  const normalized = normalizeContextWindows(config);
  for (const [key, value] of Object.entries(edits)) {
    if (value !== "default" && !validContextWindow(value)) throw new Error(`Invalid context window / 上下文窗口无效: ${key}`);
    normalized.contextWindows[key] = value === "default" ? options.defaults[key] : value;
    normalized.contextWindowSources[key] = value === "default" ? "default" : "user";
  }
  return normalized;
}
module.exports = { validContextWindow, normalizeContextWindows, applyContextWindowEdits };
