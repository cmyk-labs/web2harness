const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RequestScheduler, validateRequestScheduling, DEFAULT_REQUEST_SCHEDULING } = require("../shared/request-scheduler.cjs");

function fixture(settings = {}, options = {}) {
  let monotonic = 0, wall = 1_800_000_000_000;
  const events = [];
  const scheduler = new RequestScheduler({
    settings: { ...DEFAULT_REQUEST_SCHEDULING, ...settings },
    now: () => wall, monotonicNow: () => monotonic,
    onEvent: (name, fields) => events.push({ name, fields }), ...options,
  });
  return {
    scheduler, events,
    advance(ms) { monotonic += ms; wall += ms; scheduler.tick(); },
    moveWall(ms) { wall += ms; },
    add(id, groupId = id, extra = {}) { return scheduler.enqueue({ id, groupId, model: "gpt-6", mode: "native-tools", bytes: 100, ...extra }); },
    finish(id, outcome = "succeeded") { return scheduler.settle(id, scheduler.lease(id), outcome); },
  };
}

test("fifty mixed model/session requests share the same four slots", () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) f.add(`job${i}`, `session${i % 5}`, { model: i % 2 ? "gpt-6-pro" : "gpt-5.6-sol" });
  assert.equal(f.scheduler.snapshot().active, 4);
  assert.equal(f.scheduler.snapshot().waiting, 46);
  for (let i = 0; i < 50; i++) {
    const next = f.scheduler.query({ state: "running" }).items[0];
    assert.ok(next);
    f.finish(next.id);
    assert.ok(f.scheduler.snapshot().active <= 4);
  }
  assert.equal(f.scheduler.query({ state: "succeeded", limit: 100 }).total, 50);
});

test("invalid effort cannot enter the queue and break metadata search", () => {
  const f = fixture();
  assert.throws(() => f.add("bad", "session", { effort: {} }), /Invalid queue effort/);
  assert.equal(f.scheduler.snapshot().active, 0);
  f.add("ok", "session", { effort: "high" });
  assert.equal(f.scheduler.query({ search: "high" }).total, 1);
});

test("group round-robin serves another conversation before a burst of siblings", () => {
  const f = fixture({ maxConcurrent: 1 });
  f.add("a1", "a"); f.add("a2", "a"); f.add("a3", "a"); f.add("b1", "b"); f.add("c1", "c");
  f.finish("a1"); assert.equal(f.scheduler.get("b1").state, "preparing");
  f.finish("b1"); assert.equal(f.scheduler.get("c1").state, "preparing");
  f.finish("c1"); assert.equal(f.scheduler.get("a2").state, "preparing");
});

test("replay retains one ticket and its first deadline; changed identity fails", () => {
  const f = fixture({ maxConcurrent: 1 });
  f.add("running"); const first = f.add("queued");
  f.advance(60_000);
  assert.equal(f.add("queued").deadlineAt, first.deadlineAt);
  assert.equal(f.scheduler.snapshot().waiting, 1);
  assert.throws(() => f.add("queued", "different"), { code: "queue_identity_conflict" });
  f.advance((DEFAULT_REQUEST_SCHEDULING.queueTimeoutMinutes - 1) * 60_000);
  assert.equal(f.add("queued").state, "timed-out");
  f.finish("running"); assert.equal(f.scheduler.snapshot().active, 0);
});

test("queue timeout applies while paused and is independent of system-clock changes", () => {
  const f = fixture({ queueTimeoutMinutes: 5 });
  f.scheduler.pause(); f.add("waiting"); f.moveWall(-24 * 60 * 60_000);
  f.advance(5 * 60_000);
  assert.equal(f.scheduler.get("waiting").state, "timed-out");
  assert.equal(f.scheduler.get("waiting").waitMs, 300_000);
});

test("lowering concurrency drains active work and changes timeout for new tickets only", () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.add(`j${i}`);
  const oldDeadline = f.scheduler.get("j4").deadlineAt;
  f.scheduler.updateSettings({ maxConcurrent: 1, queueTimeoutMinutes: 5, minSendIntervalSeconds: 8 });
  const newJob = f.add("new");
  assert.equal(f.scheduler.snapshot().active, 4);
  assert.equal(f.scheduler.get("j4").deadlineAt, oldDeadline);
  assert.equal(newJob.deadlineAt, newJob.queuedAt + 300_000);
  for (let i = 0; i < 3; i++) f.finish(`j${i}`);
  assert.equal(f.scheduler.get("j4").state, "queued");
  f.finish("j3"); assert.equal(f.scheduler.get("j4").state, "preparing");
});

test("queued cancellation never dispatches and replay remains cancelled", () => {
  const f = fixture({ maxConcurrent: 1 });
  f.add("running"); f.add("waiting");
  f.scheduler.cancel("waiting"); f.finish("running");
  assert.equal(f.add("waiting").state, "cancelled");
  assert.equal(f.scheduler.snapshot().active, 0);
  assert.equal(f.events.filter(event => event.name === "queue.dispatched" && event.fields.id === "waiting").length, 0);
});

test("running cancellation holds its slot until physical settlement and rejects new sends", () => {
  const f = fixture({ maxConcurrent: 1 });
  f.add("running"); f.add("waiting");
  const lease = f.scheduler.lease("running");
  f.scheduler.cancel("running");
  assert.equal(f.scheduler.get("waiting").state, "queued");
  assert.throws(() => f.scheduler.beginSend("running", lease), { code: "queue_cancelled" });
  f.scheduler.settle("running", lease, "succeeded");
  assert.equal(f.scheduler.get("running").state, "cancelled");
  assert.equal(f.scheduler.get("waiting").state, "preparing");
  f.scheduler.settle("running", lease, "succeeded");
  assert.equal(f.scheduler.snapshot().active, 1);
  assert.throws(() => f.scheduler.settle("waiting", lease, "succeeded"), { code: "queue_lease_invalid" });
});

test("send permits serialize slow sends and observe changed spacing at the actual boundary", () => {
  const f = fixture();
  f.add("a"); f.add("b");
  const a = f.scheduler.lease("a"), b = f.scheduler.lease("b");
  const first = f.scheduler.beginSend("a", a);
  f.advance(10_000);
  assert.equal(f.scheduler.beginSend("b", b).reason, "send_in_progress");
  f.scheduler.endSend("a", a, first.permit, "confirmed");
  assert.equal(f.scheduler.beginSend("b", b).retryAfterMs, 3000);
  f.scheduler.updateSettings({ ...DEFAULT_REQUEST_SCHEDULING, minSendIntervalSeconds: 8 });
  f.advance(3000); assert.equal(f.scheduler.beginSend("b", b).retryAfterMs, 5000);
  f.advance(5000); assert.equal(f.scheduler.beginSend("b", b).allowed, true);
});

test("unknown send pauses dispatch and cannot be cleared by an ordinary user resume", () => {
  const f = fixture({ maxConcurrent: 1 });
  f.add("a"); f.add("b");
  const lease = f.scheduler.lease("a"), permit = f.scheduler.beginSend("a", lease).permit;
  f.scheduler.endSend("a", lease, permit, "unknown");
  f.scheduler.pause("user");
  assert.equal(f.scheduler.snapshot().pausedReason, "send_outcome_unknown");
  f.scheduler.resume();
  assert.equal(f.scheduler.snapshot().pausedReason, "send_outcome_unknown");
  assert.throws(() => f.scheduler.resume(), { code: "queue_pause_changed" });
  f.finish("a", "failed"); assert.equal(f.scheduler.get("b").state, "failed");
  assert.equal(f.scheduler.get("b").reason, "queue_blocked_send_outcome_unknown");
  assert.deepEqual(f.scheduler.get("b").blockedBy, { reason: "send_outcome_unknown", requestId: "a" });
  f.scheduler.resume("send_outcome_unknown"); assert.equal(f.scheduler.get("b").state, "failed");
  assert.equal(f.add("new").state, "preparing");
});

test("late send confirmation keeps shared capacity occupied until physical cleanup", () => {
  const f = fixture({ maxConcurrent: 2, minSendIntervalSeconds: 1 });
  f.add("reconciling"); f.add("other-active"); f.add("waiting");
  const lease = f.scheduler.lease("reconciling");
  const permit = f.scheduler.beginSend("reconciling", lease).permit;
  f.advance(5000);
  assert.deepEqual(f.scheduler.beginSend("other-active", f.scheduler.lease("other-active")), { allowed: false, reason: "send_in_progress" });
  assert.equal(f.scheduler.get("waiting").state, "queued");
  f.scheduler.endSend("reconciling", lease, permit, "confirmed");
  assert.equal(f.scheduler.snapshot().pausedReason, null);
  assert.equal(f.scheduler.snapshot().active, 2);
  assert.equal(f.scheduler.get("waiting").state, "queued");
  f.scheduler.settle("reconciling", lease, "failed", "fixture_after_acceptance");
  assert.equal(f.scheduler.get("waiting").state, "preparing");
  assert.equal(f.scheduler.snapshot().active, 2);
});

test("owner loss while reconciling cannot be mistaken for safe per-page isolation", () => {
  const f = fixture({ maxConcurrent: 2 });
  f.add("lost-owner"); f.add("other-active"); f.add("waiting");
  const lease = f.scheduler.lease("lost-owner");
  f.scheduler.beginSend("lost-owner", lease);
  f.scheduler.cancel("lost-owner");
  f.scheduler.settle("lost-owner", lease, "cancelled", "owner_disconnected");
  assert.equal(f.scheduler.snapshot().pausedReason, "send_outcome_unknown");
  assert.equal(f.scheduler.get("waiting").reason, "queue_blocked_send_outcome_unknown");
  assert.equal(f.scheduler.beginSend("other-active", f.scheduler.lease("other-active")).reason, "send_outcome_unknown");
});

test("user pause stops new admissions but lets already admitted turns finish sending", () => {
  const f = fixture({ maxConcurrent: 1 });
  f.add("a"); f.scheduler.pause(); f.add("b");
  assert.equal(f.scheduler.beginSend("a", f.scheduler.lease("a")).allowed, true);
  assert.equal(f.scheduler.get("b").state, "queued");
});

test("recovering one pause cause cannot clear another unresolved failure", () => {
  const f = fixture();
  f.scheduler.pause("send_outcome_unknown");
  f.scheduler.pause("account_rate_limited");
  f.add("waiting");
  f.scheduler.resume("account_rate_limited");
  assert.equal(f.scheduler.get("waiting").state, "failed");
  assert.equal(f.scheduler.get("waiting").reason, "queue_blocked_send_outcome_unknown");
  assert.equal(f.scheduler.snapshot().pausedReason, "send_outcome_unknown");
});

test("fault pauses fail queued requests immediately even with free capacity, retaining the cause", () => {
  for (const reason of ["send_outcome_unknown", "browser_unavailable", "account_rate_limited"]) {
    const f = fixture({ maxConcurrent: 1 });
    f.add("owner"); f.add("waiting"); f.scheduler.pause(reason, "owner");
    const blocked = f.scheduler.get("waiting");
    assert.equal(blocked.state, "failed"); assert.equal(blocked.reason, `queue_blocked_${reason}`);
    assert.equal(blocked.waitMs, 0); assert.deepEqual(blocked.blockedBy, { reason, requestId: "owner" });
    f.finish("owner"); assert.equal(f.scheduler.snapshot().active, 0);
    assert.equal(f.add("later").reason, `queue_blocked_${reason}`);
    f.advance(15 * 60000); assert.equal(f.scheduler.get("waiting").reason, `queue_blocked_${reason}`);
    f.scheduler.resume(reason); assert.equal(f.scheduler.get("waiting").state, "failed");
    assert.equal(f.add("recovered").state, "preparing");
  }
});

test("number and byte budgets reject overload without charging exact replay twice", () => {
  const f = fixture({ maxConcurrent: 1 }, { maxWaiting: 2, maxWaitingBytes: 200 });
  f.add("running"); f.add("a"); f.add("a"); f.add("b");
  assert.equal(f.scheduler.snapshot().waitingBytes, 200);
  assert.throws(() => f.add("c"), { code: "scheduler_overloaded" });
  f.scheduler.cancel("a");
  assert.throws(() => f.add("oversize", "oversize", { bytes: 201 }), { code: "scheduler_overloaded" });
  f.add("c"); assert.equal(f.scheduler.snapshot().waiting, 2);
});

test("bounded receipts cannot be evicted early to revive a cancelled request", () => {
  const f = fixture({}, { maxRecords: 2, receiptTtlMs: 1000 });
  f.scheduler.pause(); f.add("a"); f.scheduler.cancel("a"); f.add("b");
  assert.throws(() => f.add("c"), { code: "scheduler_overloaded" });
  assert.equal(f.add("a").state, "cancelled");
  f.advance(1001); f.add("c");
  assert.equal(f.scheduler.get("b").state, "queued");
});

test("close cancels queued tickets but still waits for active physical cleanup", () => {
  const f = fixture({ maxConcurrent: 1 });
  f.add("a"); f.add("b"); const lease = f.scheduler.lease("a");
  assert.equal(f.scheduler.close().length, 1);
  assert.equal(f.scheduler.get("b").state, "cancelled");
  assert.throws(() => f.add("c"), { code: "scheduler_closed" });
  f.scheduler.settle("a", lease, "cancelled");
  assert.equal(f.scheduler.snapshot().active, 0);
});

test("queries page metadata without disclosing leases or carrying request bodies", () => {
  const f = fixture(); f.scheduler.pause();
  for (let i = 0; i < 60; i++) f.add(`j${i}`, "session", { prompt: "must not persist" });
  const page = f.scheduler.query({ limit: 25, offset: 25, groupId: "session" });
  assert.equal(page.total, 60); assert.equal(page.items.length, 25); assert.equal(page.items[0].id, "j25");
  assert.ok(!JSON.stringify(page).includes("must not persist"));
  assert.ok(!JSON.stringify(page).includes("lease"));
});

test("settings validate the complete object and do not silently clamp invalid input", () => {
  for (const field of Object.keys(DEFAULT_REQUEST_SCHEDULING)) {
    for (const value of [null, "4", 0, 1.5, 61, NaN]) {
      assert.throws(() => validateRequestScheduling({ ...DEFAULT_REQUEST_SCHEDULING, [field]: value }));
    }
  }
  assert.throws(() => validateRequestScheduling({ ...DEFAULT_REQUEST_SCHEDULING, other: true }));
  assert.deepEqual(validateRequestScheduling(DEFAULT_REQUEST_SCHEDULING), DEFAULT_REQUEST_SCHEDULING);
});
