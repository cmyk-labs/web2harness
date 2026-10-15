// Adapted from miuuyy/codex-chatgpt-web f137c2f (MIT; see LICENSES), issue #696.
import { createHash, randomUUID } from "node:crypto";
import { diagnosticEvent } from "../diagnostics";

type CatalogResult =
  | { ok: true; status: number; statusText: string; headers: Headers; body: ArrayBuffer }
  | { ok: false; error: unknown; sent: boolean };
interface Attempt {
  id: string; startedAt: number; abort: AbortController; waiters: number; sent: boolean;
  result: Promise<CatalogResult>; timer?: ReturnType<typeof setTimeout>;
}

/** Only idempotent catalog GETs survive a short-lived client. Never share credentials or queries. */
export class ModelCatalogFetches {
  private readonly attempts = new Map<string, Attempt>();
  private closed = false;

  constructor(private readonly abandonedTimeoutMs = 30_000, private readonly unclaimedResultMs = 10_000) {}

  async fetch(request: Request, forward: (request: Request, markSent: () => void) => Promise<Response>): Promise<CatalogResult> {
    if (request.signal.aborted || this.closed) return {
      ok: false, sent: false,
      error: request.signal.reason ?? new DOMException("Model catalog service closed", "AbortError"),
    };
    const key = createHash("sha256")
      .update(JSON.stringify([new URL(request.url).search, [...request.headers].sort()])).digest("hex");
    let attempt = this.attempts.get(key);
    if (!attempt) {
      const created: Attempt = { id: randomUUID(), startedAt: Date.now(), abort: new AbortController(),
        waiters: 0, sent: false, result: undefined as unknown as Promise<CatalogResult> };
      this.attempts.set(key, created);
      this.record(created, "started");
      created.result = (async (): Promise<CatalogResult> => {
        try {
          const response = await forward(new Request(request, { signal: created.abort.signal }), () => { created.sent = true; });
          return { ok: true, status: response.status, statusText: response.statusText,
            headers: response.headers, body: await response.arrayBuffer() };
        } catch (error) { return { ok: false, error, sent: created.sent }; }
      })().then(result => {
        clearTimeout(created.timer); created.timer = undefined;
        this.record(created, "finished", result.ok ? result.status : undefined);
        if (this.attempts.get(key) === created) {
          if (result.ok && result.status >= 200 && result.status < 300 && created.waiters === 0) {
            // A client can retry just after its abandoned connection finally completed.
            created.timer = setTimeout(() => {
              if (this.attempts.get(key) === created) this.attempts.delete(key);
            }, this.unclaimedResultMs);
            created.timer.unref?.();
          } else this.attempts.delete(key); // Failures and delivered responses are not cached.
        }
        return result;
      });
      attempt = created;
    } else this.record(attempt, "joined");
    const joined = attempt;
    joined.waiters++;
    clearTimeout(joined.timer); joined.timer = undefined;
    let leave!: () => void;
    const left = new Promise<CatalogResult>(resolve => {
      leave = () => resolve({ ok: false, sent: joined.sent,
        error: request.signal.reason ?? new DOMException("Model catalog client disconnected", "AbortError") });
    });
    if (request.signal.aborted) leave();
    else request.signal.addEventListener("abort", leave, { once: true });
    try {
      const result = await Promise.race([joined.result, left]);
      if (result.ok && this.attempts.get(key) === joined) {
        clearTimeout(joined.timer); this.attempts.delete(key);
      }
      return result;
    } finally {
      request.signal.removeEventListener("abort", leave);
      joined.waiters--;
      if (joined.waiters === 0 && this.attempts.get(key) === joined && !joined.timer) {
        joined.timer = setTimeout(() => {
          if (this.attempts.get(key) !== joined) return;
          this.attempts.delete(key);
          this.record(joined, "abandoned");
          joined.abort.abort(new DOMException("Model catalog request was abandoned", "AbortError"));
        }, this.abandonedTimeoutMs);
        joined.timer.unref?.();
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const attempt of this.attempts.values()) {
      clearTimeout(attempt.timer);
      this.record(attempt, "shutdown");
      attempt.abort.abort(new DOMException("Model catalog service closed", "AbortError"));
    }
    this.attempts.clear();
  }

  private record(attempt: Attempt, phase: string, status?: number): void {
    diagnosticEvent("info", "http.model_catalog_fetch", { operationId: attempt.id, phase,
      waiters: attempt.waiters, durationMs: Date.now() - attempt.startedAt, ...(status === undefined ? {} : { httpStatus: status }) });
  }
}
