const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { randomUUID } = require("node:crypto");
const { inflateRawSync } = require("node:zlib");
const { createFailureContextRecorder } = require("../../shared/failure-context.cjs");
const { createDiagnosticRecord, PREFIX } = require("../../shared/diagnostic-event.cjs");
const { createLogger } = require("../../electron/logging.cjs");
const { collectDiagnostics, exportBundle } = require("../../electron/diagnostics/bundle.cjs");
const { appendBoundedLog, managedLogFiles, MAX_LOG_BYTES } = require("../../shared/log-retention.cjs");

test("failure recorder preserves first binding and recent states, bounds memory, expires owners and excludes prose", () => {
  const recorder = createFailureContextRecorder({ maxOwners: 2, maxRecords: 4, maxBytes: 2000, ttlMs: 100 });
  const requestId = randomUUID(), attemptId = randomUUID(), other = randomUUID();
  const initial = createDiagnosticRecord("info", "http.request_started", { requestId });
  recorder.remember(initial, 0);
  recorder.remember(createDiagnosticRecord("info", "http.request_started", { requestId: other }), 0);
  for (let i = 0; i < 12; i++) recorder.remember(createDiagnosticRecord("info", "browser.model_verification_state", { requestId, attemptId,
    checks: { radio: { checked: true }, descriptions: [{ source: "aria", effort: "high", effortMatches: false }] }, attempts: i,
    message: "PRIVATE", prompt: "PRIVATE", line: "PRIVATE", error: { message: "PRIVATE", stack: "PRIVATE" } }), i);
  const [snapshot] = recorder.remember(createDiagnosticRecord("warning", "browser.model_verification_failed", { requestId, attemptId }), 13);
  assert.equal(snapshot.detail.records.length, 4); assert.ok(snapshot.detail.droppedRecords > 0);
  assert.equal(snapshot.detail.records[0].eventId, initial.eventId);
  assert.equal(snapshot.detail.attemptId, attemptId);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 4096);
  recorder.remember(createDiagnosticRecord("info", "http.request_started", { requestId: randomUUID() }), 14);
  assert.equal(recorder.size(), 2);
  const [expired] = recorder.remember(createDiagnosticRecord("error", "browser.helper_failed", { requestId: randomUUID() }), 200);
  assert.equal(recorder.size(), 1); assert.ok(expired.detail.evictedOwners >= 3);
});

test("helper process failure snapshots only its bound requests and retains the originating interruption reference", () => {
  const recorder = createFailureContextRecorder();
  const requestId = randomUUID(), processInstanceId = randomUUID(), firstEventId = randomUUID();
  const bound = createDiagnosticRecord("info", "browser.helper_turn_bound", { requestId });
  Object.assign(bound.detail, { pid: 42, processInstanceId }); recorder.remember(bound);
  const error = createDiagnosticRecord("error", "browser.helper_process_exit", { helperPid: 42, interruption: { firstEventId } });
  const [snapshot] = recorder.remember(error);
  assert.equal(snapshot.detail.records[0].detail.requestId, requestId);
  assert.equal(snapshot.detail.interruption.firstEventId, firstEventId);
  assert.deepEqual(recorder.remember(createDiagnosticRecord("error", "browser.helper_process_exit", { helperPid: 99, processInstanceId: randomUUID() })), []);
});

test("model menu and send-control context retains safe enums and measurements without arbitrary text", () => {
  const recorder = createFailureContextRecorder(), requestId = randomUUID();
  for (const detail of [
    { phase: "control", outcome: "visible" },
    { outcome: "opened" },
    { phase: "effort_selection", previousValue: 2, targetValue: 2, min: 0, max: 3 },
    { stage: "selection_read", reason: "menu_closed", attempts: 1 },
    { control: { connected: true, visible: true, enabled: true, inViewport: true, blocked: false, modal: false, focused: true, text: "PRIVATE" } },
  ]) recorder.remember(createDiagnosticRecord("info", "browser.model_preflight", { requestId, ...detail }));
  const [snapshot] = recorder.remember(createDiagnosticRecord("warning", "browser.model_menu_recovery", {
    requestId, phase: "PRIVATE", reason: "menu_rebuilt", cause: { code: "PRIVATE", message: "PRIVATE" },
  }));
  const rows = snapshot.detail.records.map(row => row.detail);
  assert.equal(rows[0].phase, "control"); assert.equal(rows[0].outcome, "visible");
  assert.equal(rows[1].outcome, "opened");
  assert.equal(rows[2].phase, "effort_selection"); assert.equal(rows[2].previousValue, 2); assert.equal(rows[2].targetValue, 2);
  assert.equal(rows[3].stage, "selection_read"); assert.equal(rows[3].reason, "menu_closed");
  assert.deepEqual(rows[4].control, { connected: true, visible: true, enabled: true, inViewport: true, blocked: false, modal: false, focused: true });
  assert.equal(rows[5].phase, "unrecognized"); assert.equal(rows[5].reason, "menu_rebuilt");
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
});

test("send input completion retains acceptance timing without retaining input text", () => {
  const recorder = createFailureContextRecorder(), requestId = randomUUID();
  for (const outcome of ["confirmed_without_input", "confirmed_during_input"]) {
    recorder.remember(createDiagnosticRecord("info", "browser.send_input_completed", {
      requestId, phase: "send", outcome, text: "PRIVATE_INPUT",
    }));
  }
  const [snapshot] = recorder.remember(createDiagnosticRecord("error", "browser.send_input_failed", { requestId, stage: "send" }));
  assert.deepEqual(snapshot.detail.records.slice(0, 2).map(row => row.detail.outcome),
    ["confirmed_without_input", "confirmed_during_input"]);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_INPUT/);
});

test("model reference relationships survive failure context without reference strings or text", () => {
  const recorder = createFailureContextRecorder(), requestId = randomUUID(), nodeId = randomUUID();
  const [snapshot] = recorder.remember(createDiagnosticRecord("warning", "browser.model_verification_failed", {
    requestId, reason: "description_unknown", checks: { descriptionCount: 10, omittedDescriptions: 2,
      relationships: { menuId: randomUUID(), ownerCount: 1, language: "zh", owners: [{ nodeId, expanded: true }] },
      descriptionNodes: [{ source: "aria", nodeId, index: 0, present: true, inMenu: false, textChars: 45,
        reference: "PRIVATE_REFERENCE", text: "PRIVATE_BODY" }] },
  }));
  const detail = snapshot.detail.records[0].detail;
  assert.equal(detail.reason, "description_unknown");
  assert.equal(detail.checks.omittedDescriptions, 2);
  assert.equal(detail.checks.relationships.owners[0].nodeId, nodeId);
  assert.equal(detail.checks.descriptionNodes[0].inMenu, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
});

test("the largest model sample remains useful within the existing failure-record budget", () => {
  const checks = { controlId: randomUUID(), snapshotPresent: true, sliderValid: true, connected: true, visible: true,
    radio: { count: 1, checked: true }, slider: { min: 0, max: 4, value: 3, target: 3 },
    relationships: { itemId: randomUUID(), menuId: randomUUID(), ownerCount: 4, language: "zh", menuPresent: true,
      owners: Array.from({ length: 4 }, () => ({ nodeId: randomUUID(), connected: true, visible: true, expanded: true, closed: false })) },
    descriptionNodes: Array.from({ length: 8 }, (_, index) => ({ source: "aria", index, nodeId: randomUUID(), present: true,
      connected: true, visible: true, inMenu: true, textChars: 1000, truncated: true })),
    descriptions: Array.from({ length: 8 }, () => ({ recognized: true, familyMatches: true, modelFamily: "6", model: "sol",
      effort: "unknown", nameMatches: true, effortMatches: false, source: "aria" })),
    sliderMatches: true, descriptionsMatch: false, descriptionCount: 20, omittedDescriptions: 12 };
  const [snapshot] = createFailureContextRecorder().remember(createDiagnosticRecord("warning", "browser.model_verification_failed", {
    traceId: randomUUID(), requestId: randomUUID(), attemptId: randomUUID(), operationId: randomUUID(), modelFamily: "6",
    requestedEffort: "xhigh", stage: "selection_confirmation", reason: "description_unknown", attempts: 600, checks, submission: "not-sent",
  }));
  assert.equal(snapshot.detail.retainedRecords, 1);
  assert.equal(snapshot.detail.droppedRecords, 0);
  const row = snapshot.detail.records[0];
  assert.ok(Buffer.byteLength(JSON.stringify(row)) < 4096);
  assert.equal(row.detail.checks.omittedDescriptionNodes, 16);
  assert.equal(row.detail.checks.relationships.omittedOwners, 2);
  assert.equal(row.detail.checks.descriptions.length, 8);
});

const nativeContract = { version: "native_tool_calls_v1", sourceId: "a".repeat(64) };
const nativeFailure = { category: "native_tool_contract", issueCount: 2, omittedIssues: 0, issues: [
  { category: "arguments_schema", callIndex: 0, keywords: [{ code: "required" }, { code: "type" }] },
  { category: "block_json", callIndex: null },
] };
test("native failure context retains typed reasons, schema keywords, contract and retry without private payloads", () => {
  const recorder = createFailureContextRecorder(), requestId = randomUUID();
  const [snapshot] = recorder.remember(createDiagnosticRecord("warning", "browser.native_reply_delivery", {
    requestId, retryAttempt: 2, deliveryState: "validating", outcome: "failed", clientAcknowledged: false, observerAborted: false,
    contract: { ...nativeContract, description: "PRIVATE_SCHEMA" }, failure: {
      ...nativeFailure, message: "PRIVATE_ERROR", issues: nativeFailure.issues.map(issue => ({
        ...issue, wireName: "PRIVATE_TOOL", problem: "PRIVATE_PROBLEM", arguments: { private: "PRIVATE_ARGUMENT" },
      })),
    },
  }));
  for (const detail of [snapshot.detail, snapshot.detail.records.at(-1).detail]) {
    assert.deepEqual(detail.failure, nativeFailure);
    assert.deepEqual(detail.contract, nativeContract);
    assert.equal(detail.retryAttempt, 2); assert.equal(detail.deliveryState, "validating");
    assert.equal(detail.clientAcknowledged, false); assert.equal(detail.observerAborted, false);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|"(?:wireName|arguments|problem|description)"\s*:/);
  for (const category of ["structured_output", "observer_write", "internal_error"]) {
    const [next] = recorder.remember(createDiagnosticRecord("warning", "browser.native_reply_delivery", { requestId, failure: { category } }));
    assert.equal(next.detail.failure.category, category);
  }
  for (const category of "block_json block_shape call_shape tool_name tool_namespace tool_kind call_fields arguments_shape arguments_schema empty_block batch_constraints internal_error".split(" ")) {
    const [next] = recorder.remember(createDiagnosticRecord("warning", "browser.native_reply_delivery", {
      requestId, failure: { category: "native_tool_contract", issues: [{ category, callIndex: 0 }] },
    }));
    assert.equal(next.detail.failure.issues[0].category, category);
  }
});

test("native context rejects arbitrary categories, keywords, versions and invalid ordinals/counts", () => {
  const [snapshot] = createFailureContextRecorder().remember(createDiagnosticRecord("warning", "browser.native_reply_delivery", {
    requestId: randomUUID(), retryAttempt: -1, contract: { version: "PRIVATE_VERSION", sourceId: "PRIVATE_HASH" },
    failure: { category: "PRIVATE_CATEGORY", issueCount: -1, omittedIssues: 1.5, issues: [
      { category: "PRIVATE_ISSUE", callIndex: "PRIVATE_INDEX", keywords: [{ code: "PRIVATE_PROPERTY" }, { code: "type", instancePath: "PRIVATE_PATH" }] },
      { category: "arguments_schema", callIndex: -1, keywords: ["PRIVATE_KEYWORD"] },
    ] },
  }));
  assert.deepEqual(snapshot.detail.contract, {}); assert.equal(snapshot.detail.retryAttempt, undefined);
  assert.deepEqual(snapshot.detail.failure, { category: "unrecognized", omittedIssues: 0, issues: [
    { category: "unrecognized", keywords: [{ code: "type" }], omittedKeywords: 1 },
    { category: "arguments_schema", keywords: [], omittedKeywords: 1 },
  ] });
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
});

test("large native validation batches remain below the recorder row limit with explicit omission counts", () => {
  const keywords = "type required additionalProperties enum const anyOf oneOf allOf not if maximum minimum exclusiveMaximum exclusiveMinimum multipleOf maxLength".split(" ").map(code => ({ code }));
  const issues = Array.from({ length: 16 }, (_, callIndex) => ({ category: "arguments_schema", callIndex, keywords }));
  const [snapshot] = createFailureContextRecorder().remember(createDiagnosticRecord("warning", "browser.native_reply_delivery", {
    requestId: randomUUID(), attemptId: randomUUID(), queueId: "b".repeat(64), retryAttempt: 3, contract: nativeContract,
    failure: { category: "native_tool_contract", issueCount: 20, omittedIssues: 4, issues },
  }));
  const row = snapshot.detail.records.at(-1);
  assert.equal(snapshot.detail.droppedRecords, 0); assert.ok(Buffer.byteLength(JSON.stringify(row)) < 4096);
  assert.equal(row.detail.failure.issueCount, 20); assert.equal(row.detail.failure.omittedIssues, 12);
  assert.equal(row.detail.failure.issues.length, 8);
  assert.deepEqual(snapshot.detail.failure, row.detail.failure);
  for (const issue of row.detail.failure.issues) {
    assert.equal(issue.keywords.length, 4); assert.equal(issue.omittedKeywords, 12);
  }
});

test("retained failure context survives launcher rotation and is collected/exported with explicit write failure coverage", t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "w2h-failure-context-"));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith("w2h-failure-context-")); fs.rmSync(root, { recursive: true }); });
  const logsDirectory = path.join(root, "logs"), coreHome = path.join(root, "core");
  fs.mkdirSync(logsDirectory); fs.mkdirSync(coreHome);
  const filePath = path.join(logsDirectory, "launcher.jsonl"), failurePath = path.join(logsDirectory, "failure-context.jsonl");
  const privateArchive = path.join(coreHome, "diagnostics", "browser-turns", "response-source-00");
  fs.mkdirSync(privateArchive, { recursive: true });
  fs.writeFileSync(path.join(privateArchive, "browser-failure.private.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), modelVerification: { descriptions: [{ text: "PRIVATE_MODEL_SAMPLE", reference: "PRIVATE_MODEL_REFERENCE" }] },
  }));
  const logger = createLogger({ filePath }), requestId = randomUUID();
  logger.ingest(PREFIX + JSON.stringify(createDiagnosticRecord("info", "http.request_started", { requestId })));
  logger.ingest(PREFIX + JSON.stringify(createDiagnosticRecord("warning", "browser.model_verification_failed", { requestId, message: "PRIVATE" })));
  logger.ingest(PREFIX + JSON.stringify(createDiagnosticRecord("warning", "browser.native_reply_delivery", {
    requestId, retryAttempt: 1, contract: nativeContract, failure: { ...nativeFailure, message: "PRIVATE_NATIVE" },
  })));
  fs.writeFileSync(filePath, " ".repeat(MAX_LOG_BYTES)); logger.info("runtime.started");
  assert.equal(managedLogFiles(failurePath).length, 1);
  const collection = collectDiagnostics({ logsDirectory, coreHome });
  assert.equal(collection.sources.some(source => source.file.includes("browser-failure.private.json")), false);
  assert.doesNotMatch(JSON.stringify(collection), /PRIVATE_MODEL/);
  const preserved = collection.records.find(row => row.event === "diagnostics.failure_context");
  assert.ok(preserved); assert.equal(preserved.detail.requestId, requestId);
  assert.doesNotMatch(JSON.stringify(preserved), /PRIVATE/);
  assert.ok(collection.sources.some(source => source.file === "failure-context.jsonl" && source.status === "collected"));
  const native = collection.records.find(row => row.event === "diagnostics.failure_context" && row.detail.failure);
  assert.deepEqual(native.detail.failure, nativeFailure); assert.deepEqual(native.detail.contract, nativeContract);
  assert.equal(native.detail.retryAttempt, 1); assert.doesNotMatch(JSON.stringify(native), /PRIVATE/);
  // Exercise the same rotation path used by the new file without deleting other log evidence.
  fs.appendFileSync(failurePath, " ".repeat(MAX_LOG_BYTES)); appendBoundedLog(failurePath, "{}\n");
  assert.equal(managedLogFiles(failurePath).length, 2);
  const exported = exportBundle({ logsDirectory, coreHome }, {}, path.join(root, "diagnostics.zip"), { logging: { failureContextWriteFailure: { code: "EACCES" } } });
  assert.equal(exported.partial, true); assert.ok(exported.recordCount > 0);
  const zip = fs.readFileSync(path.join(root, "diagnostics.zip"));
  let offset = 0, timeline;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"), start = offset + 30 + nameLength + extra;
    if (name === "timeline.jsonl") timeline = inflateRawSync(zip.subarray(start, start + size)).toString("utf8");
    offset = start + size;
  }
  assert.ok(timeline); assert.doesNotMatch(timeline, /PRIVATE/);
  const exportedNative = timeline.trim().split("\n").map(line => JSON.parse(line))
    .find(row => row.event === "diagnostics.failure_context" && row.detail.failure);
  assert.deepEqual(exportedNative.detail.failure, nativeFailure);
  assert.deepEqual(exportedNative.detail.contract, nativeContract); assert.equal(exportedNative.detail.retryAttempt, 1);
});
