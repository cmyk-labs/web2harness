/** Observation budgets and evidence used to decide whether a browser turn may complete. */

import { chatGptExternalProgressIsLive, type ChatGptExternalTurnProgressSnapshot } from "../tools/turn-progress";

export const CHATGPT_RESPONSE_DOM_GRACE_MS = 120_000;

export const CHATGPT_EMPTY_RESPONSE_GRACE_MS = 10_000;

/** Starts only after normal generation completion; independent of the generation deadline. */
export const CHATGPT_RESPONSE_EXTRACTION_TIMEOUT_MS = 120_000;

/**
 * Detects that this process was suspended (system sleep) by watching for gaps in a steady tick.
 * On Apple Silicon the monotonic clock keeps advancing through sleep, so elapsed time alone cannot
 * distinguish "the stage really took 15 minutes" from "the machine slept for 14 of them" — and a
 * stage budget charged for slept time cancels turns that never got their budget awake.
 */
export class ChatGptSuspensionClock {
  private suspendedTotalMs = 0;
  private lastTickAt: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tickIntervalMs = 1_000,
    private readonly gapThresholdMs = 5_000,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.lastTickAt = this.now();
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = this.now();
    this.timer = setInterval(() => this.tick(this.now()), this.tickIntervalMs);
    this.timer.unref?.();
  }

  /** Exposed for tests; production ticks come from the interval above. */
  tick(now: number): void {
    const gap = now - this.lastTickAt;
    this.lastTickAt = now;
    if (gap >= this.gapThresholdMs) this.suspendedTotalMs += gap - this.tickIntervalMs;
  }

  suspendedMs(): number {
    // Adapted from miuuyy/codex-chatgpt-web 6f43747 (MIT). An expired stage timer
    // can run before the interval after resume; observe the gap on the same monotonic clock.
    this.tick(this.now());
    return this.suspendedTotalMs;
  }
}

export const chatGptSuspensionClock = new ChatGptSuspensionClock();

/**
 * How much of a stage budget remains once slept time is refunded. Zero means the stage really
 * consumed its budget while awake and the timeout stands.
 */
export function remainingStageBudgetMs(
  timeoutMs: number,
  elapsedMs: number,
  suspendedMs: number,
): number {
  const awakeMs = elapsedMs - suspendedMs;
  if (awakeMs >= timeoutMs) return 0;
  return Math.max(250, timeoutMs - awakeMs);
}

export const CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS = 5_000;

export const MAX_CHATGPT_BROWSER_PAGE_REBINDS = 2;

export class ChatGptBrowserObservationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`ChatGPT browser DOM observation did not respond within ${timeoutMs}ms`);
    this.name = "ChatGptBrowserObservationTimeoutError";
  }
}

export async function withChatGptBrowserObservationTimeout<T>(
  operation: Promise<T>,
  timeoutMs = CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ChatGptBrowserObservationTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ChatGptCompletionEvidence {
  responsePresent: boolean;
  running: boolean;
  normalCompletion: boolean;
  completionRevision: number;
  externalToolCallsInFlight?: boolean;
}

/** The caller binds this evidence to the current answer. Toolbar visibility and draft
 * stability are deliberately absent: both also occur on interrupted answers. */
export function chatGptTurnIsComplete(state: ChatGptCompletionEvidence): boolean {
  return state.responsePresent
    && !state.running
    && !state.externalToolCallsInFlight
    && state.normalCompletion
    && Number.isSafeInteger(state.completionRevision)
    && state.completionRevision > 0;
}

export type ChatGptSubmissionEvidence = "user_turn" | "assistant_turn" | "generation_running" | "mcp_tool_call" | "response_stream";

export function chatGptSubmissionEvidence(state: {
  initialTurnIdentities: readonly string[];
  userIdentities: readonly string[];
  responseIdentities: readonly string[];
  generationRunning: boolean;
}): ChatGptSubmissionEvidence | undefined {
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.userIdentities)) return "user_turn";
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.responseIdentities)) return "assistant_turn";
  if (state.generationRunning) return "generation_running";
  return undefined;
}

export function chatGptNewTurnIdentity(
  initial: readonly string[],
  current: readonly string[],
): string | undefined {
  const previous = new Set(initial);
  const added = current.filter(identity => !previous.has(identity));
  if (added.length > 1) {
    throw new Error(`ChatGPT exposed ${added.length} new conversation turns for one submitted message`);
  }
  return added[0];
}

export function chatGptReboundTurnIdentity(
  initial: readonly string[],
  boundIdentity: string,
  current: readonly string[],
): string | undefined {
  if (current.includes(boundIdentity)) return boundIdentity;
  return chatGptNewTurnIdentity(initial, current);
}

export class ChatGptCompletionTracker {
  private lastToolBatchRevision = 0;
  private completionAtLastToolBatch = 0;

  constructor(readonly announcementKey?: string) {}

  needsToolBatchObservation(revision: number): boolean {
    if (!Number.isSafeInteger(revision) || revision < this.lastToolBatchRevision) {
      throw new Error("ChatGPT completion received an invalid tool-batch revision");
    }
    return revision > this.lastToolBatchRevision;
  }

  observeToolBatch(revision: number, completionRevision: number): boolean {
    if (!this.needsToolBatchObservation(revision)) return false;
    if (!Number.isSafeInteger(completionRevision) || completionRevision < 0) {
      throw new Error("ChatGPT completion received an invalid completion revision");
    }
    // A completion observed before the tool is acknowledged cannot finish its later reply.
    // Text may be identical in the two replies; the completion event establishes the boundary.
    this.completionAtLastToolBatch = Math.max(this.completionAtLastToolBatch, completionRevision);
    this.lastToolBatchRevision = revision;
    return true;
  }

  update(state: ChatGptCompletionEvidence): boolean {
    return chatGptTurnIsComplete(state) && state.completionRevision > this.completionAtLastToolBatch;
  }
}

export class ChatGptTurnDomHealthTracker {
  private sawResponse = false;
  private missingResponseSince?: number;

  constructor(private readonly missingResponseMs = CHATGPT_RESPONSE_DOM_GRACE_MS) {}

  /**
   * Clears only the missing-response window, leaving `sawResponse` history intact.
   *
   * Callers use this when proven external progress suspends DOM health checks: the suspended
   * stretch must not be charged against the grace period, or the first observation after it
   * resumes would fail instantly against a timestamp recorded long before.
   */
  clearMissingResponse(): void {
    this.missingResponseSince = undefined;
  }

  update<T extends {
    responsePresent: boolean;
    running: boolean;
    externalProgressLive?: boolean;
    sourceAvailable?: boolean;
  }>(state: T, now = Date.now()): string | undefined {
    if (state.responsePresent) this.sawResponse = true;
    if (state.externalProgressLive || state.running || state.sourceAvailable) {
      // DOM availability is not a prerequisite of an independently observed source reply.
      this.missingResponseSince = undefined;
      return undefined;
    }
    if (state.responsePresent) {
      this.missingResponseSince = undefined;
    } else {
      this.missingResponseSince ??= now;
      if (now - this.missingResponseSince >= this.missingResponseMs) {
        return this.sawResponse
          ? "ChatGPT response DOM disappeared while the browser turn was active"
          : "ChatGPT did not create a response DOM after the message was sent";
      }
    }
    return undefined;
  }
}

/**
 * Consecutive internal observation faults tolerated before a turn is abandoned.
 *
 * An internal observation fault is not evidence that the upstream turn failed. The loop
 * re-observes within a consecutive budget; any successful observation resets that budget, and
 * exhausting it fails closed with the original fault as the cause.
 */
export const MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS = 8;

/**
 * How stale recorded MCP progress may be and still suppress DOM health checks.
 *
 * An outstanding tool call reports liveness regardless of age, so a call that never returns would
 * otherwise hold a turn open forever — turns carry no deadline unless a caller supplies one. This
 * bounds the silence since the last recorded activity rather than the turn's total duration, so a
 * long turn that keeps calling tools is never penalised for taking a long time.
 */
export const CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS = 15 * 60_000;

/** Tolerated clock difference between the recording daemon and the observing helper process. */
export const CHATGPT_EXTERNAL_PROGRESS_CLOCK_SKEW_MS = 5_000;

/** Proven MCP activity, additionally required to be recent enough to still be evidence. */
export function chatGptExternalProgressSuppressesDomHealth(
  snapshot: ChatGptExternalTurnProgressSnapshot | undefined,
  now: number,
): boolean {
  if (!chatGptExternalProgressIsLive(snapshot, now, CHATGPT_RESPONSE_DOM_GRACE_MS)) return false;
  const lastProgressAt = snapshot?.lastProgressAt;
  if (lastProgressAt === undefined) return false;
  const age = now - lastProgressAt;
  // A timestamp from the future would keep `age` below the ceiling forever. Recorded activity can
  // only precede the observation, so anything meaningfully ahead of now is not evidence at all.
  return age >= -CHATGPT_EXTERNAL_PROGRESS_CLOCK_SKEW_MS
    && age < CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS;
}
