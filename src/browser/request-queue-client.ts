import { setTimeout as delay } from "node:timers/promises";
import type { QueueInput, QueueRecord } from "../../launcher/shared/request-scheduler.cjs";
import { readLauncherBrowserHostDescriptor } from "./launcher-client";
import { ChatGptWebAdapterError } from "../adapters/chatgpt-web/adapter-error";

export interface QueueTicket { id: string; secret: string }
/** Launcher transport or the in-process owner of a standalone browser profile. */
export interface RequestQueueTransport { request<T>(action: string, body: unknown): Promise<T> }
export type RequestQueueTarget = string | RequestQueueTransport;
export async function queueRequest<T>(descriptorPath: RequestQueueTarget, action: string, body: unknown): Promise<T> {
  if (typeof descriptorPath !== "string") return descriptorPath.request<T>(action, body);
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const response = await fetch(`${descriptor.control.endpoint}/v1/queue/${action}`, {
    method: "POST", headers: { authorization: `Bearer ${descriptor.control.token}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as { error?: string; code?: string };
  if (!response.ok) throw new ChatGptWebAdapterError(result.error ?? "Request queue unavailable", {
    status: 503, errorType: "server_error", code: result.code ?? "queue_unavailable", retryable: false,
  });
  return result as T;
}
function terminalError(record: QueueRecord): Error {
  return new ChatGptWebAdapterError(record.state === "timed-out" ? "Web request expired while waiting in the global queue"
    : "Web request was cancelled or has already finished", { status: record.state === "timed-out" ? 504 : 409,
    errorType: "server_error", code: record.reason ?? "queue_cancelled", retryable: false });
}
export async function withQueuedRequest<T>(options: {
  descriptorPath: RequestQueueTarget; job: QueueInput; traceId: string; signal?: AbortSignal;
  onQueued?: () => void; execute: (ticket: QueueTicket, signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  options.signal?.throwIfAborted();
  const admitted = await queueRequest<{ record: QueueRecord; secret: string }>(options.descriptorPath, "enqueue", {
    job: options.job, traceId: options.traceId, pid: process.pid,
  });
  const ticket = { id: options.job.id, secret: admitted.secret };
  const abort = new AbortController();
  const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pollPending = false, outcome: "succeeded" | "failed" | "cancelled" = "failed";
  let executionError: unknown;
  try {
    let record = admitted.record;
    if (record.state === "queued") options.onQueued?.();
    while (record.state === "queued") {
      await delay(500, undefined, { signal });
      record = (await queueRequest<{ record: QueueRecord }>(options.descriptorPath, "poll", ticket)).record;
    }
    signal.throwIfAborted();
    if (record.state !== "preparing") throw terminalError(record);
    timer = setInterval(() => {
      if (pollPending) return;
      pollPending = true;
      void queueRequest<{ record: QueueRecord }>(options.descriptorPath, "poll", ticket).then(({ record }) => {
        if (["stopping", "cancelled", "failed", "timed-out"].includes(record.state)) abort.abort(terminalError(record));
      }).catch(error => abort.abort(error)).finally(() => { pollPending = false; });
    }, 2000);
    const result = await options.execute(ticket, signal);
    outcome = "succeeded";
    return result;
  } catch (error) {
    executionError = error;
    if (signal.aborted) outcome = "cancelled";
    throw error;
  } finally {
    clearInterval(timer);
    // execute must settle only once its physical browser owner has released resources.
    const code = executionError && typeof executionError === "object" && "code" in executionError ? executionError.code : undefined;
    const reason = typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code) ? code : undefined;
    try { await queueRequest(options.descriptorPath, "settle", { ...ticket, outcome, reason }); }
    catch (cleanupError) {
      if (executionError) throw new AggregateError([executionError, cleanupError],
        `${executionError instanceof Error ? executionError.message : String(executionError)}; queue resource release was not acknowledged`);
      throw cleanupError;
    }
  }
}

export async function waitForSendPermit(descriptorPath: RequestQueueTarget, ticket: QueueTicket, signal?: AbortSignal): Promise<string> {
  for (;;) {
    signal?.throwIfAborted();
    const result = await queueRequest<{ allowed: boolean; permit?: string; reason?: string; retryAfterMs?: number }>(descriptorPath, "send-begin", ticket);
    if (result.allowed && result.permit) return result.permit;
    if (result.reason !== "send_interval" && result.reason !== "send_in_progress") throw new Error(`Web sending paused: ${result.reason}`);
    await delay(Math.min(1000, Math.max(100, result.retryAfterMs ?? 250)), undefined, { signal });
  }
}
