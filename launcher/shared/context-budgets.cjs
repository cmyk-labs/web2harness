"use strict";
const options = require("./context-budget-options.json");
// Legacy custom windows are migrated on read. Only the independent standard/triple
// preference remains user-controlled; persisted values cannot override this policy.
function normalizeContextWindows(_legacyConfig) {
  return { contextWindows: { ...options.defaults },
    contextWindowSources: { fast: "default", standard: "default" } };
}
function rejectContextWindowEdits(edits) {
  if (edits !== undefined) throw new Error("Context windows are fixed; select standard or triple budget / 上下文窗口为固定值，只能选择标准或三倍预算");
}
module.exports = { normalizeContextWindows, rejectContextWindowEdits };
