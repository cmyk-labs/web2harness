import { expect, test } from "bun:test";
import { defaultConfig } from "../../src/config";
import { modelsRequest, startServer } from "../../src/server";
import { ModelCatalogFetches } from "../../src/codex/model-catalog-fetches";

const catalog = () => Response.json({ models: [{ slug: "fixture-native", display_name: "Fixture",
  visibility: "list", supported_in_api: true, tool_mode: "code_mode_only",
  supported_reasoning_levels: [{ effort: "medium", description: "Medium" }] }] });
const request = (signal?: AbortSignal) => new Request("http://127.0.0.1/v1/models?client_version=fixture", {
  headers: { authorization: "Bearer isolated-fixture" }, signal,
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };

test("catalog diagnostics distinguish upstream cancellation and wrapped network errors without secrets", async () => {
  for (const [error, code] of [
    [new DOMException("private", "AbortError"), "ABORT_ERR"],
    [new DOMException("private", "TimeoutError"), "ETIMEDOUT"],
    [new TypeError("private", { cause: { code: "ECONNRESET" } }), "ECONNRESET"],
    [{ code: "https://private/token", cause: { code: "/private/key" } }, undefined],
  ] as const) {
    let failure: unknown;
    const response = await modelsRequest(request(), defaultConfig("browser-only"), async () => { throw error; },
      undefined, value => { failure = value; });
    expect(response.status).toBe(502);
    expect(failure).toEqual({ stage: "transport", ...(code ? { code } : {}) });
  }
});

test("simultaneous clients share raw bytes but receive independent current configuration augmentation", async () => {
  const shared = new ModelCatalogFetches(), done = deferred<void>(); let calls = 0;
  const upstream = async () => { calls++; await done.promise; return catalog(); };
  try {
    const basic = defaultConfig("browser-only"), pro = { ...basic, proAvailable: true };
    const first = modelsRequest(request(), basic, upstream, undefined, undefined, undefined, shared);
    const second = modelsRequest(request(), pro, upstream, undefined, undefined, undefined, shared);
    done.resolve();
    const a = await (await first).json() as any, b = await (await second).json() as any;
    expect(calls).toBe(1);
    expect(a.models.some((m: any) => m.slug === "chatgpt-web/gpt-6-pro")).toBeFalse();
    expect(b.models.some((m: any) => m.slug === "chatgpt-web/gpt-6-pro")).toBeTrue();
    await (await modelsRequest(request(), basic, upstream, undefined, undefined, undefined, shared)).text();
    expect(calls).toBe(2); // A delivered response is never a persistent catalog cache.
  } finally { done.resolve(); shared.close(); }
});

test("different authorization, query, account or client headers never share a catalog attempt", async () => {
  const shared = new ModelCatalogFetches(), done = deferred<void>(); let calls = 0;
  try {
    const variants = [request(), new Request(request(), { headers: { authorization: "Bearer second" } }),
      new Request("http://127.0.0.1/v1/models?client_version=other", { headers: request().headers }),
      new Request(request(), { headers: { ...Object.fromEntries(request().headers), "chatgpt-account-id": "second" } }),
      new Request(request(), { headers: { ...Object.fromEntries(request().headers), "user-agent": "other" } })];
    const pending = variants.map(req => shared.fetch(req, async (_, mark) => { mark(); calls++; await done.promise; return catalog(); }));
    expect(calls).toBe(5); done.resolve();
    expect((await Promise.all(pending)).every(r => r.ok)).toBeTrue();
  } finally { done.resolve(); shared.close(); }
});

test("a successful unclaimed response can be claimed once and expires without a retry", async () => {
  for (const expire of [false, true]) {
    const shared = new ModelCatalogFetches(200, 25), done = deferred<void>(), controller = new AbortController(); let calls = 0;
    const forward = async (_: Request, mark: () => void) => { calls++; mark(); await done.promise; return catalog(); };
    try {
      const first = shared.fetch(request(controller.signal), forward); controller.abort(); expect((await first).ok).toBeFalse();
      done.resolve(); await Bun.sleep(expire ? 60 : 0);
      expect((await shared.fetch(request(), forward)).ok).toBeTrue();
      expect(calls).toBe(expire ? 2 : 1);
      await shared.fetch(request(), forward); expect(calls).toBe(expire ? 3 : 2);
    } finally { done.resolve(); shared.close(); }
  }
});

test("abandoned HTTP and transport failures are not retained for another client", async () => {
  for (const status of [401, 503, 0]) {
    const shared = new ModelCatalogFetches(), done = deferred<void>(), controller = new AbortController(); let calls = 0;
    const forward = async (_: Request, mark: () => void) => {
      calls++; mark(); await done.promise;
      if (!status) throw new TypeError("fixture connection reset");
      return new Response("failure", { status });
    };
    try {
      const first = shared.fetch(request(controller.signal), forward); controller.abort(); await first;
      done.resolve(); await Bun.sleep(0);
      await shared.fetch(request(), forward); expect(calls).toBe(2);
    } finally { done.resolve(); shared.close(); }
  }
});

test("abandonment aborts the owned upstream; shutdown also cancels active attempts and rejects new work", async () => {
  for (const shutdown of [false, true]) {
    const shared = new ModelCatalogFetches(15), controller = new AbortController(), stopped = deferred<void>();
    let signal: AbortSignal | undefined;
    const pending = shared.fetch(request(controller.signal), async (req, mark) => {
      signal = req.signal; mark();
      return await new Promise<Response>((_, reject) => req.signal.addEventListener("abort", () => {
        stopped.resolve(); reject(req.signal.reason);
      }, { once: true }));
    });
    try {
      if (shutdown) shared.close(); else controller.abort();
      expect((await pending).ok).toBeFalse(); await stopped.promise; expect(signal!.aborted).toBeTrue();
      if (shutdown) {
        let called = false; const result = await shared.fetch(request(), async () => { called = true; return catalog(); });
        expect(result.ok).toBeFalse(); expect(called).toBeFalse();
      } else expect((await shared.fetch(request(), async () => catalog())).ok).toBeTrue();
    } finally { shared.close(); }
  }
});

test("already disconnected model clients do not contact upstream or record a server failure", async () => {
  let calls = 0, failures = 0;
  const response = await modelsRequest(request(AbortSignal.abort()), defaultConfig("browser-only"), async () => {
    calls++; return catalog();
  }, undefined, () => { failures++; });
  expect([response.status, calls, failures]).toEqual([499, 0, 0]);
});

test("a short-lived catalog client can retry the same pending cold upstream connection", async () => {
  const started = deferred<void>(), finish = deferred<void>();
  const attempts: AbortSignal[] = [];
  const oldInt = new Set(process.listeners("SIGINT")), oldTerm = new Set(process.listeners("SIGTERM"));
  const server = startServer({ ...defaultConfig("browser-only"), host: "127.0.0.1", port: 0 }, {
    fetchUpstream: async input => {
      attempts.push(input.signal); started.resolve();
      await Promise.race([finish.promise, new Promise<never>((_, reject) => {
        const abort = () => reject(input.signal.reason);
        if (input.signal.aborted) abort(); else input.signal.addEventListener("abort", abort, { once: true });
      })]);
      return catalog();
    },
  });
  const url = `http://127.0.0.1:${server.port}/v1/models?client_version=fixture`;
  const headers = { authorization: "Bearer isolated-fixture" };
  try {
    const abort = new AbortController();
    const first = fetch(url, { headers, signal: abort.signal }).catch(() => null);
    await started.promise;
    abort.abort(); await first;
    // Give the server a chance to observe the client disconnect before its retry.
    await Bun.sleep(30);
    const second = fetch(url, { headers });
    await Bun.sleep(30);
    finish.resolve();
    const response = await second;
    expect(response.status).toBe(200);
    expect((await response.json() as any).models.some((row: any) => row.slug.startsWith("chatgpt-web/"))).toBeTrue();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.aborted).toBeFalse();
    const health = await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).json() as any;
    expect(health.last_model_catalog_result.status).toBe(200);
    expect(health.successful_model_catalog_requests).toBe(1);
  } finally {
    finish.resolve(); await server.stop(true);
    for (const listener of process.listeners("SIGINT")) if (!oldInt.has(listener)) process.off("SIGINT", listener);
    for (const listener of process.listeners("SIGTERM")) if (!oldTerm.has(listener)) process.off("SIGTERM", listener);
  }
});
