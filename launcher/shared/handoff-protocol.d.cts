export const HANDOFF_V1: "web2harness-handoff-v1";
export const HANDOFF_V2: "web2harness-handoff-v2";
export type HandoffProtocol = typeof HANDOFF_V1 | typeof HANDOFF_V2;
export function handoffProtocol(value?: unknown): HandoffProtocol;
export function handoffSubmissionTools(protocol?: HandoffProtocol): { single: string; batch: string };
