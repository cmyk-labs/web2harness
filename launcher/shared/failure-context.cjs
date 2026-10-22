// A bounded flight recorder over structural diagnostics only. No page/protocol bodies.
const { createDiagnosticRecord } = require("./diagnostic-event.cjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const IDS = new Set("requestId traceId attemptId queueId websocketRequestId websocketConnectionId processInstanceId eventId firstEventId parentEventId controlId nodeId itemId menuId".split(" "));
const ENUMS = {
  source: new Set(["aria", "header", "unknown"]), modelFamily: new Set(["5.6", "6", "unknown"]),
  model: new Set(["sol", "astra", "unknown"]), effort: new Set(["instant", "medium", "high", "extra high", "pro", "unknown"]),
  requestedEffort: new Set(["low", "medium", "high", "xhigh", "max"]),
  language: new Set(["en", "zh", "other", "unknown"]),
  deliveryState: new Set(["validating", "journaled", "emitting", "emitter_returned"]),
  sendFailureScope: new Set(["task", "global"]),
};
const NATIVE_FAILURES = new Set(["native_tool_contract", "structured_output", "observer_write", "internal_error"]);
const NATIVE_ISSUES = new Set("block_json block_shape call_shape tool_name tool_namespace tool_kind call_fields arguments_shape arguments_schema empty_block batch_constraints internal_error".split(" "));
const SCHEMA_KEYWORDS = new Set("type required additionalProperties enum const anyOf oneOf allOf not if false schema maximum minimum exclusiveMaximum exclusiveMinimum multipleOf maxLength minLength pattern format maxItems minItems uniqueItems contains maxContains minContains maxProperties minProperties dependencies dependentRequired propertyNames additionalItems items".split(" "));
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value && typeof value === "object" && !Array.isArray(value);
// Dedicated typed paths: do not grant arbitrary nested categories, codes, schemas or text
// access to the general recorder. Keep large validation failures within its 4096-byte row cap.
function nativeFailure(value) {
  if (!object(value)) return {};
  const result = { category: NATIVE_FAILURES.has(value.category) ? value.category : "unrecognized" };
  if (nonnegativeInteger(value.issueCount)) result.issueCount = value.issueCount;
  if (nonnegativeInteger(value.omittedIssues)) result.omittedIssues = value.omittedIssues;
  if (Array.isArray(value.issues)) {
    result.issues = value.issues.slice(0, 8).map(issue => {
      if (!object(issue)) return { category: "unrecognized" };
      const projected = { category: NATIVE_ISSUES.has(issue.category) ? issue.category : "unrecognized" };
      if (issue.callIndex === null || nonnegativeInteger(issue.callIndex)) projected.callIndex = issue.callIndex;
      if (Array.isArray(issue.keywords)) {
        projected.keywords = [...new Set(issue.keywords.filter(entry => object(entry) && SCHEMA_KEYWORDS.has(entry.code))
          .map(entry => entry.code))].slice(0, 4).map(code => ({ code }));
        const omitted = Math.min(Number.MAX_SAFE_INTEGER, (nonnegativeInteger(issue.omittedKeywords) ? issue.omittedKeywords : 0)
          + issue.keywords.length - projected.keywords.length);
        if (omitted) projected.omittedKeywords = omitted;
      }
      return projected;
    });
    result.omittedIssues = Math.min(Number.MAX_SAFE_INTEGER, (result.omittedIssues ?? 0) + value.issues.length - result.issues.length);
  }
  return result;
}
function nativeContract(value) {
  if (!object(value)) return {};
  return {
    ...(value.version === "native_tool_calls_v1" ? { version: value.version } : {}),
    ...(typeof value.sourceId === "string" && /^[a-f0-9]{64}$/.test(value.sourceId) ? { sourceId: value.sourceId } : {}),
  };
}
const STRUCTURES = new Set("checks control radio slider descriptions relationships owners descriptionNodes interruption cause error".split(" "));
const NUMBERS = new Set("pid helperPid seq httpTurnId httpStatus exitCode pendingCount durationMs elapsedMs attempts count min max value target previousValue targetValue direction headerCount chunks bytes ownerCount descriptionCount omittedDescriptions omittedDescriptionNodes omittedOwners index textChars".split(" "));
const FLAGS = new Set("checked recognized familyMatches nameMatches effortMatches sliderMatches descriptionsMatch snapshotPresent sliderValid connected visible busy enabled inViewport modal focused blocked signalAborted callerAborted queueAborted localFailure restoredQueueError dispatched terminalSeen cancelled owned outputFailed observerAborted clientAcknowledged present inMenu expanded closed truncated menuPresent menuVisible".split(" "));
const LABELS = new Set("stage phase origin outcome cancelSource submission state reason code systemCode signal".split(" "));
const KNOWN_LABELS = new Set(("http_client_abort http_turn_cancel http_shutdown websocket_close websocket_transport queue_interrupt helper_local_abort helper_protocol helper_shutdown_requested helper_input_closed helper_sigint helper_sigterm helper_output_failure helper_exit helper_input_failure "
  + "adapter_cancel compaction_stage_abort native_binding_retired native_retirement_failed adapter_signal_forwarded "
  + "effort_selection control visible opened menu_open selection_read menu_close closed_control_read menu_closed menu_rebuilt "
  + "family_radio model_snapshot selection_confirmation model_selection selection_mismatch description_unknown observation_failed validating journaled emitter_returned committed returned confirmed_without_input confirmed_during_input failed cancelled succeeded started transport-closed already-selected action-returned verified not-sent local_signal local_protocol queue caller none "
  + "queued preparing running waiting-user waiting-tools stopping timed-out request dispatch response_headers http_error_body sse_read sse_parse sse_validate send cleanup steering terminal_send preflight waiting_permit sending awaiting_ack reconciling confirmed unknown "
  + "ECONNRESET ECONNREFUSED EPIPE ETIMEDOUT ECONNABORTED ENETUNREACH EHOSTUNREACH ENOTFOUND EAI_AGAIN UND_ERR_SOCKET UND_ERR_CONNECT_TIMEOUT UND_ERR_HEADERS_TIMEOUT ABORT_ERR SIGTERM SIGINT SIGKILL model_version_unavailable").split(" "));
function structural(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return {};
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (IDS.has(key) && typeof item === "string" && (UUID.test(item) || key === "queueId" && /^[a-f0-9]{64}$/.test(item) || key === "traceId" && /^[a-f0-9_-]{6,128}$/.test(item))) result[key] = item;
    else if (["groupId", "roundRef", "errorRef", "diagnosticRef"].includes(key) && /^diag-[a-f0-9]{24}$/.test(item)) result[key] = item;
    else if (key === "sourceId" && /^[a-f0-9]{64}$/.test(item)) result[key] = item;
    else if (key === "retryAttempt" && nonnegativeInteger(item)) result[key] = item;
    else if (key === "failure") result[key] = nativeFailure(item);
    else if (key === "contract") result[key] = nativeContract(item);
    else if (NUMBERS.has(key) && (typeof item === "number" && Number.isFinite(item) || item === null)) result[key] = item;
    else if (FLAGS.has(key) && typeof item === "boolean") result[key] = item;
    else if (ENUMS[key]?.has(item)) result[key] = item;
    // Only programmatic labels, never free-form error messages, URLs or page text.
    else if (LABELS.has(key) && typeof item === "string") result[key] = KNOWN_LABELS.has(item) ? item : "unrecognized";
    else if ((key === "descriptionNodes" || key === "owners") && Array.isArray(item)) {
      // Keep structural model failures below the existing 4096-byte row budget.
      // Full bounded samples remain in the original event/private failure archive.
      const limit = key === "descriptionNodes" ? 4 : 2;
      const count = value[key === "descriptionNodes" ? "descriptionCount" : "ownerCount"];
      result[key] = item.slice(0, limit).map(entry => structural(entry, depth + 1));
      result[key === "descriptionNodes" ? "omittedDescriptionNodes" : "omittedOwners"] =
        Math.max(0, (nonnegativeInteger(count) ? count : item.length) - result[key].length);
    }
    else if (STRUCTURES.has(key) && item && typeof item === "object") result[key] = Array.isArray(item)
      ? item.slice(0, 8).map(entry => structural(entry, depth + 1)) : structural(item, depth + 1);
  }
  return result;
}
function createFailureContextRecorder({ maxOwners = 32, maxRecords = 48, maxBytes = 32768, ttlMs = 30 * 60 * 1000 } = {}) {
  const owners = new Map();
  let evictedOwners = 0;
  function remember(record, now = Date.now()) {
    if (!/^(?:http\.|browser\.(?:queue_|helper_|model_|effort_|send|native_reply)|runtime\.interruption_observed)/.test(record.event)) return [];
    for (const [key, entry] of owners) if (now - entry.updated > ttlMs) { owners.delete(key); evictedOwners++; }
    const detail = structural(record.detail);
    const key = detail.requestId ?? detail.attemptId ?? detail.traceId;
    const targets = key ? [key] : [...owners].filter(([, entry]) => detail.helperPid
      ? entry.helpers.has(detail.helperPid) : entry.processes.has(detail.processInstanceId)).map(([id]) => id);
    if (!targets.length && !key) return [];
    const snapshots = [];
    for (const id of targets) {
      let entry = owners.get(id);
      if (!entry) {
        if (owners.size >= maxOwners) { owners.delete(owners.keys().next().value); evictedOwners++; }
        entry = { updated: now, rows: [], bytes: 0, dropped: 0, processes: new Set(), helpers: new Set(), firstInterruptions: new Set() };
        owners.set(id, entry);
      }
      entry.updated = now;
      if (detail.processInstanceId) entry.processes.add(detail.processInstanceId);
      if (record.event === "browser.helper_turn_bound" && detail.pid) entry.helpers.add(detail.pid);
      const row = { eventId: record.eventId, at: record.at, event: record.event, detail };
      const bytes = Buffer.byteLength(JSON.stringify(row));
      if (bytes <= 4096) {
        entry.rows.push(row); entry.bytes += bytes;
        while (entry.rows.length > maxRecords || entry.bytes > maxBytes) {
          // Keep initial binding evidence while retaining recent failure context.
          const [removed] = entry.rows.splice(entry.rows.length > 1 ? 1 : 0, 1);
          entry.bytes -= Buffer.byteLength(JSON.stringify(removed)); entry.dropped++;
        }
      } else entry.dropped++;
      const first = detail.interruption?.firstEventId;
      const interruption = record.event === "runtime.interruption_observed" && first && !entry.firstInterruptions.has(first);
      if (interruption) entry.firstInterruptions.add(first);
      if (interruption || record.level === "error" || record.level === "warning") {
        snapshots.push(createDiagnosticRecord("info", "diagnostics.failure_context", {
          ...structural(entry.rows.findLast(row => row.detail.requestId || row.detail.attemptId || row.detail.traceId)?.detail),
          ...structural(entry.rows.at(-1)?.detail), triggerEventId: record.eventId,
          capturedAt: record.at, retainedRecords: entry.rows.length, droppedRecords: entry.dropped, evictedOwners,
          records: entry.rows.map(row => ({ ...row, detail: { ...row.detail } })),
        }));
      }
      // Bound auxiliary identity sets even for a long-lived request with many attempts.
      for (const set of [entry.processes, entry.helpers, entry.firstInterruptions]) while (set.size > 64) set.delete(set.values().next().value);
    }
    return snapshots;
  }
  return { remember, size: () => owners.size };
}
module.exports = { createFailureContextRecorder };
