const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { randomUUID } = require("node:crypto");
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

test("retained failure context survives launcher rotation and is collected/exported with explicit write failure coverage", t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "w2h-failure-context-"));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith("w2h-failure-context-")); fs.rmSync(root, { recursive: true }); });
  const logsDirectory = path.join(root, "logs"), coreHome = path.join(root, "core");
  fs.mkdirSync(logsDirectory); fs.mkdirSync(coreHome);
  const filePath = path.join(logsDirectory, "launcher.jsonl"), failurePath = path.join(logsDirectory, "failure-context.jsonl");
  const logger = createLogger({ filePath }), requestId = randomUUID();
  logger.ingest(PREFIX + JSON.stringify(createDiagnosticRecord("info", "http.request_started", { requestId })));
  logger.ingest(PREFIX + JSON.stringify(createDiagnosticRecord("warning", "browser.model_verification_failed", { requestId, message: "PRIVATE" })));
  fs.writeFileSync(filePath, " ".repeat(MAX_LOG_BYTES)); logger.info("runtime.started");
  assert.equal(managedLogFiles(failurePath).length, 1);
  const collection = collectDiagnostics({ logsDirectory, coreHome });
  const preserved = collection.records.find(row => row.event === "diagnostics.failure_context");
  assert.ok(preserved); assert.equal(preserved.detail.requestId, requestId);
  assert.doesNotMatch(JSON.stringify(preserved), /PRIVATE/);
  assert.ok(collection.sources.some(source => source.file === "failure-context.jsonl" && source.status === "collected"));
  // Exercise the same rotation path used by the new file without deleting other log evidence.
  fs.appendFileSync(failurePath, " ".repeat(MAX_LOG_BYTES)); appendBoundedLog(failurePath, "{}\n");
  assert.equal(managedLogFiles(failurePath).length, 2);
  const exported = exportBundle({ logsDirectory, coreHome }, {}, path.join(root, "diagnostics.zip"), { logging: { failureContextWriteFailure: { code: "EACCES" } } });
  assert.equal(exported.partial, true); assert.ok(exported.recordCount > 0);
});
