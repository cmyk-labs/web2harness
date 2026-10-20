/** Fixed vocabulary only: never serialize an exception, request, header or SSE payload. */
export type WebSocketFailureStage = "request" | "dispatch" | "response_headers" | "http_error_body"
  | "sse_read" | "sse_decode" | "sse_frame" | "sse_parse" | "sse_validate" | "send"
  | "cleanup" | "terminal_send" | "steering";
export type WebSocketFailureReason = "transport_error" | "request_too_large" | "http_error"
  | "http_error_body_too_large" | "expected_sse_body" | "sse_event_too_large"
  | "sse_unterminated_event" | "sse_invalid_utf8" | "sse_invalid_json" | "sse_invalid_event"
  | "sse_missing_terminal" | "sse_event_after_terminal" | "websocket_send_failed"
  | "websocket_output_limit" | "websocket_disconnected";

const failureReasons = new WeakMap<object, WebSocketFailureReason>();
export class WebSocketTransportFailure extends Error {
  constructor(reason: WebSocketFailureReason, cause?: unknown) {
    super(reason, { cause });
    failureReasons.set(this, reason);
  }
}

const TRANSPORT_CODES = {
  ECONNRESET: "connection_reset", ECONNREFUSED: "connection_refused", EPIPE: "connection_closed",
  ETIMEDOUT: "timeout", ESOCKETTIMEDOUT: "timeout", ENOTFOUND: "dns", EAI_AGAIN: "dns",
  UND_ERR_CONNECT_TIMEOUT: "timeout", UND_ERR_HEADERS_TIMEOUT: "timeout", UND_ERR_BODY_TIMEOUT: "timeout",
  UND_ERR_SOCKET: "connection_closed", ABORT_ERR: "aborted",
} as const;
type TransportCode = keyof typeof TRANSPORT_CODES;
type Cause = typeof TRANSPORT_CODES[TransportCode] | "unknown";

// Do not invoke error getters/toJSON/toString. A hostile or cyclic cause chain must
// neither leak arbitrary strings nor turn diagnostics into a second failure.
function own(value: object, key: string): unknown {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

export function classifyWebSocketFailure(error: unknown): {
  reason: WebSocketFailureReason; cause: Cause; transport_code?: TransportCode;
} {
  const reason = failureReasons.get(error as object) ?? "transport_error";
  let cause: Cause = "unknown";
  const seen = new Set<object>();
  for (let depth = 0; depth < 4 && error !== null && typeof error === "object" && !seen.has(error); depth++) {
    seen.add(error);
    const code = own(error, "code");
    if (typeof code === "string" && Object.hasOwn(TRANSPORT_CODES, code)) {
      return { reason, cause: TRANSPORT_CODES[code as TransportCode], transport_code: code as TransportCode };
    }
    let name = own(error, "name");
    // Read the built-in DOMException brand directly, without invoking user getters.
    try {
      if (error instanceof DOMException) name = Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get?.call(error);
    } catch { /* Unknown/revoked proxy remains unclassified. */ }
    if (name === "AbortError") cause = "aborted";
    if (name === "TimeoutError") cause = "timeout";
    error = own(error, "cause");
  }
  return { reason, cause };
}

export interface WebSocketRequestFailureDiagnostic {
  readonly kind: "request_failure";
  /** Locally generated IDs; never copied from authentication, payloads or headers. */
  readonly connection_id: string;
  readonly request_id: string;
  /** Stable connection-local lane ordinal, including the default lane. */
  readonly stream_index: number;
  readonly stage: WebSocketFailureStage;
  readonly reason: WebSocketFailureReason;
  readonly cause: Cause;
  readonly transport_code?: TransportCode;
  /** Status of the actual dispatch Response, not the synthesized WebSocket 502. */
  readonly http_status?: number;
  readonly terminal_seen: boolean;
  readonly cancelled: boolean;
}

export interface WebSocketCloseDiagnostic {
  readonly kind: "socket_close";
  readonly connection_id: string;
  readonly close_source: "local_request" | "peer_observed";
  readonly close_code?: number;
  // Peer close reason text is deliberately excluded.
}

export type WebSocketDiagnostic = WebSocketRequestFailureDiagnostic | WebSocketCloseDiagnostic;

/** No queue/history, no awaiting observers, and no observer exception reaches transport code. */
export function emitWebSocketDiagnostic(
  observer: ((diagnostic: WebSocketDiagnostic) => void | Promise<void>) | undefined,
  diagnostic: WebSocketDiagnostic,
): void {
  if (!observer) return;
  try { void Promise.resolve(observer(Object.freeze({ ...diagnostic }))).catch(() => {}); } catch { /* Best effort. */ }
}
