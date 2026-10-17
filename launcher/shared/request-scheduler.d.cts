import type { McpRemoteFailure } from "./mcp-remote-error.cjs";
export interface McpQueueStatus {
  scope: string;
  connectorName: string;
  lastFailure?: McpRemoteFailure;
  lastFailureAt?: number;
  lastVerifiedAt?: number;
  cooldownUntil?: number;
  retryAttempt?: number;
}
export interface McpQueueOutcome { failure?: McpRemoteFailure; verified?: boolean }
export interface RequestSchedulingSettings {
  maxConcurrent: number;
  queueTimeoutMinutes: number;
  minSendIntervalSeconds: number;
}
export const DEFAULT_REQUEST_SCHEDULING: Readonly<RequestSchedulingSettings>;
export const QUEUE_TIMEOUT_CHOICES: readonly number[];
export function validateRequestScheduling(value: unknown): RequestSchedulingSettings;
export type QueuePhase = "preparing" | "running" | "waiting-user" | "waiting-tools";
export type QueueState = QueuePhase | "queued" | "stopping" | "succeeded" | "failed" | "cancelled" | "timed-out";
export type QueuePauseReason = "user" | "account_rate_limited" | "browser_unavailable" | "send_outcome_unknown";
export interface QueueInput {
  id: string;
  groupId: string;
  model: string;
  mode: string;
  effort?: string;
  bytes: number;
  mcpScope?: string;
  connectorName?: string;
  retryAttempt?: number;
}
export interface QueueRecord extends Omit<QueueInput, "bytes"> {
  state: QueueState;
  cooldownUntil?: number;
  reason?: string;
  configRevision: number;
  queuedAt: number;
  deadlineAt: number;
  startedAt?: number;
  endedAt?: number;
  sendAttemptedAt?: number;
  sendConfirmedAt?: number;
  waitMs: number;
  runMs: number | null;
}
export interface QueueSnapshot {
  settings: RequestSchedulingSettings;
  configRevision: number;
  pausedReason: QueuePauseReason | null;
  pauseReasons: QueuePauseReason[];
  active: number;
  waiting: number;
  waitingBytes: number;
  closed: boolean;
  mcpStatus: McpQueueStatus[];
}
export interface QueueQuery {
  state?: "active" | "queued" | "running" | "ended" | "succeeded" | "failed" | "cancelled" | "timed-out";
  groupId?: string;
  search?: string;
  limit?: 25 | 50 | 100;
  offset?: number;
}
export interface QueuePage { items: QueueRecord[]; total: number; offset: number; limit: number; groups: string[] }
export class RequestScheduler {
  constructor(options?: {
    settings?: RequestSchedulingSettings;
    now?: () => number;
    random?: () => number;
    monotonicNow?: () => number;
    onEvent?: (event: string, fields: Partial<QueueRecord> & { configRevision: number; pausedReason: QueuePauseReason | null }) => void;
    maxWaiting?: number;
    maxWaitingBytes?: number;
    maxRecords?: number;
    receiptTtlMs?: number;
  });
  readonly pausedReason: QueuePauseReason | null;
  tick(): void;
  enqueue(input: QueueInput): QueueRecord;
  lease(id: string): string | undefined;
  setPhase(id: string, lease: string, phase: QueuePhase): QueueRecord;
  beginSend(id: string, lease: string): { allowed: true; permit: string } | { allowed: false; reason: string; retryAfterMs?: number };
  endSend(id: string, lease: string, permit: string, outcome: "confirmed" | "not-sent" | "unknown"): void;
  cancel(id: string): QueueRecord | null;
  settle(id: string, lease: string, outcome: "succeeded" | "failed" | "cancelled", reason?: string, remote?: McpQueueOutcome): QueueRecord;
  mcpStatus(): McpQueueStatus[];
  restoreMcpStatus(values?: McpQueueStatus[]): void;
  updateSettings(settings: RequestSchedulingSettings): { settings: RequestSchedulingSettings; configRevision: number };
  pause(reason?: QueuePauseReason): void;
  resume(expectedReason?: QueuePauseReason): void;
  close(): QueueRecord[];
  get(id: string): QueueRecord | null;
  snapshot(): QueueSnapshot;
  query(query?: QueueQuery): QueuePage;
}
