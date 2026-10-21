import { diagnosticContext, diagnosticEvent } from "./diagnostics";

// Observations, not assertions about a remote/network root cause. Side-channel only:
// never replace an exception, AbortSignal.reason, or cancellation outcome.
const origins = new Set(["http_client_abort", "http_turn_cancel", "http_shutdown", "websocket_close",
  "websocket_transport", "queue_interrupt", "helper_local_abort", "helper_protocol", "helper_shutdown_requested",
  "helper_input_closed", "helper_sigint", "helper_sigterm", "helper_output_failure", "helper_exit", "helper_input_failure",
  "adapter_cancel", "compaction_stage_abort", "native_binding_retired", "native_retirement_failed", "adapter_signal_forwarded"]);
export interface InterruptionEvidence { eventId: string; firstEventId: string; origin: string; at: string; parentEventId?: string }
const observations = new WeakMap<object, InterruptionEvidence>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function readInterruption(value: unknown): InterruptionEvidence | undefined {
  return value !== null && typeof value === "object" ? observations.get(value) : undefined;
}
export function parseInterruption(value: unknown): InterruptionEvidence | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Partial<InterruptionEvidence>;
  if (typeof v.eventId !== "string" || !uuid.test(v.eventId) || typeof v.firstEventId !== "string" || !uuid.test(v.firstEventId)
    || typeof v.origin !== "string" || !origins.has(v.origin) || typeof v.at !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v.at)
    || !Number.isFinite(Date.parse(v.at)) || v.parentEventId !== undefined && (typeof v.parentEventId !== "string" || !uuid.test(v.parentEventId))) return;
  return { eventId: v.eventId, firstEventId: v.firstEventId, origin: v.origin, at: v.at,
    ...(v.parentEventId ? { parentEventId: v.parentEventId } : {}) };
}
export function attachInterruption(target: unknown, evidence: InterruptionEvidence | undefined): void {
  if (target !== null && typeof target === "object" && evidence && !observations.has(target)) observations.set(target, evidence);
}
export function observeInterruption(target: object, origin: string, detail: Record<string, unknown> = {}, parent?: InterruptionEvidence): InterruptionEvidence {
  const previous = observations.get(target);
  if (previous) return previous;
  const eventId = crypto.randomUUID();
  const evidence: InterruptionEvidence = { eventId, firstEventId: parent?.firstEventId ?? eventId,
    origin: origins.has(origin) ? origin : "helper_protocol", at: new Date().toISOString(), ...(parent ? { parentEventId: parent.eventId } : {}) };
  observations.set(target, evidence);
  diagnosticEvent("info", "runtime.interruption_observed", { ...detail, interruption: evidence }, eventId);
  return evidence;
}
export function abortWithDiagnostic(controller: AbortController, origin: string, reason?: unknown,
  detail: Record<string, unknown> = {}, parent?: InterruptionEvidence): void {
  if (controller.signal.aborted) return;
  const evidence = observeInterruption(controller.signal, origin, detail, parent ?? readInterruption(reason));
  attachInterruption(reason, evidence);
  controller.abort(reason);
  attachInterruption(controller.signal.reason, evidence);
}
/** Only locally generated correlation metadata crosses helper IPC. No authority or user text. */
export function correlationContext(value: unknown = diagnosticContext.getStore()): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== "object") return result;
  const input = value as Record<string, unknown>;
  for (const key of ["requestId", "websocketRequestId", "websocketConnectionId", "attemptId", "queueId", "groupId", "roundRef"]) {
    const item = input[key];
    if (typeof item === "string" && (key === "queueId" ? /^[a-f0-9]{64}$/.test(item) || uuid.test(item)
      : key === "groupId" || key === "roundRef" ? /^diag-[a-f0-9]{24}$/.test(item) : uuid.test(item))) result[key] = item;
  }
  return result;
}
