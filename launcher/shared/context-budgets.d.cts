export interface ContextWindows { fast: number; standard: number }
export type ContextWindowSources = Record<keyof ContextWindows, "default" | "user">;
export type ContextWindowEdits = Partial<Record<keyof ContextWindows, number | "default">>;
export function validContextWindow(value: unknown): value is number;
export function normalizeContextWindows(config?: { contextWindows?: unknown; contextWindowSources?: unknown }): {
  contextWindows: ContextWindows; contextWindowSources: ContextWindowSources;
};
export function applyContextWindowEdits(config: { contextWindows?: unknown; contextWindowSources?: unknown }, edits: unknown): {
  contextWindows: ContextWindows; contextWindowSources: ContextWindowSources;
};
