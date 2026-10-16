import { diagnosticError, diagnosticEvent } from "../../../diagnostics";
import { adapterErrorEvent } from "../../../lib/errors";

export interface BrowserHelperError {
  type: "error";
  id: string;
  name?: string;
  message: string;
  status?: number;
  errorType?: string;
  code?: string;
  retryable?: boolean;
  diagnosticRef?: string;
}

/** Root causes stay in helper diagnostics; only an opaque reference crosses IPC. */
export function browserHelperError(id: string, error: unknown, traceId?: string): BrowserHelperError {
  const event = adapterErrorEvent(error);
  const evidence = diagnosticError(error);
  diagnosticEvent(event.status === 499 ? "info" : "error", "browser.helper_failed", {
    requestId: id, traceId, ...evidence,
  });
  const structured = event.status !== undefined && event.errorType !== undefined
    && event.code !== undefined && event.retryable !== undefined;
  return {
    type: "error", id, message: event.message,
    name: error instanceof Error && /^[A-Za-z0-9_.-]{1,128}$/.test(error.name) ? error.name : "Error",
    ...(structured ? { status: event.status, errorType: event.errorType, code: event.code, retryable: event.retryable } : {}),
    diagnosticRef: evidence.errorRef,
  };
}
