import type { CodexTool } from "../../../types";

/** Inventory search is a union of requested keywords, not a single phrase.
 * Prefer tool identifiers to incidental words in descriptions; retain registry
 * order for equal scores so offset/limit pagination is deterministic. */
export function searchToolInventory(tools: readonly CodexTool[], query?: string): CodexTool[] {
  const terms = [...new Set(query?.trim().toLowerCase().split(/[\s,;]+/).filter(Boolean) ?? [])];
  if (!terms.length) return [...tools];
  return tools.map((tool, index) => {
    const name = tool.name.toLowerCase();
    const qualified = `${tool.namespace ?? ""}.${name}`.toLowerCase();
    const text = [name, tool.namespace ?? "", tool.description].join("\n").toLowerCase();
    return { tool, index,
      exact: terms.filter(term => term === name || term === qualified).length,
      matches: terms.filter(term => text.includes(term)).length };
  }).filter(hit => hit.exact > 0 || hit.matches > 0)
    .sort((a, b) => b.exact - a.exact || b.matches - a.matches || a.index - b.index)
    .map(hit => hit.tool);
}
