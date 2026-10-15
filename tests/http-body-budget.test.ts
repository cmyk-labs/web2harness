import { expect, test } from "bun:test";
import { constants, zstdCompressSync } from "node:zlib";
import { HttpBodyBudget, HttpBodyError } from "../src/http-body-budget";
import { HTTP_BODY_READER_BYTES, readJsonRequestBody, readReservedJsonRequestBody } from "../src/http-body";

function streamed(bytes: Uint8Array, chunkSize = 127, headers: HeadersInit = {}, signal?: AbortSignal) {
  let offset = 0, pulls = 0, cancelled = false;
  const request = new Request("http://body-fixture/v1/responses", {
    method: "POST", headers, signal,
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (offset === bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset = Math.min(bytes.length, offset + chunkSize);
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }),
  });
  return { request, stats: () => ({ pulls, cancelled, offset }) };
}

const bytes = (text: string) => new TextEncoder().encode(text);
const budget = (extra = 64 * 1024) => new HttpBodyBudget(HTTP_BODY_READER_BYTES + extra);

test("ref-counted reservations are atomic, idempotent and independent across services", () => {
  const a = new HttpBodyBudget(100), b = new HttpBodyBudget(100);
  const lease = a.reserve(60);
  const releaseExecution = lease.retain();
  expect(() => lease.grow(41)).toThrow(HttpBodyError);
  expect(a.snapshot().reservedBytes).toBe(60);
  lease.grow(40);
  lease.shrink(10);
  lease.release(); lease.release();
  expect(a.snapshot().reservedBytes).toBe(90);
  expect(b.snapshot().reservedBytes).toBe(0);
  releaseExecution(); releaseExecution();
  expect(a.snapshot()).toMatchObject({ reservedBytes: 0, reservations: 0, peakReservedBytes: 100 });
});

test("declared size and aggregate overload reject before the first read and cancel producers", async () => {
  for (const [headers, pool, status] of [
    [{ "content-length": "67108865" }, budget(), 413],
    [{}, new HttpBodyBudget(HTTP_BODY_READER_BYTES - 1), 503],
    [{ "content-length": "-1" }, budget(), 400],
    [{ "content-encoding": "br" }, budget(), 400],
  ] as const) {
    const input = streamed(bytes("{}"), 1, headers);
    await expect(readReservedJsonRequestBody(input.request, { budget: pool })).rejects.toMatchObject({ status });
    expect(input.stats()).toMatchObject({ pulls: 0, cancelled: true });
    expect(pool.snapshot().reservedBytes).toBe(0);
  }
});

test("unknown or false content lengths cannot bypass incremental encoded limits", async () => {
  for (const headers of [{}, { "content-length": "2" }] as HeadersInit[]) {
    const pool = budget();
    const input = streamed(bytes('"' + "x".repeat(10000) + '"'), 128, headers);
    await expect(readReservedJsonRequestBody(input.request, { budget: pool, maxEncodedBytes: 256 })).rejects.toMatchObject({ status: 413 });
    expect(input.stats()).toMatchObject({ cancelled: true, offset: 384 });
    expect(pool.snapshot().reservedBytes).toBe(0);
  }
  const input = streamed(bytes("{}"), 1, { "content-length": "3" });
  await expect(readJsonRequestBody(input.request)).rejects.toThrow("Content-Length does not match");
});

test("split UTF-8, escaped quotes, duplicate keys and __proto__ retain JSON.parse semantics", async () => {
  const text = '{"emoji":"😀中文", "escape":"\\\"[,\\\\", "a":1, "a":2, "__proto__":{"safe":true}}';
  const pool = budget();
  const input = streamed(bytes(text), 1);
  const result = await readReservedJsonRequestBody(input.request, { budget: pool, retainEncoded: true });
  expect(result.value).toEqual(JSON.parse(text));
  expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
  expect(await result.replay(input.request).text()).toBe(text);
  const before = pool.snapshot().reservedBytes;
  result.discardEncoded(); result.discardEncoded();
  expect(pool.snapshot().reservedBytes).toBeLessThan(before);
  expect(pool.snapshot().reservations).toBe(1);
  result.reservation.release();
  expect(pool.snapshot().reservedBytes).toBe(0);
});

test("dense JSON allocation is budgeted before parsing and malformed input leaks nothing", async () => {
  const pool = budget(4096);
  const dense = streamed(bytes("[" + "0,".repeat(2000) + "0]"), 32);
  await expect(readReservedJsonRequestBody(dense.request, { budget: pool })).rejects.toMatchObject({ status: 503 });
  expect(dense.stats().offset).toBeLessThan(1000);
  expect(dense.stats().cancelled).toBe(true);
  for (const malformed of [bytes('{"a":'), new Uint8Array([34, 0xff, 34]), bytes('"\\uZZZZ"')]) {
    await expect(readReservedJsonRequestBody(streamed(malformed).request, { budget: pool })).rejects.toThrow();
    expect(pool.snapshot().reservedBytes).toBe(0);
  }
  await expect(readReservedJsonRequestBody(streamed(bytes("[".repeat(513))).request, { budget: pool })).rejects.toThrow();
});

test("abort releases a stalled reader without waiting on an uncooperative producer cancel", async () => {
  const pool = budget();
  const abort = new AbortController();
  let pulled!: () => void, cancelled = false;
  const pulling = new Promise<void>(resolve => { pulled = resolve; });
  const request = new Request("http://body-fixture/", { method: "POST", signal: abort.signal,
    body: new ReadableStream({ pull() { pulled(); }, cancel() { cancelled = true; return new Promise(() => {}); } }, { highWaterMark: 0 }),
  });
  const result = readReservedJsonRequestBody(request, { budget: pool });
  await pulling;
  expect(pool.snapshot().reservations).toBe(1);
  abort.abort();
  await expect(result).rejects.toMatchObject({ status: 499 });
  expect(cancelled).toBe(true);
  expect(pool.snapshot().reservedBytes).toBe(0);
});

test("50 small pending bodies share one budget without an agent/concurrency cap", async () => {
  const pool = new HttpBodyBudget(32 * 1024 * 1024);
  const held = await Promise.all(Array.from({ length: 50 }, () => readReservedJsonRequestBody(streamed(bytes('{"input":"small"}')).request, { budget: pool })));
  expect(pool.snapshot().reservations).toBe(50);
  expect(pool.snapshot().reservedBytes).toBeLessThan(pool.limit);
  for (const body of held) body.reservation.release();
  expect(pool.snapshot().reservedBytes).toBe(0);
});

test("50 concurrent large inputs overload within the shared cap and recover", async () => {
  const pool = new HttpBodyBudget(8 * 1024 * 1024);
  const payload = bytes('"' + "x".repeat(256 * 1024) + '"');
  const inputs = Array.from({ length: 50 }, () => streamed(payload, 4096));
  const results = await Promise.allSettled(inputs.map(input => readReservedJsonRequestBody(input.request, { budget: pool })));
  const rejected = results.filter(result => result.status === "rejected");
  expect(rejected.length).toBeGreaterThan(0);
  for (const result of rejected) expect((result as PromiseRejectedResult).reason.status).toBe(503);
  expect(pool.snapshot().peakReservedBytes).toBeLessThanOrEqual(pool.limit);
  for (const result of results) if (result.status === "fulfilled") result.value.reservation.release();
  expect(pool.snapshot()).toMatchObject({ reservations: 0, reservedBytes: 0 });
  expect(await readJsonRequestBody(streamed(bytes("{}")).request, { budget: pool })).toEqual({});
});

test("streaming zstd preserves compressed replay across frame/header/UTF-8 boundaries", async () => {
  const encoded = Buffer.concat([
    Bun.zstdCompressSync(bytes('{"text":"😀')),
    // A legal skippable frame between two ordinary frames.
    Buffer.from([0x50, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3]),
    Bun.zstdCompressSync(bytes('中文"}')),
  ]);
  const pool = budget();
  const input = streamed(encoded, 1, { "content-encoding": "zstd" });
  const result = await readReservedJsonRequestBody(input.request, { budget: pool, retainEncoded: true });
  expect(result.value).toEqual({ text: "😀中文" });
  expect(Buffer.from(await result.replay(input.request).arrayBuffer())).toEqual(encoded);
  result.reservation.release();
  expect(pool.snapshot().reservedBytes).toBe(0);
});

test("zstd bombs without advertised size stop during decoding; concatenated frames share output cap", async () => {
  const encoded = zstdCompressSync(bytes('"' + "x".repeat(512 * 1024) + '"'), {
    params: { [constants.ZSTD_c_contentSizeFlag]: 0, [constants.ZSTD_c_windowLog]: 10 },
  });
  const pool = budget(1024 * 1024);
  await expect(readReservedJsonRequestBody(streamed(encoded, 1, { "content-encoding": "zstd" }).request,
    { budget: pool, maxDecodedBytes: 8192 })).rejects.toMatchObject({ status: 413 });
  expect(pool.snapshot().reservedBytes).toBe(0);
  const frames = Buffer.concat(Array.from({ length: 5 }, () => Bun.zstdCompressSync(bytes(" ".repeat(2048)))));
  await expect(readReservedJsonRequestBody(streamed(frames, 16, { "content-encoding": "zstd" }).request,
    { budget: pool, maxDecodedBytes: 8192 })).rejects.toMatchObject({ status: 413 });
  expect(pool.snapshot().reservedBytes).toBe(0);
});

test("oversized zstd windows are rejected before allocation; truncated/corrupt streams release", async () => {
  const pool = budget();
  // No content-size field; the window descriptor advertises 1 GiB.
  const hugeWindow = streamed(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 160, 1, 0, 0]), 1, { "content-encoding": "zstd" });
  await expect(readReservedJsonRequestBody(hugeWindow.request, { budget: pool })).rejects.toMatchObject({ status: 413 });
  expect(hugeWindow.stats().offset).toBeLessThan(9);
  const valid = Bun.zstdCompressSync(bytes('{"x":1}'));
  for (const encoded of [valid.subarray(0, valid.length - 1), new Uint8Array([1, 2, 3, 4, 5])]) {
    await expect(readReservedJsonRequestBody(streamed(encoded, 1, { "content-encoding": "zstd" }).request, { budget: pool })).rejects.toThrow();
    expect(pool.snapshot().reservedBytes).toBe(0);
  }
});

test("a transport error or abort during zstd input destroys the decoder and releases its window", async () => {
  for (const cancel of [false, true]) {
    const pool = budget(1024 * 1024);
    const abort = new AbortController();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const request = new Request("http://body-fixture/", { method: "POST", signal: abort.signal, headers: { "content-encoding": "zstd" },
      body: new ReadableStream<Uint8Array>({ start(c) { source = c; } }),
    });
    const result = readReservedJsonRequestBody(request, { budget: pool });
    source.enqueue(Bun.zstdCompressSync(bytes('"' + "x".repeat(8192) + '"')).subarray(0, 7));
    await Bun.sleep(5);
    if (cancel) abort.abort(); else source.error(new Error("transport fixture failure"));
    await expect(result).rejects.toThrow();
    expect(pool.snapshot()).toMatchObject({ reservedBytes: 0, reservations: 0 });
  }
});
