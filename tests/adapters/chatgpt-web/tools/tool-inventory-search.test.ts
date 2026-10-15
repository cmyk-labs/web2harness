import { expect, test } from "bun:test";
import type { CodexTool } from "../../../../src/types";
import { searchToolInventory } from "../../../../src/adapters/chatgpt-web/tools/tool-inventory-search";

const tool = (name: string, description: string, namespace?: string): CodexTool =>
  ({ name, description, namespace, parameters: {} });
const catalog = [
  tool("tool_search", "Search for exec_command apply_patch child agents wait"),
  tool("exec_command", "Run a local command"),
  tool("apply_patch", "Apply a local patch"),
  tool("wait_agent", "Wait for child agents", "multi_agent_v1"),
  tool("read_record", "Read a record", "records"),
];

test("combined operation lookup finds loaded tools before incidental discovery descriptions", () => {
  const result = searchToolInventory(catalog, "exec_command apply_patch child agents wait");
  expect(result.slice(0, 2).map(t => t.name)).toEqual(["exec_command", "apply_patch"]);
  expect(result).toHaveLength(4);
  expect(result).not.toContain(catalog[4]);
  expect(result[0]).toBe(catalog[1]); // Keep the complete original schema and authority.
});

test("empty lookup preserves order and keyword matching is normalized without mutating the registry", () => {
  for (const query of [undefined, "", "  , ; "]) expect(searchToolInventory(catalog, query)).toEqual(catalog);
  expect(searchToolInventory(catalog, "EXEC_COMMAND, apply_patch; exec_command").slice(0, 2))
    .toEqual([catalog[1], catalog[2]]);
  expect(searchToolInventory(catalog, "multi_agent_v1.wait_agent")).toEqual([catalog[3]]);
  expect(searchToolInventory(catalog, "not_loaded")).toEqual([]);
  expect(catalog.map(t => t.name)).toEqual(["tool_search", "exec_command", "apply_patch", "wait_agent", "read_record"]);
});
