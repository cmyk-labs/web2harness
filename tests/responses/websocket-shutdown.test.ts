import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { mock } from "node:test";
import { createResponsesWebSocketAdapter, type ResponsesWebSocketData } from "../../src/responses/websocket";

afterEach(() => mock.timers.reset());
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function tick(ms = 0) {
  mock.timers.tick(ms);
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function fixture() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const requests: { request: Request; response: ReturnType<typeof deferred<Response>> }[] = [];
  const adapter = createResponsesWebSocketAdapter({ dispatch(request) {
    const response = deferred<Response>(); requests.push({ request, response }); return response.promise;
  } });
  function connect() {
    const ws = {
      data: adapter.createData(new Request("http://localhost/v1/responses")),
      send() { return 1; }, getBufferedAmount() { return 0; }, close() {},
    } as unknown as ServerWebSocket<ResponsesWebSocketData>;
    adapter.websocket.open!(ws);
    adapter.websocket.message(ws, JSON.stringify({ type: "response.create", model: "exact-fixture-model", reasoning: { effort: "xhigh" }, input: [] }));
    return ws;
  }
  return { adapter, requests, connect };
}

test("shutdown cancels all connections concurrently and awaits cleanup beyond five seconds", async () => {
  const f = fixture(); f.connect(); f.connect();
  const cancelled: number[] = [];
  const releases = [deferred(), deferred()];
  for (let i = 0; i < 2; i++) f.requests[i]!.response.resolve(new Response(new ReadableStream({
    cancel() { cancelled.push(i); return releases[i]!.promise; },
  }), { headers: { "content-type": "text/event-stream" } }));
  await tick();
  f.adapter.closeAll();
  let done = false;
  const result = f.adapter.settled().then(() => { done = true; });
  expect(f.requests.every(entry => entry.request.signal.aborted)).toBe(true);
  expect(cancelled).toEqual([0, 1]);
  await tick(12_000); releases[0]!.resolve(); await tick();
  expect(done).toBe(false); expect(f.adapter.activeCount()).toBe(1);
  await tick(16_000); expect(done).toBe(false);
  releases[1]!.resolve(); await result;
  expect(f.adapter.activeCount()).toBe(0);
});

test("staggered connection deadlines cannot clip each other or silently drop timed-out dispatch ownership", async () => {
  const f = fixture(), first = f.connect(); f.connect();
  f.adapter.websocket.close!(first, 1000, "fixture disconnect");
  await tick(10_000);
  expect(f.requests[0]!.request.signal.aborted).toBe(true);
  expect(f.requests[1]!.request.signal.aborted).toBe(false);
  f.adapter.closeAll();
  let done = false;
  const result = f.adapter.settled().then(() => ({ error: undefined }), error => ({ error })).finally(() => { done = true; });
  await tick(20_000); // first connection timed out, second still owns ten seconds
  expect(done).toBe(false); expect(f.adapter.activeCount()).toBe(2);
  let cancelled = 0;
  await tick(9_999);
  f.requests[1]!.response.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await tick();
  expect((await result).error).toBeInstanceOf(AggregateError);
  expect((await result).error.message).toContain("30000 ms");
  expect(cancelled).toBe(1); expect(f.adapter.activeCount()).toBe(1);
  // A late dispatcher result still has its body cancelled and releases real ownership.
  f.requests[0]!.response.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await tick();
  expect(cancelled).toBe(2); expect(f.adapter.activeCount()).toBe(0);
});

test("failed reader cancellation propagates after other connection cleanup settles", async () => {
  const f = fixture(); f.connect(); f.connect();
  const other = deferred();
  f.requests[0]!.response.resolve(new Response(new ReadableStream({ cancel() { throw new Error("fixture cleanup failure"); } }), {
    headers: { "content-type": "text/event-stream" },
  }));
  f.requests[1]!.response.resolve(new Response(new ReadableStream({ cancel() { return other.promise; } }), {
    headers: { "content-type": "text/event-stream" },
  }));
  await tick(); f.adapter.closeAll();
  let done = false;
  const result = f.adapter.settled().then(() => ({ error: undefined }), error => ({ error })).finally(() => { done = true; });
  await tick(6_000); expect(done).toBe(false);
  other.resolve(); await tick();
  const failure = (await result).error;
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors[0].errors[0].message).toBe("fixture cleanup failure");
  expect(f.adapter.activeCount()).toBe(0);
});
