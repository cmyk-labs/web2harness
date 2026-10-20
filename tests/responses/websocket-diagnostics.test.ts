import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { classifyWebSocketFailure } from "../../src/responses/websocket-diagnostics";
import { createResponsesWebSocketAdapter, type ResponsesWebSocketData, type ResponsesWebSocketOptions,
  type WebSocketDiagnostic } from "../../src/responses/websocket";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const frame = (type: string) => `data: ${JSON.stringify({ type })}\n\n`;
const sse = (text: string) => new Response(text, { headers: { "content-type": "text/event-stream" } });

function fixture(dispatch: ResponsesWebSocketOptions["dispatch"], sendResult: number | Error = 1,
  limits?: ResponsesWebSocketOptions["limits"]) {
  const observations: WebSocketDiagnostic[] = [], frames: Record<string, any>[] = [], closes: number[] = [];
  const adapter = createResponsesWebSocketAdapter({ dispatch, limits, onDiagnostic: value => { observations.push(value); } });
  const ws = { data: adapter.createData(new Request("http://localhost/v1/responses")),
    send(text: string) {
      frames.push(JSON.parse(text));
      if (sendResult instanceof Error) throw sendResult;
      return sendResult;
    },
    close(code: number) { closes.push(code); }, getBufferedAmount() { return 0; },
  } as unknown as ServerWebSocket<ResponsesWebSocketData>;
  adapter.websocket.open!(ws);
  cleanups.push(async () => { adapter.closeAll(); await adapter.settled(); });
  return { adapter, ws, observations, frames, closes,
    create(stream_id?: string) { adapter.websocket.message(ws, JSON.stringify({ type: "response.create", model: "gpt-6-astra",
      reasoning: { effort: "high" }, input: [], ...(stream_id === undefined ? {} : { stream_id }) })); } };
}

test("classifies only bounded structured causes, ignoring messages, arbitrary codes and accessors", () => {
  const error = Object.assign(new Error("ECONNRESET fixture-secret"), { code: "fixture-secret", status: 502, closeCode: 1011 });
  expect(classifyWebSocketFailure(error)).toEqual({ reason: "transport_error", cause: "unknown" });
  const cyclic: Record<string, unknown> = { code: "ETIMEDOUT" }; cyclic.cause = cyclic;
  expect(classifyWebSocketFailure(cyclic)).toMatchObject({ cause: "timeout", transport_code: "ETIMEDOUT" });
  delete cyclic.code;
  expect(classifyWebSocketFailure(cyclic)).toEqual({ reason: "transport_error", cause: "unknown" });
  let reads = 0;
  const hostile = Object.defineProperties({}, {
    code: { get() { reads++; throw new Error("fixture-secret"); } },
    cause: { get() { reads++; throw new Error("fixture-secret"); } },
    toJSON: { get() { reads++; throw new Error("fixture-secret"); } },
  });
  expect(classifyWebSocketFailure(hostile)).toEqual({ reason: "transport_error", cause: "unknown" });
  expect(reads).toBe(0);
  expect(classifyWebSocketFailure(new DOMException("fixture-secret", "AbortError"))).toMatchObject({ cause: "aborted" });
  expect(classifyWebSocketFailure(new DOMException("fixture-secret", "TimeoutError"))).toMatchObject({ cause: "timeout" });
  const proxy = Proxy.revocable({}, {}); proxy.revoke();
  expect(classifyWebSocketFailure(proxy.proxy)).toEqual({ reason: "transport_error", cause: "unknown" });
  let deep: unknown = { code: "ECONNRESET" };
  for (let i = 0; i < 4; i++) deep = { cause: deep };
  expect(classifyWebSocketFailure(deep)).toEqual({ reason: "transport_error", cause: "unknown" });
});

test("a small wire budget still delivers the original error and reports details only to the callback", async () => {
  const f = fixture(async () => { throw new Error("fixture-secret"); }, 1, { maxEventBytes: 300 });
  f.create(); await f.adapter.settled();
  expect(f.frames).toHaveLength(1); expect(f.closes).toHaveLength(0);
  expect(f.frames[0]!.error.code).toBe("websocket_upstream_error");
  expect(f.frames[0]!.error.diagnostics).toBeUndefined();
  expect(f.observations[0]).toMatchObject({ kind: "request_failure", stage: "dispatch" });
});

test.each([false, true])("dropped/thrown sends retain failure and requested close without replay (terminal=%s)", async terminal => {
  let calls = 0;
  const f = fixture(async () => { calls++; return sse(frame(terminal ? "response.completed" : "response.created")); },
    Object.assign(new Error("fixture-secret-send"), { code: "EPIPE", closeCode: 1008 }));
  f.create("fixture-secret-stream"); await f.adapter.settled();
  const failure = f.observations.find(value => value.kind === "request_failure")!;
  expect(failure).toMatchObject({ stage: terminal ? "terminal_send" : "send", reason: "websocket_send_failed",
    transport_code: "EPIPE", cause: "connection_closed", http_status: 200, cancelled: true });
  expect(f.observations.filter(value => value.kind === "request_failure")).toHaveLength(1);
  expect(f.observations.find(value => value.kind === "socket_close")).toEqual({
    kind: "socket_close", connection_id: failure.connection_id, close_source: "local_request", close_code: 1011,
  });
  expect(JSON.stringify(f.observations)).not.toContain("fixture-secret");
  expect(calls).toBe(1); expect(f.frames).toHaveLength(1); expect(f.closes).toEqual([1011]);
  // Actual callback evidence may differ from the requested close; record it once.
  f.adapter.websocket.close!(f.ws, 1006, "fixture-secret-peer-reason");
  f.adapter.websocket.close!(f.ws, 1006, "fixture-secret-peer-reason");
  expect(f.observations.filter(value => value.kind === "socket_close")).toHaveLength(2);
  expect(f.observations.at(-1)).toMatchObject({ close_source: "peer_observed", close_code: 1006, connection_id: failure.connection_id });
});

test("peer close has no fabricated upstream status or close reason and still owns cancellation", async () => {
  let signal!: AbortSignal, cancelled = 0, calls = 0;
  const f = fixture(async request => {
    calls++; signal = request.signal;
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": "text/event-stream" } });
  });
  f.create(); f.create();
  await Bun.sleep(5);
  f.adapter.websocket.close!(f.ws, 1000, "fixture-secret-peer-reason");
  await f.adapter.settled();
  expect(signal.aborted).toBe(true); expect(cancelled).toBe(1); expect(calls).toBe(1);
  expect(f.adapter.queuedCount()).toBe(0); expect(f.frames).toHaveLength(0);
  expect(f.observations[0]).toMatchObject({ kind: "socket_close", close_source: "peer_observed", close_code: 1000 });
  expect(f.observations[0]).not.toHaveProperty("http_status");
  expect(JSON.stringify(f.observations)).not.toContain("fixture-secret");
  expect(f.observations.find(value => value.kind === "request_failure")).toMatchObject({ cancelled: true });
});

test("backpressure keeps single-send semantics and close observation stays bounded", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return sse(frame("response.created") + frame("response.completed")); }, -1,
    { backpressureTimeoutMs: 10 });
  f.create(); f.create(); await f.adapter.settled();
  expect(f.closes).toEqual([1013]); expect(f.frames).toHaveLength(1); expect(calls).toBe(1);
  expect(f.adapter.queuedCount()).toBe(0);
  expect(f.observations).toHaveLength(2);
  expect(f.observations[0]).toMatchObject({ kind: "socket_close", close_source: "local_request", close_code: 1013 });
  expect(f.observations[1]).toMatchObject({ kind: "request_failure", stage: "send", cancelled: true });
});

test("concurrent named and default lanes have stable private ordinals and unique request correlations", async () => {
  const f = fixture(async () => { throw { code: "ENOTFOUND", message: "fixture-secret" }; });
  f.create("fixture-secret-a"); f.create("fixture-secret-b"); f.create();
  await f.adapter.settled(); f.create("fixture-secret-a"); await f.adapter.settled();
  const failures = f.observations.filter(value => value.kind === "request_failure");
  expect(failures.map(value => value.stream_index)).toEqual([0, 1, 2, 0]);
  expect(new Set(failures.map(value => value.request_id)).size).toBe(4);
  expect(new Set(failures.map(value => value.connection_id)).size).toBe(1);
  expect(JSON.stringify(failures)).not.toContain("fixture-secret");
});
