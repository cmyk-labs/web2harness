import { afterEach, expect, test } from "bun:test";
import { createNativeWebSocketAdapter, createNativeWebSocketConnector, nativeWebSocketTarget, nativeWebSocketProxyFromEnv,
  type NativeWebSocketConnect, type NativeWebSocketEvents, type NativeWebSocketOptions,
  type NativeWebSocketPeer, type NativeWebSocketTarget } from "../../src/codex/native-websocket";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const run of cleanup.splice(0)) await run(); });
async function until(check: () => boolean) {
  const deadline = performance.now() + 2_000;
  while (!check()) { if (performance.now() > deadline) throw new Error("Fixture deadline exceeded"); await Bun.sleep(2); }
}
const create = (extra: Record<string, unknown> = {}) => JSON.stringify({ type: "response.create", model: "gpt-6-astra",
  reasoning: { effort: "high" }, input: [{ type: "reasoning", encrypted_content: "synthetic-opaque-state" }], ...extra });
function fixture(options: Partial<NativeWebSocketOptions> = {}) {
  const sent: string[] = [], upstream: string[] = [], targets: NativeWebSocketTarget[] = [];
  let events!: NativeWebSocketEvents, finish!: () => void, closes = 0, terminations = 0, blocked = false;
  const peer: NativeWebSocketPeer = { bufferedAmount: 0, closed: new Promise<void>(resolve => { finish = resolve; }),
    send: text => { upstream.push(text); }, terminate: () => { terminations++; finish(); } };
  const adapter = createNativeWebSocketAdapter({ isNativeModel: model => !model.startsWith("chatgpt-web/"),
    connect: async (target, listener) => { targets.push(target); events = listener; return peer; }, ...options });
  const socket = { send: (text: string) => { sent.push(text); return blocked ? -1 : text.length; }, close: () => { closes++; } };
  adapter.open(socket, new Headers({ authorization: "Bearer fixture-native", "chatgpt-account-id": "fixture-account" }));
  cleanup.push(async () => { adapter.closeAll(); await adapter.settled(); });
  return { adapter, socket, sent, upstream, targets, peer, send: (text: string) => adapter.message(socket, text),
    emit: (event: unknown) => events.message(typeof event === "string" ? event : JSON.stringify(event)),
    disconnect: () => events.close(), closes: () => closes, terminations: () => terminations,
    block: (value: boolean) => { blocked = value; } };
}

test("verified endpoint and incoming auth/account headers; handshake headers are rebuilt", () => {
  const source = new Headers({ authorization: "Bearer synthetic", "chatgpt-account-id": "account",
    "openai-project": "project", "x-codex-routing-hint": "route", "user-agent": "codex_cli_rs/0.155.1",
    "openai-beta": "another_feature=1", cookie: "must-not-forward", host: "localhost", connection: "Upgrade, x-remove",
    "x-remove": "private", "sec-websocket-key": "client-key", "sec-websocket-protocol": "client-protocol" });
  const target = nativeWebSocketTarget(source);
  expect(target.url).toBe("wss://chatgpt.com/backend-api/codex/responses");
  expect(target.headers.get("authorization")).toBe("Bearer synthetic");
  expect(target.headers.get("chatgpt-account-id")).toBe("account");
  expect(target.headers.get("openai-project")).toBe("project");
  expect(target.headers.get("x-codex-routing-hint")).toBe("route");
  expect(target.headers.get("openai-beta")).toBe("another_feature=1, responses_websockets=2026-02-06");
  for (const name of ["cookie", "host", "x-remove", "connection", "sec-websocket-key", "sec-websocket-protocol"]) expect(target.headers.has(name)).toBe(false);
  expect(source.get("cookie")).toBe("must-not-forward");
  for (const base of ["https://api.openai.com/v1", "https://unverified.invalid", "https://chatgpt.com/backend-api/codex?override=1"]) {
    expect(() => nativeWebSocketTarget(source, base)).toThrow("unsupported_native_websocket_provider");
  }
  expect(() => nativeWebSocketTarget(new Headers())).toThrow("auth_required");
  expect(() => nativeWebSocketTarget(new Headers({ authorization: "Bearer x", "openai-beta": "responses_websockets=unknown" }))).toThrow("version");
});

test("prefill reaches upstream unchanged and continuation uses its actual ID, preserving opaque state/model/effort", async () => {
  const f = fixture();
  const prefill = create({ generate: false });
  f.send(prefill); await until(() => f.upstream.length === 1);
  expect(f.upstream[0]).toBe(prefill);
  expect(f.sent).toEqual([]);
  f.emit({ type: "response.created", sequence_number: 30, response: { id: "upstream-warm" } });
  f.emit({ type: "response.completed", sequence_number: 31, response: { id: "upstream-warm", output: [], status: "completed" } });
  expect(f.adapter.activeCount()).toBe(0);
  expect(JSON.parse(f.sent[1]!)).toMatchObject({ sequence_number: 31, response: { id: "upstream-warm", output: [] } });
  const next = create({ previous_response_id: "upstream-warm", input: [{ role: "user", content: "continue" }] });
  f.send(next); expect(f.upstream[1]).toBe(next); expect(f.targets).toHaveLength(1);
  f.emit({ type: "response.created", response: { id: "upstream-next" } });
  const failure = { type: "response.failed", response: { id: "upstream-next", status: "failed", error: { code: "quota", message: "upstream failure" } } };
  f.emit(failure); expect(JSON.parse(f.sent.at(-1)!)).toEqual(failure); expect(f.adapter.activeCount()).toBe(0);
});

test("native connection metadata passes through without ending prefill or inventing response work", async () => {
  const f = fixture();
  f.send(create({ generate: false })); await until(() => f.upstream.length === 1);
  // Observed on authenticated Codex WS before/around response events. Payloads
  // below are synthetic; this transport leaves their interpretation to Codex.
  const metadata = [
    '{ "type": "codex.rate_limits", "rate_limits": { "remaining": 1 } }',
    '{"type":"codex.response.metadata","headers":{"x-fixture":"unchanged"}}',
    '{"type":"responsesapi.websocket_timing","timing_metrics":{"fixture_ms":2}}',
  ];
  for (const text of metadata) {
    f.emit(text);
    expect(f.sent.at(-1)).toBe(text);
    expect(f.adapter.activeCount()).toBe(1);
  }
  f.emit({ type: "response.created", response: { id: "metadata-warmup" } });
  f.emit({ type: "response.completed", response: { id: "metadata-warmup", status: "completed", output: [] } });
  expect(f.adapter.activeCount()).toBe(0);
  const extension = '{"type":"codex.future_metadata","opaque":{"keep":true}}';
  f.emit(extension);
  expect(f.sent.at(-1)).toBe(extension);
  expect(f.adapter.activeCount()).toBe(0);
  expect(f.closes()).toBe(0);
  expect(f.upstream).toHaveLength(1);
});

test("native lanes and same-lane FIFO retain IDs and stream labels without synthetic rewriting", async () => {
  const f = fixture();
  f.send(create({ stream_id: "a" })); f.send(create({ stream_id: "a" })); f.send(create({ stream_id: "b" }));
  await until(() => f.upstream.length === 3);
  for (const [stream, id] of [["a", "a1"], ["b", "b1"]]) f.emit({ type: "response.created", stream_id: stream, response: { id } });
  f.emit({ type: "response.completed", stream_id: "b", response: { id: "b1", output: [] } });
  f.emit({ type: "response.completed", stream_id: "a", response: { id: "a1", output: [] } });
  f.emit({ type: "response.created", stream_id: "a", response: { id: "a2" } });
  f.emit({ type: "response.completed", stream_id: "a", response: { id: "a2", output: [] } });
  expect(f.adapter.activeCount()).toBe(0); expect(f.sent.map(text => JSON.parse(text).response.id)).toEqual(["a1", "b1", "b1", "a1", "a2", "a2"]);
});

test("steering is genuinely upstream-owned including accepted, incomplete and automatic successor", async () => {
  const f = fixture(); f.send(create()); await until(() => f.upstream.length === 1);
  f.emit({ type: "response.created", response: { id: "parent" } });
  const steer = JSON.stringify({ type: "response.steer", previous_response_id: "parent", input: "new requirement" });
  f.send(steer); expect(f.upstream[1]).toBe(steer);
  f.emit({ type: "response.steer.accepted", steer: { id: "steer-server", previous_response_id: "parent" } });
  f.emit({ type: "response.incomplete", response: { id: "parent", incomplete_details: { reason: "steered" } } });
  expect(f.adapter.activeCount()).toBeGreaterThan(0);
  f.emit({ type: "response.created", response: { id: "successor" } });
  f.emit({ type: "response.completed", response: { id: "successor", output: [] } });
  expect(f.adapter.activeCount()).toBe(0); expect(f.targets).toHaveLength(1); expect(f.upstream).toHaveLength(2);
});

test("disconnect after dispatch fails without retry, fallback, invented completion or reconnect", async () => {
  const f = fixture(); f.send(create()); await until(() => f.upstream.length === 1);
  f.emit({ type: "response.created", response: { id: "unfinished" } }); f.disconnect();
  await f.adapter.settled();
  expect(f.targets).toHaveLength(1); expect(f.upstream).toHaveLength(1); expect(f.closes()).toBe(1);
  expect(f.sent.map(text => JSON.parse(text).type)).toEqual(["response.created", "error"]);
  f.send(create()); expect(f.upstream).toHaveLength(1); expect(f.adapter.activeCount()).toBe(0);
});

test("rejected frames cannot change connection authentication or native route", async () => {
  const f = fixture();
  f.send(create({ headers: { authorization: "Bearer different" } }));
  f.send(create({ model: "chatgpt-web/gpt-6-sol" }));
  f.send(create({ generate: "false" })); f.send(JSON.stringify({ type: "unknown" }));
  expect(f.targets).toHaveLength(0); expect(f.adapter.activeCount()).toBe(0);
  expect(f.sent.map(text => JSON.parse(text).error.code)).toEqual(["unsupported_websocket_headers", "websocket_route_mismatch", "invalid_websocket_generate", "unsupported_websocket_event"]);
});

test("unknown response extensions and steering fields reach upstream without invented success", async () => {
  const f = fixture(); f.send(create()); await until(() => f.upstream.length === 1);
  f.emit({ type: "response.created", response: { id: "extension-parent" } });
  const extension = JSON.stringify({ type: "response.future", opaque_extension: { exact: true } });
  f.send(extension); expect(f.upstream.at(-1)).toBe(extension);
  const extra = JSON.stringify({ type: "response.future.ack", payload: "upstream-owned" });
  f.emit(extra); expect(f.sent.at(-1)).toBe(extra);
  const steer = JSON.stringify({ type: "response.steer", previous_response_id: "extension-parent", input: "update", future_option: true });
  f.send(steer); expect(f.upstream.at(-1)).toBe(steer);
  expect(f.sent.some(text => JSON.parse(text).type === "response.completed")).toBe(false);
});

test("bounded upstream error remains an error and clears rejected pending work", async () => {
  const f = fixture(); f.send(create({ generate: false, stream_id: "warm" })); await until(() => f.upstream.length === 1);
  const refusal = { type: "error", status: 403, stream_id: "warm", error: { code: "permission_denied", message: "denied" } };
  f.emit(refusal); expect(JSON.parse(f.sent[0]!)).toEqual(refusal); expect(f.adapter.activeCount()).toBe(0);
  f.send(create({ headers: {} }));
  expect(JSON.parse(f.sent.at(-1)!).error.source).toBe("web2harness");
});

test("backpressure never resends an accepted frame and bounds slow readers", async () => {
  const f = fixture({ backpressureTimeoutMs: 20 }); f.send(create()); await until(() => f.upstream.length === 1);
  f.block(true); f.emit({ type: "response.created", response: { id: "buffered" } });
  f.emit({ type: "response.completed", response: { id: "buffered", output: [] } }); expect(f.sent).toHaveLength(1);
  f.block(false); f.adapter.drain(f.socket); expect(f.sent).toHaveLength(2); expect(f.adapter.activeCount()).toBe(0);
  f.send(create()); f.block(true); f.emit({ type: "response.created", response: { id: "slow" } });
  await until(() => f.closes() === 1); await f.adapter.settled(); expect(f.terminations()).toBeGreaterThan(0);
});

test("oversized or malformed upstream frames fail without leaking payloads", async () => {
  const f = fixture({ maxEventBytes: 512 }); f.send(create()); await until(() => f.upstream.length === 1);
  f.emit("sensitive-content".repeat(60)); await f.adapter.settled();
  expect(f.sent.join("")).not.toContain("sensitive-content"); expect(f.closes()).toBe(1);
});

test("native requests retain the existing 64 MiB capacity independently of event and output-buffer limits", async () => {
  const f = fixture();
  const request = create({ input: "x".repeat(33 * 1024 * 1024) });
  f.send(request); await until(() => f.upstream.length === 1);
  expect(f.upstream[0]!.length).toBe(request.length);
  expect(f.closes()).toBe(0);
  f.emit({ type: "response.extension", payload: "x".repeat(16 * 1024 * 1024) });
  await f.adapter.settled();
  expect(f.closes()).toBe(1);
  expect(JSON.parse(f.sent.at(-1)!).error.code).toBe("native_websocket_invalid_frame");
});

test("connect cancellation terminates a late returned socket and waits for its close", async () => {
  let resolve!: (peer: NativeWebSocketPeer) => void, signal!: AbortSignal, finish!: () => void, terminated = 0;
  const f = fixture({ connect: async (_target, _events, passed) => { signal = passed; return await new Promise(done => { resolve = done; }); } });
  f.send(create()); await until(() => Boolean(resolve)); f.adapter.close(f.socket); expect(signal.aborted).toBe(true);
  const closed = new Promise<void>(done => { finish = done; });
  resolve({ bufferedAmount: 0, closed, send: () => { throw new Error("must not send"); }, terminate: () => { terminated++; finish(); } });
  await f.adapter.settled(); expect(terminated).toBeGreaterThan(0); expect(f.adapter.activeCount()).toBe(0);
});

test("turn cancellation closes only the owned native connection and drain rejects new work", async () => {
  const f = fixture({ identify: body => ({ threadId: "task", turnId: String(body.turn) }) });
  f.send(create({ turn: "one" })); await until(() => f.upstream.length === 1);
  expect(f.adapter.cancelTurn({ threadId: "other", turnId: "one" })).toBe(0);
  f.adapter.setDraining(true); f.send(create({ turn: "two" })); expect(f.upstream).toHaveLength(1);
  expect(f.adapter.cancelTurn({ threadId: "task", turnId: "one" })).toBe(1);
  await f.adapter.settled(); expect(f.adapter.activeCount()).toBe(0);
});

test("actual Bun WS connector rejects redirects without sending credentials to the target", async () => {
  let leaked = 0;
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { leaked++; return new Response("unexpected"); } });
  const redirect = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return new Response(null, { status: 302,
    headers: { location: `http://127.0.0.1:${destination.port}/responses` } }); } });
  const abort = new AbortController();
  try {
    const promise = createNativeWebSocketConnector("", {})({ url: `ws://127.0.0.1:${redirect.port}/responses`, headers: new Headers({ authorization: "Bearer fixture" }) },
      { message() {}, close() {}, error() {} }, abort.signal);
    await expect(promise).rejects.toThrow(); expect(leaked).toBe(0);
  } finally { abort.abort(); await redirect.stop(true); await destination.stop(true); }
});

test("proxy policy is explicit, respects NO_PROXY and rejects unsupported/conflicting routes", () => {
  const url = "wss://chatgpt.com/backend-api/codex/responses";
  expect(nativeWebSocketProxyFromEnv(url, {})).toEqual({ configured: false });
  expect(nativeWebSocketProxyFromEnv(url, { HTTPS_PROXY: "http://127.0.0.1:8080" })).toEqual({ configured: true, proxy: "http://127.0.0.1:8080/" });
  expect(nativeWebSocketProxyFromEnv(url, { HTTPS_PROXY: "http://127.0.0.1:8080", NO_PROXY: ".chatgpt.com:443" })).toEqual({ configured: true });
  expect(() => nativeWebSocketProxyFromEnv(url, { HTTPS_PROXY: "socks5://127.0.0.1:8080" })).toThrow("unsupported_proxy");
  expect(() => nativeWebSocketProxyFromEnv(url, { HTTPS_PROXY: "http://one", https_proxy: "http://two" })).toThrow("proxy_conflict");
  const subnetPolicy = { HTTPS_PROXY: "http://one", NO_PROXY: "10.0.0.0/8,fd00::/8" };
  expect(nativeWebSocketProxyFromEnv(url, subnetPolicy)).toEqual({ configured: true, proxy: "http://one/" });
  expect(nativeWebSocketProxyFromEnv("wss://10.2.3.4/responses", subnetPolicy)).toEqual({ configured: true });
  expect(nativeWebSocketProxyFromEnv("wss://11.2.3.4/responses", subnetPolicy)).toEqual({ configured: true, proxy: "http://one/" });
  expect(nativeWebSocketProxyFromEnv("wss://[fd00::1]/responses", subnetPolicy)).toEqual({ configured: true });
  expect(nativeWebSocketProxyFromEnv("wss://[fe80::1]/responses", subnetPolicy)).toEqual({ configured: true, proxy: "http://one/" });
  expect(nativeWebSocketProxyFromEnv(url, { ...subnetPolicy, NO_PROXY: "10.0.0.0/8,.chatgpt.com" })).toEqual({ configured: true });
  expect(() => nativeWebSocketProxyFromEnv(url, { HTTPS_PROXY: "http://one", NO_PROXY: "10.0.0.0/33" })).toThrow("unsupported_no_proxy");
});

test("actual connector uses the selected environment proxy instead of silently connecting directly", async () => {
  let direct = 0, proxied = 0;
  const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { proxied++; return new Response("synthetic proxy refusal", { status: 403 }); } });
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { direct++; return new Response("unexpected direct route", { status: 403 }); } });
  const abort = new AbortController();
  try {
    const connector = createNativeWebSocketConnector("", { HTTP_PROXY: `http://127.0.0.1:${proxy.port}` });
    await expect(connector({ url: `ws://127.0.0.1:${destination.port}/responses`, headers: new Headers() },
      { message() {}, close() {}, error() {} }, abort.signal)).rejects.toThrow();
    expect(proxied).toBe(1); expect(direct).toBe(0);
  } finally { abort.abort(); await proxy.stop(true); await destination.stop(true); }
});

test("prefill preserves upstream terminal context items without an extra empty-output restriction", async () => {
  const f = fixture(); f.send(create({ generate: false })); await until(() => f.upstream.length === 1);
  f.emit({ type: "response.created", response: { id: "context-warm" } });
  const terminal = JSON.stringify({ type: "response.completed", response: { id: "context-warm", status: "completed",
    output: [{ type: "reasoning", encrypted_content: "synthetic-retained-context" }] } });
  f.emit(terminal);
  expect(f.sent.at(-1)).toBe(terminal);
  expect(f.adapter.activeCount()).toBe(0);
  expect(f.closes()).toBe(0);
  const continuation = create({ previous_response_id: "context-warm" });
  f.send(continuation);
  expect(f.upstream[1]).toBe(continuation);
});

test("handshake timeout aborts its owned connection without retry", async () => {
  let attempts = 0, aborted = false;
  const f = fixture({ connectTimeoutMs: 10, connect: async (_target, _events, signal) => {
    attempts++;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true }));
  } });
  f.send(create()); await until(() => f.closes() === 1); await f.adapter.settled();
  expect(attempts).toBe(1); expect(aborted).toBe(true); expect(f.adapter.activeCount()).toBe(0);
});

test("physical cleanup timeout remains a failure and cannot claim idle settlement", async () => {
  let connected = false;
  const adapter = createNativeWebSocketAdapter({ isNativeModel: () => true, cleanupTimeoutMs: 10,
    connect: async () => { connected = true; return { bufferedAmount: 0, closed: new Promise<void>(() => {}), send() {}, terminate() {} }; } });
  const socket = { send: () => 1, close() {} };
  adapter.open(socket, new Headers({ authorization: "Bearer fixture" }));
  adapter.message(socket, create()); await until(() => connected);
  adapter.close(socket);
  await expect(adapter.settled()).rejects.toThrow("cleanup failed");
  expect(adapter.activeCount()).toBe(1);
});
