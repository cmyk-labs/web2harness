import { applyContextWindowEdits, type ContextWindowEdits } from "../launcher/shared/context-budgets.cjs";

export function contextWindowOptions(fast?: string, standard?: string): ContextWindowEdits | undefined {
  if (fast === undefined && standard === undefined) return undefined;
  const edits: ContextWindowEdits = {};
  for (const [key, value] of [["fast", fast], ["standard", standard]] as const) {
    if (value === undefined) continue;
    if (value !== "default" && !/^\d+$/.test(value)) throw new Error(`Invalid ${key} context window: ${value}`);
    edits[key] = value === "default" ? "default" : Number(value);
  }
  applyContextWindowEdits({}, edits);
  return edits;
}
