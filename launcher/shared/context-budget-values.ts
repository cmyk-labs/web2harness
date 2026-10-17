import options from "./context-budget-options.json";

/** Shared by the renderer preview and the native Codex model contract. */
export function contextBudgetValues(window: number, triple = false) {
  if (!Number.isSafeInteger(window) || window < options.minimumWindow || window > options.maximumWindow) {
    throw new Error(`Invalid context window: ${window}`);
  }
  const multiplier = triple ? options.tripleMultiplier : 1;
  return {
    contextWindow: window * multiplier,
    effectiveContextWindowPercent: options.effectivePercent,
    usableWindow: Math.floor(window * multiplier * options.effectivePercent / 100),
    autoCompactTokenLimit: Math.floor(window * multiplier * options.compactPercent / 100),
  };
}
