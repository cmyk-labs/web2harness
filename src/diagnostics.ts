import { AsyncLocalStorage } from "node:async_hooks";
import { LOADED_SOURCE_ID } from "./build-identity";
import { PREFIX, createDiagnosticRecord, type DiagnosticRecord } from "../launcher/shared/diagnostic-event.cjs";
export { diagnosticError, diagnosticReference } from "../launcher/shared/diagnostic-event.cjs";

export const diagnosticContext = new AsyncLocalStorage<Record<string, unknown>>();
/** Diagnostic failures must never change request execution or write to MCP protocol stdout. */
export function diagnosticEvent(level: DiagnosticRecord["level"], event: string, detail: Record<string, unknown> = {}, eventId?: string): void {
  try { const record = createDiagnosticRecord(level, event, { sourceId: LOADED_SOURCE_ID, ...diagnosticContext.getStore(), ...detail });
    if (eventId) record.eventId = eventId;
    console.error(PREFIX + JSON.stringify(record)); }
  catch { /* The supervising process records stream/persistence failures independently. */ }
}
