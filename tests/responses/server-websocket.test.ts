import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { ProviderAdapter, IncomingMeta } from "../../src/adapters/base";
import type { AdapterEvent, CodexParsedRequest } from "../../src/types";

const CHILD = "WEB2HARNESS_SERVER_WS_FIXTURE_CHILD";
const PREFIX = "web2harness-server-ws-";
const MARKER = ".owned-server-websocket-fixture";
type WireEvent = Record<string, any>;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, label: string, ms = 4000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Fixture timed out: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function assertOwnedRoot(root: string, token: string): void {
  const canonical = realpathSync(root), parent = realpathSync(tmpdir());
  const child = relative(parent, canonical);
  if (canonical !== root || !child || child.startsWith("..") || isAbsolute(child)
    || !basename(canonical).startsWith(PREFIX) || readFileSync(join(canonical, MARKER), "utf8") !== token) {
    throw new Error("Refusing to use/remove an unverified WebSocket fixture root");
  }
}

// state.ts is a lazy module-global disk cache. A separate process keeps both that cache and
// licensing/environment changes isolated from every other suite, regardless of test ordering.
if (process.env[CHILD] !== "1") {
  test("shared startServer WebSocket scenarios in an owned isolated Bun process", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), PREFIX))), token = randomUUID();
    writeFileSync(join(root, MARKER), token);
    const home = join(root, "home"), codexHome = join(root, "codex");
    mkdirSync(home); mkdirSync(codexHome);
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      assertOwnedRoot(root, token);
      child = Bun.spawn([process.execPath, "test", "--timeout", "15000", import.meta.path], {
        cwd: resolve(import.meta.dir, "../.."),
        env: { ...process.env, [CHILD]: "1", WEB2HARNESS_WS_FIXTURE_ROOT: root,
          WEB2HARNESS_WS_FIXTURE_TOKEN: token, WEB2HARNESS_HOME: home, CODEX_HOME: codexHome,
          WEB2HARNESS_BROWSER_HOST_DESCRIPTOR: "",
          WEB2HARNESS_LICENSE_KEYS_FILE: join(root, "licensing", "public-keys.json"),
          WEB2HARNESS_LICENSE_FILE: join(root, "licensing", "license.w2h") },
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const stdout = child.stdout, stderr = child.stderr;
      if (!stdout || typeof stdout === "number" || !stderr || typeof stderr === "number") throw new Error("Fixture requires piped output");
      const result = await bounded(Promise.all([
        child.exited, new Response(stdout).text(), new Response(stderr).text(),
      ]), "isolated integration suite", 45000);
      if (result[0] !== 0) throw new Error(`Shared server fixture exited ${result[0]}\n${result[1]}\n${result[2]}`);
      expect(result[0]).toBe(0);
      expect(result[2]).toMatch(/\b[1-9]\d* pass\r?\n\s+0 fail/);
      console.info(result[2].split(/\r?\n/).filter(line => /^\s*\d+ (?:pass|fail|expect\(\))|^Ran \d+ tests/.test(line)).join("\n"));
      const snapshot = JSON.parse(readFileSync(join(home, "responses-state.json"), "utf8"));
      expect(snapshot.version).toBe(1);
      expect(snapshot.states.length).toBeGreaterThan(0);
    } finally {
      if (child && child.exitCode === null) { child.kill(); await child.exited; }
      assertOwnedRoot(root, token);
      rmSync(root, { recursive: true, force: false });
      expect(existsSync(root)).toBe(false);
    }
  }, 55000);
} else {
  await registerIsolatedCases();
}

async function registerIsolatedCases(): Promise<void> {
  const root = process.env.WEB2HARNESS_WS_FIXTURE_ROOT!, token = process.env.WEB2HARNESS_WS_FIXTURE_TOKEN!;
  assertOwnedRoot(root, token);
  if (process.env.WEB2HARNESS_HOME !== join(root, "home") || process.env.CODEX_HOME !== join(root, "codex")) {
    throw new Error("WebSocket child must use its own state and Codex homes");
  }
  const { startServer } = await import("../../src/server");
  const { defaultConfig } = await import("../../src/config");
  const { flushResponseState } = await import("../../src/responses/state");
  const { createLicenseFixture } = await import("../fixtures/license-fixture");
  const { extractChatGptTurnIdentity } = await import("../../src/adapters/chatgpt-web/prompt/environment");
  const { CHATGPT_WEB_MODEL_ID } = await import("../../src/adapters/chatgpt-web/model");
  const cleanups: Array<() => Promise<void>> = [];
  beforeAll(async () => {
    const license = await createLicenseFixture(join(root, "licensing"));
    expect(license.keyFile).toBe(process.env.WEB2HARNESS_LICENSE_KEYS_FILE!);
    expect(license.licenseFile).toBe(process.env.WEB2HARNESS_LICENSE_FILE!);
  });
  afterEach(async () => {
    const results = await Promise.allSettled(cleanups.splice(0).map(cleanup => cleanup()));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  });
  afterAll(() => { flushResponseState(); assertOwnedRoot(root, token); });

  const model = "chatgpt-web/gpt-6-sol";
  const tools = [{ type: "function", name: "fixture_read", description: "Synthetic read-only tool; never executed by server",
    strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }];
  const permissions = { type: "message", role: "developer", content: [{ type: "input_text",
    text: "<permissions instructions>Sandbox: workspace-write. Approval: on-request. Only the active task's declared tool is authorized.</permissions instructions>" }] };
  const user = (text = "inspect fixture") => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
  const body = (extra: WireEvent = {}): WireEvent => ({ model, tools, reasoning: { effort: "xhigh" }, store: false,
    stream: true, input: [permissions, user()], ...extra });
  const create = (extra: WireEvent = {}) => ({ type: "response.create", ...body(extra) });
  const terminalTypes = new Set(["response.completed", "response.failed", "response.incomplete", "error"]);
  const complete = (emit: (event: AdapterEvent) => void, text = "fixture complete") => {
    emit({ type: "text_delta", text, phase: "final_answer" });
    emit({ type: "done", stopReason: "stop", endTurn: true });
  };
  // lib.dom omits Bun's headers overload, but this is the real Bun WebSocket client.
  const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };

  function fixture(runTurn: ProviderAdapter["runTurn"]) {
    const config = { ...defaultConfig("native-tools"), host: "127.0.0.1" as const, port: 0,
      subagentProtocol: "native" as const, extraHighAvailable: true, autoApproveToolCalls: false };
    const before = new Map(["SIGINT", "SIGTERM"].map(signal => [signal, new Set(process.listeners(signal))]));
    let adapterConstructions = 0;
    const server = startServer(config, { adapterFactory: provider => {
      adapterConstructions++;
      expect(provider.chatgptWeb?.nativeToolsEnabled).toBe(true);
      expect(provider.chatgptWeb?.autoApproveToolCalls).toBe(false);
      return { name: "shared-server-websocket-synthetic", runTurn };
    } });
    const ownedListeners = [...before].flatMap(([signal, prior]) => process.listeners(signal)
      .filter(listener => !prior.has(listener)).map(listener => ({ signal, listener })));
    const base = `http://127.0.0.1:${server.port}`;
    const sockets: Array<{ socket: WebSocket; closed: Promise<void> }> = [];
    const releases: Array<() => void> = [];
    cleanups.push(async () => {
      for (const release of releases) release();
      for (const { socket } of sockets) socket.close();
      await server.stop(true);
      await bounded(Promise.all(sockets.map(socket => socket.closed)), "fixture sockets closed");
      for (const { signal, listener } of ownedListeners) process.removeListener(signal, listener);
      flushResponseState();
    });
    async function connect(headers: Record<string, string> = {}) {
      const socket = new BunWebSocket(`${base.replace("http:", "ws:")}/v1/responses`, { headers });
      const opened = deferred(), closed = deferred();
      const messages: WireEvent[] = [];
      const waiters: Array<ReturnType<typeof deferred<WireEvent>>> = [];
      let ended = false;
      sockets.push({ socket, closed: closed.promise });
      socket.onopen = () => opened.resolve();
      socket.onerror = () => { opened.resolve(); };
      socket.onmessage = event => {
        const data = JSON.parse(String(event.data)), next = waiters.shift();
        if (next) next.resolve(data); else messages.push(data);
      };
      socket.onclose = () => {
        ended = true; opened.resolve(); closed.resolve();
        for (const next of waiters.splice(0)) next.resolve({ type: "fixture.closed" });
      };
      await bounded(opened.promise, "WebSocket upgrade");
      if (socket.readyState !== WebSocket.OPEN) throw new Error("Fixture WebSocket upgrade rejected");
      async function next(): Promise<WireEvent> {
        const saved = messages.shift();
        if (saved) return saved;
        if (ended) throw new Error("Fixture WebSocket closed before expected event");
        const waiter = deferred<WireEvent>(); waiters.push(waiter);
        try { return await bounded(waiter.promise, "WebSocket event"); }
        finally { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); }
      }
      return { socket, closed: closed.promise, send: (event: WireEvent) => socket.send(JSON.stringify(event)), next,
        async terminal() {
          const events: WireEvent[] = [];
          for (;;) {
            const event = await next();
            if (event.type === "fixture.closed") throw new Error("Socket closed without terminal event");
            events.push(event);
            if (terminalTypes.has(event.type)) return { event, events };
          }
        } };
    }
    async function health() { return await (await fetch(`${base}/healthz`)).json() as WireEvent; }
    async function counts(http: number, websocket: number) {
      const deadline = performance.now() + 3000;
      let snapshot = await health();
      while ((snapshot.active_http_turns !== http || snapshot.active_websocket_turns !== websocket) && performance.now() < deadline) {
        await Bun.sleep(10); snapshot = await health();
      }
      expect(snapshot).toMatchObject({ active_http_turns: http, active_websocket_turns: websocket, active_browser_turns: 0 });
      return snapshot;
    }
    const admin = (path: string, payload?: unknown, authorization = `Bearer ${config.controlToken}`) => fetch(`${base}/admin/${path}`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    return { base, config, connect, health, counts, admin, releases, adapterConstructions: () => adapterConstructions };
  }

  function stateSnapshot(): string {
    flushResponseState();
    const path = join(root, "home", "responses-state.json");
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  }

  test("generate:false returns resumable IDs without adapters and memory-only prefixes survive unrelated snapshot flush", async () => {
    const requests: CodexParsedRequest[] = [];
    const f = fixture(async (parsed, _incoming, emit) => { requests.push(parsed); complete(emit); });
    const client = await f.connect();
    const marker = `prewarm_only_${randomUUID()}`;
    const prefix = [permissions, user(marker),
      { type: "function_call", call_id: "call_prewarm_history", name: "fixture_read", arguments: '{"path":"already-read.txt"}' },
      { type: "function_call_output", call_id: "call_prewarm_history", output: "existing result, do not repeat the tool" }];
    client.send(create({ generate: false, input: prefix, stream_id: "prepare-first" }));
    const first = await client.terminal();
    expect(first.event).toMatchObject({ type: "response.completed", stream_id: "prepare-first", response: {
      status: "completed", model, output: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    } });
    const firstId = first.event.response.id;
    expect(firstId).toMatch(/^resp_.+/);
    expect(first.events.filter(event => event.type === "response.created")).toHaveLength(1);
    expect(first.events.find(event => event.type === "response.created")!.response).toMatchObject({
      id: firstId, status: "in_progress", model, output: [],
    });
    expect(first.events.every(event => event.stream_id === "prepare-first")).toBe(true);
    expect(requests).toHaveLength(0);
    expect(f.adapterConstructions()).toBe(0);
    await f.counts(0, 0);

    const extra = user("additional context without generation");
    client.send(create({ generate: false, previous_response_id: firstId, input: [extra], stream_id: "prepare-second" }));
    const second = await client.terminal();
    expect(second.event).toMatchObject({ type: "response.completed", response: { status: "completed", output: [] } });
    const secondId = second.event.response.id;
    expect(secondId).toMatch(/^resp_.+/);
    expect(secondId).not.toBe(firstId);
    expect(f.adapterConstructions()).toBe(0);
    expect(requests).toHaveLength(0);

    // An unrelated normal request schedules a real disk snapshot. This must not accidentally
    // persist either prepared entry merely because both share the module-global state cache.
    const normal = await fetch(`${f.base}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body({ stream: false, input: [user("unrelated normal request")] })) });
    expect(normal.status).toBe(200);
    const normalResponse = await normal.json();
    expect(normalResponse).toMatchObject({ status: first.event.response.status, model: first.event.response.model });
    const snapshot = stateSnapshot();
    const storedIds = (JSON.parse(snapshot).states as Array<[string, unknown]>).map(([id]) => id);
    expect(storedIds).toContain(normalResponse.id);
    expect(storedIds).not.toContain(firstId);
    expect(storedIds).not.toContain(secondId);
    expect(snapshot).not.toContain(marker);

    const tail = user("now generate from the complete prepared prefix");
    client.send(create({ generate: true, previous_response_id: secondId, input: [tail], stream_id: "consume-prefix" }));
    const generated = await client.terminal();
    expect(generated.event.type).toBe("response.completed");
    expect(requests).toHaveLength(2); // one unrelated HTTP generation, then exactly one continuation
    expect(f.adapterConstructions()).toBe(2);
    const continued = requests[1]!;
    expect(continued.context.source!.input).toEqual([...prefix, extra, tail]);
    expect(continued._replayPrefixLen).toBe(prefix.length + 1);
    expect(continued.context.source!.tools).toEqual(tools);
    expect(continued.options.reasoning).toBe("xhigh");
    expect(continued._rawBody).toMatchObject({ model, tools, reasoning: { effort: "xhigh" } });
    expect(continued._rawBody).not.toHaveProperty("generate");
    await f.counts(0, 0);
  });

  test("continuations are isolated by authorization/account and WebSocket generations stay off disk", async () => {
    const requests: CodexParsedRequest[] = [];
    const marker = `scoped_ws_${randomUUID()}`;
    const f = fixture(async (parsed, _incoming, emit) => { requests.push(parsed); complete(emit, marker); });
    const alice = await f.connect({ authorization: "Bearer fixture-alice", "chatgpt-account-id": "a" });
    const bob = await f.connect({ authorization: "Bearer fixture-bob", "chatgpt-account-id": "a" });
    const accountB = await f.connect({ authorization: "Bearer fixture-alice", "chatgpt-account-id": "b" });
    alice.send(create({ input: [user(marker)], stream_id: "source" }));
    const first = await alice.terminal();
    expect(first.event.type).toBe("response.completed");
    const id = first.event.response.id;
    for (const other of [bob, accountB]) {
      other.send(create({ previous_response_id: id, input: [user("unauthorized continuation")] }));
      expect((await other.terminal()).event).toMatchObject({ type: "error", error: { code: "previous_response_not_found" } });
    }
    expect(requests).toHaveLength(1);
    alice.send(create({ previous_response_id: id, input: [user("authorized fork")], stream_id: "branch" }));
    expect((await alice.terminal()).event.type).toBe("response.completed");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.context.source!.input)).toContain(marker);
    const unrelated = await fetch(`${f.base}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body({ stream: false, input: [user("ordinary independent HTTP history")] })) });
    expect(unrelated.status).toBe(200);
    await unrelated.text();
    const snapshot = stateSnapshot();
    const storedIds = (JSON.parse(snapshot).states as Array<[string, unknown]>).map(([storedId]) => storedId);
    expect(storedIds).not.toContain(id);
    // The synthetic HTTP response also contains marker; assert the WS-owned response ID instead.
    expect(snapshot).not.toContain("fixture-alice");
    await f.counts(0, 0);
  });

  test("one connection runs independent lanes and queues same-lane work through the shared dispatcher", async () => {
    const a = deferred(), b = deferred(), entered = deferred(), second = deferred();
    const order: string[] = [];
    const f = fixture(async (parsed, _incoming, emit) => {
      const label = (parsed._rawBody as WireEvent).metadata.fixtureLabel;
      order.push(label);
      if (order.length === 2) entered.resolve();
      if (label === "a1") await a.promise;
      if (label === "b1") await b.promise;
      if (label === "a2") second.resolve();
      complete(emit, label);
    });
    f.releases.push(() => { a.resolve(); b.resolve(); });
    const client = await f.connect();
    client.send(create({ stream_id: "a", metadata: { fixtureLabel: "a1" } }));
    client.send(create({ stream_id: "a", metadata: { fixtureLabel: "a2" } }));
    client.send(create({ stream_id: "b", metadata: { fixtureLabel: "b1" } }));
    await bounded(entered.promise, "independent lanes entered");
    expect(order).toEqual(["a1", "b1"]);
    await f.counts(2, 3); // two active generations and one queued operation
    a.resolve(); await bounded(second.promise, "same-lane successor enters after settlement");
    expect(order).toEqual(["a1", "b1", "a2"]);
    b.resolve();
    const results = [await client.terminal(), await client.terminal(), await client.terminal()];
    expect(results.every(result => result.event.type === "response.completed")).toBe(true);
    expect(results.map(result => result.event.stream_id).sort()).toEqual(["a", "a", "b"]);
    await f.counts(0, 0);
  });

  test("steering waits for client tool results, then applies one identified user revision with explicit continuation settings", async () => {
    const gate = deferred();
    const requests: CodexParsedRequest[] = [];
    const f = fixture(async (parsed, _incoming, emit) => {
      requests.push(parsed);
      if (requests.length === 1) {
        await gate.promise;
        emit({ type: "tool_call_start", id: "call_steer_once", name: "fixture_read" });
        emit({ type: "tool_call_delta", arguments: '{"path":"fixture.txt"}' }); emit({ type: "tool_call_end" });
        emit({ type: "done", endTurn: false });
      } else complete(emit, "steered fixture");
    });
    f.releases.push(() => gate.resolve());
    const client = await f.connect();
    const metadata = { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_steering_fixture", turn_id: "turn_steering_fixture" }) };
    const instruction = { ...user("original request"), id: "msg_initial_steer", internal_chat_message_metadata_passthrough: { turn_id: "turn_steering_fixture" } };
    client.send(create({ stream_id: "task", client_metadata: metadata, input: [permissions, instruction] }));
    let created: WireEvent;
    do { created = await client.next(); } while (created.type !== "response.created");
    const parent = created.response.id;
    client.send({ type: "response.steer", previous_response_id: parent, input: "Use the returned result and explain it briefly" });
    let accepted: WireEvent;
    do { accepted = await client.next(); } while (accepted.type !== "response.steer.accepted" && accepted.type !== "response.steer.failed");
    expect(accepted.type).toBe("response.steer.accepted"); expect(accepted.stream_id).toBe("task");
    expect(requests).toHaveLength(1); gate.resolve();
    const first = await client.terminal(); expect(first.event.type).toBe("response.completed");
    const pending = await client.next();
    expect(pending).toMatchObject({ type: "response.steer.pending", stream_id: "task", steer: { id: accepted.steer.id, previous_response_id: parent } });
    expect(requests).toHaveLength(1);
    client.send(create({ stream_id: "task", previous_response_id: parent, client_metadata: metadata,
      reasoning: { effort: "medium" }, tools: [],
      input: [{ type: "function_call_output", call_id: "call_steer_once", output: "saved tool result, execute nothing again" }] }));
    const completed = await client.terminal(); expect(completed.event.type).toBe("response.completed");
    expect(requests).toHaveLength(2);
    expect(requests[1]!.context.source!.tools).toEqual([]); expect(requests[1]!.options.reasoning).toBe("medium");
    const history = requests[1]!.context.source!.input as WireEvent[];
    const steers = history.filter(item => item.role === "user" && item.content === "Use the returned result and explain it briefly");
    expect(steers).toHaveLength(1); expect(steers[0]).toMatchObject({ type: "message", id: expect.any(String) });
    const { extractChatGptTurnUserRevision } = await import("../../src/adapters/chatgpt-web/prompt/environment");
    expect(extractChatGptTurnUserRevision(requests[1]!)).toBe("Use the returned result and explain it briefly");
    expect(history.filter(item => item.type === "function_call_output")).toHaveLength(1);
    await f.counts(0, 0);
  });

  test("prewarm validates tools, schema, model, controls, context, previous ID and compaction before caching or adapter admission", async () => {
    const requests: CodexParsedRequest[] = [];
    const f = fixture(async (parsed, _incoming, emit) => { requests.push(parsed); complete(emit); });
    const client = await f.connect();
    const prefix = [permissions, user(`validated_anchor_${randomUUID()}`)];
    client.send(create({ generate: false, input: prefix }));
    const anchor = await client.terminal();
    expect(anchor.event.type).toBe("response.completed");
    const anchorId = anchor.event.response.id;
    expect(anchorId).toMatch(/^resp_.+/);
    const baseline = stateSnapshot();
    const failures: Array<{ name: string; extra: WireEvent; code?: string }> = [
      { name: "tool", extra: { tools: [{ type: "fixture_unsupported_tool" }] } },
      { name: "request-schema", extra: { reasoning: 42 } },
      { name: "output-schema", extra: { text: { format: { type: "json_schema", name: "invalid_fixture_schema", strict: true,
        schema: { type: "not-a-json-schema-type" } } } } },
      { name: "model", extra: { model: "chatgpt-web/fixture-unknown-model" } },
      { name: "control", extra: { temperature: 0 }, code: "unsupported_web_request_control" },
      { name: "context", extra: { input: [{ type: "reasoning", encrypted_content: "opaque-fixture-state" }] }, code: "incompatible_web_context" },
      { name: "previous-id", extra: { previous_response_id: `resp_missing_prewarm_${randomUUID()}` }, code: "previous_response_not_found" },
      { name: "compaction", extra: { input: [{ type: "compaction_trigger" }] }, code: "unsupported_compaction_prewarm" },
    ];
    for (const failure of failures) {
      client.send(create({ generate: false, previous_response_id: anchorId, input: [user(`rejected-${failure.name}`)],
        stream_id: `invalid-${failure.name}`, ...failure.extra }));
      const reply = await client.terminal();
      expect(reply.events).toHaveLength(1);
      expect(reply.event).toMatchObject({ type: "error", status: 400, stream_id: `invalid-${failure.name}` });
      if (failure.code) expect(reply.event.error.code).toBe(failure.code);
      expect(reply.event).not.toHaveProperty("response"); // no successful/prepared ID may escape validation
      expect(requests).toHaveLength(0);
      expect(f.adapterConstructions()).toBe(0);
      expect(stateSnapshot()).toBe(baseline);
      await f.counts(0, 0);
    }
    const tail = user("continue the valid anchor after rejected preparations");
    client.send(create({ previous_response_id: anchorId, input: [tail] }));
    expect((await client.terminal()).event.type).toBe("response.completed");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context.source!.input).toEqual([...prefix, tail]);
    expect(requests[0]!._replayPrefixLen).toBe(prefix.length);
    await f.counts(0, 0);
  });

  test("native generate:false is explicitly rejected without an upstream generation or cache entry", async () => {
    let runs = 0, upstreamAttempts = 0;
    const f = fixture(async (_parsed, _incoming, emit) => { runs++; complete(emit); });
    const client = await f.connect({ authorization: "Bearer synthetic-native-prewarm-token" });
    const baseline = stateSnapshot();
    const originalFetch = globalThis.fetch;
    // Safety net for a regression in the native guard: never send synthetic credentials or
    // a generation to an external service. This interception exists only in the owned child.
    globalThis.fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== f.base) {
        upstreamAttempts++;
        throw new Error("Native prewarm attempted an external request in the isolated fixture");
      }
      return originalFetch(input, init);
    }, { preconnect: originalFetch.preconnect }) as typeof fetch;
    try {
      client.send(create({ generate: false, model: "gpt-6.1-sol", stream_id: "native-prewarm" }));
      const reply = await client.terminal();
      expect(reply.events).toHaveLength(1);
      expect(reply.event).toMatchObject({ type: "error", status: 400, stream_id: "native-prewarm", error: {
        code: "unsupported_native_prewarm", param: "generate", retryable: false,
      } });
      expect(reply.event).not.toHaveProperty("response");
      expect(upstreamAttempts).toBe(0);
      expect(runs).toBe(0);
      expect(f.adapterConstructions()).toBe(0);
      expect(stateSnapshot()).toBe(baseline);
      await f.counts(0, 0);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("drain blocks prewarm without changing its anchor and resume prepares context without generation", async () => {
    const requests: CodexParsedRequest[] = [];
    const f = fixture(async (parsed, _incoming, emit) => { requests.push(parsed); complete(emit); });
    const client = await f.connect(), prefix = [permissions, user("drain prewarm anchor")];
    client.send(create({ generate: false, input: prefix }));
    const anchor = await client.terminal();
    expect(anchor.event.type).toBe("response.completed");
    const anchorId = anchor.event.response.id;
    expect((await f.admin("drain")).status).toBe(200);
    client.send(create({ generate: false, previous_response_id: anchorId, input: [user("must not enter cache while drained")] }));
    const rejected = await client.terminal();
    expect(rejected.events).toHaveLength(1);
    expect(rejected.event).toMatchObject({ type: "error", status: 503, error: { code: "server_draining" } });
    expect(f.adapterConstructions()).toBe(0);
    await f.counts(0, 0);
    expect((await f.admin("resume")).status).toBe(200);
    const extra = user("accepted after resume");
    client.send(create({ generate: false, previous_response_id: anchorId, input: [extra] }));
    const prepared = await client.terminal();
    expect(prepared.event).toMatchObject({ type: "response.completed", response: { output: [] } });
    expect(f.adapterConstructions()).toBe(0);
    const tail = user("generate now");
    client.send(create({ previous_response_id: prepared.event.response.id, input: [tail] }));
    expect((await client.terminal()).event.type).toBe("response.completed");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context.source!.input).toEqual([...prefix, extra, tail]);
    await f.counts(0, 0);
  });

  test("shared WebSocket preserves model, effort, declared tools and cached tool-result history", async () => {
    const requests: CodexParsedRequest[] = [];
    const f = fixture(async (parsed, _incoming, emit) => {
      requests.push(parsed);
      if (requests.length === 1) {
        emit({ type: "tool_call_start", id: "call_fixture_once", name: "fixture_read" });
        emit({ type: "tool_call_delta", arguments: '{"path":"fixture.txt"}' });
        emit({ type: "tool_call_end" });
        emit({ type: "done", stopReason: "tool_use", endTurn: false });
      } else complete(emit, "consumed fixture result");
    });
    const client = await f.connect({ authorization: "Bearer synthetic-client-credential" });
    client.send(create({ stream_id: "first" }));
    const first = await client.terminal();
    expect(first.event.type).toBe("response.completed");
    expect(first.events.every(event => event.stream_id === "first")).toBe(true);
    const toolCall = first.event.response.output.find((item: WireEvent) => item.type === "function_call");
    expect(toolCall).toMatchObject({ call_id: "call_fixture_once", name: "fixture_read", arguments: '{"path":"fixture.txt"}' });
    const result = { type: "function_call_output", call_id: toolCall.call_id, output: "synthetic file contents" };
    client.send(create({ stream_id: "second", previous_response_id: first.event.response.id, input: [result] }));
    const second = await client.terminal();
    expect(second.event.type).toBe("response.completed");
    expect(second.events.every(event => event.stream_id === "second")).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.context.source!.input).toEqual([permissions, user(), ...first.event.response.output, result]);
    expect(requests[1]!._replayPrefixLen).toBe(2 + first.event.response.output.length);
    for (const parsed of requests) {
      expect(parsed._rawBody).toMatchObject({ model, reasoning: { effort: "xhigh" }, tools, store: false });
      expect(parsed.modelId).toBe(CHATGPT_WEB_MODEL_ID);
      expect(parsed._chatgptModelFamily).toBe("6");
      expect(parsed.options.reasoning).toBe("xhigh");
      expect(parsed.context.source!.tools).toEqual(tools);
      expect(parsed.context.tools!.map(tool => tool.name)).toEqual(["fixture_read"]);
    }
    expect(second.event.response.model).toBe(model);
    await f.counts(0, 0);
  });

  test("missing previous_response_id fails with 400 and only explicit full-history recovery dispatches once", async () => {
    const requests: CodexParsedRequest[] = [];
    const f = fixture(async (parsed, _incoming, emit) => { requests.push(parsed); complete(emit, "read the supplied tool result"); });
    const client = await f.connect();
    // The client owns an already executed call/result pair. Recovering context must not cause
    // the transport to resubmit the old call as a new model request or execute any tool itself.
    let clientExecutions = 0;
    const originalCall = { type: "function_call", call_id: "call_previously_executed", name: "fixture_read", arguments: '{"path":"fixture.txt"}' };
    const originalResult = { type: "function_call_output", call_id: originalCall.call_id, output: `result-${++clientExecutions}` };
    const missing = `resp_missing_${randomUUID()}`;
    client.send(create({ previous_response_id: missing, input: [originalResult], stream_id: "missing" }));
    const failure = await client.terminal();
    expect(failure.events).toHaveLength(1);
    expect(failure.event).toMatchObject({ type: "error", status: 400, stream_id: "missing",
      error: { code: "previous_response_not_found", param: "previous_response_id", retryable: false } });
    expect(requests).toHaveLength(0);
    await f.counts(0, 0);
    const http = await fetch(`${f.base}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body({ previous_response_id: missing, input: [originalResult] })) });
    expect(http.status).toBe(400);
    expect((await http.json()).error.code).toBe("previous_response_not_found");
    expect(requests).toHaveLength(0);
    const fullHistory = [permissions, user(), originalCall, originalResult, user("continue from the existing result")];
    client.send(create({ previous_response_id: null, input: fullHistory, stream_id: "explicit-recovery" }));
    const recovered = await client.terminal();
    expect(recovered.event.type).toBe("response.completed");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context.source!.input).toEqual(fullHistory);
    expect((requests[0]!._rawBody as WireEvent).previous_response_id).toBeUndefined();
    expect(recovered.event.response.output.some((item: WireEvent) => item.type === "function_call")).toBe(false);
    expect(clientExecutions).toBe(1);
    await f.counts(0, 0);
  });

  test("authenticated drain/resume gates existing and new WebSockets and shares HTTP active counts", async () => {
    const release = deferred(), enteredWs = deferred(), enteredHttp = deferred();
    let runs = 0;
    const f = fixture(async (parsed, _incoming, emit) => {
      runs++;
      const hold = (parsed._rawBody as WireEvent).metadata?.fixture;
      if (hold === "hold-ws" || hold === "hold-http") {
        (hold === "hold-ws" ? enteredWs : enteredHttp).resolve(); await release.promise;
      }
      complete(emit);
    });
    f.releases.push(() => release.resolve());
    const active = await f.connect(), idle = await f.connect();
    active.send(create({ metadata: { fixture: "hold-ws" } }));
    await bounded(enteredWs.promise, "active WebSocket adapter");
    const pendingHttp = fetch(`${f.base}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body({ metadata: { fixture: "hold-http" } })) }).then(response => response.text());
    void pendingHttp.catch(() => {});
    await bounded(enteredHttp.promise, "active HTTP adapter");
    await f.counts(2, 1);
    expect((await f.admin("drain", undefined, "Bearer invalid")).status).toBe(401);
    expect((await f.health()).accepting_turns).toBe(true);
    const drained = await f.admin("drain");
    expect(await drained.json()).toMatchObject({ accepting_turns: false, active_http_turns: 2, active_websocket_turns: 1 });
    idle.send(create());
    expect((await idle.terminal()).event).toMatchObject({ type: "error", status: 503, error: { code: "server_draining" } });
    await expect(f.connect()).rejects.toThrow("upgrade rejected");
    const rejectedHttp = await fetch(`${f.base}/v1/responses`, { method: "POST", body: JSON.stringify(body()) });
    expect(rejectedHttp.status).toBe(503); await rejectedHttp.text();
    expect((await f.admin("shutdown")).status).toBe(409);
    expect(runs).toBe(2);
    release.resolve();
    expect((await active.terminal()).event.type).toBe("response.completed");
    expect(await bounded(pendingHttp, "existing HTTP completion during drain")).toContain("response.completed");
    await f.counts(0, 0);
    expect((await f.admin("resume", undefined, "Bearer invalid")).status).toBe(401);
    expect((await f.health()).accepting_turns).toBe(false);
    expect((await f.admin("resume")).status).toBe(200);
    idle.send(create());
    expect((await idle.terminal()).event.type).toBe("response.completed");
    const fresh = await f.connect(); fresh.send(create());
    expect((await fresh.terminal()).event.type).toBe("response.completed");
    expect(runs).toBe(4);
    await f.counts(0, 0);
  });

  test("disconnect aborts only its active request and native turn interrupt keeps identity and control authority", async () => {
    type Held = { parsed: CodexParsedRequest; incoming: IncomingMeta; release: ReturnType<typeof deferred<void>>;
      aborted: ReturnType<typeof deferred<void>>; finished: ReturnType<typeof deferred<void>> };
    const held = new Map<string, Held>();
    const entered = new Map(["turn_ws_a", "turn_ws_b", "turn_http"].map(turn => [turn, deferred()]));
    const f = fixture(async (parsed, incoming, emit) => {
      const identity = extractChatGptTurnIdentity(parsed);
      const key = identity.threadId === "thread_http" ? "turn_http" : identity.turnId!;
      const run: Held = { parsed, incoming, release: deferred(), aborted: deferred(), finished: deferred() };
      held.set(key, run); f.releases.push(() => run.release.resolve());
      const abort = () => run.aborted.resolve();
      incoming.abortSignal!.addEventListener("abort", abort, { once: true });
      entered.get(key)!.resolve();
      try {
        await Promise.race([run.release.promise, run.aborted.promise]);
        if (incoming.abortSignal!.aborted) throw incoming.abortSignal!.reason;
        complete(emit);
      } finally { incoming.abortSignal!.removeEventListener("abort", abort); run.finished.resolve(); }
    });
    const metadata = (thread: string, turn: string) => ({ "x-codex-turn-metadata": JSON.stringify({ thread_id: thread, turn_id: turn }) });
    const a = await f.connect({ authorization: "Bearer fixture-client-a" });
    const b = await f.connect({ authorization: "Bearer fixture-client-b" });
    b.send(create({ headers: { authorization: `Bearer ${f.config.controlToken}` } }));
    expect((await b.terminal()).event.error.code).toBe("unsupported_websocket_headers");
    expect(held.size).toBe(0);
    a.send(create({ client_metadata: metadata("thread_ws_shared", "turn_ws_a") }));
    b.send(create({ client_metadata: metadata("thread_ws_shared", "turn_ws_b") }));
    const pendingHttp = fetch(`${f.base}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body({ client_metadata: metadata("thread_http", "turn_ws_b") })) }).then(response => response.text());
    void pendingHttp.catch(() => {});
    await bounded(Promise.all([...entered.values()].map(value => value.promise)), "three independent adapters");
    await f.counts(3, 2);
    expect(held.get("turn_ws_a")!.incoming.headers.get("authorization")).toBe("Bearer fixture-client-a");
    expect(held.get("turn_ws_b")!.incoming.headers.get("authorization")).toBe("Bearer fixture-client-b");
    for (const run of held.values()) {
      expect(run.parsed.context.source!.input).toEqual([permissions, user()]);
      expect(run.parsed.context.source!.tools).toEqual(tools);
    }
    a.socket.close(); await bounded(a.closed, "first socket close");
    await bounded(held.get("turn_ws_a")!.aborted.promise, "disconnect reaches only its adapter");
    expect(held.get("turn_ws_b")!.incoming.abortSignal!.aborted).toBe(false);
    expect(held.get("turn_http")!.incoming.abortSignal!.aborted).toBe(false);
    await f.counts(2, 1);
    const target = { threadId: "thread_ws_shared", turnId: "turn_ws_b" };
    expect((await f.admin("interrupt-turn", target, "Bearer fixture-client-b")).status).toBe(401);
    expect(held.get("turn_ws_b")!.incoming.abortSignal!.aborted).toBe(false);
    const wrong = await f.admin("interrupt-turn", { threadId: "thread_wrong", turnId: "turn_ws_b" });
    expect(await wrong.json()).toMatchObject({ cancelled_http_turns: 0 });
    const interrupted = await f.admin("interrupt-turn", target);
    expect(interrupted.status).toBe(200);
    expect(await interrupted.json()).toMatchObject({ cancelled_http_turns: 1, cancelled_browser_turns: 0 });
    await bounded(held.get("turn_ws_b")!.aborted.promise, "exact native turn interrupt");
    expect(held.get("turn_http")!.incoming.abortSignal!.aborted).toBe(false);
    const stopped = await b.terminal();
    expect(["error", "response.failed"]).toContain(stopped.event.type);
    await f.counts(1, 0);
    b.socket.close(); await bounded(b.closed, "idle socket close");
    expect(held.get("turn_http")!.incoming.abortSignal!.aborted).toBe(false);
    held.get("turn_http")!.release.resolve();
    expect(await bounded(pendingHttp, "unrelated HTTP finishes normally")).toContain("response.completed");
    await bounded(Promise.all([...held.values()].map(run => run.finished.promise)), "all owned adapters settled");
    await f.counts(0, 0);
    expect(held.size).toBe(3);
  });
}
