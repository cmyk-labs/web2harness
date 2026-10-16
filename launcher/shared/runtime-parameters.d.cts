export interface RuntimeParameters {
  retainedTabTarget: number;
  idleTabMinutes: number;
  stallMinutes: number;
  attachmentMinutes: number;
  maxRetries: number;
  manualSubmitSeconds: number;
  manualCompactionSubmitSeconds: number;
}
export type RuntimeParameterSources = Record<keyof RuntimeParameters, "default" | "user">;
export type RuntimeParameterEdits = Partial<RuntimeParameterSources>;
export const DEFAULT_RUNTIME_PARAMETERS: Readonly<RuntimeParameters>;
export const RUNTIME_PARAMETER_CHOICES: Readonly<Record<keyof RuntimeParameters, readonly number[]>>;
export function validateRuntimeParameters(value: unknown): RuntimeParameters;
export function normalizeRuntimeParameters(values?: unknown, sources?: unknown): {
  runtimeParameters: RuntimeParameters; runtimeParameterSources: RuntimeParameterSources;
};
export function runtimeParameterSourcesForSave(currentValues: unknown, currentSources: unknown, values: RuntimeParameters, edits?: unknown): RuntimeParameterSources;
