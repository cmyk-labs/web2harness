const { cleanText } = require("./diagnostic-event.cjs");
const { validMcpRemoteFailure } = require("./mcp-remote-error.cjs");

// Explicit, bounded data for helper and renderer boundaries; never serialize causes/stacks.
function browserOperationError(value) {
  const error = value && typeof value === "object" ? value : {};
  const result = { message: cleanText(typeof error.message === "string" ? error.message : "Browser operation failed").slice(0, 2000) };
  for (const key of ["name", "code", "errorType", "operationId"]) {
    if (typeof error[key] === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(error[key])) result[key] = error[key];
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) result.status = error.status;
  if (typeof error.retryable === "boolean") result.retryable = error.retryable;
  if (/^diag-[a-f0-9]{24}$/.test(error.diagnosticRef)) result.diagnosticRef = error.diagnosticRef;
  if (validMcpRemoteFailure(error.mcpRemote)) result.mcpRemote = error.mcpRemote;
  if (typeof error.cleanupMessage === "string") result.cleanupMessage = cleanText(error.cleanupMessage).slice(0, 2000);
  return result;
}

function browserFailureKind(error) {
  if (error?.name === "AbortError" || error?.status === 499 || error?.code === "client_cancelled") return "cancelled";
  if (/^queue_blocked_(user|send_outcome_unknown|account_rate_limited|browser_unavailable)$/.test(error?.code)
    || error?.code === "queue_configuration_busy") return "blocked";
  return "failed";
}

module.exports = { browserOperationError, browserFailureKind };
