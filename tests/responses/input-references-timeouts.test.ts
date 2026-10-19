import { afterEach, expect, test } from "bun:test";
import { mock } from "node:test";
import { EventEmitter } from "node:events";
import type { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import type { request, RequestOptions } from "node:https";
import { createPublicHttpsTransport } from "../../src/responses/input-reference-network";
import { resolveInputReferences } from "../../src/responses/input-references";

afterEach(() => mock.timers.reset());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function tick(ms = 0) {
  mock.timers.tick(ms);
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
const scope = { taskId: "timeout-fixture", providerId: "chatgpt-web", accountId: "fixture" };
const urls = ["https://cdn.attachments.org/a.txt", "https://files.attachments.org/b.txt", "https://cdn.attachments.org/redirect.txt"];
function fixture() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const dns: ReturnType<typeof deferred<Array<{ address: string; family: number }>>>[] = [];
  const requests: { options: RequestOptions; headers(response: IncomingMessage): void; destroyed: number }[] = [];
  const transport = createPublicHttpsTransport({
    lookup: (() => { const result = deferred<Array<{ address: string; family: number }>>(); dns.push(result); return result.promise; }) as unknown as typeof lookup,
    request: ((options: RequestOptions, headers: (response: IncomingMessage) => void) => {
      const entry = { options, headers, destroyed: 0 }; requests.push(entry);
      return Object.assign(new EventEmitter(), { end() {}, destroy() { entry.destroyed++; } });
    }) as typeof request,
  });
  const controller = new AbortController();
  const options = { scope, authorization: { scope, urls }, signal: controller.signal, transport, reserveBytes() {} };
  function start(count = 1) {
    const content: Record<string, unknown>[] = urls.slice(0, count).map(file_url => ({ type: "input_file", file_url }));
    const promise = resolveInputReferences({ input: [{ role: "user", content }] }, options);
    const result = promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    return result;
  }
  function respond(index: number, statusCode = 200) {
    const chunk = deferred<Buffer>();
    const response = {
      statusCode, headers: statusCode === 200 ? { "content-type": "text/plain" } : { location: urls[2] }, destroyed: 0,
      destroy() { this.destroyed++; },
      async *[Symbol.asyncIterator]() { yield await chunk.promise; },
    };
    requests[index]!.headers(response as unknown as IncomingMessage);
    return { response, chunk };
  }
  return { dns, requests, controller, start, respond, resolveDns(index: number) { dns[index]!.resolve([{ address: "8.8.8.8", family: 4 }]); } };
}

test("files and redirects each receive independent DNS 30s, headers 60s and body 120s", async () => {
  const f = fixture(), result = f.start(2);
  for (let hop = 0; hop < 3; hop++) {
    expect(f.dns).toHaveLength(hop + 1);
    await tick(29_000); f.resolveDns(hop); await tick();
    expect(f.requests).toHaveLength(hop + 1);
    await tick(59_000);
    const download = f.respond(hop, hop === 0 ? 302 : 200); await tick();
    if (hop > 0) { await tick(119_000); download.chunk.resolve(Buffer.from("fixture")); await tick(); }
    expect(download.response.destroyed).toBe(1);
    expect(f.requests[hop]!.destroyed).toBe(1);
  }
  const outcome = await result;
  expect(outcome.error).toBeUndefined();
  expect(outcome.value!.input[0]!.content).toEqual([
    { type: "input_file", filename: "redirect.txt", file_data: "data:text/plain;base64,Zml4dHVyZQ==" },
    { type: "input_file", filename: "b.txt", file_data: "data:text/plain;base64,Zml4dHVyZQ==" },
  ]);
  await tick(120_000);
  expect(f.controller.signal.aborted).toBe(false);
});

test("DNS deadline stops waiting at 30s and late resolution cannot create a socket", async () => {
  const f = fixture(), result = f.start();
  await tick(30_000);
  expect((await result).error).toMatchObject({ code: "attachment_timeout", status: 408 });
  f.resolveDns(0); await tick();
  expect(f.requests).toHaveLength(0);
});

test("headers get 60s after DNS and timeout destroys the request and a late response", async () => {
  const f = fixture(), result = f.start();
  await tick(29_000); f.resolveDns(0); await tick();
  let settled = false; void result.then(() => { settled = true; });
  await tick(59_999); expect(settled).toBe(false);
  await tick(1);
  expect((await result).error).toMatchObject({ code: "attachment_timeout" });
  expect(f.requests[0]!.destroyed).toBe(1);
  const late = f.respond(0); expect(late.response.destroyed).toBe(1);
});

test("a file body has 120s total after headers, not a resettable per-chunk allowance", async () => {
  const f = fixture(), result = f.start();
  f.resolveDns(0); await tick();
  await tick(59_000);
  const firstChunk = deferred<Buffer>();
  const stalled = deferred<void>();
  let destroyed = 0;
  f.requests[0]!.headers({ statusCode: 200, headers: { "content-type": "text/plain" },
    destroy() { destroyed++; }, async *[Symbol.asyncIterator]() { yield await firstChunk.promise; await stalled.promise; },
  } as unknown as IncomingMessage);
  await tick();
  let settled = false; void result.then(() => { settled = true; });
  await tick(60_000); firstChunk.resolve(Buffer.from("partial")); await tick();
  await tick(59_999); expect(settled).toBe(false);
  await tick(1);
  expect((await result).error).toMatchObject({ code: "attachment_timeout" });
  expect(destroyed).toBe(1); expect(f.requests[0]!.destroyed).toBe(1);
  stalled.resolve(); await tick();
});

test("caller cancellation during headers releases transport without consuming its deadline", async () => {
  const f = fixture(), result = f.start();
  f.resolveDns(0); await tick();
  f.controller.abort(); await tick();
  expect((await result).error).toMatchObject({ code: "attachment_cancelled", status: 499 });
  expect(f.requests[0]!.destroyed).toBe(1);
  expect(f.respond(0).response.destroyed).toBe(1);
});
