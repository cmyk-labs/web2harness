// Shared by the Bun runtime, browser helper and Electron. No credentials or payload bodies.
const { randomUUID, createHash } = require("node:crypto");
const PREFIX = "@web2harness/diagnostic ";
const processInstanceId = randomUUID();
let sequence = 0;
const SECRET = /authorization|cookie|password|secret|token|credential|runtimekey|license(code)?|privatekey|apikey|storageState/i;
const CONTENT = /^(prompt|response|content|html|dom|input|output|arguments|result|text|messages|command|patch|script|stdout|stderr|conversationTitles?|chatTitles?|sidebarRows|visibleRows)$/i;
const TEXT = new Set(("message error reason code errorCode errorName errorDescription category status phase stage operation line stack cause detail signal model effort mode interactionMode browserInteractionMode checkpoint traceId requestId sessionId launcherSessionId processInstanceId operationId parentOperationId toolEventId toolName cellId event source component id eventId at capturedAt tag role ariaExpanded ariaChecked dataState dataHighlighted origin type channel connector timeBasis version currentVersion platform arch osRelease profile language electron node chrome outcome cancelSource deliveryState requestedModel verifiedModel requestedEffort verifiedEffort modelFamily budgetPolicy targetRole networkPhase systemCode endpoint reader transport severity tabId method purpose submission receiptId receiptStatus configRevision sandboxMode approvalMode observedDecision evidence verification changedKey previous next lastProgressAt").split(" "));
function cleanText(input) {
  return String(input).slice(0, 16384)
    .replace(/W2H1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[license]")
    .replace(/tunnel_[a-f0-9]{32}/g, "[tunnel-id]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[runtime-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s"'`<>]+/gi, candidate => { try { return new URL(candidate).origin; } catch { return "[url removed]"; } })
    .replace(/\b[A-Za-z]:\\+Users\\+[^\\/\r\n"'`<>|]+/gi, "[user-home]")
    .replace(/\/(?:Users|home)\/[^/\r\n"'`<>]+/g, "[user-home]")
    .replace(/<codex_context_json>[\s\S]*?(?:<\/codex_context_json>|$)/gi, "[conversation removed]")
    .replace(/\b(?:access_token|refresh_token|api[_-]?key|password|cookie|authorization|controlToken|runtimeKey|client_secret|licenseCode)\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "[credential removed]")
    .replace(/\b(?:turn|binding|call)_[A-Za-z0-9_-]{12,}\b/g, "[binding removed]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/((?:visible rows|sidebar (?:rows|titles)|conversation titles):)\s*[^\r\n]*/gi, "$1 [redacted]")
    .replace(/((?:prompt|response|tool result|tool output|conversation content)\s*[:=])[\s\S]*/gi, "$1 [content removed]");
}
function safeDetail(value, depth = 0) {
  if (depth > 10) return "[depth limit]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => typeof item === "string" ? "[text removed]" : safeDetail(item, depth + 1));
  if (!value || typeof value !== "object") return "[removed]";
  return Object.fromEntries(Object.entries(value).slice(0, 200).filter(([, item]) => item !== undefined).map(([key, item]) => [
    key, SECRET.test(key) || CONTENT.test(key) ? "[removed]"
      : typeof item === "string" ? (TEXT.has(key) ? cleanText(item) : "[text removed]")
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
function diagnosticError(error, depth = 0) {
  const candidate = error && typeof error === "object" ? error : {};
  const cancelled = candidate.name === "AbortError" || candidate.code === "client_cancelled";
  return safeDetail({ errorName: candidate.name ?? "Error", code: candidate.code ?? "unknown",
    message: candidate.message ?? String(error), ...(candidate.stack ? { stack: candidate.stack } : {}),
    category: cancelled ? "cancelled" : /timeout|timed out/i.test(candidate.message ?? "") ? "timeout" : "failure",
    ...(typeof candidate.retryable === "boolean" ? { retryable: candidate.retryable } : {}),
    ...(candidate.cause && depth < 3 ? { cause: diagnosticError(candidate.cause, depth + 1) } : {}) });
}
// Inputs must be opaque, high-entropy task/call IDs, never passwords or user content.
function diagnosticReference(value) { return `diag-${createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`; }
module.exports = { PREFIX, cleanText, safeDetail, sourceFor, createDiagnosticRecord, parseDiagnosticLine, diagnosticError, diagnosticReference };
