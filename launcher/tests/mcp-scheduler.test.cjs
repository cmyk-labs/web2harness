const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RequestScheduler } = require("../shared/request-scheduler.cjs");
const failure = { kind: "rate_limit", source: "probe", status: 429 };
function fixture() {
  let now = 1000000, mono = 0;
  const scheduler = new RequestScheduler({ now: () => now, monotonicNow: () => mono, random: () => 0 });
  const add = (id, scope = "a", attempt = 0) => scheduler.enqueue({ id, groupId: id, model: "gpt-6-sol", effort: "high",
    mode: scope ? "mcp-bridge" : "native-tools", bytes: 1, ...(scope ? { mcpScope: scope.repeat(64), connectorName: `connector-${scope}`, retryAttempt: attempt } : {}) });
  return { scheduler, add, advance(ms) { now += ms; mono += ms; scheduler.tick(); },
    end(id, remote, outcome = "failed") { scheduler.settle(id, scheduler.lease(id), outcome, "mcp_remote_rate_limited", remote); } };
}
test("cooldown releases slots, isolates scopes, admits only one recovery at a time and preserves errors after success", () => {
  const f = fixture(); f.add("first"); f.end("first", { failure });
  assert.equal(f.add("retry", "a", 1).state, "queued");
  assert.equal(f.add("sibling").state, "queued");
  assert.equal(f.add("other", "b").state, "preparing");
  assert.equal(f.add("native", null).state, "preparing");
  f.advance(29999); assert.equal(f.scheduler.get("retry").state, "queued");
  f.advance(1); assert.equal(f.scheduler.get("retry").state, "preparing");
  assert.equal(f.scheduler.get("sibling").state, "queued");
  f.end("retry", { failure }); f.advance(59999); assert.equal(f.scheduler.get("sibling").state, "queued");
  f.advance(1); f.end("sibling", { verified: true }, "succeeded");
  assert.equal(f.scheduler.snapshot().mcpStatus[0].lastFailure.kind, "rate_limit");
  assert.ok(f.scheduler.snapshot().mcpStatus[0].lastVerifiedAt);
  assert.equal(f.scheduler.snapshot().mcpStatus[0].cooldownUntil, undefined);
});
test("explicit Retry-After survives restart and waiting remains cancellable or expires normally", () => {
  const f = fixture(); f.add("first"); f.end("first", { failure: { ...failure, retryAfterMs: 1000000 } });
  const restored = fixture(); restored.scheduler.restoreMcpStatus(f.scheduler.mcpStatus());
  assert.equal(restored.add("cancel").state, "queued"); restored.scheduler.cancel("cancel");
  assert.equal(restored.scheduler.get("cancel").state, "cancelled");
  restored.add("timeout"); restored.advance(900000);
  assert.equal(restored.scheduler.get("timeout").state, "timed-out");
  assert.equal(restored.scheduler.snapshot().active, 0);
});
test("an already-admitted sender observes the same cooldown, duplicate settlement cannot extend it", () => {
  const f = fixture(); f.add("first"); f.add("already-preparing");
  const lease = f.scheduler.lease("first"); f.end("first", { failure });
  assert.deepEqual(f.scheduler.beginSend("already-preparing", f.scheduler.lease("already-preparing")), { allowed: false, reason: "mcp_cooldown", retryAfterMs: 30000 });
  const status = f.scheduler.mcpStatus(); f.advance(1000);
  f.scheduler.settle("first", lease, "failed", "mcp_remote_rate_limited", { failure });
  assert.deepEqual(f.scheduler.mcpStatus(), status);
});
