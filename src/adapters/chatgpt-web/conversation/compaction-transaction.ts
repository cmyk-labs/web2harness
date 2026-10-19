import { randomBytes } from "node:crypto";

export interface CompactionTransactionHandle {
  token: string;
  handoffId: string;
}

interface TransactionWaiter {
  resolve: (summary: string) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface CompactionTransaction extends CompactionTransactionHandle {
  traceId: string;
  summary?: string;
  waiter?: TransactionWaiter;
  signal: AbortSignal;
  onAbort: () => void;
}

function opaqueId(prefix: "control" | "handoff"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

/** One-shot capability store for the summary only; it never owns a Codex tool environment. */
export class CompactionTransactionStore {
  private readonly transactions = new Map<string, CompactionTransaction>();

  begin(traceId: string, signal: AbortSignal): CompactionTransactionHandle {
    if (!traceId.trim()) throw new Error("compaction transaction trace id is required");
    signal.throwIfAborted();
    // The owning stages control lifetime. A creation-time TTL would consume valid queue,
    // preparation, generation, or settlement time before the corresponding stage starts.
    const transaction: CompactionTransaction = {
      token: opaqueId("control"),
      handoffId: opaqueId("handoff"),
      traceId,
      signal,
      onAbort: () => this.finishError(transaction, signal.reason instanceof Error
        ? signal.reason : new DOMException("compaction transaction aborted", "AbortError")),
    };
    this.transactions.set(transaction.token, transaction);
    signal.addEventListener("abort", transaction.onAbort, { once: true });
    return { token: transaction.token, handoffId: transaction.handoffId };
  }

  submit(token: string, handoffId: string, summary: string): void {
    const transaction = this.transactions.get(token);
    if (!transaction) throw new Error("compaction control token is invalid, expired, or consumed");
    if (transaction.summary !== undefined) throw new Error("compaction handoff was already submitted");
    if (handoffId !== transaction.handoffId) {
      throw new Error("compaction handoff id does not match the pending transaction");
    }
    const normalized = summary.trim();
    if (!normalized) throw new Error("compaction handoff summary is empty");
    transaction.summary = normalized;
    console.info(`[chatgpt-web] broker trace=${transaction.traceId} accepted structured compaction handoff`);
    if (transaction.waiter) this.consume(transaction);
  }

  wait(token: string, signal?: AbortSignal): Promise<string> {
    const transaction = this.transactions.get(token);
    if (!transaction) return Promise.reject(new Error("compaction control token is invalid, expired, or consumed"));
    if (transaction.waiter) return Promise.reject(new Error("compaction transaction already has a waiter"));
    if (transaction.summary !== undefined) return Promise.resolve(this.consume(transaction));
    if (signal?.aborted) {
      const error = new DOMException("compaction transaction aborted", "AbortError");
      this.finishError(transaction, error);
      return Promise.reject(error);
    }
    return new Promise<string>((resolve, reject) => {
      const waiter: TransactionWaiter = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => this.finishError(
          transaction,
          new DOMException("compaction transaction aborted", "AbortError"),
        );
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      transaction.waiter = waiter;
    });
  }

  abort(token: string): void {
    const transaction = this.transactions.get(token);
    if (!transaction) return;
    if (transaction.summary !== undefined) {
      this.transactions.delete(token);
      transaction.signal.removeEventListener("abort", transaction.onAbort);
      this.detachWaiter(transaction);
      transaction.waiter = undefined;
      return;
    }
    this.finishError(transaction, new Error("compaction transaction aborted"));
  }

  abortTrace(traceId: string): void {
    for (const transaction of [...this.transactions.values()]) {
      if (transaction.traceId === traceId && transaction.summary === undefined) {
        this.finishError(transaction, new Error("compaction transaction was revoked"));
      }
    }
  }

  close(): void {
    for (const transaction of [...this.transactions.values()]) {
      this.finishError(transaction, new Error("compaction transaction broker closed"));
    }
  }

  private consume(transaction: CompactionTransaction): string {
    if (transaction.summary === undefined) throw new Error("compaction transaction is not ready");
    const summary = transaction.summary;
    const waiter = transaction.waiter;
    this.transactions.delete(transaction.token);
    transaction.signal.removeEventListener("abort", transaction.onAbort);
    this.detachWaiter(transaction);
    transaction.waiter = undefined;
    waiter?.resolve(summary);
    return summary;
  }

  private finishError(transaction: CompactionTransaction, error: Error): void {
    if (!this.transactions.delete(transaction.token)) return;
    transaction.signal.removeEventListener("abort", transaction.onAbort);
    const waiter = transaction.waiter;
    this.detachWaiter(transaction);
    transaction.waiter = undefined;
    waiter?.reject(error);
  }

  private detachWaiter(transaction: CompactionTransaction): void {
    const waiter = transaction.waiter;
    if (waiter?.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }
}
