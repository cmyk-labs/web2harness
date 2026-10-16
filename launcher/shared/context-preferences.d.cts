export interface ContextPreferenceSources {
  files: "default" | "user";
  budget: "default" | "user";
}
export function normalizeContextPreferences<T extends object>(config: T): T & {
  experimentalContextFiles: boolean;
  experimentalContextTripleBudget: boolean;
  contextPreferenceSources: ContextPreferenceSources;
};
