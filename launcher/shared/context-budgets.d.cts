export interface ContextWindows { fast: number; standard: number }
export type ContextWindowSources = Record<keyof ContextWindows, "default" | "user">;
export function normalizeContextWindows(config?: { contextWindows?: unknown; contextWindowSources?: unknown }): {
  contextWindows: ContextWindows; contextWindowSources: ContextWindowSources;
};
export function rejectContextWindowEdits(edits: unknown): void;
