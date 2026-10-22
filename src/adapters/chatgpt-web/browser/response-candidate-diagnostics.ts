/** Structural diagnostics only. This module neither reads bodies nor authorizes an answer.
 * Values crossing the diagnostic boundary are fixed enums, booleans, counts and local ordinals;
 * unknown roles/channels/recipients are never echoed (they may contain private data).
 */
export interface ResponseCandidateStructure {
  id: string;
  role: unknown;
  channel: unknown;
  recipient: unknown;
  status: unknown;
  endTurn: unknown;
  contentType: unknown;
  hidden: boolean;
  parent?: string;
  complete?: boolean;
  finishType?: string;
}

const enumValue = <T extends string>(value: unknown, allowed: readonly T[]): T | "missing" | "null" | "other" =>
  value === undefined ? "missing" : value === null ? "null"
    : allowed.includes(value as T) ? value as T : "other";
const booleanState = (value: unknown) => value === undefined ? "missing" : value === null ? "null"
  : value === true ? "true" : value === false ? "false" : "other";
const reasons = ["role_not_assistant", "channel_not_final", "recipient_not_all", "hidden",
  "content_not_text", "end_turn_not_true", "status_not_finished", "completion_incomplete",
  "finish_not_stop", "input_unbound"] as const;
type Rejection = typeof reasons[number];

/** Uses the merged structure, not the evidence projection. The caller retains its existing
 * identity, framing, ambiguity, content and completion checks. Even zero rejection reasons
 * here do not prove an answer is deliverable. Bounded details never truncate aggregate counts.
 * Enum wrappers use existing diagnostic type/status keys so safeDetail preserves them.
 */
export function responseCandidateDiagnostics(messages: readonly ResponseCandidateStructure[], userMessageId: string) {
  const byId = new Map(messages.map(message => [message.id, message]));
  const rejectionCounts = Object.fromEntries(reasons.map(reason => [reason, 0])) as Record<Rejection, number>;
  let assistantCount = 0, publicTextCount = 0, structuralFinalCount = 0;
  function inputRelation(message: ResponseCandidateStructure) {
    const seen = new Set<string>();
    let current: ResponseCandidateStructure | undefined = message;
    while (current) {
      if (current.id === userMessageId) return current.role === "user"
        ? message === current ? "current_input" : "descendant" : "unbound";
      if (seen.has(current.id)) return "cycle";
      if (current.role === "user") return "other_input";
      seen.add(current.id);
      current = current.parent === undefined ? undefined : byId.get(current.parent);
    }
    return "unbound";
  }
  const candidates: Array<ReturnType<typeof inspect>> = [];
  function inspect(message: ResponseCandidateStructure, ordinal: number) {
    const relation = inputRelation(message);
    const rejected: Partial<Record<Rejection, true>> = {};
    const reject = (reason: Rejection) => { rejected[reason] = true; rejectionCounts[reason]++; };
    if (message.role !== "assistant") reject("role_not_assistant");
    else assistantCount++;
    if (message.channel !== "final") reject("channel_not_final");
    if (message.recipient !== "all") reject("recipient_not_all");
    if (message.hidden) reject("hidden");
    if (message.contentType !== "text") reject("content_not_text");
    if (message.endTurn !== true) reject("end_turn_not_true");
    if (message.status !== "finished_successfully") reject("status_not_finished");
    if (message.complete === false) reject("completion_incomplete");
    if (message.finishType !== undefined && message.finishType !== "stop") reject("finish_not_stop");
    if (relation !== "descendant" && relation !== "current_input") reject("input_unbound");
    if (message.role === "assistant" && (message.channel === "final" || message.channel === "commentary")
      && message.recipient === "all" && !message.hidden && message.contentType === "text") publicTextCount++;
    if (Object.keys(rejected).length === 0) structuralFinalCount++;
    return { ordinal, role: enumValue(message.role, ["user", "assistant", "system", "tool", "developer"]),
      channel: enumValue(message.channel, ["final", "commentary", "analysis"]),
      recipient: { type: enumValue(message.recipient, ["all"]) },
      contentType: { type: enumValue(message.contentType, ["text", "code", "thoughts", "reasoning_recap",
        "model_editable_context", "execution_output", "multimodal_text", "tether_browsing_display"]) },
      status: enumValue(message.status, ["in_progress", "finished_successfully", "finished_partial"]),
      endTurn: { status: booleanState(message.endTurn) }, hidden: message.hidden,
      completion: { status: message.complete === undefined ? "missing" : message.complete ? "complete" : "incomplete" },
      finish: { type: enumValue(message.finishType, ["stop", "length", "max_tokens", "interrupted"]) },
      inputBinding: { status: relation }, rejected };
  }
  messages.forEach((message, index) => {
    const candidate = inspect(message, index);
    if (index < 32) candidates.push(candidate);
  });
  return { version: 1, messageCount: messages.length, assistantCount, publicTextCount, structuralFinalCount,
    rejectionCounts, candidates, omittedCandidates: Math.max(0, messages.length - candidates.length) };
}
