import { expect, test } from "bun:test";
import type { ProviderAdapter } from "../../src/adapters/base";
import { defaultConfig } from "../../src/config";
import { HTTP_BODY_READER_BYTES } from "../../src/http-body";
import { HttpBodyBudget } from "../../src/http-body-budget";
import { compactRequest, responseRequest, startServer } from "../../src/server";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!check() && performance.now() < deadline) await Bun.sleep(2);
  expect(check()).toBe(true);
}

function request(stream = true, signal?: AbortSignal, zstd = false, input = "fixture") {
  const text = JSON.stringify({ model: "chatgpt-web/high", stream, input: [{ type: "message", id: "msg_body_fixture", role: "user", content: [{ type: "input_text", text: input }] }] });
  return new Request("http://body-fixture/v1/responses", { method: "POST", signal,
    headers: zstd ? { "content-encoding": "zstd" } : {},
    body: zstd ? new Uint8Array(Bun.zstdCompressSync(new TextEncoder().encode(text))) : text,
  });
}

const complete = (): ProviderAdapter => ({ name: "body-budget-fixture", async runTurn(_parsed, _incoming, emit) {
  emit({ type: "text_delta", text: "fixture summary", phase: "final_answer" });
  emit({ type: "done", stopReason: "stop", endTurn: true });
} });

test("Responses and compact reject admission before pulling when the shared budget is full", async () => {
  const config = defaultConfig("browser-only");
  const bodyBudget = new HttpBodyBudget(HTTP_BODY_READER_BYTES);
  const occupied = bodyBudget.reserve(bodyBudget.limit);
  let pulls = 0, cancellations = 0, runs = 0;
  for (const handler of [responseRequest, compactRequest]) {
    const req = new Request("http://body-fixture/", { method: "POST", body: new ReadableStream({
      pull() { pulls++; }, cancel() { cancellations++; },
    }, { highWaterMark: 0 }) });
    const response = await handler(req, config, () => { runs++; return complete(); }, { bodyBudget });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect((await response.json()).error).toMatchObject({ code: "request_body_overloaded", retryable: true });
  }
  expect([pulls, cancellations, runs]).toEqual([0, 2, 0]);
  expect(bodyBudget.snapshot().reservations).toBe(1);
  occupied.release();
  expect(bodyBudget.snapshot().reservedBytes).toBe(0);
});

test("body limits, invalid JSON and native forwarding errors settle without reservations", async () => {
  const config = defaultConfig("browser-only");
  const bodyBudget = new HttpBodyBudget();
  for (const handler of [responseRequest, compactRequest]) {
    for (const [body, headers, status] of [
      ["{}", { "content-length": "67108865" }, 413],
      ["{", {}, 400],
      ['{"model":"gpt-native-fixture"}', {}, 502], // Missing bearer fails locally, never contacts an account.
      ["{}", { "content-encoding": "gzip" }, 400],
    ] as const) {
      const response = await handler(new Request("http://body-fixture/", { method: "POST", headers, body }), config, complete, { bodyBudget });
      expect(response.status).toBe(status);
      await response.text();
      await until(() => bodyBudget.snapshot().reservedBytes === 0);
    }
  }
});

test("50 Responses can remain queued concurrently without a Codex agent cap", async () => {
  const config = defaultConfig("browser-only");
  const bodyBudget = new HttpBodyBudget(32 * 1024 * 1024);
  const finish = deferred();
  let admitted = 0;
  const responses = await Promise.all(Array.from({ length: 50 }, () => responseRequest(request(), config, () => ({
    name: "pending-queue-fixture", async runTurn(_parsed, _incoming, emit) {
      admitted++;
      await finish.promise;
      emit({ type: "done", stopReason: "stop", endTurn: true });
    },
  }), { bodyBudget, rememberState: false })));
  try {
    expect(admitted).toBe(50);
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(bodyBudget.snapshot().reservations).toBe(50);
    expect(bodyBudget.snapshot().peakReservedBytes).toBeLessThanOrEqual(bodyBudget.limit);
  } finally {
    finish.resolve();
    await Promise.all(responses.map(response => response.text()));
  }
  await until(() => bodyBudget.snapshot().reservedBytes === 0);
});

test("SSE cancellation retains memory until adapter cleanup actually settles", async () => {
  const config = defaultConfig("browser-only");
  const bodyBudget = new HttpBodyBudget();
  const cancelled = deferred(), cleanup = deferred();
  const response = await responseRequest(request(), config, () => ({ name: "delayed-cleanup", async runTurn(_parsed, incoming) {
    incoming.abortSignal!.addEventListener("abort", () => cancelled.resolve(), { once: true });
    await cleanup.promise;
  } }), { bodyBudget, rememberState: false });
  await response.body!.cancel("fixture disconnected");
  await cancelled.promise;
  expect(bodyBudget.snapshot().reservations).toBe(1);
  cleanup.resolve();
  await until(() => bodyBudget.snapshot().reservedBytes === 0);
});

test("client abort while non-stream Responses or compact is waiting keeps its execution lease", async () => {
  for (const handler of [responseRequest, compactRequest]) {
    const config = defaultConfig("browser-only");
    const bodyBudget = new HttpBodyBudget();
    const started = deferred(), cancelled = deferred(), cleanup = deferred();
    const abort = new AbortController();
    const pending = handler(request(false, abort.signal, true), config, () => ({ name: "delayed-json-cleanup", async runTurn(_parsed, incoming) {
      incoming.abortSignal!.addEventListener("abort", () => cancelled.resolve(), { once: true });
      started.resolve();
      await cleanup.promise;
      throw new Error("fixture cancelled");
    } }), { bodyBudget, rememberState: false });
    await started.promise;
    abort.abort();
    await cancelled.promise;
    expect(bodyBudget.snapshot().reservations).toBe(1);
    cleanup.resolve();
    const response = await pending;
    await response.text().catch(() => {});
    await until(() => bodyBudget.snapshot().reservedBytes === 0);
  }
});

test("terminal SSE delivery does not release a still-running adapter; throws release cleanly", async () => {
  const config = defaultConfig("browser-only");
  const bodyBudget = new HttpBodyBudget();
  const cleanup = deferred();
  const response = await responseRequest(request(), config, () => ({ name: "terminal-before-cleanup", async runTurn(_parsed, _incoming, emit) {
    emit({ type: "done", stopReason: "stop", endTurn: true });
    await cleanup.promise;
  } }), { bodyBudget, rememberState: false });
  expect(await response.text()).toContain("response.completed");
  expect(bodyBudget.snapshot().reservations).toBe(1);
  cleanup.resolve();
  await until(() => bodyBudget.snapshot().reservedBytes === 0);
  await expect(responseRequest(request(), config, () => { throw new Error("factory failed"); }, { bodyBudget })).rejects.toThrow("factory failed");
  expect(bodyBudget.snapshot().reservedBytes).toBe(0);
  const failed = await responseRequest(request(), config, () => ({ name: "throws", async runTurn() { throw new Error("adapter failed"); } }), { bodyBudget, rememberState: false });
  expect(await failed.text()).toContain("response.failed");
  await until(() => bodyBudget.snapshot().reservedBytes === 0);
});

test("zstd compact shares one parsed-body lease and preserves selected model and metadata", async () => {
  const bodyBudget = new HttpBodyBudget(HTTP_BODY_READER_BYTES + 32 * 1024);
  const req = request(false, undefined, true);
  req.headers.set("x-codex-turn-metadata", JSON.stringify({ thread_id: "body-budget-thread", turn_id: "body-budget-turn" }));
  let identities = 0;
  const response = await compactRequest(req, defaultConfig("browser-only"), () => ({
    name: "single-compaction-lease", async runTurn(parsed, incoming, emit) {
      expect(bodyBudget.snapshot().reservations).toBe(1);
      expect(parsed._compactionRequest).toBe(true);
      expect(parsed.modelId).toBe("gpt-5.6-sol");
      expect(parsed.options.reasoning).toBe("high");
      expect(incoming.headers.get("x-codex-turn-metadata")).toBe(req.headers.get("x-codex-turn-metadata"));
      emit({ type: "text_delta", text: "Fixture compaction summary", phase: "final_answer" });
      emit({ type: "done", stopReason: "stop", endTurn: true });
    },
  }), { bodyBudget, onTurnIdentity(identity) {
    expect(identity).toEqual({ threadId: "body-budget-thread", turnId: "body-budget-turn" }); identities++;
  } });
  expect(response.status).toBe(200);
  expect((await response.json()).output.length).toBeGreaterThan(0);
  expect(identities).toBeGreaterThan(0);
  await until(() => bodyBudget.snapshot().reservedBytes === 0);
});

test("separate service listeners own independent pools while both endpoints share each pool", async () => {
  const config = { ...defaultConfig("browser-only"), host: "127.0.0.1" as const, port: 0 };
  const budgetA = new HttpBodyBudget(), budgetB = new HttpBodyBudget();
  const occupied = budgetA.reserve(budgetA.limit);
  const serverA = startServer(config, { bodyBudget: budgetA, adapterFactory: complete });
  const serverB = startServer(config, { bodyBudget: budgetB, adapterFactory: complete });
  try {
    for (const endpoint of ["responses", "responses/compact"]) {
      const rejected = await fetch(new URL(`/v1/${endpoint}`, serverA.url), { method: "POST", body: "{}" });
      expect(rejected.status).toBe(503);
      await rejected.text();
      const other = await fetch(new URL(`/v1/${endpoint}`, serverB.url), { method: "POST", body: "{}" });
      expect(other.status).toBe(400); // Schema failure is sufficient to prove independent admission.
      await other.text();
    }
    await until(() => budgetB.snapshot().reservedBytes === 0);
    expect(budgetA.snapshot().reservedBytes).toBe(budgetA.limit);
  } finally {
    occupied.release();
    await serverA.stop(true);
    await serverB.stop(true);
  }
});
