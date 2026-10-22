import { setTimeout as delay } from "node:timers/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import type { QueueInput, QueueRecord, NativeDeliveryState } from "../../launcher/shared/request-scheduler.cjs";
import { readLauncherBrowserHostDescriptor } from "./launcher-client";
import { ChatGptWebAdapterError } from "../adapters/chatgpt-web/adapter-error";
import { validMcpRemoteFailure } from "../../launcher/shared/mcp-remote-error.cjs";
import { diagnosticContext, diagnosticError, diagnosticEvent } from "../diagnostics";
import { abortWithDiagnostic, readInterruption } from "../interruption-diagnostics";

export interface QueueTicket { id: string; secret: string }
/** Launcher transport or the in-process owner of a standalone browser profile. */
export interface RequestQueueTransport { request<T>(action: string, body: unknown): Promise<T> }
export type RequestQueueTarget = string | RequestQueueTransport;

const deliveryScope = new AsyncLocalStorage<NativeQueueDelivery>();
/** Capture the actual queue admission (including context resync), never infer its owner by ID.
 * Credentials stay in this runtime object and are never serialized into events or receipts. */
export class NativeQueueDelivery {
  private binding?: { target: RequestQueueTarget; ticket: QueueTicket; attemptId: string };
  private sequence = 0;
  run<T>(execute: () => T): T { return deliveryScope.run(this, execute); }
  bind(target: RequestQueueTarget, ticket: QueueTicket, attemptId: string): void {
    this.binding = { target, ticket, attemptId };
    this.sequence = 0;
  }
  context(): { queueId?: string; attemptId?: string } {
    return this.binding ? { queueId: this.binding.ticket.id, attemptId: this.binding.attemptId } : {};
  }
  async report(deliveryState: NativeDeliveryState): Promise<void> {
    if (!this.binding) return;
    const { target, ticket, attemptId } = this.binding;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      await Promise.race([
        queueRequest(target, "native-delivery", { ...ticket, delivery: { deliveryState, sequence: ++this.sequence } }),
        // Includes an in-process host blocked on persistence, not just HTTP fetch timeouts.
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
          timedOut = true; reject(new Error("Delivery metadata timeout"));
        }, 2000); }),
      ]);
    } catch {
      // A metadata outage must neither resend the web generation nor invalidate the committed reply.
      diagnosticEvent("warning", "browser.native_delivery_update_failed", {
        queueId: ticket.id, attemptId, deliveryState, category: "queue_metadata_unavailable", outcome: timedOut ? "timeout" : "failed",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
export async function queueRequest<T>(descriptorPath: RequestQueueTarget, action: string, body: unknown): Promise<T> {
  if (typeof descriptorPath !== "string") return descriptorPath.request<T>(action, body);
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const endpoint = `${descriptor.control.endpoint}/v1/queue/${action}`;
  const options = {
    method: "POST", headers: { authorization: `Bearer ${descriptor.control.token}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  };
  let response: Response;
  try { response = await fetch(endpoint, options); }
  catch (error) {
    const code = error instanceof Error
      ? (error as NodeJS.ErrnoException).code ?? (error.cause as NodeJS.ErrnoException | undefined)?.code : undefined;
    // Poll only refreshes the same owner's status/heartbeat. A dropped loopback socket
    // must not immediately cancel its browser work; mutating operations are never replayed.
    // Keep the captured endpoint, ticket bytes and original deadline across this one retry.
    if (action !== "poll" || code !== "ECONNRESET" || options.signal.aborted) throw error;
    diagnosticEvent("warning", "browser.queue_poll_transport_retry", { error: diagnosticError(error) });
    await delay(100, undefined, { signal: options.signal });
    response = await fetch(endpoint, options);
  }
  const result = await response.json() as { error?: string; code?: string };
  if (!response.ok) throw new ChatGptWebAdapterError(result.error ?? "Request queue unavailable", {
    status: 503, errorType: "server_error", code: result.code ?? "queue_unavailable", retryable: false,
  });
  return result as T;
}
function terminalError(record: QueueRecord): Error {
  if (record.state === "failed" && record.reason?.startsWith("queue_blocked_")) {
    const reason = record.blockedBy?.reason ?? record.reason.slice("queue_blocked_".length);
    return new ChatGptWebAdapterError(
      `Web dispatch is suspended: ${reason}${record.blockedBy?.requestId ? ` (blocking request ${record.blockedBy.requestId})` : ""}. `
      + "Reconcile the blocking request and confirm recovery in the task queue before starting new work; this request was not sent.",
      { status: 503, errorType: "server_error", code: record.reason, retryable: false },
    );
  }
  // Receipts retain state/reason, not the original exception's status or cause.
  if (record.state === "failed") return new ChatGptWebAdapterError(
    `Web request failed${record.reason ? `: ${record.reason}` : ""}`, {
      status: 502, errorType: "server_error", code: record.reason ?? "queue_failed", retryable: false,
    });
  return new ChatGptWebAdapterError(record.state === "timed-out" ? "Web request expired while waiting in the global queue"
    : "Web request was cancelled or has already finished", { status: record.state === "timed-out" ? 504 : 409,
    errorType: "server_error", code: record.reason ?? "queue_cancelled", retryable: false });
}
export async function withQueuedRequest<T>(options: {
  descriptorPath: RequestQueueTarget; job: QueueInput; traceId: string; signal?: AbortSignal;
  onQueued?: () => void; execute: (ticket: QueueTicket, signal: AbortSignal) => Promise<T>;
  remoteVerified?: () => Promise<boolean>;
}): Promise<T> {
  options.signal?.throwIfAborted();
  const admitted = await queueRequest<{ record: QueueRecord; secret: string }>(options.descriptorPath, "enqueue", {
    job: options.job, traceId: options.traceId, pid: process.pid,
  });
  const ticket = { id: options.job.id, secret: admitted.secret };
  const context = { ...diagnosticContext.getStore(), traceId: options.traceId, queueId: ticket.id, attemptId: crypto.randomUUID() };
  if (options.job.mode === "native-tools") deliveryScope.getStore()?.bind(options.descriptorPath, ticket, context.attemptId);
  return diagnosticContext.run(context, async () => {
  diagnosticEvent("info", "browser.queue_attempt_admitted", { state: admitted.record.state });
  const abort = new AbortController();
  const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pollPending = false, outcome: "succeeded" | "failed" | "cancelled" = "failed";
  let executionError: unknown;
  let verified = false;
  let queueInterruption: { error: unknown; outcome: "failed" | "cancelled" } | undefined;
  const interruptFromQueue = (error: unknown, outcome: "failed" | "cancelled") => {
    if (abort.signal.aborted) return;
    queueInterruption = { error, outcome };
    abortWithDiagnostic(abort, "queue_interrupt", error, { ...context, outcome });
  };
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
        if (["stopping", "cancelled", "failed", "timed-out"].includes(record.state)) {
          interruptFromQueue(terminalError(record), ["stopping", "cancelled"].includes(record.state) ? "cancelled" : "failed");
        }
      }).catch(error => interruptFromQueue(error, "failed")).finally(() => { pollPending = false; });
    }, 2000);
    const result = await options.execute(ticket, signal);
    verified = await options.remoteVerified?.().catch(() => false) ?? false;
    signal.throwIfAborted();
    outcome = "succeeded";
    return result;
  } catch (error) {
    // Browser APIs often replace AbortSignal.reason with a generic AbortError. Restore only
    // our own queue interruption; a caller cancellation or an independent execution error wins.
    const queueAbort = queueInterruption && signal.aborted && signal.reason === abort.signal.reason
      && (error === signal.reason || error instanceof Error && error.name === "AbortError");
    executionError = queueAbort ? queueInterruption!.error : error;
    if (queueAbort) outcome = queueInterruption!.outcome;
    else if (signal.aborted) outcome = "cancelled";
    diagnosticEvent(outcome === "cancelled" ? "info" : "warning", "browser.queue_execution_interrupted", {
      ...context, outcome, interruption: readInterruption(signal.reason),
      cancelSource: signal.aborted ? signal.reason === abort.signal.reason && abort.signal.aborted ? "queue" : "caller" : "none",
      callerAborted: options.signal?.aborted === true, queueAborted: abort.signal.aborted,
      signalAborted: signal.aborted, restoredQueueError: !!queueAbort,
      error: diagnosticError(executionError),
      ...(signal.aborted ? { cause: diagnosticError(signal.reason) } : {}),
    });
    throw executionError;
  } finally {
    clearInterval(timer);
    // execute must settle only once its physical browser owner has released resources.
    const code = executionError && typeof executionError === "object" && "code" in executionError ? executionError.code : undefined;
    const reason = typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code) ? code : undefined;
    const failure = executionError instanceof ChatGptWebAdapterError && validMcpRemoteFailure(executionError.mcpRemote) ? executionError.mcpRemote : undefined;
    try { await queueRequest(options.descriptorPath, "settle", { ...ticket, outcome, reason,
      ...(failure || verified ? { remote: { failure, verified } } : {}) }); }
    catch (cleanupError) {
      if (executionError) throw new AggregateError([executionError, cleanupError],
        `${executionError instanceof Error ? executionError.message : String(executionError)}; queue resource release was not acknowledged`);
      throw cleanupError;
    }
  }
  });
}

export async function waitForSendPermit(descriptorPath: RequestQueueTarget, ticket: QueueTicket, signal?: AbortSignal): Promise<string> {
  for (;;) {
    signal?.throwIfAborted();
    const result = await queueRequest<{ allowed: boolean; permit?: string; reason?: string; retryAfterMs?: number }>(descriptorPath, "send-begin", ticket);
    if (result.allowed && result.permit) return result.permit;
    if (result.reason !== "send_interval" && result.reason !== "send_in_progress" && result.reason !== "mcp_cooldown") {
      throw new ChatGptWebAdapterError(`Web sending paused: ${result.reason ?? "queue_send_paused"}`, {
        status: 503, errorType: "server_error", code: result.reason ?? "queue_send_paused", retryable: false,
      });
    }
    await delay(Math.min(1000, Math.max(100, result.retryAfterMs ?? 250)), undefined, { signal });
  }
}
