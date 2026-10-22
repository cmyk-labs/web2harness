const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { RequestQueue } = require("../electron/runtime/request-queue.cjs");

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "w2h-queue-host-"));
  const resources = new Set(), events = [];
  const config = { directory: root, settings: { maxConcurrent: 1, queueTimeoutMinutes: 15, minSendIntervalSeconds: 1 },
    logger: { info: (event, fields) => events.push({ event, fields }), error() {} },
    hasResource: trace => resources.has(trace), cancelResource: async () => {}, ...options };
  let queue = await new RequestQueue(config).start();
  t.after(async () => { await queue.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("w2h-queue-host-")); await fs.rm(root, { recursive: true }); });
  return { get queue() { return queue; }, root, resources, events,
    async restart() { await queue.close(); queue = await new RequestQueue(config).start(); },
    async add(name, groupId = name) {
      const id = createHash("sha256").update(name).digest("hex");
      const input = { job: { id, groupId, model: "gpt-6", mode: "native-tools", bytes: 128 }, pid: process.pid, traceId: `trace_${name}` };
      const result = await queue.request("enqueue", input);
      return { input, record: result.record, ticket: { id, secret: result.secret } };
    },
  };
}

test("only a verified native page can isolate an unknown send while retaining its resource slot", async t => {
  const proof = { version: 1, inputSettled: true, helperPid: 912, surfaceId: "owned-surface" };
  const f = await fixture(t, { settings: { maxConcurrent: 2, queueTimeoutMinutes: 15, minSendIntervalSeconds: 1 },
    ownsIsolatedSendResource: (traceId, observed) => traceId === "trace_local" && observed.helperPid === 912 && observed.surfaceId === "owned-surface" });
  const first = await f.add("local"), second = await f.add("independent"), waiting = await f.add("waiting");
  f.resources.add("trace_local");
  const permit = (await f.queue.request("send-begin", first.ticket)).permit;
  await f.queue.request("send-end", { ...first.ticket, permit, outcome: "unknown", isolation: proof });
  assert.equal(f.queue.snapshot().pausedReason, null); assert.equal(f.queue.snapshot().active, 2);
  assert.equal(f.queue.core.get(waiting.ticket.id).state, "queued");
  await assert.rejects(f.queue.request("settle", { ...first.ticket, outcome: "failed" }), /resources have not been released/);
  assert.equal(f.queue.core.get(second.ticket.id).state, "preparing");
  f.resources.delete("trace_local");
  await f.queue.request("settle", { ...first.ticket, outcome: "failed", reason: "chatgpt_send_outcome_unknown" });
  assert.equal(f.queue.core.get(first.ticket.id).sendFailureScope, "task");
  assert.equal(f.queue.core.get(waiting.ticket.id).state, "preparing");
  const receipt = JSON.parse(await fs.readFile(path.join(f.root, "request-queue.json"), "utf8"));
  assert.equal(receipt.records.find(r => r.id === first.ticket.id).sendFailureScope, "task");
  assert.equal(JSON.stringify(receipt).includes("owned-surface"), false);
});

test("a forged page proof and shared authentication failure retain global protection", async t => {
  const f = await fixture(t, { ownsIsolatedSendResource: () => false });
  const first = await f.add("forged");
  const permit = (await f.queue.request("send-begin", first.ticket)).permit;
  await f.queue.request("send-end", { ...first.ticket, permit, outcome: "unknown",
    isolation: { version: 1, inputSettled: true, helperPid: 912, surfaceId: "not-owned" } });
  assert.equal(f.queue.snapshot().pausedReason, "send_outcome_unknown");
  await f.queue.request("settle", { ...first.ticket, outcome: "failed", reason: "chatgpt_sign_in_required" });
  assert.ok(f.queue.snapshot().pauseReasons.includes("browser_unavailable"));
});

test("restart cannot trust a persisted unfinished task isolation receipt", async t => {
  const f = await fixture(t);
  const first = await f.add("old-isolation");
  await f.queue.close();
  const file = path.join(f.root, "request-queue.json"), saved = JSON.parse(await fs.readFile(file, "utf8"));
  Object.assign(saved.records.find(r => r.id === first.ticket.id), { state: "preparing", sendProgress: "unknown", sendFailureScope: "task" });
  saved.pauseReasons = []; saved.pauseSources = []; saved.pendingSend = false;
  await fs.writeFile(file, JSON.stringify(saved));
  await f.restart();
  assert.equal(f.queue.snapshot().pausedReason, "send_outcome_unknown");
  assert.equal(f.queue.core.get(first.ticket.id).state, "failed");
  assert.equal(f.queue.core.get(first.ticket.id).reason, "runtime_restarted_outcome_unknown");
});

test("budget updates reserve an idle queue and release admission even after failure", async t => {
  const f = await fixture(t);
  await assert.rejects(f.queue.whileIdle(async () => {
    await assert.rejects(f.add("during_update"), { code: "queue_configuration_busy" });
    await assert.rejects(f.queue.whileIdle(async () => {}), /tasks are idle/);
    throw new Error("setup failed");
  }), /setup failed/);
  const active = await f.add("after_update");
  await assert.rejects(f.queue.whileIdle(async () => assert.fail("must not apply")), /tasks are idle/);
  assert.equal((await f.queue.request("poll", active.ticket)).record.state, "preparing");
});

test("host admits once, persists metadata before ACK, and refuses replay after restart", async t => {
  const f = await fixture(t); const first = await f.add("main");
  assert.equal(first.record.state, "preparing");
  const receipt = JSON.parse(await fs.readFile(path.join(f.root, "request-queue.json"), "utf8"));
  assert.equal(receipt.records[0].id, first.ticket.id);
  assert.equal(JSON.stringify(receipt).includes(first.ticket.secret), false);
  assert.equal(JSON.stringify(receipt).includes("lease"), false);
  assert.equal((await f.queue.request("enqueue", first.input)).secret, first.ticket.secret);
  await assert.rejects(f.queue.request("enqueue", { ...first.input, traceId: "trace_other" }), /receipt/);
  await f.restart();
  assert.equal(f.queue.snapshot().active, 0);
  assert.equal(f.queue.query({ state: "ended" }).items[0].reason, "runtime_restarted_outcome_unknown");
  await assert.rejects(f.queue.request("enqueue", first.input), /receipt/);
});

test("native delivery follows the settled owner, releases slots, rejects stale updates and survives restart", async t => {
  const f = await fixture(t), first = await f.add("delivery_first"), next = await f.add("delivery_next");
  const update = (ticket, deliveryState, sequence) => f.queue.request("native-delivery", { ...ticket, delivery: { deliveryState, sequence } });
  await assert.rejects(update(first.ticket, "response_written", 1), { code: "queue_delivery_owner_invalid" });
  await f.queue.request("settle", { ...first.ticket, outcome: "succeeded" });
  assert.equal((await f.queue.request("poll", next.ticket)).record.state, "preparing");
  await assert.rejects(update({ ...first.ticket, secret: next.ticket.secret }, "response_written", 1), /owner/);
  await assert.rejects(update(first.ticket, "PRIVATE_ERROR", 1), /Invalid native delivery/);
  let receipt = await update(first.ticket, "write_failed", 1);
  assert.equal(receipt.state, "succeeded");
  assert.equal(receipt.nativeDelivery.deliveryState, "write_failed");
  receipt = await update(first.ticket, "response_written", 2);
  assert.equal(receipt.nativeDelivery.deliveryState, "response_written");
  await assert.rejects(update(first.ticket, "write_failed", 1), { code: "queue_delivery_stale" });
  assert.equal((await update(first.ticket, "write_failed", 3)).nativeDelivery.deliveryState, "response_written");
  await f.queue.request("settle", { ...next.ticket, outcome: "succeeded" });
  await update(next.ticket, "validation_failed", 1);
  assert.equal((await update(next.ticket, "response_written", 2)).nativeDelivery.deliveryState, "validation_failed");
  const saved = await fs.readFile(path.join(f.root, "request-queue.json"), "utf8");
  assert.ok(!saved.includes(first.ticket.secret) && !saved.includes("PRIVATE_ERROR") && !saved.includes('"lease"'));
  await f.restart();
  assert.equal(f.queue.core.get(first.ticket.id).nativeDelivery.deliveryState, "response_written");
  assert.equal(f.queue.core.get(next.ticket.id).nativeDelivery.deliveryState, "validation_failed");
  await assert.rejects(update(first.ticket, "response_written", 4), /owner/);
});

test("cancelling an active owner retains its slot until physical resources are released", async t => {
  let stops = 0;
  const f = await fixture(t, { cancelResource: async () => { stops++; } });
  const main = await f.add("main"), child = await f.add("child");
  f.resources.add("trace_main");
  await f.queue.control("cancel", main.ticket.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
  assert.equal((await f.queue.request("poll", child.ticket)).record.state, "queued");
  await assert.rejects(f.queue.request("settle", { ...main.ticket, outcome: "cancelled" }), /not been released/);
  f.resources.delete("trace_main");
  await f.queue.request("settle", { ...main.ticket, outcome: "cancelled" });
  assert.equal((await f.queue.request("poll", child.ticket)).record.state, "preparing");
});

test("an exact owner reconnect keeps its original failure despite a changed byte estimate", async t => {
  const f = await fixture(t), first = await f.add("failed_upload");
  await f.queue.request("settle", { ...first.ticket, outcome: "failed", reason: "chatgpt_attachment_upload_failed" });
  const retry = { ...first.input, job: { ...first.input.job, bytes: first.input.job.bytes + 17 } };
  const replay = await f.queue.request("enqueue", retry);
  assert.equal(replay.secret, first.ticket.secret);
  assert.equal(replay.record.state, "failed");
  assert.equal(replay.record.reason, "chatgpt_attachment_upload_failed");
  assert.equal(f.queue.snapshot().active, 0);
  await assert.rejects(f.queue.request("enqueue", { ...retry, traceId: "trace_foreign_owner" }), { code: "queue_request_replayed" });
});

test("resource cleanup can call back into queue without locking itself out", async t => {
  let f, ticket, cleaned;
  const cleanup = new Promise(resolve => { cleaned = resolve; });
  f = await fixture(t, { cancelResource: async () => {
    f.resources.delete("trace_main"); await f.queue.request("settle", { ...ticket, outcome: "cancelled" }); cleaned();
  } });
  ticket = (await f.add("main")).ticket; f.resources.add("trace_main");
  await f.queue.control("cancel", ticket.id);
  await Promise.race([cleanup, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("cleanup deadlock")), 2000); timer.unref(); })]);
  assert.equal((await f.queue.request("poll", ticket)).record.state, "cancelled");
});

test("queue snapshots keep membership stable; settings retain existing deadlines", async t => {
  const f = await fixture(t); await f.add("main"); const waiting = await f.add("child");
  const page = f.queue.query({ limit: 25 });
  await f.queue.updateSettings({ maxConcurrent: 1, queueTimeoutMinutes: 5, minSendIntervalSeconds: 2 }, 7);
  const latest = await f.add("new");
  assert.equal((await f.queue.request("poll", waiting.ticket)).record.deadlineAt, waiting.record.deadlineAt);
  assert.equal(latest.record.deadlineAt - latest.record.queuedAt, 300000);
  assert.equal(f.queue.snapshot().configRevision, 7);
  assert.equal(f.queue.query({ limit: 25, snapshotId: page.snapshotId }).total, 2);
  assert.equal(f.queue.query({ limit: 25 }).total, 3);
});

test("session choices follow state and search across all pages, independent of selected session", async t => {
  const f = await fixture(t);
  const old = await f.add("old", "history-only");
  await f.queue.request("settle", { ...old.ticket, outcome: "succeeded" });
  for (let i = 0; i < 26; i++) await f.add(`current_${i}`, `session-${i}`);
  const page = f.queue.query({ state: "active", limit: 25 });
  assert.equal(page.items.length, 25);
  assert.equal(page.groups.length, 26);
  assert.equal(page.groups.includes("history-only"), false);
  const selected = f.queue.query({ groupId: "session-25", limit: 25 });
  assert.equal(selected.total, 1);
  assert.deepEqual(selected.groups, page.groups);
  assert.deepEqual(f.queue.query({ state: "ended" }).groups, ["history-only"]);
  assert.deepEqual(f.queue.query({ search: "session-25" }).groups, ["session-25"]);
  assert.deepEqual(f.queue.query({ search: "no-match" }).groups, []);
  await f.add("newly_arrived", "new-session");
  const next = f.queue.query({ state: "active", limit: 25, offset: 25, snapshotId: page.snapshotId });
  assert.equal(next.total, 26);
  assert.deepEqual(next.groups, page.groups);
  assert.equal(f.queue.query({ state: "active", limit: 25 }).total, 27);
});

test("fresh empty queries see arrivals and omit sessions after their last task finishes", async t => {
  const f = await fixture(t);
  const empty = f.queue.query();
  const job = await f.add("arrival");
  assert.equal(f.queue.query({ snapshotId: empty.snapshotId }).total, 0);
  assert.deepEqual(f.queue.query().groups, ["arrival"]);
  await f.queue.request("settle", { ...job.ticket, outcome: "succeeded" });
  assert.deepEqual(f.queue.query().groups, []);
  assert.deepEqual(f.queue.query({ state: "ended" }).groups, ["arrival"]);
});

test("send permits authenticate the owner and unknown sends stop dispatch", async t => {
  const f = await fixture(t); const first = await f.add("main"); const second = await f.add("child");
  await assert.rejects(f.queue.request("send-begin", { ...first.ticket, secret: "invalid" }), /unavailable/);
  await assert.rejects(f.queue.request("send-progress", { ...first.ticket, secret: "invalid", progress: "sending" }), /unavailable/);
  await f.queue.request("send-progress", { ...first.ticket, progress: "waiting_permit" });
  assert.equal((await f.queue.request("poll", first.ticket)).record.sendProgress, "waiting_permit");
  const permit = await f.queue.request("send-begin", first.ticket);
  assert.equal(permit.allowed, true);
  await f.queue.request("send-progress", { ...first.ticket, progress: "awaiting_ack" });
  await f.queue.request("send-end", { ...first.ticket, permit: permit.permit, outcome: "unknown" });
  await assert.rejects(f.queue.request("send-progress", { ...first.ticket, progress: "sending" }), /retired/);
  await f.queue.request("settle", { ...first.ticket, outcome: "failed" });
  assert.ok(f.queue.snapshot().pauseReasons.includes("send_outcome_unknown"));
  await assert.rejects(f.queue.control("resume"), /reconcile/);
  assert.equal((await f.queue.request("poll", second.ticket)).record.reason, "queue_blocked_send_outcome_unknown");
  assert.deepEqual((await f.queue.request("poll", second.ticket)).record.blockedBy,
    { reason: "send_outcome_unknown", requestId: first.ticket.id });
});

test("rate-limit pauses persist across restart and require explicit recovery", async t => {
  const f = await fixture(t); const first = await f.add("limited");
  await f.queue.request("settle", { ...first.ticket, outcome: "failed", reason: "rate_limit_exceeded" });
  await f.restart();
  assert.deepEqual(f.queue.snapshot().pauseReasons, ["account_rate_limited"]);
  const waiting = await f.add("retry_new_request");
  assert.equal(waiting.record.state, "failed");
  assert.equal(waiting.record.reason, "queue_blocked_account_rate_limited");
  assert.deepEqual(waiting.record.blockedBy, { reason: "account_rate_limited", requestId: first.ticket.id });
  await assert.rejects(f.queue.control("resume"), /reconcile/);
  await f.queue.control("recover", undefined, f.queue.snapshot().recoveryToken);
  assert.equal((await f.queue.request("poll", waiting.ticket)).record.state, "failed");
  assert.equal((await f.add("after_recovery")).record.state, "preparing");
  assert.equal(f.queue.query({ state: "ended" }).items[0].reason, "rate_limit_exceeded");
});

test("expired blocking receipts retain bounded evidence across restart, without replay", async t => {
  const f = await fixture(t), original = await f.add("expired_blocker");
  const permit = await f.queue.request("send-begin", original.ticket);
  await f.queue.request("send-end", { ...original.ticket, permit: permit.permit, outcome: "unknown" });
  await f.queue.request("settle", { ...original.ticket, outcome: "failed", reason: "chatgpt_send_outcome_unknown" });
  f.queue.core.jobs.get(original.ticket.id).endedMonotonic -= f.queue.core.receiptTtlMs + 1;
  assert.equal(f.queue.core.get(original.ticket.id), null);
  const evidence = f.queue.snapshot().pauseSources[0];
  assert.equal(evidence.requestId, original.ticket.id);
  assert.equal(evidence.sendProgress, "unknown");
  assert.ok(Number.isFinite(evidence.at));
  assert.deepEqual(Object.keys(evidence).sort(), ["at", "reason", "requestId", "sendProgress"]);
  await f.restart();
  assert.deepEqual(f.queue.snapshot().pauseSources[0], evidence);
  assert.equal((await f.add("check_still_blocked")).record.reason, "queue_blocked_send_outcome_unknown");
  await f.queue.control("recover", undefined, f.queue.snapshot().recoveryToken);
  assert.equal(f.queue.snapshot().pauseSources.length, 0);
  assert.equal((await f.add("new_after_recovery")).record.state, "preparing");
});

test("old receipt files migrate blocking evidence before their records expire", async t => {
  const f = await fixture(t), original = await f.add("old_format");
  await f.queue.request("settle", { ...original.ticket, outcome: "failed", reason: "rate_limit_exceeded" });
  await f.queue.close();
  const file = path.join(f.root, "request-queue.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  saved.pauseSources = saved.pauseSources.map(({ reason, requestId }) => ({ reason, requestId }));
  saved.records[0].endedAt = Date.now() - 25 * 3600_000;
  await fs.writeFile(file, JSON.stringify(saved));
  await f.restart();
  assert.equal(f.queue.query({ state: "ended" }).items.length, 0);
  assert.equal(f.queue.snapshot().pauseSources[0].at, saved.records[0].endedAt);
});

test("recovery rejects missing/stale confirmations and preserves the user's separate pause", async t => {
  const f = await fixture(t);
  f.queue.core.pause("send_outcome_unknown");
  const old = f.queue.snapshot().recoveryToken;
  await assert.rejects(f.queue.control("recover"), { code: "queue_pause_changed" });
  f.queue.core.pause("browser_unavailable");
  await assert.rejects(f.queue.control("recover", undefined, old), { code: "queue_pause_changed" });
  await f.queue.control("pause");
  await f.queue.control("recover", undefined, f.queue.snapshot().recoveryToken);
  assert.deepEqual(f.queue.snapshot().pauseReasons, ["user"]);
  assert.equal((await f.add("manual_pause_preserved")).record.state, "queued");
  await f.queue.control("resume");
  assert.equal(f.queue.snapshot().active, 1);
});

test("recovery cannot release a still-active physical owner", async t => {
  const f = await fixture(t); const first = await f.add("main");
  const send = await f.queue.request("send-begin", first.ticket);
  await f.queue.request("send-end", { ...first.ticket, permit: send.permit, outcome: "unknown" });
  f.resources.add("trace_main");
  await assert.rejects(f.queue.control("recover", undefined, f.queue.snapshot().recoveryToken), /Stop active tasks/);
  await f.queue.control("cancel", first.ticket.id);
  await assert.rejects(f.queue.control("recover", undefined, f.queue.snapshot().recoveryToken), /Stop active tasks/);
  f.resources.delete("trace_main");
  await f.queue.request("settle", { ...first.ticket, outcome: "cancelled" });
  await f.queue.control("recover", undefined, f.queue.snapshot().recoveryToken);
  assert.equal(f.queue.snapshot().pausedReason, null);
});

test("restart during an unacknowledged send pauses dispatch without replaying the request", async t => {
  const f = await fixture(t); const first = await f.add("unacknowledged");
  await f.queue.request("send-begin", first.ticket);
  await f.restart();
  assert.ok(f.queue.snapshot().pauseReasons.includes("send_outcome_unknown"));
  assert.equal((await f.add("after_restart")).record.reason, "queue_blocked_send_outcome_unknown");
  await assert.rejects(f.queue.request("enqueue", first.input), /receipt/);
  await f.queue.control("recover", undefined, f.queue.snapshot().recoveryToken);
  assert.equal(f.queue.snapshot().active, 0);
  assert.equal((await f.add("after_recovery")).record.state, "preparing");
});
