import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rename, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { QueueInput, QueueRecord } from "../../launcher/shared/request-scheduler.cjs";
import { StandaloneRequestQueue, getStandaloneRequestQueue, closeStandaloneRequestQueues,
  recoverStandaloneRequestQueue, standaloneQueueDirectory, inspectStandaloneRequestQueue } from "../../src/browser/standalone-request-queue";
import { withQueuedRequest, waitForSendPermit, queueRequest, type QueueTicket } from "../../src/browser/request-queue-client";
import { standaloneQueueCommand } from "../../src/browser/standalone-queue-command";
import { queueProfileId, readStandaloneQueueDescriptor } from "../../src/browser/standalone-queue-transport";
import { ChatGptBrowserWorker, closeChatGptBrowserWorkers, type BrowserTurn } from "../../src/adapters/chatgpt-web/browser/browser-worker";

async function fixture() {
  const root = resolve(import.meta.dir, "../../output/queue-cli-fixtures");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "case-"));
  const profile = join(directory, "storage-state.json");
  await writeFile(profile, "{}"); // inert fixture; never credentials or a real browser
  return { directory, profile };
}
const job = (name: string, group = name): QueueInput => ({
  id: createHash("sha256").update(name).digest("hex"), groupId: group,
  model: "gpt-6", effort: "high", mode: "native-tools", bytes: 128,
});
async function admit(queue: StandaloneRequestQueue, name: string) {
  const input = job(name);
  const { secret, record } = await queue.request<{ secret: string; record: QueueRecord }>("enqueue", {
    job: input, pid: process.pid, traceId: `trace_${name}`,
  });
  return { id: input.id, secret, record };
}
const settings = { maxConcurrent: 1, queueTimeoutMinutes: 5, minSendIntervalSeconds: 1 };
async function child(profile: string, action: string) {
  const process = Bun.spawn([globalThis.process.execPath, join(import.meta.dir, "fixtures/standalone-queue-process.ts"), profile, action], {
    cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { exit, stdout, stderr };
}

test("canonical profile host is shared and another process cannot create a second pool", async () => {
  const { profile } = await fixture();
  const first = await getStandaloneRequestQueue(profile);
  try {
    expect(await getStandaloneRequestQueue(join(profile, "..", "storage-state.json"))).toBe(first);
    if (process.platform === "win32") expect(await getStandaloneRequestQueue(profile.toUpperCase())).toBe(first);
    expect(await child(profile, "probe")).toEqual({ exit: 1, stdout: "queue_host_conflict\n", stderr: "" });
    await expect(recoverStandaloneRequestQueue(profile, true)).rejects.toMatchObject({ code: "queue_host_conflict" });
  } finally { await closeStandaloneRequestQueues(); }
  expect(await child(profile, "probe")).toEqual({ exit: 0, stdout: "opened\n", stderr: "" });
});

test("separate CLI processes join one profile owner and share capacity and actual-send pacing", async () => {
  const { directory, profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  await queue.updateSettings(settings);
  try {
    const results = await Promise.all(Array.from({ length: 3 }, () => child(profile, "join")));
    expect(results).toEqual(Array.from({ length: 3 }, () => ({ exit: 0, stdout: "joined\n", stderr: "" })));
    const events = (await readFile(join(directory, "events.jsonl"), "utf8")).trim().split("\n")
      .map(line => JSON.parse(line) as { event: string; at: number; pid: number });
    expect(events.map(event => event.event)).toEqual(["send", "release", "send", "release", "send", "release"]);
    expect(new Set(events.map(event => event.pid)).size).toBe(3);
    const sends = events.filter(event => event.event === "send");
    expect(sends[1]!.at - sends[0]!.at).toBeGreaterThanOrEqual(970);
    expect(sends[2]!.at - sends[1]!.at).toBeGreaterThanOrEqual(970);
    expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0 });
    const saved = await inspectStandaloneRequestQueue(profile);
    expect(saved.records).toHaveLength(3);
    expect(saved.records.every(row => row.state === "succeeded" && row.model === "gpt-6-pro" && row.effort === "max" && row.mode === "native-tools")).toBe(true);
  } finally { await queue.close(); }
}, 10000);

test("lost remote owner retains its physical lease and fences new dispatch", async () => {
  const { profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  try {
    expect(await child(profile, "join-crash")).toEqual({ exit: 0, stdout: "", stderr: "" });
    const deadline = Date.now() + 2500;
    while (!queue.snapshot().pausedReason && Date.now() < deadline) await delay(25);
    expect(queue.snapshot()).toMatchObject({ active: 1, pausedReason: "browser_unavailable" });
    expect((await admit(queue, "after_remote_crash")).record).toMatchObject({ state: "failed", reason: "queue_blocked_browser_unavailable" });
    await expect(queue.close()).rejects.toMatchObject({ code: "queue_resource_not_released" });
    expect((await inspectStandaloneRequestQueue(profile)).ownerPresent).toBe(true);
  } finally {
    // This test created no browser. Close only its own loopback fixture endpoint,
    // preserving the unresolved receipt/lock as crash evidence under output/.
    await queue.close().catch(() => {});
    clearInterval((queue as unknown as { timer: ReturnType<typeof setInterval> }).timer);
    const server = (queue as unknown as { server: import("node:http").Server }).server;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("queue transport rejects unauthenticated, wrong-generation, cross-profile and oversized controls", async () => {
  const { profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  try {
    const directory = standaloneQueueDirectory(profile), owner = await readStandaloneQueueDescriptor(directory);
    const url = `${owner.endpoint}/v1/queue/hello`;
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(403);
    const body = { generation: owner.generation, profileId: queueProfileId(directory), clientId: crypto.randomUUID(), pid: process.pid, body: {} };
    for (const invalid of [{ ...body, generation: "old-generation" }, { ...body, profileId: "another-profile" }, { ...body, body: "x".repeat(9000) }]) {
      const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${owner.token}` }, body: JSON.stringify(invalid) });
      expect(response.status).toBe(503);
      await response.arrayBuffer();
    }
    expect(queue.snapshot().active).toBe(0);
  } finally { await queue.close(); }
});

test("queued deadline expires without preparing or sending", async () => {
  const { profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  await queue.updateSettings(settings);
  const first = await admit(queue, "deadline_blocker");
  const core = (queue as unknown as { core: { monotonicNow: () => number } }).core;
  const clock = core.monotonicNow;
  let prepared = false;
  try {
    await expect(withQueuedRequest({ descriptorPath: queue, traceId: "trace_expired", job: job("expired"),
      onQueued: () => { const expiredAt = clock() + 300001; core.monotonicNow = () => expiredAt; },
      execute: async () => { prepared = true; },
    })).rejects.toMatchObject({ code: "queue_wait_timeout" });
    expect(prepared).toBe(false);
    expect(queue.snapshot()).toMatchObject({ active: 1, waiting: 0, waitingBytes: 0 });
  } finally { core.monotonicNow = clock; await queue.request("settle", { ...first, outcome: "succeeded" }); await queue.close(); }
});

test("receipt write failure never returns a send permit and retains uncertainty", async () => {
  const { profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  const file = join(standaloneQueueDirectory(profile), "receipts.json"), backup = `${file}.fixture-backup`;
  const ticket = await admit(queue, "disk_failure");
  await rename(file, backup); await mkdir(file);
  let restored = false;
  try {
    await expect(queue.request("send-begin", ticket)).rejects.toBeDefined();
    expect(queue.snapshot().pausedReason).toBe("browser_unavailable");
    // Only this fixture's individually created empty directory is removed.
    await rmdir(file); await rename(backup, file); restored = true;
    await queue.request("settle", { ...ticket, outcome: "failed" });
    const saved = await inspectStandaloneRequestQueue(profile);
    expect(saved.pendingSend).toBe(true);
    expect(saved.pauseReasons).toContain("send_outcome_unknown");
  } finally {
    if (!restored) { await rmdir(file); await rename(backup, file); }
    await queue.close();
  }
});

test("50 standalone clients share four slots; physical release precedes replacement", async () => {
  const { profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  let active = 0, peak = 0;
  try {
    const values = await Promise.all(Array.from({ length: 50 }, (_, index) => withQueuedRequest({
      descriptorPath: queue, traceId: `trace_many_${index}`, job: job(`many_${index}`, `group_${index % 5}`),
      execute: async ticket => {
        let released = false;
        await queue.holdResource(ticket, () => released);
        peak = Math.max(peak, ++active);
        try { await delay(20); return index; }
        finally { active--; released = true; }
      },
    })));
    expect(values).toHaveLength(50); expect(peak).toBe(4);
    expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0, waitingBytes: 0 });
    expect((await inspectStandaloneRequestQueue(profile)).records).toHaveLength(50);
  } finally { await queue.close(); }
}, 15000);

test("cancelled waiters never run; running cancellation cannot release a live page", async () => {
  const { profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  await queue.updateSettings(settings);
  let released = false;
  try {
    const first = await admit(queue, "physical");
    await queue.holdResource(first, () => released);
    const abort = new AbortController(); let ran = false;
    const waiting = withQueuedRequest({ descriptorPath: queue, traceId: "trace_wait_cancel", job: job("wait_cancel"), signal: abort.signal,
      onQueued: () => abort.abort(), execute: async () => { ran = true; },
    });
    await expect(waiting).rejects.toBeDefined(); expect(ran).toBe(false);
    await queue.request("cancel", first);
    await expect(queue.request("send-begin", first)).rejects.toMatchObject({ code: "queue_cancelled" });
    await expect(queue.request("settle", { ...first, outcome: "cancelled" })).rejects.toMatchObject({ code: "queue_resource_not_released" });
    expect(queue.snapshot()).toMatchObject({ active: 1, waiting: 0, pausedReason: "browser_unavailable" });
    released = true;
    await queue.request("settle", { ...first, outcome: "cancelled" });
    expect(queue.snapshot().active).toBe(0);
  } finally { released = true; await queue.close(); }
});

test("cancellation waits for cleanup before another queued request starts", async () => {
  const { profile } = await fixture();
  const queue = await StandaloneRequestQueue.open(profile);
  await queue.updateSettings(settings);
  const abort = new AbortController(); let released = false, secondStarted = false;
  let entered!: () => void, finishCleanup!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  const first = withQueuedRequest({ descriptorPath: queue, traceId: "trace_abort_live", job: job("abort_live"), signal: abort.signal,
    execute: async (ticket, signal) => {
      await queue.holdResource(ticket, () => released); entered();
      try { await delay(10000, undefined, { signal }); }
      finally { await cleanup; released = true; }
    },
  });
  const firstResult = first.catch(error => error);
  await started;
  const second = withQueuedRequest({ descriptorPath: queue, traceId: "trace_after_abort", job: job("after_abort"),
    execute: async () => { secondStarted = true; expect(released).toBe(true); },
  });
  try {
    abort.abort(); await delay(50);
    expect(queue.snapshot().active).toBe(1); expect(secondStarted).toBe(false);
    finishCleanup(); await firstResult; await second;
    expect(secondStarted).toBe(true);
  } finally { abort.abort(); finishCleanup(); await Promise.allSettled([first, second]); await queue.close(); }
});

test("actual sends serialize across clients, persist before permit return and retain interval after restart", async () => {
  const { profile } = await fixture();
  let queue = await StandaloneRequestQueue.open(profile);
  await queue.updateSettings({ ...settings, maxConcurrent: 2 });
  try {
    const first = await admit(queue, "send_one"), second = await admit(queue, "send_two");
    const permit = await waitForSendPermit(queue, first);
    expect((await inspectStandaloneRequestQueue(profile)).pendingSend).toBe(true);
    expect(await queue.request("send-begin", second)).toMatchObject({ allowed: false, reason: "send_in_progress" });
    await queueRequest(queue, "send-end", { ...first, permit, outcome: "confirmed" });
    const confirmed = performance.now();
    expect(await queue.request("send-begin", second)).toMatchObject({ allowed: false, reason: "send_interval" });
    await queue.request("settle", { ...first, outcome: "succeeded" });
    await queue.request("settle", { ...second, outcome: "succeeded" });
    await queue.close();
    queue = await StandaloneRequestQueue.open(profile);
    const resumed = await admit(queue, "send_after_restart");
    const nextPermit = await waitForSendPermit(queue, resumed);
    expect(performance.now() - confirmed).toBeGreaterThanOrEqual(970);
    await queue.request("send-end", { ...resumed, permit: nextPermit, outcome: "not-sent" });
    await queue.request("settle", { ...resumed, outcome: "succeeded" });
    await expect(admit(queue, "send_one")).rejects.toMatchObject({ code: "queue_request_replayed" });
    const receiptText = await readFile(join(standaloneQueueDirectory(profile), "receipts.json"), "utf8");
    expect(receiptText).not.toContain(first.secret); expect(receiptText).not.toContain(permit);
  } finally { await queue.close(); }
});

test("crashed owner requires explicit physical recovery, keeps receipts and never replays", async () => {
  const { profile } = await fixture();
  expect(await child(profile, "crash")).toEqual({ exit: 0, stdout: "", stderr: "" });
  expect((await inspectStandaloneRequestQueue(profile)).pendingSend).toBe(true);
  await expect(StandaloneRequestQueue.open(profile)).rejects.toMatchObject({ code: "queue_host_conflict" });
  await expect(recoverStandaloneRequestQueue(profile, false)).rejects.toThrow("--confirm-browser-stopped");
  await recoverStandaloneRequestQueue(profile, true);
  const saved = await inspectStandaloneRequestQueue(profile);
  expect(saved.records[0]).toMatchObject({ state: "failed", reason: "runtime_restarted_outcome_unknown" });
  const queue = await StandaloneRequestQueue.open(profile);
  try {
    await expect(admit(queue, "crashed-request")).rejects.toMatchObject({ code: "queue_request_replayed" });
    const next = await admit(queue, "recovery_new"); expect(next.record.state).toBe("preparing");
    await queue.request("settle", { ...next, outcome: "succeeded" });
  } finally { await queue.close(); }
});

test("unknown send and rate limits pause dispatch until offline recovery; settings validate and persist", async () => {
  const { profile } = await fixture();
  await expect(standaloneQueueCommand(profile, ["configure", "--concurrency", "0", "--timeout-minutes", "5", "--send-interval-seconds", "1"])).rejects.toBeDefined();
  await standaloneQueueCommand(profile, ["configure", "--concurrency", "1", "--timeout-minutes", "5", "--send-interval-seconds", "1"]);
  let queue = await StandaloneRequestQueue.open(profile);
  try {
    expect(queue.snapshot().settings).toEqual(settings);
    const ticket = await admit(queue, "unknown");
    const permit = await waitForSendPermit(queue, ticket);
    await queue.request("send-end", { ...ticket, permit, outcome: "unknown" });
    await queue.request("settle", { ...ticket, outcome: "failed" });
    expect((await admit(queue, "blocked")).record).toMatchObject({ state: "failed", reason: "queue_blocked_send_outcome_unknown", blockedBy: { requestId: ticket.id } });
    await queue.close(); queue = await StandaloneRequestQueue.open(profile);
    expect(queue.snapshot().pausedReason).toBe("send_outcome_unknown");
    await queue.close();
    await standaloneQueueCommand(profile, ["recover", "--confirm-browser-stopped"]);
    queue = await StandaloneRequestQueue.open(profile);
    const limited = await admit(queue, "rate_limited");
    await queue.request("settle", { ...limited, outcome: "failed", reason: "rate_limit_exceeded" });
    expect(queue.snapshot().pausedReason).toBe("account_rate_limited");
  } finally { await queue.close(); }
});

test("distinct managed workers use one host, preserve model/tool choices and delay preparation", async () => {
  const { profile } = await fixture();
  const queue = await getStandaloneRequestQueue(profile);
  if (!(queue instanceof StandaloneRequestQueue)) throw new Error("Fixture must own its isolated profile");
  await queue.updateSettings(settings);
  const workers = [true, false].map(headed => ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: "browser://queue-fixture",
    chatgptWeb: { browserHost: "managed-chrome", storageStatePath: profile, headed },
  }));
  expect(workers[0]).not.toBe(workers[1]);
  let active = 0, peak = 0, prepared = 0;
  const originals = workers.map(worker => (worker as unknown as { runExclusive: (turn: BrowserTurn) => Promise<string> }).runExclusive);
  for (const worker of workers) (worker as unknown as { runExclusive: (turn: BrowserTurn) => Promise<string> }).runExclusive = async turn => {
    expect(turn.queueTicket).toBeDefined();
    expect((await queue.request<{ record: QueueRecord }>("poll", turn.queueTicket!)).record).toMatchObject({
      model: turn.reasoning === "max" ? "gpt-6-pro" : "gpt-6-sol", effort: turn.reasoning,
    });
    peak = Math.max(peak, ++active);
    const prompt = await turn.prepare(); prepared++;
    try { await delay(20); return `${turn.modelId}:${turn.reasoning}:${turn.capabilities.nativeToolsEnabled}`; }
    finally { prompt.release(); active--; }
  };
  try {
    const turns = Array.from({ length: 6 }, (_, index) => workers[index % 2]!.run({
      traceId: `worker_fixture_${index}`, modelId: "gpt-5.6-sol", modelFamily: "6", reasoning: index % 2 ? "high" : "max",
      capabilities: { localToolsEnabled: false, nativeToolsEnabled: true, solAvailable: true, proAvailable: true, extraHighAvailable: true },
      prepare: async () => ({ text: "inert fixture", images: [], release() {} }), onTextDelta() {},
    }));
    expect(await Promise.all(turns)).toEqual(Array.from({ length: 6 }, (_, index) => index % 2 ? "gpt-5.6-sol:high:true" : "gpt-5.6-sol:max:true"));
    expect(peak).toBe(1); expect(prepared).toBe(6);
  } finally {
    workers.forEach((worker, index) => { (worker as unknown as { runExclusive: unknown }).runExclusive = originals[index]; });
    await closeChatGptBrowserWorkers();
  }
}, 10000);
