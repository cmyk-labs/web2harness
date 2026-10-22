import { expect, test } from "bun:test";
import type { ChatGptTurnEnvironment } from "../../../../src/adapters/chatgpt-web/prompt/environment";
import { safeVisibleTools } from "../../../../src/adapters/chatgpt-web/tools/mcp-tool-policy";

test("manual visibility excludes app-prefixed bridge methods and their namespace without hiding unrelated tools", () => {
  const tools = [
    { name: "_codex_finish_turn", namespace: "mcp__codex_apps__codex_native2_dev" },
    { name: "_other_bridge_method", namespace: "mcp__codex_apps__codex_native2_dev" },
    { name: "codex_submit_tool_call", namespace: "ordinary_bridge" },
    { name: "exec", namespace: "functions" },
    { name: "_read_file", namespace: "other_app" },
    { name: "spawn_agent", namespace: "multi_agent_v1" },
  ].map(identity => ({ ...identity, description: "fixture", parameters: {} }));
  const environment = { tools } as ChatGptTurnEnvironment;
  expect(safeVisibleTools(environment, "safe")).toEqual(tools.slice(4));
  expect(safeVisibleTools(environment, "native")).toBe(tools);
});

test("manual visibility excludes v2 submission methods and their connector namespaces", () => {
  const tools = [
    { name: "_codex_submit_tool_call_v2", namespace: "v2_single" },
    { name: "another_method", namespace: "v2_single" },
    { name: "codex_submit_tool_batch_v2", namespace: "v2_batch" },
    { name: "another_method", namespace: "v2_batch" },
    { name: "_read_file", namespace: "unrelated" },
  ].map(identity => ({ ...identity, description: "fixture", parameters: {} }));
  expect(safeVisibleTools({ tools } as ChatGptTurnEnvironment, "safe")).toEqual(tools.slice(4));
});
