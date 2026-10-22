import { ChatGptWebAdapterError } from "../adapter-error";

export type CompletionFenceState =
  | { state: "ready"; revision: number; awaitingToolResults?: boolean }
  | { state: "already_committed"; revision: number; awaitingToolResults?: boolean }
  | { state: "awaiting_intent"; activities: number; invocations: number; sealed: boolean }
  | { state: "activity_in_flight"; activities: number; invocations: number; sealed: boolean };
export type CompletionFenceCommit =
  | { state: "committed"; revision: number; awaitingToolResults?: boolean }
  | { state: "revision_changed"; revision: number }
  | Extract<CompletionFenceState, { activities: number }>;

const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function isCompletionFenceState(value: unknown): value is CompletionFenceState {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.state === "ready" || item.state === "already_committed") return count(item.revision)
    && (item.awaitingToolResults === undefined || typeof item.awaitingToolResults === "boolean");
  return (item.state === "awaiting_intent" || item.state === "activity_in_flight")
    && count(item.activities) && count(item.invocations) && typeof item.sealed === "boolean";
}
export function isCompletionFenceCommit(value: unknown): value is CompletionFenceCommit {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.state === "committed" || item.state === "revision_changed"
    ? count(item.revision) && (item.awaitingToolResults === undefined || typeof item.awaitingToolResults === "boolean")
    : isCompletionFenceState(value) && (value.state === "awaiting_intent" || value.state === "activity_in_flight");
}

/** The browser has independently established completion; this class only bounds
 * settlement of the broker protocol. Activity takes precedence over absent intent.
 * One deadline survives changes of blocking reason so a flapping peer cannot extend it.
 */
export class CompletionFenceWait {
  private since: number | undefined;
  reset(): void { this.since = undefined; }
  observe(state: CompletionFenceState, now: number, graceMs: number, notReceived = false): void {
    if (state.state === "ready" || state.state === "already_committed") { this.reset(); return; }
    this.since ??= now;
    if (now - this.since < graceMs) return;
    const active = state.state === "activity_in_flight";
    throw new ChatGptWebAdapterError(active
      ? "ChatGPT ended the Web response while MCP activity was still unsettled. No pending batch was executed."
      : notReceived ? "ChatGPT issued a tool call for this Codex round, but no MCP request reached its local broker before completion. No tool batch was executed. The upstream cause is unconfirmed."
      : "ChatGPT ended the Web response without sealing its MCP handoff. No pending batch was executed.", {
      status: 502, errorType: "server_error", code: active ? "mcp_activity_unsettled" : notReceived ? "mcp_handoff_not_received" : "mcp_handoff_missing", retryable: false,
    });
  }
}
