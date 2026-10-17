"use strict";

// Never copy remote prose, URLs, credentials or tool arguments into diagnostics.
const kinds = Object.freeze({
  rate_limit: [429, "mcp_remote_rate_limited", "Remote MCP connection was rate limited (HTTP 429)."],
  authentication: [401, "mcp_remote_authentication", "Remote MCP authentication failed (HTTP 401)."],
  permission: [403, "mcp_remote_permission", "Remote MCP access was denied (HTTP 403)."],
  quota: [429, "mcp_remote_quota", "Remote MCP reported an exhausted usage or spending allowance."],
  unavailable: [503, "mcp_remote_unavailable", "Remote MCP service is unavailable."],
  other: [502, "mcp_remote_error", "The current MCP connector returned a remote error."],
});
function validMcpRemoteFailure(value) {
  return !!value && typeof value === "object" && Object.hasOwn(kinds, value.kind)
    && ["probe", "connector"].includes(value.source)
    && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599
    && (value.retryAfterMs === undefined || Number.isSafeInteger(value.retryAfterMs) && value.retryAfterMs >= 0 && value.retryAfterMs <= Number.MAX_SAFE_INTEGER - Date.now())
    && Object.keys(value).every(key => ["kind", "source", "status", "retryAfterMs"].includes(key));
}
function mcpRemoteErrorInfo(value) {
  if (!validMcpRemoteFailure(value)) throw new Error("Invalid remote MCP error");
  const [, code, message] = kinds[value.kind];
  return { code, message, retryCandidate: value.kind === "rate_limit" || value.kind === "unavailable" };
}

/** Only called for a real connector tool result matched to the current binding. */
function parseMcpRemoteFailure(content, now = Date.now()) {
  const parts = content?.content_type === "text" && Array.isArray(content.parts) ? content.parts : [];
  if (parts.length > 16 || parts.some(part => typeof part !== "string") || parts.reduce((n, part) => n + part.length, 0) > 16_384) return;
  const text = parts.join("\n");
  const probe = /\bMCP SSE probe returned (4\d\d|5\d\d) from openai\.org\b/.exec(text);
  let payload;
  try { payload = JSON.parse(text); } catch { /* Legacy errors are plain text. */ }
  const error = payload?.error && typeof payload.error === "object" ? payload.error : undefined;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const quota = ["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"].includes(code);
  let status = probe ? Number(probe[1]) : quota || ["rate_limit_exceeded", "slow_down"].includes(code) ? 429
    : code === "authentication_error" ? 401 : code === "permission_denied" ? 403 : code === "service_unavailable" ? 503 : undefined;
  if (!status) return;
  const kind = quota ? "quota" : status === 429 ? "rate_limit" : status === 401 ? "authentication"
    : status === 403 ? "permission" : status === 503 ? "unavailable" : "other";
  // Retry-After must be explicit remote error metadata, never inferred from model prose.
  const header = error?.retry_after ?? payload?.headers?.["retry-after"];
  let retryAfterMs;
  if (typeof header === "number" || typeof header === "string") {
    const value = String(header).trim();
    const ms = /^\d+(?:\.\d+)?$/.test(value) ? Math.ceil(Number(value) * 1000) : Date.parse(value) - now;
    if (Number.isFinite(ms) && ms >= 0) retryAfterMs = Math.min(ms, Number.MAX_SAFE_INTEGER - now);
  }
  return { kind, source: probe ? "probe" : "connector", status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}
module.exports = { validMcpRemoteFailure, parseMcpRemoteFailure, mcpRemoteErrorInfo };
