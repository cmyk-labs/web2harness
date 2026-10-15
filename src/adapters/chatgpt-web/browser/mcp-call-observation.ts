import { createHash } from "node:crypto";
import { CompletionFenceWait, type CompletionFenceState } from "../tools/completion-fence";

/** Positive, current-binding evidence only. Never executes or retains tool arguments. */
export class ChatGptMcpCallObservation {
  private active = false;
  private readonly calls = new Set<string>();
  private readonly results = new Set<string>();
  private readonly inspected = new Set<string>();
  private readonly invalid = new Set<string>();
  private foreignBindings = 0;
  private truncated = false;
  constructor(private readonly binding?: string) {}
  activate(): void { this.active = true; }
  observe(message: Record<string, any>): void {
    if (!this.active || !this.binding) return;
    const id = message.id;
    if (typeof id !== "string" || !id || id.length > 256) return;
    const parent = message.metadata?.parent_id;
    if (message.author?.role === "tool" && typeof parent === "string" && parent.length <= 256) {
      if (this.results.size < 128) this.results.add(parent);
      else this.truncated = true;
    }
    if (message.author?.role !== "assistant" || message.recipient !== "api_tool.call_tool"
      || message.metadata?.connector_tool_payload === undefined || this.inspected.has(id)) return;
    if (this.inspected.size + this.invalid.size >= 128 && !this.invalid.has(id)) { this.truncated = true; return; }
    const payload = message.metadata.connector_tool_payload;
    try {
      if (typeof payload !== "string" || payload.length > 512_000) throw new Error("Unsupported payload");
      const value = JSON.parse(payload);
      if (!value || typeof value.turn_token !== "string" || value.turn_token.length > 256) throw new Error("Missing binding");
      this.inspected.add(id); this.invalid.delete(id);
      // The reserved compaction control has its own acknowledgement/lifecycle,
      // not a handoff activity lease. Its receipt cannot be inferred from revision0.
      if (value.wire_name !== undefined) return;
      if (createHash("sha256").update(value.turn_token).digest("hex") === this.binding) this.calls.add(id);
      else this.foreignBindings += 1;
    } catch { this.invalid.add(id); }
  }
  snapshot() {
    return { active: this.active && !!this.binding, boundCalls: this.calls.size,
      matchedResults: [...this.calls].filter(id => this.results.has(id)).length,
      foreignBindings: this.foreignBindings, invalidPayloads: this.invalid.size, truncated: this.truncated };
  }
}

/** A late real MCP receipt may settle within the existing fence budget. A page
 * cannot turn an issued but unreceived current-binding call into a plain reply. */
export function observeMcpCompletion(fence: CompletionFenceState,
  observation: ReturnType<ChatGptMcpCallObservation["snapshot"]>, wait: CompletionFenceWait,
  now: number, graceMs: number): CompletionFenceState {
  const notReceived = fence.state === "ready" && fence.revision === 0 && observation.boundCalls > 0;
  const state: CompletionFenceState = notReceived
    ? { state: "awaiting_intent", activities: 0, invocations: 0, sealed: false } : fence;
  wait.observe(state, now, graceMs, notReceived);
  return state;
}
