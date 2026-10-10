export interface DiagnosticRecord {
  schemaVersion: number; eventId: string; at: string;
  level: "info" | "warning" | "error" | "debug";
  component: string; event: string; detail: Record<string, unknown>;
}
export const PREFIX: string;
export function cleanText(value: unknown): string;
export function safeDetail(value: unknown): Record<string, unknown>;
export function sourceFor(record: { event: string; component?: string }): string;
export function createDiagnosticRecord(level: DiagnosticRecord["level"], event: string, detail?: Record<string, unknown>): DiagnosticRecord;
export function parseDiagnosticLine(line: string): DiagnosticRecord | null;
export function diagnosticError(error: unknown): Record<string, unknown>;
export function diagnosticReference(value: string): string;
