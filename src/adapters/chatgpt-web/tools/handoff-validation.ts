import type { CodexTool } from "../../../types";

/** Stable, non-sensitive categories for rejected, unexecuted handoff submissions. */
export const HANDOFF_REJECTION_CODES = [
  "parallel_calls_disabled", "tool_choice_disabled", "tool_choice_required", "tool_choice_mismatch",
  "tool_identity_mismatch", "tool_arguments_invalid", "tool_input_invalid", "batch_conflict",
  "round_sealed", "round_cancelled", "batch_too_large", "batch_invalid",
] as const;
export type HandoffRejectionCode = typeof HANDOFF_REJECTION_CODES[number];

export class HandoffValidationError extends Error {
  constructor(readonly code: HandoffRejectionCode, message: string) {
    super(message);
    this.name = "HandoffValidationError";
  }
}

export function isHandoffRejectionCode(value: unknown): value is HandoffRejectionCode {
  return typeof value === "string" && HANDOFF_REJECTION_CODES.some(code => code === value);
}

export function classifyHandoffRejection(error: Error): HandoffValidationError {
  if (error instanceof HandoffValidationError) return error;
  const message = error.message;
  const code: HandoffRejectionCode = message === "Codex disabled parallel_tool_calls; return one call at a time" ? "parallel_calls_disabled"
    : message === "Codex tool_choice is none" ? "tool_choice_disabled"
    : message === "Codex tool_choice requires a tool call" ? "tool_choice_required"
    : message === "Tool call is outside Codex tool_choice" ? "tool_choice_mismatch"
    : message.startsWith("Tool is not visible in this contract:") || message === "Tool identity is not available in the active Codex request"
      || message === "Tool identity or kind is not available in the active Codex request" ? "tool_identity_mismatch"
    : message === "Tool arguments do not match the declared schema" ? "tool_arguments_invalid"
    : message === "Freeform tool requires input only" || message === "Function tool requires arguments only"
      || message === "Native nested tool gateway is unavailable or invalid" || message === "Invalid nested catalog query" ? "tool_input_invalid"
    : message === "This Web round already has a different batch; do not submit another batch" ? "batch_conflict"
    : message === "Web round is already sealed" ? "round_sealed"
    : message === "Handoff round is cancelled" ? "round_cancelled"
    : message === "Handoff batch exceeds 8 MiB" ? "batch_too_large" : "batch_invalid";
  return new HandoffValidationError(code, message);
}

/** Compare untrusted calls with the active registry without logging supplied names or payloads.
 * Only matching declared identities may be named. Unknown names/namespaces remain booleans;
 * even an identifier-shaped credential submitted as a name must never enter diagnostics. */
export function handoffRejectionDiagnostics(tools: readonly CodexTool[], calls: readonly unknown[]): Record<string, unknown> {
  const inspected = calls.slice(0, 32);
  return {
    declaredToolCount: tools.length, omittedCallCount: calls.length - inspected.length,
    diagnosticCalls: inspected.map((value, callIndex) => {
      const call = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const scope = call.scope === undefined ? "top_level" : call.scope;
      const candidates = tools.filter(tool => call.name === tool.name
        || (tool.namespace !== undefined && call.name === `${tool.namespace}.${tool.name}`));
      return {
        callIndex, handoffScope: typeof scope === "string" && ["top_level", "exec", "catalog"].includes(scope) ? scope : "invalid",
        namespaceSupplied: call.namespace !== undefined, hasArguments: call.arguments !== undefined, hasInput: call.input !== undefined,
        exactIdentityMatch: tools.some(tool => tool.name === call.name && tool.namespace === call.namespace),
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 8).map(tool => {
          const identity = tool.namespace ? `${tool.namespace}.${tool.name}` : tool.name;
          return {
            ...(/^[A-Za-z_$][A-Za-z0-9_$.-]{0,159}$/.test(identity) ? { toolName: identity } : {}),
            nameMatched: call.name === tool.name, namespaceMatched: call.namespace === tool.namespace,
            qualifiedNameMatched: tool.namespace !== undefined && call.name === identity,
            namespaceRequired: tool.namespace !== undefined, freeform: tool.freeform === true,
          };
        }),
      };
    }),
  };
}
