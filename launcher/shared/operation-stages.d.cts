export type OperationStage = "running" | "startup" | "connection" | "controls" | "inspection" | "cleanup" | "websocket-close" | "config" | "download" | "component-ready" | "verification" | "human-login" | "browser-startup" | "page-load";
export interface OperationStageEvent { type: "stage"; event: "begin" | "end"; id: number; parentId?: number; stage?: OperationStage }
export const OPERATION_STAGE_TIMEOUTS: Readonly<Record<Exclude<OperationStage, "running">, number> & { running: undefined }>;
export function createOperationStageWatchdog(onTimeout: (error: Error) => void, options?: { initialStage?: OperationStage; timeoutMs?: number }): {
  stop(): void;
  accept(message: OperationStageEvent): void;
};
