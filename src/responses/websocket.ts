import type { ServerWebSocket, WebSocketHandler } from "bun";
import { diagnosticContext, diagnosticEvent } from "../diagnostics";
import { abortWithDiagnostic, observeInterruption } from "../interruption-diagnostics";
import { WebSocketSteering, type SteeringJob, type SteerTarget, type SteerValidation } from "./websocket-steering";
import { operationStage } from "../runtime/operation-stage";
import { classifyWebSocketFailure, emitWebSocketDiagnostic, WebSocketTransportFailure,
  type WebSocketDiagnostic, type WebSocketFailureStage, type WebSocketRequestFailureDiagnostic } from "./websocket-diagnostics";
export type { SteerTarget, SteerValidation } from "./websocket-steering";
export type { WebSocketDiagnostic } from "./websocket-diagnostics";

type JsonObject = Record<string, unknown>;
type Socket = ServerWebSocket<ResponsesWebSocketData>;
type PendingFrame = { text: string; bytes: number; resolve(): void; reject(error: Error): void };
type ActiveResponse = { controller: AbortController; context?: Record<string, unknown>; reader?: ReadableStreamDefaultReader<Uint8Array>; cancellation?: Promise<void> };
type ConnectionTasks = { tasks: Set<Promise<void>>; failures: unknown[]; cleanup?: Promise<void> };
type QueuedResponse = SteeringJob & { bytes: number };
type Lane = { streamId?: string; queue: QueuedResponse[]; active?: ActiveResponse; ready: boolean };

export interface ResponsesWebSocketData {
  readonly url: string;
  /** Snapshot of the upgrade request, never populated from response.create fields. */
  readonly headers: readonly (readonly [string, string])[];
  lanes: Map<string | undefined, Lane>;
  ready: Lane[];
  inFlight: number;
  queuedRequests: number;
  queuedBytes: number;
  scheduling: boolean;
  sequence: number;
  steering?: WebSocketSteering;
  closed: boolean;
  pending: PendingFrame[];
  pendingBytes: number;
  blocked?: PendingFrame;
  backpressureTimer?: ReturnType<typeof setTimeout>;
}

export interface ResponsesWebSocketLimits {
  maxMessageBytes: number;
  maxEventBytes: number;
  maxBufferedBytes: number;
  maxPendingFrames: number;
  backpressureTimeoutMs: number;
  maxConnections: number;
  maxActiveResponses: number;
  maxNamedLanes: number;
  maxQueuedRequests: number;
  maxQueuedBytes: number;
  maxPendingSteers: number;
  maxSteeringBytes: number;
  steerValidationTimeoutMs: number;
}

export interface ResponsesWebSocketOptions {
  /**
   * The SAME dispatch/lifecycle used by POST /v1/responses, including native routing.
   * prepareOnly MUST validate and prepare request state without generating. A route
   * that cannot prepare state must return an error; it must never ignore this option.
   */
  dispatch(request: Request, options?: { prepareOnly?: boolean }): Promise<Response>;
  /** Validate only; never generate/cache. Required to opt this shared route into steering. */
  validateSteer?(request: Request, target: SteerTarget): Promise<SteerValidation>;
  /** Bounded metadata only: at most one failure per dispatched request and two close
   * observations per socket (local request / peer callback). Keep observers fast;
   * they are not awaited, retained, or allowed to affect transport behavior. */
  onDiagnostic?(diagnostic: WebSocketDiagnostic): void | Promise<void>;
  limits?: Partial<ResponsesWebSocketLimits>;
}

const MIB = 1024 * 1024;
const DEFAULT_LIMITS: ResponsesWebSocketLimits = {
  maxMessageBytes: 64 * MIB,
  maxEventBytes: 16 * MIB,
  maxBufferedBytes: 32 * MIB,
  maxPendingFrames: 32,
  backpressureTimeoutMs: 30_000,
  maxConnections: 128,
  maxActiveResponses: 16,
  maxNamedLanes: 32,
  maxQueuedRequests: 128,
  maxQueuedBytes: 64 * MIB,
  maxPendingSteers: 64,
  maxSteeringBytes: 8 * MIB,
  steerValidationTimeoutMs: 10_000,
};
const TERMINAL_EVENTS = new Set(["response.completed", "response.failed", "response.incomplete", "error"]);
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

function errorEvent(status: number, code: string, message: string, param?: string): JsonObject {
  return {
    type: "error", status,
    error: { type: status >= 500 ? "server_error" : "invalid_request_error", code, message, ...(param ? { param } : {}) },
  };
}

/** Incremental SSE framing: chunk boundaries, CR/LF and UTF-8 boundaries are not events. */
async function* sseData(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number,
  stage: (value: WebSocketFailureStage) => void): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function decode(bytes?: Uint8Array, stream = false): string {
    stage("sse_decode");
    try { return decoder.decode(bytes, { stream }); }
    catch (error) { throw new WebSocketTransportFailure("sse_invalid_utf8", error); }
  }
  let line = "", parts: string[] = [], eventBytes = 0, skipLf = false;
  function* lines(text: string): Generator<string> {
    stage("sse_frame");
    for (const char of text) {
      if (skipLf) { skipLf = false; if (char === "\n") continue; }
      if (char !== "\r" && char !== "\n") {
        line += char;
        if (line.length + eventBytes > maxBytes) throw new WebSocketTransportFailure("sse_event_too_large");
        continue;
      }
      skipLf = char === "\r";
      eventBytes += Buffer.byteLength(line) + 1;
      if (eventBytes > maxBytes) throw new WebSocketTransportFailure("sse_event_too_large");
      if (!line) {
        const data = parts.length ? parts.join("\n") : undefined;
        parts = []; eventBytes = 0;
        if (data !== undefined) yield data;
        stage("sse_frame");
      } else if (line === "data") parts.push("");
      else if (line.startsWith("data:")) parts.push(line.slice(line[5] === " " ? 6 : 5));
      line = "";
    }
  }
  for (;;) {
    stage("sse_read");
    const { done, value } = await reader.read();
    if (done) break;
    // Do not decode an arbitrarily large upstream chunk into a second unbounded string.
    for (let offset = 0; offset < value.length; offset += 64 * 1024) {
      yield* lines(decode(value.subarray(offset, offset + 64 * 1024), true));
    }
  }
  yield* lines(decode());
  stage("sse_frame");
  if (parts.length || line === "data" || line.startsWith("data:")) throw new WebSocketTransportFailure("sse_unterminated_event");
}

async function readHttpError(response: Response, active: ActiveResponse, maxBytes: number): Promise<JsonObject> {
  const chunks: Uint8Array[] = [];
  let size = 0, body: unknown;
  if (response.body) {
    const reader = active.reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.length) > maxBytes) throw new WebSocketTransportFailure("http_error_body_too_large");
      chunks.push(value);
    }
    try { body = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); } catch { /* Never forward arbitrary HTML. */ }
  }
  const event = errorEvent(response.status, "upstream_http_error", `Responses request failed with HTTP ${response.status}.`);
  if (object(body) && object(body.error)) event.error = body.error;
  const headers: Record<string, string> = {};
  for (const name of ["retry-after", "x-request-id"]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  if (Object.keys(headers).length) event.headers = headers;
  return event;
}

/**
 * Transport only: response.create -> existing HTTP POST -> Responses JSON events.
 * No model substitution, tools, response cache, replay or cross-connection cancellation.
 * Authenticate/authorize the upgrade exactly as the HTTP route before server.upgrade().
 */
export function createResponsesWebSocketAdapter(options: ResponsesWebSocketOptions) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid WebSocket limit: ${name}`);
  }
  if (limits.maxActiveResponses > 16 || limits.maxNamedLanes > 32) throw new Error("Responses WebSocket protocol lane limits exceeded");
  const sockets = new Set<Socket>();
  const activeTasks = new Set<Promise<void>>();
  // Keep disconnected ownership until cleanup actually finishes, including after a timeout.
  const connections = new Map<Socket, ConnectionTasks>();
  // Weak ownership also covers close callbacks after connection cleanup has finished.
  const diagnostics = new WeakMap<Socket, { id: string; localClose: boolean; peerClose: boolean }>();
  let draining = false;

  function correlation(ws: Socket) {
    let value = diagnostics.get(ws);
    if (!value) { value = { id: crypto.randomUUID(), localClose: false, peerClose: false }; diagnostics.set(ws, value); }
    return value;
  }

  function observeClose(ws: Socket, code: number, source: "local_request" | "peer_observed"): void {
    const context = correlation(ws), key = source === "local_request" ? "localClose" : "peerClose";
    if (context[key]) return;
    context[key] = true;
    emitWebSocketDiagnostic(options.onDiagnostic, { kind: "socket_close", connection_id: context.id, close_source: source,
      ...(Number.isInteger(code) && code >= 1000 && code <= 4999 ? { close_code: code } : {}) });
  }

  function owner(ws: Socket): ConnectionTasks {
    let connection = connections.get(ws);
    if (!connection) { connection = { tasks: new Set(), failures: [] }; connections.set(ws, connection); }
    return connection;
  }

  async function waitForConnection(connection: ConnectionTasks): Promise<void> {
    while (connection.tasks.size) await Promise.allSettled([...connection.tasks]);
    if (connection.failures.length) throw new AggregateError(connection.failures,
      "Responses WebSocket cleanup failed: " + connection.failures.map(error => String(error)).join("; "));
  }

  function cancelReader(ws: Socket, active: ActiveResponse, reason?: Error): Promise<void> | undefined {
    if (!active.reader) return;
    if (!active.cancellation) {
      const connection = owner(ws);
      const task = active.reader.cancel(reason).catch(error => { if (ws.data.closed) connection.failures.push(error); })
        .finally(() => connection.tasks.delete(task));
      connection.tasks.add(task);
      active.cancellation = task;
    }
    return active.cancellation;
  }

  function settleClosedConnection(ws: Socket): void {
    const connection = owner(ws);
    let timer: ReturnType<typeof setTimeout>;
    connection.cleanup = operationStage("websocket-close", () => Promise.race([
      waitForConnection(connection),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Responses WebSocket connection cleanup timed out after 30000 ms")), 30_000);
      }),
    ]).finally(() => clearTimeout(timer)));
    // Observe failures now; settled() propagates them to the server after every connection settles.
    void connection.cleanup.then(() => connections.delete(ws), () => {});
  }

  function releaseSocket(ws: Socket): void {
    const data = ws.data;
    if (data.closed) return;
    data.closed = true;
    sockets.delete(ws);
    clearTimeout(data.backpressureTimer);
    const error = new WebSocketTransportFailure("websocket_disconnected");
    data.steering?.close();
    for (const lane of data.lanes.values()) {
      if (lane.active) abortWithDiagnostic(lane.active.controller, "websocket_close", error, lane.active.context);
      if (lane.active) void cancelReader(ws, lane.active, error);
      lane.queue.length = 0; lane.ready = false;
    }
    data.ready.length = 0; data.queuedRequests = 0; data.queuedBytes = 0;
    data.blocked?.reject(error);
    data.blocked = undefined;
    for (const pending of data.pending.splice(0)) pending.reject(error);
    data.pendingBytes = 0;
    settleClosedConnection(ws);
  }

  function closeSocket(ws: Socket, code: number, reason: string): void {
    observeClose(ws, code, "local_request");
    releaseSocket(ws);
    ws.close(code, reason);
  }

  function flush(ws: Socket): void {
    const data = ws.data;
    while (!data.closed && !data.blocked && data.pending.length) {
      const frame = data.pending.shift()!;
      data.pendingBytes -= frame.bytes;
      let sent: number;
      let sendError: unknown;
      try { sent = ws.send(frame.text); } catch (error) { sendError = error; sent = 0; }
      if (sent === 0) {
        frame.reject(new WebSocketTransportFailure("websocket_send_failed", sendError));
        closeSocket(ws, 1011, "Responses transport send failed");
      } else if (sent === -1) {
        // Bun has ALREADY queued this frame. Resolve on drain; never send it a second time.
        data.blocked = frame;
        data.backpressureTimer = setTimeout(() => closeSocket(ws, 1013, "Responses backpressure timeout"), limits.backpressureTimeoutMs);
      } else frame.resolve();
    }
  }

  function send(ws: Socket, event: JsonObject, streamId?: string): Promise<void> {
    if (ws.data.closed) return Promise.reject(new WebSocketTransportFailure("websocket_disconnected"));
    const payload = { ...event };
    delete payload.stream_id;
    if (streamId !== undefined) payload.stream_id = streamId;
    if ("sequence_number" in payload || String(payload.type).startsWith("response.steer.")) payload.sequence_number = ws.data.sequence++;
    const text = JSON.stringify(payload), bytes = Buffer.byteLength(text), data = ws.data;
    if (bytes > limits.maxEventBytes || data.pending.length >= limits.maxPendingFrames
      || ws.getBufferedAmount() + data.pendingBytes + bytes > limits.maxBufferedBytes) {
      closeSocket(ws, 1013, "Responses output buffer limit");
      return Promise.reject(new WebSocketTransportFailure("websocket_output_limit"));
    }
    return new Promise<void>((resolve, reject) => {
      data.pending.push({ text, bytes, resolve, reject }); data.pendingBytes += bytes;
      flush(ws);
    });
  }

  function reject(ws: Socket, status: number, code: string, message: string, param?: string, streamId?: string): void {
    trackControl(ws, send(ws, errorEvent(status, code, message, param), streamId));
  }

  function trackControl(ws: Socket, promise: Promise<void>): void {
    const connection = owner(ws);
    const task = promise.catch(() => {}).finally(() => connection.tasks.delete(task));
    connection.tasks.add(task);
  }

  function request(data: ResponsesWebSocketData, body: JsonObject, signal: AbortSignal): Request {
    return new Request(data.url, { method: "POST", headers: data.headers as [string, string][], body: JSON.stringify(body), signal });
  }

  function markReady(data: ResponsesWebSocketData, lane: Lane): void {
    if (!lane.active && lane.queue.length && !lane.ready && !data.closed) {
      lane.ready = true; data.ready.push(lane);
    }
  }

  function schedule(ws: Socket): void {
    const data = ws.data;
    if (data.scheduling || data.closed) return;
    data.scheduling = true;
    try {
      // One request per ready lane per rotation; a busy lane never blocks another.
      // Accepted work drains normally even after admission is closed by setDraining.
      while (!data.closed && !data.blocked && data.inFlight < limits.maxActiveResponses && data.ready.length) {
        const lane = data.ready.shift()!;
        lane.ready = false;
        if (lane.active || !lane.queue.length) continue;
        const job = lane.queue.shift()!;
        data.queuedRequests--; data.queuedBytes -= job.bytes;
        const active = { controller: new AbortController() };
        lane.active = active; data.inFlight++;
        const connection = owner(ws);
        const task = run(ws, job, active, lane.streamId)
          .catch(() => { if (!data.closed) closeSocket(ws, 1011, "Responses transport failed"); })
          .finally(() => {
            lane.active = undefined; data.inFlight--;
            activeTasks.delete(task);
            connection.tasks.delete(task);
            markReady(data, lane); schedule(ws);
          });
        activeTasks.add(task);
        connection.tasks.add(task);
      }
    } finally { data.scheduling = false; }
  }

  function enqueue(ws: Socket, body: JsonObject, prepareOnly: boolean, streamId?: string, claimed?: SteeringJob["claimed"], quiet = false): boolean {
    const data = ws.data;
    if (data.closed) return false;
    let lane = data.lanes.get(streamId);
    if (!lane && streamId !== undefined && data.lanes.size - Number(data.lanes.has(undefined)) >= limits.maxNamedLanes) {
      if (!quiet) reject(ws, 400, "websocket_stream_limit_reached", "Reuse an existing stream_id or open a new connection; the named stream limit has been reached.", "stream_id", streamId);
      return false;
    }
    const bytes = Buffer.byteLength(JSON.stringify(body));
    const canStart = !lane?.active && !data.blocked && !data.ready.length && data.inFlight < limits.maxActiveResponses;
    if (bytes > limits.maxMessageBytes || (!canStart && (data.queuedRequests >= limits.maxQueuedRequests || data.queuedBytes + bytes > limits.maxQueuedBytes))) {
      if (!quiet) reject(ws, 429, "websocket_queue_full", "The connection's bounded input queue is full. This request was not executed.", undefined, streamId);
      return false;
    }
    if (!lane) { lane = { streamId, queue: [], ready: false }; data.lanes.set(streamId, lane); }
    lane.queue.push({ body, prepareOnly, bytes, claimed }); data.queuedRequests++; data.queuedBytes += bytes;
    markReady(data, lane); schedule(ws);
    return true;
  }

  async function run(ws: Socket, job: QueuedResponse, active: ActiveResponse, streamId?: string): Promise<void> {
    const data = ws.data;
    let terminal: JsonObject | undefined;
    let stage: WebSocketFailureStage = "request", httpStatus: number | undefined;
    let reported = false;
    const requestId = crypto.randomUUID();
    const context = active.context = { ...diagnosticContext.getStore(), websocketConnectionId: correlation(ws).id, websocketRequestId: requestId };
    diagnosticEvent("info", "http.websocket_dispatched", context);
    const diagnostic = (error: unknown): WebSocketRequestFailureDiagnostic => ({
      kind: "request_failure", connection_id: correlation(ws).id, request_id: requestId,
      stream_index: [...data.lanes.keys()].indexOf(streamId), stage, ...classifyWebSocketFailure(error),
      ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
      terminal_seen: terminal !== undefined, cancelled: data.closed || active.controller.signal.aborted,
    });
    const report = (error: unknown) => {
      const failure = diagnostic(error);
      if (!reported) { reported = true; emitWebSocketDiagnostic(options.onDiagnostic, failure); }
      return failure;
    };
    try {
      stage = "steering";
      const preflight = data.steering?.prepare(job, streamId);
      if (preflight) { stage = "send"; await send(ws, preflight, streamId); return; }
      stage = "request";
      try {
        if (Buffer.byteLength(JSON.stringify(job.body)) > limits.maxMessageBytes) throw new WebSocketTransportFailure("request_too_large");
        const dispatchedRequest = request(data, job.body, active.controller.signal);
        stage = "dispatch";
        const response = await diagnosticContext.run(context, () => options.dispatch(dispatchedRequest, job.prepareOnly ? { prepareOnly: true } : undefined));
        if (response.status >= 100 && response.status <= 599) httpStatus = response.status;
        if (active.controller.signal.aborted) {
          await response.body?.cancel().catch(error => { owner(ws).failures.push(error); });
          return;
        }
        stage = "response_headers";
        if (!response.ok) {
          stage = "http_error_body";
          terminal = await readHttpError(response, active, limits.maxEventBytes);
          report(new WebSocketTransportFailure("http_error"));
        }
        else {
          if (!response.body || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
            await response.body?.cancel();
            throw new WebSocketTransportFailure("expected_sse_body");
          }
          const reader = active.reader = response.body.getReader();
          let doneMarker = false;
          for await (const value of sseData(reader, limits.maxEventBytes, value => { stage = value; })) {
            stage = "sse_validate";
            if (value === "[DONE]") { if (!terminal) throw new WebSocketTransportFailure("sse_missing_terminal"); doneMarker = true; continue; }
            stage = "sse_parse";
            let event: unknown;
            try { event = JSON.parse(value); } catch (error) { throw new WebSocketTransportFailure("sse_invalid_json", error); }
            stage = "sse_validate";
            if (!object(event) || typeof event.type !== "string"
              || !(event.type.startsWith("response.") || event.type === "error")) throw new WebSocketTransportFailure("sse_invalid_event");
            if (event.type === "response.heartbeat" && terminal) continue;
            if (terminal || doneMarker) throw new WebSocketTransportFailure("sse_event_after_terminal");
            if (TERMINAL_EVENTS.has(event.type)) { terminal = event; data.steering?.stopAccepting(job); }
            else {
              if (event.type === "response.created") data.steering?.created(job, event, streamId);
              stage = "send";
              await send(ws, event, streamId);
            }
          }
          stage = "sse_validate";
          if (!terminal) throw new WebSocketTransportFailure("sse_missing_terminal");
        }
      } catch (error) {
        const failure = report(error);
        if (!data.closed && !active.controller.signal.aborted) {
          terminal = errorEvent(502, "websocket_upstream_error", "Responses transport failed before a complete result. No request was replayed.");
          const detailed = { ...terminal, error: { ...(terminal.error as JsonObject), diagnostics: failure },
            ...(streamId === undefined ? {} : { stream_id: streamId }) };
          // Diagnostic overhead must not close a socket whose original error fits.
          // The callback still receives full metadata under a small wire budget.
          if (Buffer.byteLength(JSON.stringify(detailed)) <= Math.min(limits.maxEventBytes, limits.maxBufferedBytes)) {
            (terminal.error as JsonObject).diagnostics = failure;
          }
          const interruption = observeInterruption(error && typeof error === "object" ? error : {}, "websocket_transport", { ...context, stage, ...classifyWebSocketFailure(error) });
          abortWithDiagnostic(active.controller, "websocket_transport", new Error("Responses transport failed"), context, interruption);
        }
      } finally {
        stage = "cleanup";
        data.steering?.stopAccepting(job);
        if (active.reader) {
          await cancelReader(ws, active);
          active.reader.releaseLock();
        }
      }
      // Keep this lane occupied until HTTP cleanup AND terminal backpressure settle.
      stage = "steering";
      await data.steering?.beforeTerminal(job);
      stage = "terminal_send";
      if (terminal && !data.closed) await send(ws, terminal, streamId);
      stage = "steering";
      await data.steering?.afterTerminal(job, terminal, streamId);
    } catch (error) {
      report(error);
      throw error;
    }
  }

  const websocket: WebSocketHandler<ResponsesWebSocketData> = {
    maxPayloadLength: limits.maxMessageBytes,
    backpressureLimit: limits.maxBufferedBytes,
    closeOnBackpressureLimit: true,
    idleTimeout: 0,
    sendPings: true,
    perMessageDeflate: false,
    open(ws) {
      if (draining || sockets.size >= limits.maxConnections) { closeSocket(ws, 1013, "Responses server unavailable"); return; }
      ws.data.steering = new WebSocketSteering({
        validate: options.validateSteer, request: (body, signal) => request(ws.data, body, signal),
        send: (event, streamId) => send(ws, event, streamId),
        enqueue: (job, streamId) => enqueue(ws, job.body, job.prepareOnly, streamId, job.claimed, true),
        accepting: () => !draining && !ws.data.closed,
        maxSubmissions: limits.maxPendingSteers, maxBytes: limits.maxSteeringBytes, validationTimeoutMs: limits.steerValidationTimeoutMs,
      });
      sockets.add(ws);
    },
    message(ws, message) {
      if (ws.data.closed) return;
      if (typeof message !== "string") { reject(ws, 400, "invalid_websocket_frame", "Send response.create as a JSON text frame."); return; }
      if (Buffer.byteLength(message) > limits.maxMessageBytes) { closeSocket(ws, 1009, "Responses request too large"); return; }
      let event: unknown;
      try { event = JSON.parse(message); } catch { reject(ws, 400, "invalid_json", "Invalid JSON in WebSocket frame."); return; }
      if (object(event) && event.type === "response.steer") {
        if (ws.data.steering) trackControl(ws, ws.data.steering.accept(event).catch(() => { if (!ws.data.closed) closeSocket(ws, 1011, "Steering transport failed"); }));
        return;
      }
      if (!object(event) || event.type !== "response.create") {
        reject(ws, 400, "unsupported_websocket_event", "Only response.create and response.steer are Responses WebSocket client events.", "type"); return;
      }
      const streamId = event.stream_id;
      if (streamId !== undefined && (typeof streamId !== "string" || !/^[A-Za-z0-9_.-]{1,256}$/.test(streamId))) {
        reject(ws, 400, "invalid_stream_id", "stream_id must contain 1–256 letters, numbers, underscores, hyphens or periods.", "stream_id"); return;
      }
      const fail = (status: number, code: string, message: string, param?: string) => reject(ws, status, code, message, param, streamId);
      if (draining) { fail(503, "server_draining", "Responses server is draining."); return; }
      if (event.generate !== undefined && typeof event.generate !== "boolean") {
        fail(400, "invalid_websocket_generate", "generate must be a boolean when supplied.", "generate"); return;
      }
      if ((event.stream !== undefined && event.stream !== true)
        || (event.background !== undefined && event.background !== null && event.background !== false)) {
        fail(400, "unsupported_websocket_transport_option", "WebSocket Responses requires streaming foreground generation."); return;
      }
      if ("headers" in event || "authorization" in event) {
        fail(400, "unsupported_websocket_headers", "Authentication and request headers belong to the initial connection."); return;
      }
      const body: JsonObject = { ...event, stream: true };
      for (const key of ["type", "stream_id", "generate", "background"]) delete body[key];
      if (body.previous_response_id === null) delete body.previous_response_id;
      // generate is a WebSocket transport control. Carry false into the shared handler
      // explicitly, even though it does not belong in the HTTP Responses JSON body.
      enqueue(ws, body, event.generate === false, streamId);
    },
    drain(ws) {
      clearTimeout(ws.data.backpressureTimer);
      const blocked = ws.data.blocked;
      ws.data.blocked = undefined;
      blocked?.resolve();
      flush(ws);
      schedule(ws);
    },
    close(ws, code) { observeClose(ws, code, "peer_observed"); releaseSocket(ws); },
  };

  return {
    websocket,
    createData(request: Request): ResponsesWebSocketData {
      const headers = new Headers(request.headers);
      const hopByHop = ["connection", "upgrade", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "content-length", "content-encoding", "host"];
      for (const name of (headers.get("connection") ?? "").split(",")) if (name.trim()) hopByHop.push(name.trim());
      for (const name of [...headers.keys()]) if (name.startsWith("sec-websocket-")) headers.delete(name);
      for (const name of hopByHop) headers.delete(name);
      headers.set("content-type", "application/json");
      headers.set("accept", "text/event-stream");
      return { url: request.url, headers: [...headers.entries()], closed: false, pending: [], pendingBytes: 0,
        lanes: new Map(), ready: [], inFlight: 0, queuedRequests: 0, queuedBytes: 0, scheduling: false, sequence: 0 };
    },
    setDraining(value: boolean): void { draining = value; },
    connectionCount(): number { return sockets.size; },
    /** Includes admitted creates waiting for a lane/slot, so shutdown cannot strand them. */
    activeCount(): number { return activeTasks.size + [...sockets].reduce((sum, ws) => sum + ws.data.queuedRequests, 0); },
    queuedCount(): number { return [...sockets].reduce((sum, ws) => sum + ws.data.queuedRequests, 0); },
    /** Reject new work first. Existing generations finish normally until closeAll is called. */
    closeAll(): void {
      draining = true;
      for (const ws of [...sockets]) closeSocket(ws, 1001, "Responses server is shutting down");
    },
    /** Closed connections each own 30 seconds; never discard pending tasks on timeout. */
    async settled(): Promise<void> {
      const results = await Promise.allSettled([...connections.values()].map(connection => connection.cleanup ?? waitForConnection(connection)));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, "Responses WebSocket cleanup failed: " + failures.map(error => String(error)).join("; "));
    },
  };
}
