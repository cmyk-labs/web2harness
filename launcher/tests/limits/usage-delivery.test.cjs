const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { randomUUID } = require("node:crypto");
const { UsageOutbox } = require("../../shared/usage-receipts.cjs");
const { LimitsController } = require("../../electron/limits/limits-controller.cjs");
const { LimitsStore } = require("../../electron/limits/limits-store.cjs");
const A = "a".repeat(64), B = "b".repeat(64), NOW = Date.UTC(2026, 9, 8), DAY = 86400000;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w2h-usage-delivery-"));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const directory = path.join(root, "outbox"), file = path.join(root, "limits.json");
  let clock = NOW, mode = "automatic";
  const options = { now: () => clock, getInteractionMode: () => mode, outboxDirectory: directory };
  return { root, directory, file, options, queue: new UsageOutbox(directory), controller: new LimitsController(file, options), time(v) { clock = v; }, mode(v) { mode = v; } };
}
function accepted(accountKey = A, at = NOW, purpose = "task") {
  const id = randomUUID(); return { version: 1, id, state: "accepted", at, receipt: { id, accountKey, at, plan: "unsupported", model: "gpt-6-sol", effort: "high", purpose } };
}
test("accepted outbox survives restart, deduplicates a lost ACK, and records details without another Web send", t => {
  const f = fixture(t), entry = accepted(); f.queue.write(entry);
  assert.equal(f.controller.recordAcknowledged(entry).status, "recorded"); // response lost; queue retained
  const restored = new LimitsController(f.file, f.options), snapshot = restored.snapshot();
  assert.equal(snapshot.totalMessages, 1); assert.equal(snapshot.pendingReceipts, 0);
  assert.deepEqual(snapshot.details, [{ model: "gpt-6-sol", effort: "high", purpose: "task", last24Hours: 1, last7Days: 1 }]);
  assert.equal(snapshot.lastRecordedAt, NOW); assert.equal(f.queue.entries().entries.length, 0);
  assert.equal(restored.recordAcknowledged(entry).status, "duplicate");
});
test("unconfirmed activation is visible after restart and never counted without acceptance evidence", t => {
  const f = fixture(t), entry = { version: 1, id: randomUUID(), state: "pending", at: NOW }; f.queue.write(entry);
  const snapshot = new LimitsController(f.file, f.options).snapshot();
  assert.equal(snapshot.totalMessages, 0); assert.equal(snapshot.pendingMessages, 1); assert.equal(snapshot.incomplete, true);
  f.time(NOW + 7 * DAY); assert.equal(f.controller.snapshot().pendingMessages, 0);
});
test("unavailable account persists a gap and does not charge a previously active account", t => {
  const f = fixture(t); f.controller.recordAcknowledged(accepted());
  f.queue.write({ version: 1, id: randomUUID(), at: NOW, state: "accepted", trackingError: "account-unavailable" });
  const s = f.controller.snapshot(); assert.equal(s.totalMessages, 1); assert.equal(s.incomplete, true); assert.equal(s.gapAt, NOW);
});
test("delayed old account receipt does not switch the newer active account; old account history is recovered", t => {
  const f = fixture(t); f.controller.recordAcknowledged(accepted(B));
  f.queue.write(accepted(A, NOW - 1000, "tool-result"));
  assert.equal(f.controller.snapshot().totalMessages, 1);
  const store = new LimitsStore(f.file, { now: () => NOW }); assert.equal(store.matchesAccount(B), true);
  const a = store.configure({ accountKey: A, plan: "unsupported" }); assert.equal(a.totalMessages, 1); assert.equal(a.details[0].purpose, "tool-result");
});
test("manual mode pauses replay; returning to automatic recovers confirmed sends", t => {
  const f = fixture(t); f.queue.write(accepted()); f.mode("manual");
  assert.equal(f.controller.snapshot().pendingReceipts, 1); assert.equal(f.controller.snapshot().totalMessages, 0);
  f.mode("automatic"); assert.equal(f.controller.snapshot().totalMessages, 1);
});
test("malformed journal files are preserved and reported, path traversal is rejected", t => {
  const f = fixture(t); fs.mkdirSync(f.directory); const name = path.join(f.directory, randomUUID() + ".json"); fs.writeFileSync(name, "broken");
  const s = f.controller.snapshot(); assert.equal(s.deliveryErrors, 1); assert.equal(s.incomplete, true); assert.equal(fs.readFileSync(name, "utf8"), "broken");
  assert.throws(() => f.queue.remove("../limits"));
});
test("v2 migration preserves gap and receipt IDs, missing dimensions stay unknown", t => {
  const f = fixture(t); const event = { id: "old", model: "gpt-5.6-sol", at: NOW };
  fs.writeFileSync(f.file, JSON.stringify({ version: 2, activeAccountKey: A, gapAt: NOW, accounts: { [A]: { plan: "unsupported", initializedAt: NOW, checkedAt: NOW, events: [event] } } }));
  const s = f.controller.snapshot(); assert.equal(s.gapAt, NOW); assert.equal(s.details[0].effort, "unknown");
  assert.equal(f.controller.recordAcknowledged({ receipt: { ...event, accountKey: A, plan: "unsupported" } }).status, "duplicate");
});
test("each policy record has traceable sources, valid dates and disjoint reference views", () => {
  const policy = require("../../electron/limits/limits-policy.json"); assert.equal(policy.schemaVersion, 2);
  const ids = new Set(); for (const r of policy.rules) {
    assert.ok(!ids.has(r.id)); ids.add(r.id); assert.ok(r.count > 0 && Number.isInteger(r.count));
    assert.ok(["day", "week", "month"].includes(r.period)); assert.equal(new URL(r.sourceUrl).protocol, "https:");
    for (const d of [r.checkedOn, r.effectiveFrom, r.effectiveUntil].filter(Boolean)) assert.equal(new Date(d).toISOString().slice(0, 10), d);
    if (r.effectiveFrom && r.effectiveUntil) assert.ok(r.effectiveFrom < r.effectiveUntil);
    if (r.sourceKind === "notice-transcript") assert.equal(r.status, "unverified");
  }
  assert.equal(policy.rules.find(r => r.id === "pro200-six-future").count, 100);
  assert.equal(policy.rules.find(r => r.id === "pro200-six-prior").count, 200);
});
