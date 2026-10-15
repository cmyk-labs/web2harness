import { toolIdentityKey, type CodexParsedRequest, type CodexRequestOptions, type CodexTool } from "../../../types";
import type { BrokerToolRequest } from "./turn-broker";

/** Validate the entire batch before any call can be handed to Codex. */
export function validateToolCallBatch(parsed: CodexParsedRequest, requests: readonly BrokerToolRequest[]): void {
  validateDeclaredToolCallBatch(parsed.context.tools ?? [], parsed.options, requests);
}

export function validateDeclaredToolCallBatch(
  tools: readonly CodexTool[], options: Pick<CodexRequestOptions, "toolChoice" | "parallelToolCalls">,
  requests: readonly BrokerToolRequest[],
): void {
  const available = new Map(tools.map(tool => [toolIdentityKey(tool.namespace, tool.name), tool]));
  if (options.parallelToolCalls === false && requests.length > 1) {
    throw new Error("Codex disabled parallel_tool_calls; return one call at a time");
  }
  const choice = options.toolChoice;
  if (choice === "none" && requests.length) throw new Error("Codex tool_choice is none");
  const required = choice === "required" || (typeof choice === "object" && ("name" in choice || choice.mode === "required"));
  if (required && !requests.length) throw new Error("Codex tool_choice requires a tool call");
  for (const request of requests) {
    const tool = available.get(request.wireName);
    if (!tool || Boolean(tool.freeform) !== request.freeform) {
      throw new Error("Tool identity or kind is not available in the active Codex request");
    }
    if (typeof choice === "object") {
      const allowed = "name" in choice ? [choice.name] : choice.allowedTools;
      if (!allowed.includes(request.wireName)) throw new Error("Tool call is outside Codex tool_choice");
    }
  }
}
