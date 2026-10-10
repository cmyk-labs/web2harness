const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { inflateRawSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const { collectDiagnostics, exportBundle, queryLogs, rangeFor } = require("../../electron/diagnostics/bundle.cjs");
const { runDiagnostics } = require("../../electron/diagnostics/service.cjs");
const { pruneLogs, logFiles } = require("../../electron/diagnostics/log-files.cjs");
const { crc32 } = require("../../electron/diagnostics/zip.cjs");
const { createLogger } = require("../../electron/logging.cjs");
const { PREFIX, createDiagnosticRecord, diagnosticReference } = require("../../shared/diagnostic-event.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-diagnostics-test-"));
  t.after(() => { assert.ok(root.startsWith(path.join(os.tmpdir(), "web2harness-diagnostics-test-"))); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { logsDirectory: path.join(root, "launcher", "logs"), userData: path.join(root, "launcher"), coreHome: path.join(root, "core") };
  fs.mkdirSync(options.logsDirectory, { recursive: true }); fs.mkdirSync(options.coreHome);
  return { root, options, log: path.join(options.logsDirectory, "launcher.jsonl") };
}
function writeLogs(file, records) { fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join("\n") + "\n"); }
test("helper events keep source time, severity, safe correlations and error fields through persistence and export", t => {
  const { root, options, log } = fixture(t);
  const logger = createLogger({ filePath: log });
  const record = createDiagnosticRecord("error", "browser.stage_failed", { traceId: "trace-transfer", operationId: "stage-transfer", tabId: "tab-fixture", durationMs: 500,
    toolEventId: diagnosticReference("call_0123456789abcdef0123456789abcdef"), errorDescription: "ERR_CONNECTION_RESET", prompt: "SECRET_PROMPT", licenseCode: "SECRET_LICENSE" });
  record.at = "2026-10-10T01:02:03.123Z";
  assert.equal(logger.ingest(PREFIX + JSON.stringify(record)), true);
  const persisted = JSON.parse(fs.readFileSync(log, "utf8"));
  assert.equal(persisted.at, record.at); assert.equal(persisted.eventId, record.eventId);
  assert.equal(persisted.level, "error"); assert.equal(persisted.component, "browser");
  assert.doesNotMatch(JSON.stringify(persisted), /SECRET_PROMPT|SECRET_LICENSE|call_0123/);
  const page = queryLogs(options, { correlation: { field: "traceId", value: "trace-transfer" } });
  assert.equal(page.total, 1); assert.equal(page.records[0].detail.errorDescription, "ERR_CONNECTION_RESET");
  assert.equal(page.records[0].detail.tabId, "tab-fixture");
  assert.equal(queryLogs(options, { correlation: { field: "traceId", value: "trace" } }).total, 0);
  const destination = path.join(root, "transfer.zip"); exportBundle(options, {}, destination);
  const exported = JSON.parse(unzip(destination)["timeline.jsonl"].trim());
  assert.deepEqual(exported, page.records[0]);
  const restored = createLogger({ filePath: log }).recent()[0];
  assert.equal(restored.eventId, record.eventId);
  assert.equal(logger.ingest(PREFIX + "invalid-json"), false);
});
const entry = (at, event, detail = {}, level = "error") => ({ at, event, detail, level });
function unzip(file) {
  const bytes = fs.readFileSync(file), files = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 8);
    const compressed = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + length).toString("utf8");
    const start = offset + 30 + length + extra, data = inflateRawSync(bytes.subarray(start, start + compressed));
    assert.equal(data.length, bytes.readUInt32LE(offset + 22));
    assert.equal(crc32(data), bytes.readUInt32LE(offset + 14));
    files[name] = data.toString("utf8"); offset = start + compressed;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), Object.keys(files).length);
  return files;
}
test("bundle reconstructs a timeout across runtime/browser and reports corrupt and missing sources without leaking secrets", t => {
  const { root, options, log } = fixture(t);
  writeLogs(log, [entry("2026-10-10T01:00:00Z", "runtime.daemon_stdout", { line: "trace=trace-fixture request timeout password=privatePassword", sessionId: "session-fixture", prompt: "privatePrompt", cookie: "privateCookie", apiKey: "privateKey", url: "https://example.com/private-path" }),
    entry("2026-10-10T01:00:02Z", "browser.connection_failed", { traceId: "trace-fixture", code: "ETIMEDOUT", stack: "Error: connection timeout\n at transport.cjs:20" })]);
  fs.appendFileSync(log, "corrupt json\n");
  const browser = path.join(options.coreHome, "diagnostics", "browser-turns", "trace-fixture"); fs.mkdirSync(browser, { recursive: true });
  fs.writeFileSync(path.join(browser, "01-send-failed.json"), JSON.stringify({ capturedAt: "2026-10-10T01:00:01Z", traceId: "trace-fixture", checkpoint: "send-failed", state: { role: "button", count: 1, text: "privateConversation" } }));
  fs.writeFileSync(path.join(browser, "screenshot.png"), "privateScreenshot");
  const destination = path.join(root, "diagnostics.zip");
  const result = exportBundle(options, { range: "all", timeZone: "Asia/Shanghai" }, destination, { version: "1.2.0", password: "privateSnapshotPassword" });
  assert.equal(result.recordCount, 3); assert.equal(result.partial, true);
  const files = unzip(destination), joined = Object.values(files).join("\n");
  assert.doesNotMatch(joined, /privatePassword|privatePrompt|privateCookie|privateKey|privateConversation|privateScreenshot|privateSnapshotPassword|private-path/);
  const records = files["timeline.jsonl"].trim().split("\n").map(JSON.parse);
  assert.deepEqual(records.map(record => record.detail.traceId), Array(3).fill("trace-fixture"));
  assert.equal(records[2].detail.code, "ETIMEDOUT"); assert.match(records[2].detail.stack, /transport.cjs:20/);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.sources.find(source => source.file === "launcher.jsonl").invalidRecords, 1);
  assert.ok(manifest.sources.some(source => source.status === "absent"));
  assert.equal(manifest.requestedRange.timeZone, "Asia/Shanghai");
  for (const info of manifest.files) assert.equal(createHash("sha256").update(files[info.name]).digest("hex"), info.sha256);
  assert.equal(JSON.parse(files["snapshot.json"]).version, "1.2.0");
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});
test("time ranges apply across log sources with an exclusive end and explicit undated coverage", t => {
  const { options, log } = fixture(t);
  writeLogs(log, [entry("2026-10-10T00:59:59Z", "before"), entry("2026-10-10T01:00:00Z", "start"), entry("2026-10-10T02:00:00Z", "end")]);
  fs.writeFileSync(path.join(options.logsDirectory, "update-worker.log"), "2026-10-10T01:30:00Z update failed\nstack continuation\n");
  fs.writeFileSync(path.join(options.logsDirectory, "process-stream-errors.log"), "undated error");
  const found = collectDiagnostics(options, { range: "custom", start: "2026-10-10T09:00:00+08:00", end: "2026-10-10T10:00:00+08:00", timeZone: "Asia/Shanghai" });
  assert.deepEqual(found.records.map(record => record.event), ["start", "update.worker"]);
  assert.match(found.records[1].detail.message, /stack continuation/);
  assert.equal(found.partial, true);
  assert.ok(collectDiagnostics(options).records.some(record => record.detail.timeBasis === "file-mtime"));
  assert.equal(rangeFor({ range: "24h" }, 86400001).start, 1);
  for (const value of [{ range: "no" }, { range: "custom" }, { range: "custom", start: "2026-01-01", end: "2026-01-01" }, { timeZone: "invalid" }]) assert.throws(() => rangeFor(value));
});
test("history searches across rotated files and paginates a frozen timestamp", async t => {
  const { options, log } = fixture(t);
  const records = Array.from({ length: 120 }, (_, index) => entry(new Date(Date.UTC(2026, 9, 10, 0, index)).toISOString(), "browser.connection_failed", { code: "ETIMEDOUT", retry: index }, index % 2 ? "warning" : "error"));
  writeLogs(log, records.slice(60)); writeLogs(`${log}.1`, records.slice(0, 60));
  assert.equal(queryLogs(options).records.length, 100);
  assert.equal(queryLogs(options, { offset: 100 }).records.length, 20);
  assert.equal(queryLogs(options, { level: "error", source: "browser", search: "etimedout" }).total, 60);
  assert.equal(queryLogs(options, { before: records[9].at }).total, 10);
  const page = await runDiagnostics("query", options, { offset: 100 });
  assert.equal(page.records.length, 20); assert.equal(page.total, 120);
});
test("export refuses source directories and linked targets and retains the original file", t => {
  const { root, options, log } = fixture(t); writeLogs(log, [entry("2026-10-10T00:00:00Z", "example")]);
  const original = fs.readFileSync(log, "utf8");
  assert.throws(() => exportBundle(options, {}, log), /outside application data/);
  assert.equal(fs.readFileSync(log, "utf8"), original);
  const linked = path.join(root, "linked.zip"); fs.linkSync(log, linked);
  assert.throws(() => exportBundle(options, {}, linked), /Unsafe export destination/);
  assert.equal(fs.readFileSync(log, "utf8"), original);
});
test("a source read failure is recorded and does not prevent exporting other records", t => {
  const { root, options, log } = fixture(t); writeLogs(log, [entry("2026-10-10T00:00:00Z", "model.selection_failed", { model: "gpt-6", effort: "high", code: "MODEL_UNVERIFIED" })]);
  fs.mkdirSync(path.join(options.logsDirectory, "update-worker.log"));
  const result = exportBundle(options, {}, path.join(root, "partial.zip"));
  assert.equal(result.partial, true); assert.equal(result.recordCount, 1);
  assert.ok(JSON.parse(unzip(result.path)["manifest.json"]).sources.some(source => source.file === "update-worker.log" && source.status === "failed"));
});
test("retention only prunes recognized owned archives and logger adds a session identity", t => {
  const { options, log } = fixture(t);
  const archive = path.join(options.logsDirectory, "launcher.1000000000000-abcd.jsonl"), unrelated = path.join(options.logsDirectory, "user-notes.txt");
  fs.writeFileSync(archive, "old"); fs.writeFileSync(unrelated, "keep"); fs.writeFileSync(log, "");
  fs.utimesSync(archive, new Date(0), new Date(0)); pruneLogs(log);
  assert.equal(fs.existsSync(archive), false); assert.equal(fs.readFileSync(unrelated, "utf8"), "keep");
  const logger = createLogger({ filePath: log }); logger.info("runtime.started");
  assert.match(logger.recent()[0].detail.sessionId, /^[a-f0-9-]{36}$/);
  fs.appendFileSync(log, " ".repeat(4 * 1024 * 1024)); logger.info("runtime.next");
  assert.equal(logFiles(log).length, 2); assert.equal(logger.health().writeFailure, null);
});
test("missing configuration snapshot and persistence faults mark the bundle partial", t => {
  const { root, options } = fixture(t);
  const result = exportBundle(options, {}, path.join(root, "failed-startup.zip"), { collectorErrors: [{ source: "configuration", message: "bad JSON" }], logging: { writeFailure: { code: "EACCES" } } });
  assert.equal(result.partial, true); assert.equal(result.recordCount, 0);
  assert.match(unzip(result.path)["snapshot.json"], /EACCES|bad JSON/);
});

test("tool failures and process exits retain correlation and error evidence without raw tool input", t => {
  const { root, options, log } = fixture(t);
  writeLogs(log, [entry("2026-10-10T00:00:00Z", "codex.tool_failed", { traceId: "tool-fixture", code: "EACCES", phase: "execution", input: "privateCode", output: "privateToolOutput" }),
    entry("2026-10-10T00:00:01Z", "runtime.daemon_process_error", { traceId: "tool-fixture", message: "Child exited unexpectedly", exitCode: 1 })]);
  const files = unzip(exportBundle(options, {}, path.join(root, "execution.zip")).path);
  const timeline = files["timeline.jsonl"].trim().split("\n").map(JSON.parse);
  assert.deepEqual(timeline.map(record => record.detail.traceId), ["tool-fixture", "tool-fixture"]);
  assert.equal(timeline[1].detail.exitCode, 1); assert.equal(timeline[0].detail.code, "EACCES");
  assert.doesNotMatch(Object.values(files).join("\n"), /privateCode|privateToolOutput/);
});

test("oversize text and malformed checkpoints have explicit collection limits", t => {
  const { root, options, log } = fixture(t);
  fs.writeFileSync(log, 'x'.repeat(8 * 1024 * 1024 + 1) + '\n' + JSON.stringify(entry("2026-10-10T00:00:00Z", "last.record")) + '\n');
  const browser = path.join(options.coreHome, "diagnostics", "browser-turns", "trace-fixture"); fs.mkdirSync(browser, { recursive: true });
  fs.writeFileSync(path.join(browser, "01-broken.json"), "not JSON");
  const files = unzip(exportBundle(options, {}, path.join(root, "truncated.zip")).path);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.partial, true); assert.ok(manifest.sources.find(source => source.file === "launcher.jsonl").truncated);
  assert.ok(manifest.sources.some(source => source.file.includes("01-broken") && source.status === "failed"));
  assert.match(files["timeline.jsonl"], /last.record/);
});
