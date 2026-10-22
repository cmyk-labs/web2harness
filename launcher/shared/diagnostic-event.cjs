// Shared by the Bun runtime, browser helper and Electron. No credentials or payload bodies.
const { randomUUID, createHash } = require("node:crypto");
const PREFIX = "@web2harness/diagnostic ";
const processInstanceId = randomUUID();
const errorReferences = new WeakMap();
let sequence = 0;
const SECRET = /authorization|cookie|password|secret|token|credential|runtimekey|license(code)?|privatekey|apikey|storageState/i;
const CONTENT = /^(prompt|response|content|html|dom|input|output|arguments|result|text|messages|command|patch|script|stdout|stderr|conversationTitles?|chatTitles?|sidebarRows|visibleRows)$/i;
const MARKDOWN_TAGS = new Set("root inline ol:item ul:item address article aside blockquote div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table ul span code thead tbody tfoot tr th td dt dd math".split(" "));
const QUEUE_ENUMS = {
  delivery: new Set(["append", "buffered"]),
  observedTag: MARKDOWN_TAGS,
  committedTag: MARKDOWN_TAGS,
  resourceKind: new Set(["document", "script", "stylesheet", "conversation", "other"]),
  networkFailure: new Set(["aborted", "network_changed", "connection", "timeout", "other"]),
  handoffScope: new Set(["top_level", "exec", "catalog", "invalid"]),
  state: new Set(["queued", "preparing", "running", "waiting-user", "waiting-tools", "stopping", "succeeded", "failed", "cancelled", "timed-out", "ready", "already_committed", "awaiting_intent", "activity_in_flight", "open", "submitted", "finished"]),
  pausedReason: new Set(["user", "account_rate_limited", "browser_unavailable", "send_outcome_unknown"]),
  sendProgress: new Set(["preflight", "waiting_permit", "sending", "awaiting_ack", "reconciling", "confirmed", "not-sent", "unknown"]),
  sendFailureScope: new Set(["task", "global"]),
};
const TEXT = new Set(("message error reason code errorCode errorName errorDescription category status phase stage operation line stack cause detail signal model effort mode interactionMode browserInteractionMode checkpoint traceId requestId sessionId launcherSessionId processInstanceId operationId parentOperationId toolEventId toolName cellId event source component id eventId at capturedAt tag role ariaExpanded ariaChecked dataState dataHighlighted origin type channel connector timeBasis version currentVersion platform arch osRelease profile language electron node chrome outcome cancelSource deliveryState requestedModel verifiedModel requestedEffort verifiedEffort modelFamily budgetPolicy targetRole networkPhase systemCode endpoint reader transport severity tabId method purpose submission receiptId receiptStatus configRevision sandboxMode approvalMode observedDecision evidence verification changedKey previous next lastProgressAt").split(" "));
function cleanText(input) {
  return String(input).slice(0, 16384)
    // Playwright can wrap every action-log line in ANSI styling even in captured logs.
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/W2H1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[license]")
    .replace(/tunnel_[a-f0-9]{32}/g, "[tunnel-id]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[runtime-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s"'`<>]+/gi, candidate => { try { return new URL(candidate).origin; } catch { return "[url removed]"; } })
    .replace(/\b[A-Za-z]:\\+Users\\+[^\\/\r\n"'`<>|]+/gi, "[user-home]")
    .replace(/\/(?:Users|home)\/[^/\r\n"'`<>]+/g, "[user-home]")
    .replace(/<codex_context_json>[\s\S]*?(?:<\/codex_context_json>|$)/gi, "[conversation removed]")
    // Playwright actionability logs include DOM previews (attributes and visible text).
    // Keep the failure reason after the preview, never the page content it embeds.
    .replace(/(^[ \t]*(?:-\s+)?(?:\d+\s*[×x]\s+)?(?:locator resolved to\s+)?)(<[a-z!/][^\r\n]*>)/gim, "$1[DOM removed]")
    .replace(/\b(?:token|access_token|refresh_token|api[_-]?key|password|cookie|authorization|controlToken|runtimeKey|client_secret|licenseCode)\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "[credential removed]")
    .replace(/\b(?:turn|binding|call)_[A-Za-z0-9_-]{12,}\b/g, "[binding removed]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/((?:visible rows|sidebar (?:rows|titles)|conversation titles):)\s*[^\r\n]*/gi, "$1 [redacted]")
    .replace(/((?:prompt|response|tool result|tool output|conversation content)\s*[:=])[\s\S]*/gi, "$1 [content removed]");
}
for (const key of ["errorType", "errno", "syscall"]) TEXT.add(key);
function safeDetail(value, depth = 0) {
  if (depth > 10) return "[depth limit]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => typeof item === "string" ? "[text removed]" : safeDetail(item, depth + 1));
  if (!value || typeof value !== "object") return "[removed]";
  return Object.fromEntries(Object.entries(value).slice(0, 200).filter(([, item]) => item !== undefined).map(([key, item]) => [
    key, SECRET.test(key) || CONTENT.test(key) ? "[removed]"
      : typeof item === "string" ? (Object.hasOwn(QUEUE_ENUMS, key) ? (QUEUE_ENUMS[key].has(item) ? item : "[text removed]")
        : ["groupId", "roundRef", "errorRef", "diagnosticRef"].includes(key) ? (/^diag-[a-f0-9]{24}$/.test(item) ? item : "[text removed]")
        : ["attemptId", "queueId", "websocketRequestId", "websocketConnectionId", "firstEventId", "parentEventId", "triggerEventId", "controlId", "nodeId", "itemId", "menuId"].includes(key) ? (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item) || key === "queueId" && /^[a-f0-9]{64}$/.test(item) ? item : "[text removed]")
        : key === "helperRequestId" ? (/^[A-Za-z0-9_-]{6,128}$/.test(item) ? item : "[text removed]")
        : key === "sourceId" ? (/^[a-f0-9]{64}$/.test(item) ? item : "[text removed]")
        : TEXT.has(key) ? cleanText(item) : "[text removed]")
      : safeDetail(item, depth + 1),
  ]));
}
function sourceFor(record) {
  if (["launcher", "runtime", "browser", "codex", "connection", "update"].includes(record.component)) return record.component;
  if (/tunnel|mcp|connector/i.test(record.event)) return "connection";
  if (/update|install/i.test(record.event)) return "update";
  if (/browser/i.test(record.event)) return "browser";
  if (/^codex\.|tool/i.test(record.event)) return "codex";
  if (/^runtime\.|^http\.|^usage\.|^dev_profile\./.test(record.event)) return "runtime";
  return "launcher";
}
function createDiagnosticRecord(level, event, detail = {}) {
  return { schemaVersion: 2, eventId: randomUUID(), at: new Date().toISOString(), level,
    component: sourceFor({ event }), event, detail: safeDetail({ ...detail, processInstanceId, pid: process.pid, seq: ++sequence }) };
}
function parseDiagnosticLine(line) {
  if (typeof line !== "string" || !line.startsWith(PREFIX) || line.length > 262144) return null;
  try {
    const value = JSON.parse(line.slice(PREFIX.length));
    if (value.schemaVersion !== 2 || !["info", "warning", "error", "debug"].includes(value.level)
      || typeof value.event !== "string" || !/^[a-z][a-z0-9_.-]{0,120}$/.test(value.event)
      || typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at))
      || typeof value.eventId !== "string" || !/^[a-f0-9-]{36}$/.test(value.eventId)) return null;
    return { schemaVersion: 2, eventId: value.eventId, at: value.at, level: value.level,
      component: sourceFor(value), event: value.event, detail: safeDetail(value.detail ?? {}) };
  } catch { return null; }
}
function diagnosticError(error) {
  // Bound the whole graph, not just each branch: AggregateError can fan out exponentially.
  const seen = new WeakSet();
  let remaining = 16;
  let remainingText = 32768;
  const text = value => {
    const cleaned = cleanText(value).slice(0, Math.min(2048, remainingText));
    remainingText -= cleaned.length;
    return cleaned;
  };
  const read = (object, key) => { try { return object[key]; } catch { return undefined; } };
  const visit = (value, depth) => {
    const candidate = value && typeof value === "object" ? value : {};
    let errorRef = errorReferences.get(candidate);
    if (!errorRef) { errorRef = diagnosticReference(randomUUID()); errorReferences.set(candidate, errorRef); }
    if (seen.has(candidate)) return { errorRef, message: "[circular or repeated error]" };
    seen.add(candidate);
    remaining--;
    const name = read(candidate, "name"), code = read(candidate, "code"), message = read(candidate, "message");
    const status = read(candidate, "status"), retryable = read(candidate, "retryable");
    const stack = read(candidate, "stack"), cause = read(candidate, "cause"), errors = read(candidate, "errors");
    const cancelled = name === "AbortError" || code === "client_cancelled" || status === 499;
    const result = { errorRef, errorName: text(typeof name === "string" ? name : "Error"),
      code: text(typeof code === "string" || typeof code === "number" ? code : "unknown"),
      message: text(typeof message === "string" ? message : typeof value === "string" ? value : "Unknown error"),
      ...(typeof stack === "string" ? { stack: text(stack) } : {}),
      category: cancelled ? "cancelled" : /timeout|timed out/i.test(typeof message === "string" ? message : "") ? "timeout" : "failure",
      ...(typeof status === "number" && Number.isInteger(status) ? { status } : {}),
      ...(typeof retryable === "boolean" ? { retryable } : {}) };
    // Whitelist network metadata; never serialize an entire request, response or socket.
    for (const key of ["errorType", "errno", "syscall", "diagnosticRef"]) {
      const item = read(candidate, key);
      if (typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) result[key] = typeof item === "string" ? text(item) : item;
    }
    if (cause !== undefined) {
      if (depth < 3 && remaining > 0) result.cause = visit(cause, depth + 1);
      else result.causeOmitted = true;
    }
    if (Array.isArray(errors)) {
      result.errors = [];
      for (let i = 0; i < Math.min(errors.length, 8) && depth < 3 && remaining > 0; i++) result.errors.push(visit(errors[i], depth + 1));
      if (result.errors.length < errors.length) result.errorsOmitted = errors.length - result.errors.length;
    }
    return result;
  };
  return safeDetail(visit(error, 0));
}
// Inputs must be opaque, high-entropy task/call IDs, never passwords or user content.
function diagnosticReference(value) { return `diag-${createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`; }
module.exports = { PREFIX, cleanText, safeDetail, sourceFor, createDiagnosticRecord, parseDiagnosticLine, diagnosticError, diagnosticReference };
