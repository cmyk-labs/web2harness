import { test, expect, spyOn } from "bun:test";
import { parseDiagnosticLine, type DiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { withQueuedRequest, waitForSendPermit, queueRequest, NativeQueueDelivery } from "../../../../src/browser/request-queue-client";
import { ChatGptWebAdapterError } from "../../../../src/adapters/chatgpt-web/adapter-error";
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../../../../src/browser/launcher-client";

const require = createRequire(import.meta.url);
const { RequestQueue } = require("../../../../launcher/electron/runtime/request-queue.cjs");
const { BrowserControlServer } = require("../../../../launcher/electron/control-server.cjs");

test.each(["reject", "stall"])("delivery metadata %s is bounded, private and never resends or rejects the committed reply", async outcome => {
  const records: DiagnosticRecord[] = [], actions: string[] = [];
  const log = spyOn(console, "error").mockImplementation((line: unknown) => {
    const record = parseDiagnosticLine(String(line)); if (record) records.push(record);
  });
  const delivery = new NativeQueueDelivery();
  const transport = { async request<T>(action: string): Promise<T> {
    actions.push(action);
    if (action === "enqueue") return { record: { state: "preparing" }, secret: "PRIVATE_TICKET" } as T;
    if (action === "native-delivery") {
      if (outcome === "stall") return await new Promise<T>(() => {});
      throw new Error("PRIVATE_ERROR PRIVATE_TICKET");
    }
    return {} as T;
  } };
  try {
    expect(await delivery.run(() => withQueuedRequest({ descriptorPath: transport, traceId: "delivery_fixture",
      job: { id: "a".repeat(64), groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 0 },
      execute: async () => "reply",
    }))).toBe("reply");
    await delivery.report("response_written");
    expect(actions).toEqual(["enqueue", "settle", "native-delivery"]);
    expect(records.at(-1)).toMatchObject({ event: "browser.native_delivery_update_failed",
      detail: { category: "queue_metadata_unavailable", deliveryState: "response_written", queueId: "a".repeat(64),
        outcome: outcome === "stall" ? "timeout" : "failed" } });
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
  } finally { log.mockRestore(); }
});

test.each([false, true])("an execution AbortError records caller signal=%s without inventing cancellation", async signalled => {
  const records: DiagnosticRecord[] = [], settlements: any[] = [];
  const log = spyOn(console, "error").mockImplementation((line: unknown) => {
    const record = parseDiagnosticLine(String(line)); if (record) records.push(record);
  });
  const abort = new AbortController(), original = new DOMException("Browser operation aborted", "AbortError");
  const transport = { async request<T>(action: string, body: unknown): Promise<T> {
    if (action === "enqueue") return { record: { state: "preparing" }, secret: "PRIVATE_TICKET" } as T;
    if (action === "settle") settlements.push(body);
    return {} as T;
  } };
  try {
    await expect(withQueuedRequest({ descriptorPath: transport, traceId: "abort-origin", signal: abort.signal,
      job: { id: "abort-origin", groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 },
      execute: async () => { if (signalled) abort.abort(original); throw original; },
    })).rejects.toBe(original);
    expect(settlements[0]?.outcome).toBe(signalled ? "cancelled" : "failed");
    expect(records).toHaveLength(2);
    expect(records[0]?.event).toBe("browser.queue_attempt_admitted");
    expect(records[1]).toMatchObject({ event: "browser.queue_execution_interrupted", detail: {
      signalAborted: signalled, callerAborted: signalled, queueAborted: false,
      cancelSource: signalled ? "caller" : "none", outcome: signalled ? "cancelled" : "failed",
      error: { errorName: "AbortError", code: "20" }, restoredQueueError: false,
    } });
    expect(JSON.stringify(records)).not.toContain("PRIVATE_TICKET");
  } finally { log.mockRestore(); }
});

async function withQueueFixture(run: (queue: InstanceType<typeof RequestQueue>) => Promise<void>) {
  const root = resolve(await mkdtemp(join(tmpdir(), "w2h-client-queue-")));
  const queue = new RequestQueue({ directory: root, logger: { info() {}, warn() {}, error() {} },
    hasResource: () => false, cancelResource: async () => {},
    settings: { maxConcurrent: 4, queueTimeoutMinutes: 5, minSendIntervalSeconds: 1 } });
  try { await queue.start(); await run(queue); }
  finally {
    await queue.close();
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("w2h-client-queue-")) throw new Error("Unexpected fixture path");
    await rm(root, { recursive: true });
  }
}

test.each(["send_outcome_unknown", "browser_unavailable", "account_rate_limited"])(
  "send permit denial preserves %s as a non-retryable structured error", async reason => {
    let attempts = 0;
    const transport = { async request<T>(action: string): Promise<T> {
      expect(action).toBe("send-begin"); attempts++;
      return { allowed: false, reason } as T;
    } };
    const error = await waitForSendPermit(transport, { id: "fixture", secret: "fixture" }).catch(error => error);
    expect(error).toBeInstanceOf(ChatGptWebAdapterError);
    expect(error).toMatchObject({ code: reason, status: 503, errorType: "server_error", retryable: false });
    expect(error.message).toContain(reason);
    expect(attempts).toBe(1);
  },
);

test("send permit only waits for interval and in-progress denials", async () => {
  const responses = [
    { allowed: false, reason: "send_interval", retryAfterMs: 100 },
    { allowed: false, reason: "send_in_progress", retryAfterMs: 100 },
    { allowed: true, permit: "fixture-permit" },
  ];
  let attempts = 0;
  const transport = { async request<T>(): Promise<T> { return responses[attempts++] as T; } };
  expect(await waitForSendPermit(transport, { id: "fixture", secret: "fixture" })).toBe("fixture-permit");
  expect(attempts).toBe(3);
});

test.each(["send_outcome_unknown", "browser_unavailable", "account_rate_limited"])(
  "queued request reports %s without consuming a slot or waiting for its timeout", async reason => {
    await withQueueFixture(async queue => {
      queue.core.pause(reason);
      let executed = false;
      const traceId = `trace_blocked_${reason}`;
      const job = { id: createHash("sha256").update(traceId).digest("hex"), groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 };
      await expect(withQueuedRequest({ descriptorPath: queue, traceId, job,
        execute: async () => { executed = true; },
      })).rejects.toMatchObject({ status: 503, code: `queue_blocked_${reason}`, retryable: false });
      expect(executed).toBe(false);
      expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0, pausedReason: reason });
      expect(queue.query({ state: "failed" }).items[0]).toMatchObject({ reason: `queue_blocked_${reason}`, blockedBy: { reason } });
    });
  },
);

test("unknown send outcome remains paused and a failed receipt never sends again", async () => {
  await withQueueFixture(async queue => {
    const traceId = "trace_unknown_send";
    const job = { id: createHash("sha256").update(traceId).digest("hex"), groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 };
    let executions = 0, permits = 0;
    const execute = async (ticket: { id: string; secret: string }, signal: AbortSignal) => {
      executions++;
      const permit = await waitForSendPermit(queue, ticket, signal); permits++;
      await queueRequest(queue, "send-end", { ...ticket, permit, outcome: "unknown" });
      await waitForSendPermit(queue, ticket, signal);
      throw new Error("An unknown send must never receive another permit");
    };
    const first = await withQueuedRequest({ descriptorPath: queue, traceId, job, execute }).catch(error => error);
    expect(first).toMatchObject({ code: "send_outcome_unknown", retryable: false });
    const receipt = queue.query({ state: "failed" }).items[0];
    expect(receipt).toMatchObject({ state: "failed", reason: "send_outcome_unknown" });

    const replay = await withQueuedRequest({ descriptorPath: queue, traceId, job, execute }).catch(error => error);
    expect(replay).toBeInstanceOf(ChatGptWebAdapterError);
    expect(replay).toMatchObject({ status: 502, code: "send_outcome_unknown", retryable: false });
    expect(replay.message).toContain("send_outcome_unknown");
    expect(replay.message).not.toMatch(/cancelled|already finished/);
    expect(queue.query({ state: "failed" }).items).toEqual([receipt]);
    expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0, pausedReason: "send_outcome_unknown",
      pauseReasons: ["send_outcome_unknown"] });
    expect(executions).toBe(1); expect(permits).toBe(1);

    await expect(withQueuedRequest({ descriptorPath: queue, traceId: "trace_different_owner", job, execute }))
      .rejects.toMatchObject({ code: "queue_request_replayed" });
    expect(executions).toBe(1);
  });
});

test.each(["chatgpt_response_timeout", "context_length_exceeded", undefined])(
  "failed replay retains reason %s without inventing cancellation", async code => {
    await withQueueFixture(async queue => {
      const traceId = "trace_failed_replay";
      const cause = new Error("original browser failure");
      const original = code ? new ChatGptWebAdapterError("original failure", {
        status: code === "context_length_exceeded" ? 400 : 502, errorType: "server_error", code, retryable: false, cause,
      }) : new Error("unclassified failure", { cause });
      const job = { id: createHash("sha256").update(traceId).digest("hex"), groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 };
      let executions = 0;
      const execute = async () => { executions++; throw original; };
      await expect(withQueuedRequest({ descriptorPath: queue, traceId, job, execute })).rejects.toBe(original);
      const receipt = queue.query({ state: "failed" }).items[0];
      expect(receipt).toMatchObject({ state: "failed", reason: code });
      const replay = await withQueuedRequest({ descriptorPath: queue, traceId, job, execute }).catch(error => error);
      expect(replay).toMatchObject({ code: code ?? "queue_failed", status: 502, retryable: false });
      expect(replay.message).toContain(code ?? "failed");
      expect(replay.message).not.toMatch(/cancelled|already finished/);
      expect(executions).toBe(1);
      expect(queue.query({ state: "failed" }).items).toEqual([receipt]);
    });
  },
);

test.each([
  { state: "succeeded", reason: undefined, status: 409, code: "queue_cancelled", message: "Web request was cancelled or has already finished" },
  { state: "cancelled", reason: "client_cancelled", status: 409, code: "client_cancelled", message: "Web request was cancelled or has already finished" },
  { state: "timed-out", reason: "queue_wait_timeout", status: 504, code: "queue_wait_timeout", message: "Web request expired while waiting in the global queue" },
])("$state receipt replay retains existing behavior", async ({ state, reason, status, code, message }) => {
  let executions = 0;
  const transport = { async request<T>(action: string): Promise<T> {
    if (action === "enqueue") return { record: { state, reason }, secret: "fixture" } as T;
    expect(action).toBe("settle"); return {} as T;
  } };
  await expect(withQueuedRequest({ descriptorPath: transport, traceId: "replay-fixture",
    job: { id: "replay-fixture", groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 },
    execute: async () => { executions++; },
  })).rejects.toMatchObject({ code, status, message, retryable: false });
  expect(executions).toBe(0);
});

test("send permit transport failures and explicit abort keep their original status and cause", async () => {
  const original = new ChatGptWebAdapterError("owned queue is unavailable", {
    status: 409, errorType: "server_error", code: "queue_lease_invalid", retryable: false, cause: new Error("original cause"),
  });
  let attempts = 0;
  const transport = { async request<T>(): Promise<T> { attempts++; throw original; } };
  const ticket = { id: "fixture", secret: "fixture" };
  await expect(waitForSendPermit(transport, ticket)).rejects.toBe(original);
  const abort = new AbortController(); abort.abort(original);
  await expect(waitForSendPermit(transport, ticket, abort.signal)).rejects.toBe(original);
  expect(attempts).toBe(1);
});

test("settlement failure retains both the execution error and cleanup error", async () => {
  const original = new ChatGptWebAdapterError("send could not be confirmed", {
    status: 502, errorType: "server_error", code: "send_outcome_unknown", retryable: false, cause: new Error("original cause"),
  });
  const cleanupError = new Error("fixture resource still held");
  const transport = { async request<T>(action: string): Promise<T> {
    if (action === "enqueue") return { record: { state: "preparing" }, secret: "fixture" } as T;
    expect(action).toBe("settle"); throw cleanupError;
  } };
  const error = await withQueuedRequest({ descriptorPath: transport, traceId: "cleanup-fixture",
    job: { id: "cleanup-fixture", groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 },
    execute: async () => { throw original; },
  }).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([original, cleanupError]);
  expect(error.errors[0]).toBe(original);
});

test("cancellation while the physical attempt settles cannot return a recovery-eligible reply", async () => {
  const abort = new AbortController();
  const settlements: unknown[] = [];
  const transport = { async request<T>(action: string, body: unknown): Promise<T> {
    if (action === "enqueue") return { record: { state: "preparing" }, secret: "fixture" } as T;
    if (action === "settle") settlements.push(body);
    return {} as T;
  } };
  await expect(withQueuedRequest({ descriptorPath: transport, traceId: "late-cancel", signal: abort.signal,
    job: { id: "late-cancel", groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 },
    execute: async () => { abort.abort(); return "must not recover from this reply"; },
  })).rejects.toBeDefined();
  expect(settlements).toEqual([{ id: "late-cancel", secret: "fixture", outcome: "cancelled", reason: undefined }]);
});

test.each([
  { state: "failed", reason: "queue_owner_lost", outcome: "failed", status: 502 },
  { state: "timed-out", reason: "queue_wait_timeout", outcome: "failed", status: 504 },
  { state: "cancelled", reason: "client_cancelled", outcome: "cancelled", status: 409 },
])("active $state receipt survives a browser's generic AbortError", async ({ state, reason, outcome, status }) => {
  const settlements: unknown[] = [];
  let released = false;
  const transport = { async request<T>(action: string, body: unknown): Promise<T> {
    if (action === "enqueue") return { record: { state: "preparing" }, secret: "fixture" } as T;
    if (action === "poll") return { record: { state, reason } } as T;
    if (action === "settle") { expect(released).toBe(true); settlements.push(body); }
    return {} as T;
  } };
  await expect(withQueuedRequest({ descriptorPath: transport, traceId: "poll-fixture",
    job: { id: "poll-fixture", groupId: "fixture", model: "gpt-6", mode: "native-tools", bytes: 1 },
    execute: async (_ticket, signal) => {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      released = true;
      throw new DOMException("Browser operation aborted", "AbortError");
    },
  })).rejects.toMatchObject({ code: reason, status, retryable: false });
  expect(settlements).toEqual([{ id: "poll-fixture", secret: "fixture", outcome, reason }]);
});

test("50 independent HTTP queue clients share four slots, and a cancelled waiter never executes", async () => {
  const root = await mkdtemp(join(tmpdir(), "w2h-http-queue-"));
  const logger = { info() {}, warn() {}, error() {} }, resources = new Set<string>();
  const queue = await new RequestQueue({ directory: root, logger, hasResource: (trace: string) => resources.has(trace),
    cancelResource: async () => {}, settings: { maxConcurrent: 4, queueTimeoutMinutes: 5, minSendIntervalSeconds: 1 } }).start();
  const server = await new BrowserControlServer({ logger, getBrowserHost: () => null, getRequestQueue: () => queue,
    getPreferences: () => ({}), assertLicensed: async () => {} }).start();
  const descriptorPath = join(root, "launcher.json");
  try {
    await writeFile(descriptorPath, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND,
      profile: "development", pid: process.pid, endpoint: server.descriptor().endpoint, control: server.descriptor(),
      helper: { executable: process.execPath, script: import.meta.path }, partition: "persist:web2harness-dev-chatgpt",
      idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: "launcher_surface_id_0123456789AB", createdAt: new Date().toISOString(),
      surfaceTargets: { launcher_surface_id_0123456789AB: "fixture-target" } }), { mode: 0o600 });
    let active = 0, peak = 0, completed = 0;
    const runs = Array.from({ length: 50 }, (_, index) => {
      const traceId = `trace_http_${index}`;
      return withQueuedRequest({ descriptorPath, traceId,
        job: { id: createHash("sha256").update(traceId).digest("hex"), groupId: `session_${index % 7}`,
          model: "gpt-6", mode: "native-tools", bytes: 128 },
        execute: async () => {
          queue.assertAdmission(traceId); resources.add(traceId); active++; peak = Math.max(peak, active);
          try { await delay(30); completed++; return index; }
          finally { active--; resources.delete(traceId); }
        },
      });
    });
    expect(await Promise.all(runs)).toHaveLength(50);
    expect(completed).toBe(50); expect(peak).toBe(4); expect(queue.snapshot().active).toBe(0);
    await queue.control("pause");
    const abort = new AbortController(); let executed = false;
    const waiting = withQueuedRequest({ descriptorPath, traceId: "trace_cancelled_waiter", signal: abort.signal,
      job: { id: createHash("sha256").update("cancelled").digest("hex"), groupId: "cancelled", model: "gpt-6", mode: "native-tools", bytes: 10 },
      execute: async () => { executed = true; },
    });
    const cancelTimer = setTimeout(() => abort.abort(), 30);
    try { await expect(waiting).rejects.toBeDefined(); }
    finally { clearTimeout(cancelTimer); }
    await queue.control("resume");
    expect(executed).toBe(false); expect(queue.snapshot().active).toBe(0);
    expect(queue.query({ state: "ended", limit: 100 }).total).toBe(51);
  } finally {
    await server.close(); await queue.close();
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("w2h-http-queue-")) throw new Error("Unexpected fixture path");
    await rm(root, { recursive: true });
  }
}, 30000);
