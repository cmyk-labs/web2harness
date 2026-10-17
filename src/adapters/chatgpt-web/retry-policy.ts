import { ChatGptWebAdapterError } from "./adapter-error";

/** Maximum number of automatic browser-turn retries after the initial send. */
export const MAX_CHATGPT_WEB_TURN_RETRIES = 3;
const RETRY_BUDGET_TTL_MS = 30 * 60_000;

interface RetryBudgetEntry {
  retries: number;
  maxRetries: number;
  updatedAt: number;
  terminal?: boolean;
  lastError: {
    message: string;
    status: number;
    errorType: string;
    code: string;
    mcpRemote?: ChatGptWebAdapterError["mcpRemote"];
  };
}

function exhaustedError(entry: RetryBudgetEntry): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    entry.terminal ? entry.lastError.message
      : `${entry.lastError.message} ${entry.maxRetries === 0 ? "Automatic retries are disabled." : "The configured Web retry limit was reached."}`,
    {
      status: entry.lastError.status,
      errorType: entry.lastError.errorType,
      code: entry.lastError.code,
      mcpRemote: entry.lastError.mcpRemote,
      retryable: false,
    },
  );
}

/**
 * Tracks only retryable ChatGPT browser failures across adapter instances. The HTTP bridge creates
 * one adapter per request, so this process-local budget must live outside createChatGptWebAdapter.
 */
export class ChatGptWebTurnRetryPolicy {
  private readonly entries = new Map<string, RetryBudgetEntry>();

  constructor(private readonly ttlMs = RETRY_BUDGET_TTL_MS) {}

  recordRetryableFailure(key: string, error: ChatGptWebAdapterError, now = Date.now(), maxRetries = MAX_CHATGPT_WEB_TURN_RETRIES): ChatGptWebAdapterError {
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_CHATGPT_WEB_TURN_RETRIES) throw new Error("Invalid Web retry limit");
    this.prune(now);
    const previous = this.entries.get(key);
    const entry: RetryBudgetEntry = {
      retries: (previous?.retries ?? 0) + 1,
      maxRetries: error.mcpRemote ? Math.min(previous?.maxRetries ?? maxRetries, 2) : previous?.maxRetries ?? maxRetries,
      updatedAt: now,
      lastError: {
        message: error.message,
        status: error.status,
        errorType: error.errorType,
        code: error.code,
        mcpRemote: error.mcpRemote,
      },
    };
    this.entries.set(key, entry);
    return entry.retries > entry.maxRetries ? exhaustedError(entry) : error;
  }

  exhaustedError(key: string, now = Date.now()): ChatGptWebAdapterError | undefined {
    this.prune(now);
    const entry = this.entries.get(key);
    return entry && (entry.terminal || entry.retries > entry.maxRetries) ? exhaustedError(entry) : undefined;
  }

  /** A permanent remote failure remains terminal for this native turn, even when the client
   * adds partially delivered prose to its reconnect body and changes the browser-round hash. */
  recordTerminalFailure(key: string, error: ChatGptWebAdapterError, now = Date.now()): void {
    this.prune(now);
    const previous = this.entries.get(key);
    this.entries.set(key, { retries: previous?.retries ?? 0, maxRetries: previous?.maxRetries ?? 0,
      updatedAt: now, terminal: true, lastError: { message: error.message, status: error.status,
        errorType: error.errorType, code: error.code, mcpRemote: error.mcpRemote } });
  }

  /** Advances only after an explicitly retryable failure, never on a transport reconnect. */
  attempt(key: string, now = Date.now()): number {
    this.prune(now);
    return this.entries.get(key)?.retries ?? 0;
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.updatedAt >= this.ttlMs) this.entries.delete(key);
    }
  }
}

export const chatGptWebTurnRetryPolicy = new ChatGptWebTurnRetryPolicy();
