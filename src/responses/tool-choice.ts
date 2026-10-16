import { toolIdentityKey, type CodexTool, type CodexToolChoice } from "../types";

type ModelToolReference =
  | { type: "function" | "custom"; name: string; namespace?: string }
  | { type: "tool_search" };

export type ModelToolChoice =
  | "auto" | "none" | "required"
  | ModelToolReference
  | { type: "allowed_tools"; mode: "auto" | "required"; tools: ModelToolReference[] };

export function toolChoiceKind(tool: CodexTool): ModelToolReference["type"] {
  return tool.toolSearch ? "tool_search" : tool.freeform ? "custom" : "function";
}

/** Convert the internal policy through the active catalog; routing keys are never wire names. */
export function modelToolChoice(choice: CodexToolChoice | undefined, tools: readonly CodexTool[]): ModelToolChoice {
  if (choice === undefined) return "auto";
  if (typeof choice === "string") return choice;
  const available = new Map(tools.map(tool => [toolIdentityKey(tool.namespace, tool.name), tool]));
  const reference = (key: string): ModelToolReference => {
    const tool = available.get(key);
    if (!tool) throw new Error("Codex tool_choice identity is not available in the active request");
    const type = toolChoiceKind(tool);
    return type === "tool_search" ? { type } : {
      type, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}),
    };
  };
  if ("name" in choice) return reference(choice.name);
  if (choice.mode === "required" && choice.allowedTools.length === 0) {
    throw new Error("Codex required allowed_tools must contain at least one tool");
  }
  return { type: "allowed_tools", mode: choice.mode, tools: choice.allowedTools.map(reference) };
}
