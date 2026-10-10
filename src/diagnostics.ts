import { AsyncLocalStorage } from "node:async_hooks";
import { PREFIX, createDiagnosticRecord, type DiagnosticRecord } from "../launcher/shared/diagnostic-event.cjs";
export { diagnosticError, diagnosticReference } from "../launcher/shared/diagnostic-event.cjs";

export const diagnosticContext = new AsyncLocalStorage<Record<string, unknown>>();
/** Diagnostic failures must never change request execution or write to MCP protocol stdout. */
export function diagnosticEvent(level: DiagnosticRecord["level"], event: string, detail: Record<string, unknown> = {}): void {
  try { console.error(PREFIX + JSON.stringify(createDiagnosticRecord(level, event, { ...diagnosticContext.getStore(), ...detail }))); }
  catch { /* The supervising process records stream/persistence failures independently. */ }
}
