import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createResponsesWebSocketAdapter, type ResponsesWebSocketData, type ResponsesWebSocketOptions } from "../../src/responses/websocket";

type Event = Record<string, any>;
const encoder = new TextEncoder();
const frame = (event: Event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const completed = (id = "resp_fixture") => ({ type: "response.completed", response: { id, status: "completed", output: [] } });
const sse = (text: string) => new Response(text, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
const create = (extra: Event = {}): Event => ({ type: "response.create", model: "exact-native-model", input: [], ...extra });
// tsconfig includes lib.dom, whose WebSocket constructor hides Bun's headers overload.
const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function fixture(options: ResponsesWebSocketOptions) {
  const adapter = createResponsesWebSocketAdapter(options);
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    websocket: adapter.websocket,
    fetch(request, server) {
      if (server.upgrade(request, { data: adapter.createData(request) })) return;
      return new Response("Upgrade required", { status: 426 });
    },
  });
  cleanups.push(async () => {
    adapter.closeAll();
    await server.stop(true);
    await adapter.settled();
  });
  async function connect(headers: Record<string, string> = {}) {
    const socket = new BunWebSocket(`ws://127.0.0.1:${server.port}/v1/responses`, { headers });
    const messages: string[] = [], pending: { resolve(text: string): void; reject(error: Error): void }[] = [];
    const opened = deferred<void>(), closed = deferred<CloseEvent>();
    let ended = false;
    socket.onopen = () => opened.resolve();
    socket.onmessage = event => {
      const text = String(event.data), waiter = pending.shift();
      if (waiter) waiter.resolve(text); else messages.push(text);
    };
    socket.onclose = event => {
      ended = true; closed.resolve(event);
      for (const waiter of pending.splice(0)) waiter.reject(new Error("Fixture socket closed"));
    };
    await opened.promise;
    return {
      socket, closed: closed.promise,
      send(event: Event) { socket.send(JSON.stringify(event)); },
      async next(): Promise<Event> {
        const text = messages.shift();
        if (text !== undefined) return JSON.parse(text);
        if (ended) throw new Error("Fixture socket closed");
        return JSON.parse(await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Fixture event timeout")), 2_000);
          pending.push({ resolve(text) { clearTimeout(timer); resolve(text); }, reject(error) { clearTimeout(timer); reject(error); } });
        }));
      },
    };
  }
  return { adapter, connect };
}

describe("Responses WebSocket HTTP transport", () => {
  test("generate:false dispatches prepareOnly with exact request fields and connection headers", async () => {
    const requests: { request: Request; body: Event; options?: { prepareOnly?: boolean } }[] = [];
    let generations = 0;
    const f = await fixture({ dispatch: async (request, options) => {
      requests.push({ request, body: await request.json(), options });
      if (options?.prepareOnly) return sse(frame({ type: "response.created", response: { id: "resp_prepared", status: "in_progress", output: [] } }) + frame(completed("resp_prepared")));
      generations++;
      return sse(frame(completed("resp_generated")));
    } });
    const client = await f.connect({ authorization: "Bearer prepare-fixture", "x-codex-thread-id": "prepare-thread" });
    const original = create({
      model: "chatgpt-web/exact-fixture-model", generate: false, stream_id: "main", store: false,
      input: [{ role: "user", content: [{ type: "input_text", text: "Preserve original context\n" }] }],
      tools: [{ type: "function", name: "fixture", parameters: { type: "object", properties: { generate: { type: "boolean", const: false } } } }],
      tool_choice: "required", parallel_tool_calls: false, reasoning: { effort: "high" },
      text: { format: { type: "json_object" } }, instructions: "Exact instructions", metadata: { fixture: true },
    });
    client.send(original);
    expect((await client.next()).type).toBe("response.created");
    expect(await client.next()).toEqual({ ...completed("resp_prepared"), stream_id: "main" });
    expect(generations).toBe(0);
    expect(requests[0].options).toEqual({ prepareOnly: true });
    expect(requests[0].request.headers.get("authorization")).toBe("Bearer prepare-fixture");
    expect(requests[0].request.headers.get("x-codex-thread-id")).toBe("prepare-thread");
    const { type, generate, stream_id, ...body } = original;
    expect(requests[0].body).toEqual({ ...body, stream: true });
    const incremental = [{ role: "user", content: "Only new input" }];
    client.send(create({ generate: true, previous_response_id: "resp_prepared", input: incremental }));
    expect((await client.next()).response.id).toBe("resp_generated");
    expect(requests[1].options).toBeUndefined();
    expect(requests[1].body).toEqual({ model: "exact-native-model", previous_response_id: "resp_prepared", input: incremental, stream: true });
    expect(generations).toBe(1);
    client.send(create({ metadata: { prepareOnly: true } }));
    await client.next();
    expect(requests[2].options).toBeUndefined();
    expect(generations).toBe(2);
  });

  test("prepare-only handler errors pass through without falling back to generation", async () => {
    let prepares = 0, generations = 0;
    const error = { type: "invalid_request_error", code: "unsupported_native_prewarm", message: "Native request-state preparation is unsupported.", retryable: false };
    const f = await fixture({ dispatch: async (_request, options) => {
      if (options?.prepareOnly) { prepares++; return Response.json({ error }, { status: 400 }); }
      generations++; return sse(frame(completed()));
    } });
    const client = await f.connect(); client.send(create({ generate: false }));
    expect(await client.next()).toEqual({ type: "error", status: 400, error });
    await f.adapter.settled();
    expect(prepares).toBe(1); expect(generations).toBe(0);
  });

  test("preparation shares the serial lifecycle and releases only after the response settles", async () => {
    const started = deferred<void>(), prepared = deferred<Response>();
    let generations = 0;
    const f = await fixture({ dispatch: async (_request, options) => {
      if (options?.prepareOnly) { started.resolve(); return prepared.promise; }
      generations++; return sse(frame(completed()));
    } });
    const client = await f.connect(); client.send(create({ generate: false })); await started.promise;
    client.send(create());
    await Bun.sleep(10);
    expect(generations).toBe(0);
    prepared.resolve(sse(frame(completed("resp_prepared"))));
    expect((await client.next()).response.id).toBe("resp_prepared");
    expect((await client.next()).type).toBe("response.completed");
    expect(generations).toBe(1);
  });

  test("disconnect aborts pending preparation without starting generation", async () => {
    const started = deferred<AbortSignal>();
    let generations = 0;
    const f = await fixture({ dispatch: async (request, options) => {
      if (!options?.prepareOnly) { generations++; return sse(frame(completed())); }
      started.resolve(request.signal);
      await new Promise<void>(resolve => request.signal.addEventListener("abort", () => resolve(), { once: true }));
      return new Response(null, { status: 499 });
    } });
    const client = await f.connect(); client.send(create({ generate: false })); const signal = await started.promise;
    const aborted = new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    client.socket.close(); await aborted; await f.adapter.settled();
    expect(signal.aborted).toBe(true); expect(generations).toBe(0);
  });

  test("dispatches the exact model, tools, input and initial auth through one HTTP handler", async () => {
    const requests: Request[] = [], bodies: Event[] = [];
    const f = await fixture({ dispatch: async request => {
      requests.push(request); bodies.push(await request.json());
      return sse(frame({ type: "response.created", response: { id: "resp_1" } })
        + frame({ type: "response.output_item.done", item: { type: "function_call", call_id: "call_1", name: "exec", arguments: "{}" } })
        + frame(completed("resp_1")) + "data: [DONE]\n\n");
    } });
    const client = await f.connect({ authorization: "Bearer synthetic-fixture-only", "x-codex-turn-id": "turn_fixture" });
    const body = create({
      stream: true, generate: true, stream_id: "main", store: false,
      reasoning: { effort: "high" }, tools: [{ type: "custom", name: "apply_patch" }],
      input: [{ type: "function_call_output", call_id: "call_old", output: "original\nbytes" }],
      metadata: { permission: "unchanged" },
    });
    client.send(body);
    expect((await client.next()).type).toBe("response.created");
    expect((await client.next()).item.call_id).toBe("call_1");
    expect(await client.next()).toEqual({ ...completed("resp_1"), stream_id: "main" });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(new URL(requests[0].url).pathname).toBe("/v1/responses");
    expect(requests[0].headers.get("authorization")).toBe("Bearer synthetic-fixture-only");
    expect(requests[0].headers.get("x-codex-turn-id")).toBe("turn_fixture");
    expect(requests[0].headers.get("accept")).toBe("text/event-stream");
    expect(requests[0].headers.get("upgrade")).toBeNull();
    expect(requests[0].headers.get("sec-websocket-key")).toBeNull();
    const { type, generate, stream_id, ...expected } = body;
    expect(bodies[0]).toEqual(expected);
  });

  test("incremental UTF-8, CRLF, multiline SSE and comments become JSON events", async () => {
    const text = ': keepalive\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"你好🙂"}\r\n\r\n'
      + frame(completed()).replaceAll("\n", "\r") + "data: [DONE]\r\r";
    const bytes = encoder.encode(text);
    const f = await fixture({ dispatch: async () => new Response(new ReadableStream({
      start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); },
    }), { headers: { "content-type": "text/event-stream" } }) });
    const client = await f.connect(); client.send(create());
    expect(await client.next()).toEqual({ type: "response.output_text.delta", delta: "你好🙂" });
    expect(await client.next()).toEqual(completed());
  });

  test("streams deltas before completion and queues same-lane generation without replay", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let count = 0;
    const f = await fixture({ dispatch: async () => {
      count++;
      if (count > 1) return sse(frame(completed("resp_second")));
      return new Response(new ReadableStream({ start(controller) { source = controller; controller.enqueue(encoder.encode(frame({ type: "response.output_text.delta", delta: "first" }))); } }), { headers: { "content-type": "text/event-stream" } });
    } });
    const client = await f.connect(); client.send(create());
    expect((await client.next()).delta).toBe("first");
    client.send(create());
    await Bun.sleep(10);
    expect(count).toBe(1);
    source.enqueue(encoder.encode(frame(completed()))); source.close();
    expect((await client.next()).type).toBe("response.completed");
    expect((await client.next()).response.id).toBe("resp_second");
    expect(count).toBe(2);
  });

  test("forwards cache misses and accepts caller-supplied full history without injecting context", async () => {
    const bodies: Event[] = [];
    const error = { type: "invalid_request_error", code: "previous_response_not_found", param: "previous_response_id", message: "Send full original history without the id; do not replay tool side effects.", retryable: false };
    const f = await fixture({ dispatch: async request => {
      const body = await request.json(); bodies.push(body);
      return body.previous_response_id ? Response.json({ error }, { status: 400 }) : sse(frame(completed()));
    } });
    const client = await f.connect();
    client.send(create({ previous_response_id: "missing", input: [{ role: "user", content: "delta" }] }));
    expect(await client.next()).toEqual({ type: "error", status: 400, error });
    expect(bodies).toHaveLength(1);
    const input = [{ role: "user", content: "full context" }, { type: "function_call_output", call_id: "already_executed", output: "do not rerun" }];
    client.send(create({ previous_response_id: null, input }));
    expect((await client.next()).type).toBe("response.completed");
    expect(bodies[1]).toEqual({ model: "exact-native-model", stream: true, input });
  });

  test("does not cache previous response ids or merge prior request fields", async () => {
    const bodies: Event[] = [];
    const f = await fixture({ dispatch: async request => { bodies.push(await request.json()); return sse(frame(completed())); } });
    const client = await f.connect();
    client.send(create({ tools: [{ type: "function", name: "first" }], instructions: "first-only" }));
    await client.next();
    client.send(create({ previous_response_id: "resp_fixture", input: "new input", model: "another-explicit-model" }));
    await client.next();
    expect(bodies[1]).toEqual({ model: "another-explicit-model", input: "new input", previous_response_id: "resp_fixture", stream: true });
  });

  test("invalid and unsupported frames are explicit errors and never execute", async () => {
    let count = 0;
    const f = await fixture({ dispatch: async () => { count++; return sse(frame(completed())); } });
    const client = await f.connect();
    client.socket.send("{"); expect((await client.next()).error.code).toBe("invalid_json");
    client.socket.send(new Uint8Array([1])); expect((await client.next()).error.code).toBe("invalid_websocket_frame");
    for (const [body, code] of [
      [{ type: "response.cancel" }, "unsupported_websocket_event"],
      [create({ stream_id: "" }), "invalid_stream_id"],
      ...["false", 0, 1, null, {}, []].map(generate => [create({ generate }), "invalid_websocket_generate"] as [Event, string]),
      [create({ stream: false }), "unsupported_websocket_transport_option"],
      [create({ background: true }), "unsupported_websocket_transport_option"],
      [create({ headers: { authorization: "Bearer frame-cannot-replace-auth" } }), "unsupported_websocket_headers"],
    ] as [Event, string][]) {
      client.send(body); expect((await client.next()).error.code).toBe(code);
    }
    client.send({ type: "response.steer" });
    expect((await client.next()).error.code).toBe("invalid_input");
    expect(count).toBe(0);
    client.send(create()); expect((await client.next()).type).toBe("response.completed");
  });

  test("HTTP rate-limit status, errors and safe retry headers survive transport", async () => {
    const error = { type: "rate_limit_error", code: "rate_limit_exceeded", message: "fixture limit" };
    const f = await fixture({ dispatch: async () => Response.json({ error }, { status: 429, headers: { "retry-after": "12", "set-cookie": "never-forward" } }) });
    const client = await f.connect(); client.send(create({ stream_id: "rate" }));
    expect(await client.next()).toEqual({ type: "error", status: 429, stream_id: "rate", error, headers: { "retry-after": "12" } });
  });

  test.each(["response.failed", "response.incomplete", "error"])("preserves %s terminal events", async type => {
    const event = type === "error" ? { type, status: 400, error: { code: "original_error" } } : { type, response: { id: "resp_f", status: type.slice(9), error: { code: "original_error" } } };
    const f = await fixture({ dispatch: async () => sse(frame(event)) });
    const client = await f.connect(); client.send(create());
    expect(await client.next()).toEqual(event);
  });

  test.each([
    "data: [DONE]\n\n",
    "data: {broken}\n\n",
    'data: {"type":"response.created"}\n\n',
    'data: {"type":"response.completed"}',
    frame(completed()) + frame({ type: "response.output_text.delta", delta: "late" }),
  ])("reports incomplete/invalid SSE instead of accepting success: %s", async text => {
    const f = await fixture({ dispatch: async () => sse(text) });
    const client = await f.connect(); client.send(create());
    let event = await client.next();
    if (event.type === "response.created") event = await client.next();
    expect(event.type).toBe("error"); expect(event.error.code).toBe("websocket_upstream_error");
  });

  test("disconnect aborts only its own HTTP request and cancels its reader", async () => {
    const signals: AbortSignal[] = [], sources: ReadableStreamDefaultController<Uint8Array>[] = [];
    let cancelled = 0;
    const f = await fixture({ dispatch: async request => {
      signals.push(request.signal);
      return new Response(new ReadableStream({
        start(controller) { sources.push(controller); controller.enqueue(encoder.encode(frame({ type: "response.created" }))); },
        cancel() { cancelled++; },
      }), { headers: { "content-type": "text/event-stream" } });
    } });
    const one = await f.connect(), two = await f.connect();
    one.send(create()); await one.next(); two.send(create()); await two.next();
    const aborted = new Promise<void>(resolve => signals[0].addEventListener("abort", () => resolve(), { once: true }));
    one.socket.close(); await aborted;
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    expect(cancelled).toBe(1);
    sources[1].enqueue(encoder.encode(frame(completed("unrelated")))); sources[1].close();
    expect((await two.next()).response.id).toBe("unrelated");
  });

  test("disconnect before dispatch resolves cancels the eventual response body", async () => {
    const started = deferred<AbortSignal>(), response = deferred<Response>();
    let cancelled = false;
    const f = await fixture({ dispatch: async request => { started.resolve(request.signal); return response.promise; } });
    const client = await f.connect(); client.send(create()); const signal = await started.promise;
    const aborted = new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    client.socket.close(); await aborted;
    response.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await f.adapter.settled(); expect(cancelled).toBe(true);
  });

  test("draining rejects new work, permits active work to finish, and shutdown closes sockets", async () => {
    const started = deferred<void>(), result = deferred<Response>();
    const f = await fixture({ dispatch: async () => { started.resolve(); return result.promise; } });
    const client = await f.connect(); client.send(create()); await started.promise;
    f.adapter.setDraining(true);
    client.send(create()); expect((await client.next()).error.code).toBe("server_draining");
    result.resolve(sse(frame(completed()))); expect((await client.next()).type).toBe("response.completed");
    await f.adapter.settled(); expect(f.adapter.activeCount()).toBe(0);
    f.adapter.closeAll(); expect((await client.closed).code).toBe(1001);
    expect(f.adapter.connectionCount()).toBe(0);
  });

  test("bounds inbound payloads and upstream event size", async () => {
    let calls = 0;
    const f = await fixture({ limits: { maxMessageBytes: 256, maxEventBytes: 512 }, dispatch: async () => {
      calls++; return sse(frame({ type: "response.output_text.delta", delta: "x".repeat(1024) }));
    } });
    const oversized = await f.connect(); oversized.send(create({ input: "x".repeat(1024) }));
    await oversized.closed; expect(calls).toBe(0);
    const client = await f.connect(); client.send(create());
    expect((await client.next()).error.code).toBe("websocket_upstream_error");
    expect(calls).toBe(1);
  });

  test("shutdown aborts active dispatch, while resume permits work after a reversible drain", async () => {
    const started = deferred<AbortSignal>();
    const f = await fixture({ dispatch: async request => {
      started.resolve(request.signal);
      await new Promise<void>(resolve => request.signal.addEventListener("abort", () => resolve(), { once: true }));
      return new Response(null, { status: 499 });
    } });
    const client = await f.connect();
    f.adapter.setDraining(true); client.send(create());
    expect((await client.next()).error.code).toBe("server_draining");
    f.adapter.setDraining(false); client.send(create());
    const signal = await started.promise;
    expect(signal.aborted).toBe(false);
    f.adapter.closeAll(); await f.adapter.settled();
    expect(signal.aborted).toBe(true); expect(f.adapter.activeCount()).toBe(0);
  });

  test("connection limit rejects the extra socket without affecting the first", async () => {
    const f = await fixture({ limits: { maxConnections: 1 }, dispatch: async () => sse(frame(completed())) });
    const one = await f.connect(), two = await f.connect();
    expect((await two.closed).code).toBe(1013);
    one.send(create()); expect((await one.next()).type).toBe("response.completed");
    expect(f.adapter.connectionCount()).toBe(1);
  });

  test("unstructured HTTP failures and thrown dispatch errors do not leak private details", async () => {
    let calls = 0;
    const f = await fixture({ dispatch: async () => {
      if (++calls === 1) return new Response("<html>private-secret-fixture</html>", { status: 502 });
      throw new Error("private-secret-fixture");
    } });
    const client = await f.connect();
    for (let i = 0; i < 2; i++) {
      client.send(create()); const event = await client.next();
      expect(event.type).toBe("error"); expect(event.status).toBe(502);
      expect(JSON.stringify(event)).not.toContain("private-secret-fixture");
    }
    expect(calls).toBe(2);
  });

  test("rejects unexpected JSON success and bounds HTTP error bodies", async () => {
    let calls = 0, cancelled = false;
    const f = await fixture({ limits: { maxEventBytes: 512 }, dispatch: async () => {
      if (++calls === 1) return Response.json({ id: "cannot-fabricate-SSE", status: "completed" });
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode("x".repeat(1024))); },
        cancel() { cancelled = true; },
      }), { status: 400 });
    } });
    const client = await f.connect();
    for (let i = 0; i < 2; i++) {
      client.send(create()); expect((await client.next()).error.code).toBe("websocket_upstream_error");
    }
    expect(cancelled).toBe(true);
  });
});

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Fixture condition timed out");
    await Bun.sleep(1);
  }
}

async function controlled(options: Partial<ResponsesWebSocketOptions> = {}) {
  const requests: { body: Event; headers: Headers; signal: AbortSignal; options?: { prepareOnly?: boolean } }[] = [];
  const sources = new Map<number, ReadableStreamDefaultController<Uint8Array>>();
  const cancelled: number[] = [];
  const f = await fixture({ ...options, dispatch: async (request, operation) => {
    requests.push({ body: await request.json(), headers: request.headers, signal: request.signal, options: operation });
    const id = requests.length;
    return new Response(new ReadableStream({
      start(controller) {
        sources.set(id, controller);
        controller.enqueue(encoder.encode(frame({ type: "response.created", sequence_number: 0, response: { id: `resp_${id}`, status: "in_progress", output: [] } })));
      },
      cancel() { cancelled.push(id); sources.delete(id); },
    }), { headers: { "content-type": "text/event-stream" } });
  } });
  return { ...f, requests, cancelled,
    emit(id: number, event: Event) { sources.get(id)!.enqueue(encoder.encode(frame(event))); },
    finish(id: number, output: Event[] = [], extra: Event = {}) {
      const source = sources.get(id)!;
      source.enqueue(encoder.encode(frame({ ...completed(`resp_${id}`), sequence_number: 4, response: { id: `resp_${id}`, status: "completed", output }, ...extra })));
      source.close(); sources.delete(id);
    },
    end(id: number) { sources.get(id)!.close(); sources.delete(id); },
  };
}

describe("Responses WebSocket lanes", () => {
  test("distinct lanes run in parallel while each lane is FIFO, including the default lane", async () => {
    const f = await controlled(), client = await f.connect();
    client.send(create({ stream_id: "planner", input: "p1" }));
    client.send(create({ stream_id: "planner", input: "p2" }));
    client.send(create({ stream_id: "research", input: "r1" }));
    client.send(create({ input: "d1" })); client.send(create({ input: "d2" }));
    const starts = [await client.next(), await client.next(), await client.next()];
    expect(starts.map(event => event.stream_id)).toEqual(["planner", "research", undefined]);
    expect(f.requests.map(item => item.body.input)).toEqual(["p1", "r1", "d1"]);
    expect(f.adapter.activeCount()).toBe(5); expect(f.adapter.queuedCount()).toBe(2);
    f.finish(3); expect((await client.next()).stream_id).toBeUndefined();
    expect((await client.next()).stream_id).toBeUndefined();
    expect(f.requests[3].body.input).toBe("d2");
    f.finish(1); expect((await client.next()).response.id).toBe("resp_1");
    expect((await client.next()).stream_id).toBe("planner");
    expect(f.requests[4].body.input).toBe("p2");
  });

  test("sixteen responses run at once; the seventeenth waits for a completed slot", async () => {
    const f = await controlled(), client = await f.connect();
    for (let i = 0; i < 17; i++) client.send(create({ stream_id: `lane_${i}` }));
    for (let i = 0; i < 16; i++) expect((await client.next()).type).toBe("response.created");
    await until(() => f.adapter.queuedCount() === 1);
    expect(f.requests).toHaveLength(16);
    f.finish(4);
    expect((await client.next()).type).toBe("response.completed");
    expect((await client.next()).stream_id).toBe("lane_16");
    expect(f.requests).toHaveLength(17);
  });

  test("thirty-two named lanes remain reusable; default does not consume a named slot", async () => {
    const f = await fixture({ dispatch: async () => sse(frame(completed())) });
    const client = await f.connect();
    for (let i = 0; i < 32; i++) {
      client.send(create({ stream_id: `lane_${i}` })); expect((await client.next()).stream_id).toBe(`lane_${i}`);
    }
    client.send(create({ stream_id: "lane_32" }));
    const error = await client.next(); expect(error.error.code).toBe("websocket_stream_limit_reached"); expect(error.stream_id).toBe("lane_32");
    client.send(create()); expect((await client.next()).stream_id).toBeUndefined();
    client.send(create({ stream_id: "lane_0" })); expect((await client.next()).type).toBe("response.completed");
  });

  test("round-robin scheduling prevents a busy lane from starving already-ready lanes", async () => {
    const f = await controlled({ limits: { maxActiveResponses: 1 } }), client = await f.connect();
    client.send(create({ stream_id: "a", input: "a1" })); await client.next();
    for (const [lane, input] of [["a", "a2"], ["a", "a3"], ["b", "b1"], ["c", "c1"]]) client.send(create({ stream_id: lane, input }));
    await until(() => f.adapter.queuedCount() === 4);
    for (let id = 1; id <= 4; id++) { f.finish(id); await client.next(); expect((await client.next()).type).toBe("response.created"); }
    expect(f.requests.map(item => item.body.input)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
  });

  test.each(["count", "bytes"])("bounded %s admission rejects only the excess request and never replays it", async kind => {
    const f = await controlled({ limits: { maxActiveResponses: 1, maxQueuedRequests: 1, maxQueuedBytes: 256 } });
    const client = await f.connect(); client.send(create({ stream_id: "a" })); await client.next();
    if (kind === "count") client.send(create({ stream_id: "a", input: "kept" }));
    client.send(create({ stream_id: "b", input: kind === "bytes" ? "x".repeat(300) : "rejected" }));
    const error = await client.next(); expect(error.error.code).toBe("websocket_queue_full"); expect(error.stream_id).toBe("b");
    f.finish(1); await client.next();
    if (kind === "count") { await client.next(); expect(f.requests[1].body.input).toBe("kept"); f.finish(2); await client.next(); }
    await f.adapter.settled(); expect(f.requests).toHaveLength(kind === "count" ? 2 : 1);
    client.send(create({ stream_id: "b", input: "caller-new-request" })); await client.next();
    expect(f.requests.at(-1)!.body.input).toBe("caller-new-request");
  });

  test("terminal parsing alone does not release a lane before the upstream body settles", async () => {
    const f = await controlled(), client = await f.connect();
    client.send(create({ stream_id: "a" })); await client.next();
    f.emit(1, completed("resp_1"));
    client.send(create({ stream_id: "a" }));
    await until(() => f.adapter.queuedCount() === 1); expect(f.requests).toHaveLength(1);
    f.end(1); expect((await client.next()).type).toBe("response.completed");
    expect((await client.next()).response.id).toBe("resp_2");
  });

  test("drain rejects new admission but settled waits for every accepted queued request", async () => {
    const f = await controlled({ limits: { maxActiveResponses: 1 } }), client = await f.connect();
    client.send(create({ stream_id: "a" })); await client.next();
    client.send(create({ stream_id: "a" })); client.send(create({ stream_id: "b" }));
    await until(() => f.adapter.queuedCount() === 2);
    f.adapter.setDraining(true);
    let settled = false; const done = f.adapter.settled().then(() => { settled = true; });
    client.send(create({ stream_id: "c" })); expect((await client.next()).error.code).toBe("server_draining");
    for (let id = 1; id <= 3; id++) {
      expect(settled).toBe(false); f.finish(id); await client.next();
      if (id < 3) expect((await client.next()).type).toBe("response.created");
    }
    await done; expect(f.adapter.activeCount()).toBe(0);
  });

  test("disconnect cancels every owned active lane and discards queued work without touching another socket", async () => {
    const f = await controlled(), one = await f.connect(), two = await f.connect();
    one.send(create({ stream_id: "a" })); one.send(create({ stream_id: "b" })); await one.next(); await one.next();
    one.send(create({ stream_id: "a", input: "never-run" }));
    two.send(create({ stream_id: "a" })); await two.next();
    await until(() => f.adapter.queuedCount() === 1);
    one.socket.close(); await one.closed;
    await until(() => f.requests[0].signal.aborted && f.requests[1].signal.aborted);
    expect(f.requests[2].signal.aborted).toBe(false); expect(f.requests).toHaveLength(3);
    f.finish(3); expect((await two.next()).response.id).toBe("resp_3");
    await f.adapter.settled(); expect(f.adapter.queuedCount()).toBe(0);
  });

  test("forks preserve explicit settings and lineage; lane reuse never inherits previous request fields", async () => {
    const bodies: Event[] = [], headers: Headers[] = [];
    const f = await fixture({ dispatch: async request => {
      bodies.push(await request.json()); headers.push(request.headers); return sse(frame(completed(`fork_${bodies.length}`)));
    } });
    const client = await f.connect({ authorization: "Bearer fork-fixture", "chatgpt-account-id": "fixture-account" });
    const settings = { model: "original-selected-model", reasoning: { effort: "high" }, tools: [{ type: "function", name: "fixture" }],
      tool_choice: "required", parallel_tool_calls: false, instructions: "Keep instructions", metadata: { permission: "unchanged" }, store: false };
    for (const lane of ["parent", "fork"]) client.send(create({ ...settings, stream_id: lane, previous_response_id: "resp_parent", input: [{ role: "user", content: lane }] }));
    await client.next(); await client.next();
    for (let i = 0; i < 2; i++) {
      expect(bodies[i]).toEqual({ ...settings, previous_response_id: "resp_parent", input: [{ role: "user", content: i ? "fork" : "parent" }], stream: true });
      expect(headers[i].get("authorization")).toBe("Bearer fork-fixture"); expect(headers[i].get("chatgpt-account-id")).toBe("fixture-account");
    }
    client.send(create({ stream_id: "fork", input: "new-chain" })); await client.next();
    expect(bodies[2]).toEqual({ model: "exact-native-model", input: "new-chain", stream: true });
  });

  test("queued fork checks history at dispatch time, returns its lane miss, and permits explicit full-history recovery", async () => {
    const gate = deferred<Response>(), started = deferred<void>();
    const bodies: Event[] = []; let cached = true;
    const f = await fixture({ limits: { maxActiveResponses: 1 }, dispatch: async request => {
      const body = await request.json() as Event; bodies.push(body);
      if (bodies.length === 1) { started.resolve(); return gate.promise; }
      if (body.previous_response_id && !cached) return Response.json({ error: { code: "previous_response_not_found", param: "previous_response_id" } }, { status: 400 });
      return sse(frame(completed()));
    } });
    const client = await f.connect(); client.send(create({ stream_id: "source" })); await started.promise;
    client.send(create({ stream_id: "fork", previous_response_id: "parent", input: "increment" }));
    await until(() => f.adapter.queuedCount() === 1); cached = false; gate.resolve(sse(frame(completed())));
    await client.next(); const error = await client.next(); expect(error.stream_id).toBe("fork"); expect(error.error.code).toBe("previous_response_not_found");
    expect(bodies).toHaveLength(2);
    const input = [{ role: "user", content: "original history" }, { type: "function_call_output", call_id: "already-ran", output: "saved result" }];
    client.send(create({ stream_id: "fork", previous_response_id: null, input })); await client.next();
    expect(bodies[2].input).toEqual(input); expect(bodies[2].previous_response_id).toBeUndefined();
  });
});

describe("Responses WebSocket steering at natural completion", () => {
  const steer = (input: unknown, parent = "resp_1"): Event => ({ type: "response.steer", previous_response_id: parent, input });
  const validationOK = async () => ({ ok: true as const });
  const functionCall = { type: "function_call", call_id: "saved_call", name: "fixture", arguments: "{}" };
  const savedOutput = { type: "function_call_output", call_id: "saved_call", output: "already executed once" };

  test("natural completion creates one successor with original settings and stable server-issued user item IDs", async () => {
    const checks: Event[] = [];
    const f = await controlled({ validateSteer: async (request, target) => {
      checks.push({ body: await request.json(), target, authorization: request.headers.get("authorization") });
      return { ok: true };
    } });
    const client = await f.connect({ authorization: "Bearer steer-fixture", "x-codex-turn-id": "unchanged-turn" });
    const settings = { model: "original-model", reasoning: { effort: "high" }, tools: [{ type: "custom", name: "apply_patch" }],
      tool_choice: "auto", parallel_tool_calls: false, instructions: "Original instructions", text: { format: { type: "json_object" } },
      metadata: { task: "same-task", permission: "same-approval" }, store: false };
    client.send(create({ ...settings, stream_id: "main", input: "Original input" })); await client.next();
    f.emit(1, { type: "response.output_item.done", item: { type: "message", id: "completed_item", content: [] } }); await client.next();
    client.send(steer("Narrow the scope")); const accepted = await client.next();
    expect(accepted.type).toBe("response.steer.accepted"); expect(accepted.stream_id).toBe("main");
    expect(f.requests).toHaveLength(1); expect(f.requests[0].signal.aborted).toBe(false);
    expect(checks[0].body).toEqual({ ...settings, stream: true, previous_response_id: "resp_1", input: "Narrow the scope" });
    expect(checks[0].target.requestBody.input).toBe("Original input"); expect(checks[0].authorization).toBe("Bearer steer-fixture");
    f.finish(1, [{ type: "message", id: "completed_item", content: [] }]);
    const terminal = await client.next(), successor = await client.next();
    expect(terminal.type).toBe("response.completed"); expect(successor.response.id).toBe("resp_2");
    expect(terminal.sequence_number).toBeGreaterThan(accepted.sequence_number); expect(successor.sequence_number).toBeGreaterThan(terminal.sequence_number);
    expect(f.requests[1].body).toEqual({ ...settings, stream: true, previous_response_id: "resp_1", input: [
      { type: "message", role: "user", content: "Narrow the scope", id: `msg_${accepted.steer.id}_0` },
    ] });
    expect(f.requests[1].headers.get("x-codex-turn-id")).toBe("unchanged-turn");
    f.finish(2); await client.next(); await f.adapter.settled(); expect(f.requests).toHaveLength(2);
    client.send(steer("late")); expect((await client.next()).error.code).toBe("response_already_completed");
  });

  test("completion races asynchronous validation; acknowledgements and materialized input remain in submission order", async () => {
    const validations = [deferred<{ ok: true }>(), deferred<{ ok: true }>()]; let calls = 0;
    const f = await controlled({ validateSteer: async () => validations[calls++].promise }), client = await f.connect();
    client.send(create()); await client.next();
    const parts = [{ type: "message", role: "user", content: [{ type: "input_text", text: "second" }, { type: "input_image", image_url: "data:image/png;base64,AA==" }, { type: "input_file", file_id: "fixture_file" }] }];
    client.send(steer("first")); client.send(steer(parts)); await until(() => calls === 2);
    f.finish(1); validations[1].resolve({ ok: true }); await Bun.sleep(10); expect(f.requests).toHaveLength(1);
    validations[0].resolve({ ok: true });
    const first = await client.next(), second = await client.next();
    expect(first.type).toBe("response.steer.accepted"); expect(second.type).toBe("response.steer.accepted");
    expect((await client.next()).type).toBe("response.completed"); expect((await client.next()).type).toBe("response.created");
    expect(f.requests[1].body.input).toEqual([
      { type: "message", role: "user", content: "first", id: `msg_${first.steer.id}_0` },
      { ...parts[0], id: `msg_${second.steer.id}_0` },
    ]);
  });

  test("tool and approval boundaries keep input pending, then prepend it once without overriding explicit settings", async () => {
    const f = await controlled({ validateSteer: validationOK }), client = await f.connect();
    client.send(create({ stream_id: "main", metadata: { task: "original" } })); await client.next();
    client.send(steer("retain accepted input")); const accepted = await client.next();
    const output = [functionCall, { type: "custom_tool_call", call_id: "patch_call", name: "apply_patch", input: "patch" }, { type: "mcp_approval_request", id: "approval_1" }];
    f.finish(1, output); expect((await client.next()).type).toBe("response.completed");
    const pending = await client.next(); expect(pending.type).toBe("response.steer.pending"); expect(pending.steer.id).toBe(accepted.steer.id);
    expect(pending.required_input).toEqual([
      { type: "function_call_output", call_id: "saved_call", name: "fixture" },
      { type: "custom_tool_call_output", call_id: "patch_call" }, { type: "mcp_approval_response", approval_request_id: "approval_1" },
    ]);
    expect(f.requests).toHaveLength(1);
    client.send(create({ stream_id: "main", previous_response_id: "resp_1", input: [savedOutput] }));
    expect((await client.next()).error.code).toBe("steering_required_input_missing"); expect(f.requests).toHaveLength(1);
    const results = [savedOutput, { type: "custom_tool_call_output", call_id: "patch_call", output: "saved patch result" }, { type: "mcp_approval_response", approval_request_id: "approval_1", approve: false }, { role: "user", content: "explicit next input" }];
    const explicit = { model: "explicit-next-model", reasoning: { effort: "medium" }, tools: [], tool_choice: "none", instructions: "Explicit instructions", metadata: { task: "explicit-permissions" } };
    client.send(create({ ...explicit, stream_id: "main", previous_response_id: "resp_1", input: results })); await client.next();
    expect(f.requests[1].body).toEqual({ ...explicit, stream: true, previous_response_id: "resp_1", input: [
      { type: "message", role: "user", content: "retain accepted input", id: `msg_${accepted.steer.id}_0` }, ...results,
    ] });
    f.finish(2); await client.next();
    client.send(create({ stream_id: "main", previous_response_id: "resp_2", input: [] })); await client.next();
    expect(f.requests[2].body.input).toEqual([]);
  });

  test("an explicit tool-result create queued before completion claims accepted input at execution, once", async () => {
    const f = await controlled({ validateSteer: validationOK }), client = await f.connect();
    client.send(create({ stream_id: "main" })); await client.next();
    client.send(steer("queued-before-tool-result")); const accepted = await client.next();
    client.send(create({ stream_id: "main", previous_response_id: "resp_1", input: [savedOutput] }));
    await until(() => f.adapter.queuedCount() === 1); f.finish(1, [functionCall]);
    expect((await client.next()).type).toBe("response.completed"); expect((await client.next()).type).toBe("response.steer.pending");
    expect((await client.next()).response.id).toBe("resp_2");
    expect(f.requests[1].body.input[0].id).toBe(`msg_${accepted.steer.id}_0`); expect(f.requests[1].body.input[1]).toEqual(savedOutput);
  });

  test("a cross-lane fork never consumes another lane's queued steering", async () => {
    const f = await controlled({ validateSteer: validationOK }), client = await f.connect();
    client.send(create({ stream_id: "parent" })); await client.next();
    client.send(steer("parent only")); await client.next(); f.finish(1, [functionCall]); await client.next(); await client.next();
    client.send(create({ stream_id: "fork", previous_response_id: "resp_1", input: [savedOutput] })); await client.next();
    expect(f.requests[1].body.input).toEqual([savedOutput]);
    client.send(create({ stream_id: "parent", previous_response_id: "resp_1", input: [savedOutput] })); await client.next();
    expect(f.requests[2].body.input).toHaveLength(2); expect(f.requests[2].body.input[0].content).toBe("parent only");
  });

  test.each(["missing-validator", "shared-rejection", "prepare-only"])("%s cannot fake steering acceptance", async mode => {
    let checks = 0;
    const f = await controlled({ ...(mode !== "missing-validator" ? { validateSteer: async () => { checks++; return { ok: false as const, code: "steering_not_supported", message: "Explicit route restriction" }; } } : {}) });
    const client = await f.connect(); client.send(create({ ...(mode === "prepare-only" ? { generate: false } : {}), stream_id: "target" })); await client.next();
    client.send(steer("original failed echo")); const error = await client.next();
    expect(error.type).toBe("response.steer.failed"); expect(error.error.code).toBe("steering_not_supported"); expect(error.steer.id).toBeUndefined();
    expect(error.steer.input).toBe("original failed echo"); expect(error.stream_id).toBe("target");
    expect(checks).toBe(mode === "shared-rejection" ? 1 : 0); expect(f.requests).toHaveLength(1);
  });

  test("invalid roles, item IDs, control fields and client stream IDs fail before validation", async () => {
    let checks = 0;
    const f = await controlled({ validateSteer: async () => { checks++; return { ok: true }; } }), client = await f.connect();
    client.send(create({ stream_id: "target" })); await client.next();
    for (const event of [steer([]), steer([{ role: "system", content: "bad" }]), steer([{ role: "user", content: "bad", id: "caller-id" }]),
      steer([{ type: "function_call_output", call_id: "not-user", output: "bad" }]), { ...steer("bad"), stream_id: "other" }, { ...steer("bad"), model: "substitute" }]) {
      client.send(event); const error = await client.next(); expect(error.error.code).toBe("invalid_input"); expect(error.stream_id).toBe("target");
    }
    expect(checks).toBe(0); expect(f.requests).toHaveLength(1);
    client.send({ type: "response.cancel", previous_response_id: "resp_1" }); expect((await client.next()).error.code).toBe("unsupported_websocket_event");
    expect(f.requests[0].signal.aborted).toBe(false);
  });

  test("a response on a different connection cannot be steered", async () => {
    let checks = 0;
    const f = await controlled({ validateSteer: async () => { checks++; return { ok: true }; } }), one = await f.connect(), two = await f.connect();
    one.send(create()); await one.next(); two.send(steer("wrong socket"));
    expect((await two.next()).error.code).toBe("response_not_found"); expect(checks).toBe(0);
  });

  test("pending validation has a bounded deadline and does not cancel model work", async () => {
    let signal!: AbortSignal;
    const f = await controlled({ limits: { steerValidationTimeoutMs: 10 }, validateSteer: async request => { signal = request.signal; return new Promise(() => {}); } });
    const client = await f.connect(); client.send(create()); await client.next(); client.send(steer("timeout"));
    expect((await client.next()).type).toBe("response.steer.failed"); expect(signal.aborted).toBe(true); expect(f.requests[0].signal.aborted).toBe(false);
    f.finish(1); expect((await client.next()).type).toBe("response.completed"); await f.adapter.settled(); expect(f.requests).toHaveLength(1);
  });

  test("disconnect aborts pending validation and never starts a delayed successor", async () => {
    let signal!: AbortSignal;
    const validation = deferred<{ ok: true }>();
    const f = await controlled({ validateSteer: async request => { signal = request.signal; return validation.promise; } }), client = await f.connect();
    client.send(create()); await client.next(); client.send(steer("disconnect")); await until(() => Boolean(signal));
    client.socket.close(); await client.closed; await f.adapter.settled();
    validation.resolve({ ok: true }); await Bun.sleep(1); expect(signal.aborted).toBe(true); expect(f.requests).toHaveLength(1);
  });

  test("pending count and bytes are reserved before asynchronous validation", async () => {
    const validation = deferred<{ ok: true }>(); let checks = 0;
    const f = await controlled({ limits: { maxPendingSteers: 1, maxSteeringBytes: 32 }, validateSteer: async () => { checks++; return validation.promise; } }), client = await f.connect();
    client.send(create()); await client.next(); client.send(steer("x".repeat(40)));
    expect((await client.next()).error.code).toBe("too_many_pending_steers"); expect(checks).toBe(0);
    client.send(steer("first")); await until(() => checks === 1); client.send(steer("second"));
    expect((await client.next()).error.code).toBe("too_many_pending_steers");
    validation.resolve({ ok: true }); expect((await client.next()).type).toBe("response.steer.accepted");
  });

  test("failed parent returns original accepted input with its ID, without normalization or replay", async () => {
    const f = await controlled({ validateSteer: validationOK }), client = await f.connect();
    client.send(create()); await client.next(); const input = [{ role: "user", content: "unchanged echo" }];
    client.send(steer(input)); const accepted = await client.next();
    f.finish(1, [], { type: "response.failed", response: { id: "resp_1", status: "failed", error: { code: "fixture_failure" } } });
    expect((await client.next()).type).toBe("response.failed"); const failure = await client.next();
    expect(failure.type).toBe("response.steer.failed"); expect(failure.steer.id).toBe(accepted.steer.id); expect(failure.steer.input).toEqual(input);
    await f.adapter.settled(); expect(f.requests).toHaveLength(1);
  });

  test("automatic successor HTTP failure returns the original steer; response.created is the commit point", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>; const bodies: Event[] = [];
    const f = await fixture({ validateSteer: validationOK, dispatch: async request => {
      bodies.push(await request.json());
      if (bodies.length > 1) return Response.json({ error: { code: "previous_response_not_found" } }, { status: 400 });
      return new Response(new ReadableStream({ start(controller) { source = controller; controller.enqueue(encoder.encode(frame({ type: "response.created", response: { id: "resp_1" } }))); } }), { headers: { "content-type": "text/event-stream" } });
    } });
    const client = await f.connect(); client.send(create()); await client.next(); client.send(steer("return on cache miss")); const accepted = await client.next();
    source.enqueue(encoder.encode(frame(completed("resp_1")))); source.close();
    expect((await client.next()).type).toBe("response.completed"); expect((await client.next()).error.code).toBe("previous_response_not_found");
    const failure = await client.next(); expect(failure.error.code).toBe("successor_creation_failed"); expect(failure.steer.id).toBe(accepted.steer.id);
    expect(failure.steer.input).toBe("return on cache miss"); await f.adapter.settled(); expect(bodies).toHaveLength(2);
  });

  test("a full lane queue returns accepted input instead of silently dropping an automatic successor", async () => {
    const f = await controlled({ validateSteer: validationOK, limits: { maxQueuedRequests: 1 } }), client = await f.connect();
    client.send(create({ stream_id: "main" })); await client.next(); client.send(steer("queue cannot retain me")); const accepted = await client.next();
    client.send(create({ stream_id: "main", input: "explicit earlier admission" })); await until(() => f.adapter.queuedCount() === 1);
    f.finish(1); await client.next(); const failed = await client.next();
    expect(failed.error.code).toBe("successor_creation_failed"); expect(failed.steer.id).toBe(accepted.steer.id);
    expect(failed.steer.input).toBe("queue cannot retain me"); await client.next();
    expect(f.requests[1].body.input).toBe("explicit earlier admission"); expect(f.requests).toHaveLength(2);
  });

  test("response.created commits accepted input even if that successor later fails", async () => {
    const f = await controlled({ validateSteer: validationOK, limits: { maxPendingSteers: 1 } }), client = await f.connect();
    client.send(create()); await client.next(); client.send(steer("already committed")); await client.next();
    f.finish(1); await client.next(); await client.next();
    f.finish(2, [], { type: "response.failed", response: { id: "resp_2", status: "failed" } });
    expect((await client.next()).type).toBe("response.failed");
    client.send(create()); const created = await client.next();
    expect(created.type).toBe("response.created"); // No spurious failed echo for already committed input.
    client.send(steer("new submission after released budget", "resp_3"));
    expect((await client.next()).type).toBe("response.steer.accepted");
  });

  test("drain rejects validation still in progress, but already-accepted automatic continuation is drained", async () => {
    const validation = deferred<{ ok: true }>(); let calls = 0;
    const f = await controlled({ validateSteer: async () => ++calls === 1 ? { ok: true } : validation.promise }), client = await f.connect();
    client.send(create({ stream_id: "accepted" })); await client.next(); client.send(steer("accepted before drain")); await client.next();
    client.send(create({ stream_id: "validating" })); await client.next(); client.send(steer("not accepted yet", "resp_2"));
    await until(() => calls === 2); f.adapter.setDraining(true); validation.resolve({ ok: true });
    const failed = await client.next(); expect(failed.type).toBe("response.steer.failed"); expect(failed.error.code).toBe("response_not_active");
    f.finish(1); await client.next(); expect((await client.next()).type).toBe("response.created");
    expect(f.requests[2].body.input[0].content).toBe("accepted before drain");
    f.finish(2); await client.next(); f.finish(3); await client.next(); await f.adapter.settled(); expect(f.adapter.activeCount()).toBe(0);
  });

  test("unrecognized output boundaries return accepted input instead of guessing tool completion", async () => {
    const f = await controlled({ validateSteer: validationOK }), client = await f.connect();
    client.send(create()); await client.next(); client.send(steer("cannot assume external work finished")); const accepted = await client.next();
    f.finish(1, [{ type: "future_tool_call", call_id: "unknown" }]); await client.next();
    const failed = await client.next(); expect(failed.type).toBe("response.steer.failed"); expect(failed.steer.id).toBe(accepted.steer.id);
    expect(f.requests).toHaveLength(1);
  });
});

describe("Responses WebSocket bounded backpressure", () => {
  function synthetic(options: Partial<ResponsesWebSocketOptions> = {}, sendResult = -1) {
    const frames: Event[] = [], closed: number[] = [];
    const adapter = createResponsesWebSocketAdapter({ dispatch: async () => sse(frame(completed())), ...options });
    const ws = {
      data: adapter.createData(new Request("http://localhost/v1/responses")),
      send(text: string) { frames.push(JSON.parse(text)); return sendResult; },
      getBufferedAmount() { return 0; },
      close(code: number) { closed.push(code); },
    } as unknown as ServerWebSocket<ResponsesWebSocketData>;
    adapter.websocket.open!(ws);
    cleanups.push(async () => { adapter.closeAll(); await adapter.settled(); });
    return { adapter, ws, frames, closed, receive(event: Event) { adapter.websocket.message(ws, JSON.stringify(event)); } };
  }

  test("send(-1) pauses upstream and drain never resends the buffered frame", async () => {
    const f = synthetic({ dispatch: async () => sse(frame({ type: "response.created" }) + frame(completed())) });
    f.receive(create());
    await Bun.sleep(10);
    expect(f.frames.map(e => e.type)).toEqual(["response.created"]);
    f.adapter.websocket.drain!(f.ws);
    await Bun.sleep(10);
    expect(f.frames.map(e => e.type)).toEqual(["response.created", "response.completed"]);
    f.adapter.websocket.drain!(f.ws);
    await f.adapter.settled(); expect(f.closed).toEqual([]);
  });

  test("a backpressured terminal holds its lane and queued work resumes fairly without duplicated frames", async () => {
    const inputs: unknown[] = [];
    const f = synthetic({ dispatch: async request => { inputs.push((await request.json()).input); return sse(frame(completed(String(inputs.length)))); } });
    f.receive(create({ stream_id: "a", input: "a1" })); await until(() => f.frames.length === 1);
    f.receive(create({ stream_id: "a", input: "a2" })); f.receive(create({ stream_id: "b", input: "b1" }));
    expect(inputs).toEqual(["a1"]); expect(f.adapter.queuedCount()).toBe(2);
    f.adapter.websocket.drain!(f.ws); await until(() => f.frames.length === 2);
    // Once a1 drains, both lanes may run within the parallel cap. Their output
    // still shares one bounded socket queue, so b1's buffered frame precedes a2.
    await until(() => inputs.length === 3); expect(inputs).toEqual(["a1", "b1", "a2"]);
    f.adapter.websocket.drain!(f.ws); await until(() => f.frames.length === 3);
    expect(inputs).toEqual(["a1", "b1", "a2"]);
    f.adapter.websocket.drain!(f.ws); await f.adapter.settled();
    expect(f.frames.map(event => event.stream_id)).toEqual(["a", "b", "a"]); expect(f.closed).toEqual([]);
  });

  test("accepted steering and terminal backpressure settle in order before automatic continuation", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>; let calls = 0;
    const f = synthetic({ validateSteer: async () => ({ ok: true }), dispatch: async () => {
      calls++;
      if (calls > 1) return sse(frame({ type: "response.created", response: { id: "resp_2" } }) + frame(completed("resp_2")));
      return new Response(new ReadableStream({ start(controller) { source = controller; controller.enqueue(encoder.encode(frame({ type: "response.created", response: { id: "resp_1" } }))); } }), { headers: { "content-type": "text/event-stream" } });
    } });
    f.receive(create()); await until(() => f.frames.length === 1);
    f.receive({ type: "response.steer", previous_response_id: "resp_1", input: "queued steering" });
    await until(() => f.ws.data.pending.length === 1);
    source.enqueue(encoder.encode(frame(completed("resp_1")))); source.close();
    f.adapter.websocket.drain!(f.ws); await until(() => f.frames.length === 2);
    expect(f.frames[1].type).toBe("response.steer.accepted"); expect(calls).toBe(1);
    f.adapter.websocket.drain!(f.ws); await until(() => f.frames.length === 3);
    expect(f.frames[2].type).toBe("response.completed"); expect(calls).toBe(1);
    f.adapter.websocket.drain!(f.ws); await until(() => f.frames.length === 4);
    expect(f.frames[3].response.id).toBe("resp_2"); expect(calls).toBe(2);
    f.adapter.websocket.drain!(f.ws); await until(() => f.frames.length === 5);
    f.adapter.websocket.drain!(f.ws); await f.adapter.settled(); expect(f.closed).toEqual([]);
  });

  test("backpressure timeout aborts all active owned lanes and discards their queued successors", async () => {
    const signals: AbortSignal[] = [];
    const f = synthetic({ limits: { backpressureTimeoutMs: 25 }, dispatch: async request => {
      signals.push(request.signal); return sse(frame({ type: "response.created", response: { id: `resp_${signals.length}` } }) + frame(completed()));
    } });
    f.receive(create({ stream_id: "a" })); f.receive(create({ stream_id: "b" })); f.receive(create({ stream_id: "a" }));
    await f.adapter.settled(); expect(signals).toHaveLength(2); expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(f.closed).toEqual([1013]); expect(f.adapter.queuedCount()).toBe(0);
  });

  test("bounds queued error frames while a socket is blocked", () => {
    const f = synthetic({ limits: { maxPendingFrames: 2 } });
    for (let i = 0; i < 4; i++) f.receive({ type: "unsupported" });
    expect(f.frames).toHaveLength(1); expect(f.closed).toEqual([1013]);
    expect(f.ws.data.pending).toHaveLength(0);
  });

  test("backpressure timeout closes and aborts its owned generation", async () => {
    let signal!: AbortSignal;
    const f = synthetic({ limits: { backpressureTimeoutMs: 10 }, dispatch: async request => {
      signal = request.signal; return sse(frame({ type: "response.created" }) + frame(completed()));
    } });
    f.receive(create()); await f.adapter.settled();
    expect(f.closed).toEqual([1013]); expect(signal.aborted).toBe(true);
  });

  test("send(0) fails without retrying a dropped event", async () => {
    const f = synthetic({}, 0); f.receive(create()); await f.adapter.settled();
    expect(f.frames).toHaveLength(1); expect(f.closed).toEqual([1011]);
  });

  test("rejects an outbound frame over the byte budget before sending", () => {
    const f = synthetic({ limits: { maxBufferedBytes: 128 } });
    f.receive({ type: "unsupported" });
    expect(f.frames).toHaveLength(0); expect(f.closed).toEqual([1013]);
  });

  test("initial headers are snapshotted and handshake headers are stripped", () => {
    const adapter = createResponsesWebSocketAdapter({ dispatch: async () => sse(frame(completed())) });
    const request = new Request("http://localhost/v1/responses", { headers: {
      authorization: "Bearer original-fixture", connection: "upgrade, x-hop", "x-hop": "remove",
      upgrade: "websocket", "sec-websocket-key": "remove", "content-length": "0", "content-encoding": "gzip",
    } });
    const data = adapter.createData(request);
    request.headers.set("authorization", "Bearer later-mutation");
    const headers = Object.fromEntries(data.headers);
    expect(headers.authorization).toBe("Bearer original-fixture");
    expect(headers["x-hop"]).toBeUndefined(); expect(headers["content-length"]).toBeUndefined();
    expect(headers["content-encoding"]).toBeUndefined(); expect(headers["sec-websocket-key"]).toBeUndefined();
  });
});
