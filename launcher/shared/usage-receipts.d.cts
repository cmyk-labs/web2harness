export type UsageModel = "gpt-6-pro" | "gpt-5.6-pro" | "gpt-6-sol" | "gpt-5.6-sol" | "gpt-5.6-luna" | "pro-unknown" | "other";
export type UsageEffort = "low" | "medium" | "high" | "xhigh" | "max" | "unknown";
export type UsagePurpose = "task" | "tool-result" | "compaction" | "unknown";
export interface UsageReceipt { id: string; accountKey: string; model: UsageModel; at: number; plan?: "pro_100" | "pro_200" | "unsupported"; effort?: UsageEffort; purpose?: UsagePurpose; }
export interface UsageOutboxEntry { version: 1; id: string; state: "pending" | "accepted"; at: number; receipt?: UsageReceipt; trackingError?: "account-unavailable"; }
export class UsageOutbox { constructor(directory: string); write(entry: UsageOutboxEntry): void; read(id: string): UsageOutboxEntry; remove(id: string): void; entries(): { entries: UsageOutboxEntry[]; errors: number }; }
export function usageOutboxDirectory(descriptorPath: string): string;
export function validReceipt(value: unknown): value is UsageReceipt;
export function receiptFields(value: UsageReceipt): UsageReceipt;
