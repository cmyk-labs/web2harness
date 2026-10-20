import { ChatGptBrowserObservationTimeoutError } from "./turn-observation";

type PendingRead<T> = { startedAt: number; outcome?: { value: T } | { error: unknown } };

/** One outstanding read of an owned page. Polling the result does not start another read,
 * so a slow renderer cannot block source events, cancellation or the generation deadline. */
export class ChatGptPendingObservation<T> {
  private pending?: PendingRead<T>;

  constructor(private readonly timeoutMs = 120_000) {}

  poll(read: () => Promise<T>, now = Date.now()): { state: "pending" } | { state: "ready"; value: T } {
    if (!this.pending) {
      const pending: PendingRead<T> = { startedAt: now };
      this.pending = pending;
      // Install rejection handling immediately, including synchronous observer faults.
      void Promise.resolve().then(read).then(
        value => { pending.outcome = { value }; },
        error => { pending.outcome = { error }; },
      );
    }
    const pending = this.pending;
    if (pending.outcome) {
      this.pending = undefined;
      if ("error" in pending.outcome) throw pending.outcome.error;
      return { state: "ready", value: pending.outcome.value };
    }
    if (now - pending.startedAt >= this.timeoutMs) {
      // Keep the outstanding read until the caller retires/rebinds its owned transport.
      // A timeout is not permission to submit overlapping evaluations to the same page.
      throw new ChatGptBrowserObservationTimeoutError(this.timeoutMs);
    }
    return { state: "pending" };
  }
}
