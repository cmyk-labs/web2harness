// Renderer-only navigation intent; never persisted or sent to the browser connector.
let pendingRequestId: string | undefined;
export function openRequestLogs(requestId: string) { pendingRequestId = requestId; }
export function pendingRequestLogs() { return pendingRequestId; }
export function clearRequestLogs() { pendingRequestId = undefined; }
