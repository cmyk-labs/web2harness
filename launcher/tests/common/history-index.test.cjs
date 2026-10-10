const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHistoryIndex, PAGE_BYTES } = require("../../electron/diagnostics/history-index.cjs");
const { createHistoryService } = require("../../electron/diagnostics/history-service.cjs");
const { queryLogs } = require("../../electron/diagnostics/bundle.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "web2harness-history-test-"));
  const options = { logsDirectory: path.join(root, "logs"), coreHome: path.join(root, "core") };
  const cache = path.join(root, "cache");
  for (const dir of [options.logsDirectory, options.coreHome, cache]) fs.mkdirSync(dir);
  const index = createHistoryIndex(options, cache), log = path.join(options.logsDirectory, "launcher.jsonl");
  t.after(() => { index.close(); assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.match(path.basename(root), /^web2harness-history-test-/); fs.rmSync(root, { recursive: true }); });
  return { root, options, cache, index, log };
}
const record = (n, detail = {}) => ({ at: new Date(Date.UTC(2026, 9, 10) + n * 1000).toISOString(), level: n % 2 ? "warning" : "error", event: "browser.fixture", detail: { retry: n, code: "ETIMEDOUT", ...detail } });
const write = (file, rows) => fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join("\n") + "\n");

test("paging and repeated searches read cached positions without rereading source or rescanning matches", t => {
  const { index, log, options, cache } = fixture(t);
  write(log, Array.from({ length: 250 }, (_, n) => record(n, { apiKey: "private-sentinel" })));
  const first = index.query({ search: "ETIMEDOUT" }), built = index.metrics();
  assert.equal(first.records.length, 100); assert.equal(first.total, 250);
  assert.deepEqual(first.records, queryLogs(options, { search: "ETIMEDOUT" }).records);
  const second = index.query({ search: "etimedout", cursor: first.nextCursor });
  const last = index.query({ search: "etimedout", cursor: second.nextCursor });
  assert.equal(second.offset, 100); assert.equal(last.records.length, 50); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.records, ...second.records, ...last.records].map(r => r.id)).size, 250);
  assert.deepEqual(index.query({ search: "etimedout", cursor: second.previousCursor }).records, first.records);
  index.query({ search: "etimedout" });
  assert.equal(index.metrics().sourceBytesRead, built.sourceBytesRead);
  assert.equal(index.metrics().searches, built.searches);
  for (const file of fs.readdirSync(cache)) assert.doesNotMatch(fs.readFileSync(path.join(cache, file), "utf8"), /private-sentinel/);
});

test("append and rotation keep an existing snapshot stable and refresh only changed sources", t => {
  const { index, log } = fixture(t);
  write(`${log}.1`, Array.from({ length: 160 }, (_, n) => record(n)));
  write(log, [record(160)]);
  const first = index.query(), bytes = index.metrics().sourceBytesRead;
  fs.appendFileSync(log, JSON.stringify(record(161)) + "\n");
  const latest = index.query();
  assert.equal(latest.total, 162); assert.equal(latest.records[0].detail.retry, 161);
  assert.equal(index.metrics().sourceBytesRead - bytes, fs.statSync(log).size);
  fs.renameSync(log, path.join(path.dirname(log), "launcher.1791580000000-abcd.jsonl")); write(log, [record(162)]);
  assert.equal(index.query().total, 163);
  const old = index.query({ cursor: first.nextCursor });
  assert.equal(old.total, 161); assert.equal(old.records[0].detail.retry, 60);
  assert.equal(index.query({ cursor: first.nextCursor, search: "other" }).expired, true);
});

test("byte-bounded pages and one oversized record keep every full record with reversible cursors", t => {
  const { index, log } = fixture(t);
  const detail = { stages: Array.from({ length: 40 }, () => ({ message: "f".repeat(16000) })) };
  write(log, [...Array.from({ length: 80 }, (_, n) => record(n, { message: "x".repeat(14000) })), record(80, detail)]);
  let page = index.query();
  assert.equal(page.records.length, 1); assert.ok(page.pageBytes > PAGE_BYTES); assert.equal(page.records[0].detail.stages[39].message.length, 16000);
  const ids = page.records.map(r => r.id);
  while (page.nextCursor) {
    const previous = page;
    page = index.query({ cursor: page.nextCursor });
    assert.ok(page.pageBytes <= PAGE_BYTES); assert.ok(page.records.length < 100);
    assert.deepEqual(index.query({ cursor: page.previousCursor }).records, previous.records);
    ids.push(...page.records.map(r => r.id));
  }
  assert.equal(ids.length, 81); assert.equal(new Set(ids).size, 81);
});

test("cancellation during refresh is transactional and the next query recovers", t => {
  const { index, log } = fixture(t);
  write(log, Array.from({ length: 260 }, (_, n) => record(n)));
  const first = index.query();
  fs.appendFileSync(log, JSON.stringify(record(260)) + "\n");
  let checks = 0;
  assert.throws(() => index.query({}, { cancelled: () => ++checks === 4 }), { code: "HISTORY_SUPERSEDED" });
  assert.equal(index.query({ cursor: first.nextCursor }).total, 260);
  assert.equal(index.query().total, 261);
  assert.equal(index.metrics().cachedFiles, 2);
});

test("source coverage, malformed rows and metadata filters match the diagnostic collector", t => {
  const { index, log, options } = fixture(t);
  write(log, [record(0, { traceId: "trace-fixture" }), record(1)]); fs.appendFileSync(log, "malformed\n");
  fs.writeFileSync(path.join(options.logsDirectory, "update-worker.log"), "2026-10-10T01:00:00Z update failed\ncontinuation\n");
  const folder = path.join(options.coreHome, "diagnostics", "browser-turns", "trace-fixture"); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "send.json"), JSON.stringify({ capturedAt: "2026-10-10T02:00:00Z", traceId: "trace-fixture", checkpoint: "send", state: {} }));
  for (const query of [{}, { source: "update" }, { level: "error" }, { correlation: { field: "traceId", value: "trace-fixture" } }, { search: '"code":"ETIMEDOUT"' }, { before: record(0).at }]) {
    const page = index.query(query), legacy = queryLogs(options, query);
    assert.deepEqual(page.records, legacy.records); assert.equal(page.partial, true);
  }
});

test("idle snapshots expire explicitly and cache versions are removed after release", t => {
  const { index, log } = fixture(t);
  write(log, [record(0)]);
  const first = index.query({}, { now: 1000 });
  assert.equal(index.query({ cursor: first.cursor }, { now: 302000 }).expired, true);
  for (let n = 1; n <= 8; n++) { write(log, [record(n)]); index.query({ search: String(n) }); }
  assert.ok(index.metrics().snapshots <= 4); assert.ok(index.metrics().cachedFiles <= 4);
});

test("persistent worker coalesces rapid requests, resolves superseded callers and closes", async t => {
  const { log, options } = fixture(t);
  write(log, Array.from({ length: 2000 }, (_, n) => record(n)));
  const service = createHistoryService(options);
  try {
    const results = await Promise.all(Array.from({ length: 15 }, (_, n) => service.query({ search: n === 14 ? "ETIMEDOUT" : "unused" })));
    assert.ok(results.slice(0, -1).every(result => result.superseded));
    assert.equal(results.at(-1).total, 2000);
    const second = await service.query({ search: "ETIMEDOUT", cursor: results.at(-1).nextCursor });
    assert.equal(second.offset, 100);
  } finally { await service.close(); }
  await assert.rejects(service.query(), /closed/);
});

test("page sizes share search matches but keep independent reversible page boundaries", t => {
  const { index, log } = fixture(t);
  write(log, Array.from({ length: 437 }, (_, n) => record(n)));
  const initial = index.query({ search: "ETIMEDOUT" }), baseline = index.metrics();
  for (const pageSize of [25, 50, 100, 200]) {
    let page = index.query({ search: "ETIMEDOUT", pageSize });
    assert.equal(page.offset, 0); assert.equal(page.records.length, pageSize); assert.equal(page.pageSize, pageSize);
    const seen = page.records.map(row => row.id);
    while (page.nextCursor) {
      const previous = page;
      page = index.query({ search: "ETIMEDOUT", pageSize, cursor: page.nextCursor });
      assert.equal(page.offset, seen.length);
      assert.deepEqual(index.query({ search: "ETIMEDOUT", pageSize, cursor: page.previousCursor }).records, previous.records);
      seen.push(...page.records.map(row => row.id));
    }
    assert.equal(seen.length, 437); assert.equal(new Set(seen).size, 437);
  }
  assert.equal(index.query({ search: "ETIMEDOUT", pageSize: 25, cursor: initial.nextCursor }).expired, true);
  assert.equal(index.metrics().sourceBytesRead, baseline.sourceBytesRead);
  assert.equal(index.metrics().searches, baseline.searches);
});

test("resizing a paused result can reuse matches and preserves byte limits at every size", t => {
  const { index, log } = fixture(t);
  write(log, Array.from({ length: 90 }, (_, n) => record(n, { message: "x".repeat(14000) })));
  index.query({ search: "ETIMEDOUT" }); const baseline = index.metrics();
  for (const pageSize of [25, 50, 100, 200]) {
    const query = { search: "ETIMEDOUT", pageSize, before: record(74).at };
    let page = index.query(query); const rows = [...page.records];
    assert.equal(page.total, 75); assert.ok(page.records.length <= pageSize); assert.ok(page.pageBytes <= PAGE_BYTES);
    while (page.nextCursor) {
      const previous = page;
      page = index.query({ ...query, cursor: page.nextCursor });
      assert.ok(page.pageBytes <= PAGE_BYTES);
      assert.deepEqual(index.query({ ...query, cursor: page.previousCursor }).records, previous.records);
      rows.push(...page.records);
    }
    assert.equal(new Set(rows.map(row => row.id)).size, 75);
  }
  assert.equal(index.metrics().sourceBytesRead, baseline.sourceBytesRead);
  assert.equal(index.metrics().searches, baseline.searches);
});

test("unsupported explicit page sizes fail before reading sources", t => {
  const { index, log } = fixture(t); write(log, [record(0)]);
  for (const pageSize of [null, 0, -1, 26, 1.5, 1000000, "100", NaN, true, {}]) {
    assert.throws(() => index.query({ pageSize }), /Unsupported log page size/);
  }
  assert.equal(index.metrics().sourceBytesRead, 0);
  assert.equal(index.query().pageSize, 100);
});
