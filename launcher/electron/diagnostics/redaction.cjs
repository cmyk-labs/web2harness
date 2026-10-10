const { createHash } = require("node:crypto");
const { cleanText, safeDetail, sourceFor } = require("../../shared/diagnostic-event.cjs");
function safeRecord(record) {
  const detail = safeDetail(record.detail ?? {});
  const line = typeof detail.line === "string" ? detail.line : "";
  const trace = line.match(/\btrace(?:Id)?[=:]\s*([A-Za-z0-9_-]{6,128})/)?.[1];
  if (trace && !detail.traceId) detail.traceId = trace;
  const safe = { at: record.at, level: record.level, event: cleanText(record.event), source: sourceFor(record), detail };
  if (record.schemaVersion === 2) { safe.schemaVersion = 2; safe.eventId = cleanText(record.eventId ?? ""); safe.component = sourceFor(record); }
  safe.id = createHash("sha256").update(JSON.stringify(safe)).digest("hex").slice(0, 24);
  return safe;
}
module.exports = { cleanText, safeDetail, safeRecord, sourceFor };
