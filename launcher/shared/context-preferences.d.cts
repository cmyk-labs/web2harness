export interface ContextPreferenceSources {
  files: "default" | "user";
  budget: "default" | "user";
}
export function normalizeContextPreferences<T extends object>(config: T): T & {
  contextWindows: import("./context-budgets.cjs").ContextWindows;
  contextWindowSources: import("./context-budgets.cjs").ContextWindowSources;
  experimentalContextFiles: boolean;
  experimentalContextTripleBudget: boolean;
  contextPreferenceSources: ContextPreferenceSources;
};
