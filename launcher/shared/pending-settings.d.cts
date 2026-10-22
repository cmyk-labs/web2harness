import type { RequestSchedulingSettings } from "./request-scheduler.cjs";
import type { RuntimeParameters, RuntimeParameterSources } from "./runtime-parameters.cjs";
export interface PendingSettings {
  experimentalContextFiles?: boolean;
  experimentalContextTripleBudget?: boolean;
  experimentalSkillAttachments?: boolean;
  experimentalFreshConversationPerTurn?: boolean;
  useSavedChats?: boolean;
  requestScheduling?: RequestSchedulingSettings;
  runtimeParameters?: RuntimeParameters;
  runtimeParameterSources?: RuntimeParameterSources;
}
export const PREFERENCE_KEYS: readonly (keyof PendingSettings)[];
export function validatePendingSettings(value: unknown): PendingSettings;
export function settingsForEditing<T extends { pendingSettings?: PendingSettings }>(state: T): T;
