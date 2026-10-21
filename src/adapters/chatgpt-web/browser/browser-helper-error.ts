import { diagnosticError, diagnosticEvent } from "../../../diagnostics";
import { readInterruption, type InterruptionEvidence } from "../../../interruption-diagnostics";
import { adapterErrorEvent } from "../../../lib/errors";
import { validMcpRemoteFailure, type McpRemoteFailure } from "../../../../launcher/shared/mcp-remote-error.cjs";

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
  interruption?: InterruptionEvidence;
  mcpRemote?: McpRemoteFailure;
}

/** Root causes stay in helper diagnostics; only an opaque reference crosses IPC. */
export function browserHelperError(id: string, error: unknown, traceId?: string, interruption = readInterruption(error)): BrowserHelperError {
  const event = adapterErrorEvent(error);
  const remote = error && typeof error === "object" && "mcpRemote" in error ? error.mcpRemote : undefined;
  const evidence = diagnosticError(error);
  diagnosticEvent(event.status === 499 ? "info" : "error", "browser.helper_failed", {
    helperRequestId: id, traceId, interruption, ...evidence,
  });
  const structured = event.status !== undefined && event.errorType !== undefined
    && event.code !== undefined && event.retryable !== undefined;
  return {
    type: "error", id, message: event.message,
    name: error instanceof Error && /^[A-Za-z0-9_.-]{1,128}$/.test(error.name) ? error.name : "Error",
    ...(structured ? { status: event.status, errorType: event.errorType, code: event.code, retryable: event.retryable } : {}),
    diagnosticRef: evidence.errorRef,
    ...(interruption ? { interruption } : {}),
    ...(validMcpRemoteFailure(remote) ? { mcpRemote: remote } : {}),
  };
}
