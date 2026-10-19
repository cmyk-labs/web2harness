import { AsyncLocalStorage } from "node:async_hooks";
import { writeSync } from "node:fs";
import type { OperationStage, OperationStageEvent } from "../../launcher/shared/operation-stages.cjs";

const stageOwner = new AsyncLocalStorage<number>();
let nextId = 0;
let pipeLost = false;
const activeStages = new Map<number, OperationStageEvent>();
const observers = new Set<(event: OperationStageEvent) => void>();

export function subscribeOperationStages(observer: (event: OperationStageEvent) => void): () => void {
  for (const event of activeStages.values()) observer(event);
  observers.add(observer);
  return () => { observers.delete(observer); };
}

function report(message: OperationStageEvent): void {
  if (message.event === "begin") activeStages.set(message.id, message);
  else activeStages.delete(message.id);
  for (const observer of observers) {
    try { observer(message); }
    catch { observers.delete(observer); }
  }
  // A launcher-created pipe reports ownership independently of human-facing logs.
  if (process.env.WEB2HARNESS_STAGE_PIPE === "1" && !pipeLost) {
    try { writeSync(3, `${JSON.stringify(message)}\n`); }
    catch (error) {
      if (!["EPIPE", "EBADF", "ECONNRESET", "EOF"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      // A stale daemon may outlive its original launcher pipe. Its authenticated
      // shutdown observer still receives stages; losing telemetry must not skip cleanup.
      pipeLost = true;
    }
  }
}

export async function operationStage<T>(stage: OperationStage, action: () => Promise<T> | T): Promise<T> {
  const id = ++nextId;
  report({ type: "stage", event: "begin", id, parentId: stageOwner.getStore(), stage });
  try { return await stageOwner.run(id, action); }
  finally { report({ type: "stage", event: "end", id }); }
}

export function operationStageSync<T>(stage: OperationStage, action: () => T): T {
  const id = ++nextId;
  report({ type: "stage", event: "begin", id, parentId: stageOwner.getStore(), stage });
  try { return stageOwner.run(id, action); }
  finally { report({ type: "stage", event: "end", id }); }
}

// Relay a remote leaf boundary under the currently active CLI owner. The remote
// watchdog owns nested stages; this pipe only carries the current leaf budget.
export function operationStageRelay(): (stage: OperationStage | null) => void {
  let id: number | undefined;
  const parentId = stageOwner.getStore();
  return stage => {
    if (id !== undefined) report({ type: "stage", event: "end", id });
    id = stage === null ? undefined : ++nextId;
    if (stage !== null) report({ type: "stage", event: "begin", id: id!, parentId, stage });
  };
}
