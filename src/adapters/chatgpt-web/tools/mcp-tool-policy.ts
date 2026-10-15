import type { CodexTool } from "../../../types";
import type { ChatGptTurnEnvironment } from "../prompt/environment";
import { CODEX_COMPACTION_CONTROL_WIRE_NAME } from "./native-compaction-control";

export const BRIDGE_TOOL_NAMES = new Set([
  "codex_turn_start", "codex_exec", "codex_write_stdin", "codex_apply_patch", "codex_view_image",
  "codex_tool_inventory", "codex_tool_call", "codex_turn_complete",
  "codex_submit_tool_call", "codex_submit_tool_batch", "codex_yield_turn", "codex_finish_turn",
]);

// App connectors may expose the same method with one leading underscore.
// Match only known bridge methods; arbitrary underscored tools remain available.
function isBridgeTool(name: string): boolean {
  return BRIDGE_TOOL_NAMES.has(name) || (name.startsWith("_") && BRIDGE_TOOL_NAMES.has(name.slice(1)));
}

/** Shared by both protocols; handoff must not expand the manual-mode tool boundary. */
export function safeVisibleTools(environment: ChatGptTurnEnvironment, contract: "native" | "safe"): CodexTool[] {
  if (contract === "native") return environment.tools;
  const bridgeNamespaces = new Set(environment.tools
    .filter(tool => tool.namespace && isBridgeTool(tool.name)).map(tool => tool.namespace!));
  return environment.tools.filter(tool => (
    tool.name !== CODEX_COMPACTION_CONTROL_WIRE_NAME && !isBridgeTool(tool.name)
    && ((tool.namespace !== undefined && tool.namespace !== "functions") || tool.name !== "exec")
    && (!tool.namespace || !bridgeNamespaces.has(tool.namespace))
  ));
}
