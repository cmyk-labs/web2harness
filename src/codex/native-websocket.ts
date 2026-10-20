import { CODEX_BACKEND } from "./native-passthrough";
import { nativeProxyFromPac } from "./native-network";
import { readLauncherBrowserHostDescriptor } from "../browser/launcher-client";
import { BlockList, isIP } from "node:net";

type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const BETA = "responses_websockets=2026-02-06";
const terminal = new Set(["response.completed", "response.failed", "response.incomplete"]);
export type NativeWebSocketIdentity = { threadId: string; turnId: string };
export type NativeWebSocketTarget = { url: string; headers: Headers };
export interface NativeWebSocketPeer {
  readonly bufferedAmount: number;
  readonly closed: Promise<void>;
  send(text: string): void;
  terminate(): void;
}
export interface NativeWebSocketEvents {
  message(data: unknown): void;
  close(): void;
  error(): void;
}
/** Trusted transport injection, never selectable by a client frame. No retry is permitted. */
export type NativeWebSocketConnect = (target: NativeWebSocketTarget, events: NativeWebSocketEvents,
  signal: AbortSignal) => Promise<NativeWebSocketPeer>;
export interface NativeWebSocketSocket {
  send(text: string): number;
  close(code?: number, reason?: string): void;
}

/** Codex's cached provider + responses_websocket/connector.rs use provider URL + /responses.
 * Only the bridge's established Codex backend is verified here; API-key/other providers are
 * not inferred from a Bearer token. Headers belong to this upgrade, never to a frame. */
export function nativeWebSocketTarget(source: Headers, baseUrl = CODEX_BACKEND): NativeWebSocketTarget {
  if (baseUrl !== CODEX_BACKEND) throw new Error("unsupported_native_websocket_provider");
  const authorization = source.get("authorization") ?? "";
  if (!/^Bearer [^\s]+$/.test(authorization)) throw new Error("native_websocket_auth_required");
  const headers = new Headers(source);
  const remove = ["connection", "upgrade", "host", "content-length", "content-encoding", "content-type", "accept",
    "keep-alive", "proxy-connection", "proxy-authorization", "proxy-authenticate", "te", "trailer", "transfer-encoding",
    "cookie", "origin", "referer"];
  for (const name of (headers.get("connection") ?? "").split(",")) if (name.trim()) remove.push(name.trim());
  for (const name of headers.keys()) if (name.startsWith("sec-websocket-")) remove.push(name);
  for (const name of remove) headers.delete(name);
  const betas = (headers.get("openai-beta") ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (betas.some(value => value.startsWith("responses_websockets=") && value !== BETA)) {
    throw new Error("unsupported_native_websocket_version");
  }
  if (!betas.includes(BETA)) betas.push(BETA);
  headers.set("openai-beta", betas.join(", "));
  return { url: `${CODEX_BACKEND.replace(/^https:/, "wss:")}/responses`, headers };
}

/** Bun WebSocket does not inherit fetch's environment proxy handling. Resolve explicitly,
 * without rewriting the environment or guessing conflicting/unsupported proxy policies. */
export function nativeWebSocketProxyFromEnv(url: string, environment: NodeJS.ProcessEnv): { configured: boolean; proxy?: string } {
  const read = (name: string): string | undefined => {
    const upper = environment[name]?.trim(), lower = environment[name.toLowerCase()]?.trim();
    if (upper && lower && upper !== lower) throw new Error("native_websocket_proxy_conflict");
    return lower || upper || undefined;
  };
  const http = read("HTTP_PROXY"), https = read("HTTPS_PROXY"), all = read("ALL_PROXY");
  if (!http && !https && !all) return { configured: false };
  const target = new URL(url), port = target.port || (target.protocol === "wss:" ? "443" : "80");
  for (const entry of (read("NO_PROXY") ?? "").split(/[\s,]+/).filter(Boolean)) {
    if (entry === "*") return { configured: true };
    if (entry.includes("/")) {
      const [network, prefix, extra] = entry.split("/");
      const family = isIP(network ?? "");
      if (!family || extra !== undefined || !/^\d+$/.test(prefix ?? "") || Number(prefix) > (family === 4 ? 32 : 128)) {
        throw new Error("native_websocket_unsupported_no_proxy");
      }
      // CIDR entries match literal IP targets, not unrelated DNS names. Do not
      // resolve a hostname locally and thereby change the selected proxy route.
      const address = target.hostname.replace(/^\[|\]$/g, "");
      if (isIP(address) === family) {
        const subnet = new BlockList();
        const type = family === 4 ? "ipv4" : "ipv6";
        subnet.addSubnet(network!, Number(prefix), type);
        if (subnet.check(address, type)) return { configured: true };
      }
      continue;
    }
    const match = /^(\[[0-9a-f:]+\]|(?:\*\.)?\.?[a-z0-9_.-]+)(?::(\d{1,5}))?$/i.exec(entry);
    if (!match) throw new Error("native_websocket_unsupported_no_proxy");
    const host = match[1]!.toLowerCase().replace(/^\*?\./, "");
    if ((!match[2] || match[2] === port) && (target.hostname.toLowerCase() === host || target.hostname.toLowerCase().endsWith(`.${host}`))) {
      return { configured: true };
    }
  }
  const proxy = (target.protocol === "wss:" ? https : http) ?? all;
  if (!proxy) return { configured: true };
  let parsed: URL;
  try { parsed = new URL(proxy); } catch { throw new Error("native_websocket_invalid_proxy"); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.hash || parsed.search || parsed.pathname !== "/") {
    throw new Error("native_websocket_unsupported_proxy");
  }
  return { configured: true, proxy: parsed.href };
}

/** Same launcher proxy selection as native HTTP, with no alternate route or retry. */
export function createNativeWebSocketConnector(descriptorPath?: string, environment: NodeJS.ProcessEnv = process.env): NativeWebSocketConnect {
  return async (target, events, signal) => {
    const configuredProxy = nativeWebSocketProxyFromEnv(target.url, environment);
    let proxy = configuredProxy.proxy;
    const descriptorFile = descriptorPath ?? environment.WEB2HARNESS_BROWSER_HOST_DESCRIPTOR?.trim();
    if (descriptorFile && !configuredProxy.configured) {
      const descriptor = readLauncherBrowserHostDescriptor(descriptorFile);
      const response = await fetch(`${descriptor.control.endpoint}/v1/network/resolve-proxy`, {
        method: "POST", headers: { authorization: `Bearer ${descriptor.control.token}`, "content-type": "application/json" },
        body: JSON.stringify({ url: target.url.replace(/^wss:/, "https:") }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: "error",
      });
      if (!response.ok) throw new Error("native_websocket_proxy_failed");
      proxy = nativeProxyFromPac((await response.json() as { proxy?: unknown }).proxy);
    }
    signal.throwIfAborted();
    const Client = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket & { terminate(): void } };
    const socket = new Client(target.url, { headers: Object.fromEntries(target.headers), perMessageDeflate: false,
      ...(proxy ? { proxy } : {}) });
    let finish!: () => void;
    const closed = new Promise<void>(resolve => { finish = resolve; });
    return new Promise<NativeWebSocketPeer>((resolve, reject) => {
      let opened = false;
      // Settle failed/aborted handshakes only after the owned socket actually closes.
      const abort = () => { socket.terminate(); };
      signal.addEventListener("abort", abort, { once: true });
      socket.onopen = () => {
        if (signal.aborted) { abort(); return; }
        opened = true;
        resolve({ get bufferedAmount() { return socket.bufferedAmount; }, closed,
          send: text => socket.send(text), terminate: () => socket.terminate() });
      };
      socket.onmessage = event => events.message(event.data);
      socket.onerror = () => {
        if (opened) events.error();
        socket.terminate();
      };
      socket.onclose = () => {
        signal.removeEventListener("abort", abort);
        finish();
        reject(new Error("native_websocket_closed"));
        if (opened) events.close();
      };
      if (signal.aborted) abort();
    });
  };
}

interface Work {
  stream?: string;
  id?: string;
  previous?: string;
  identity?: NativeWebSocketIdentity;
}
interface Steer { parent: string; id?: string; owner: Work }
interface Session {
  socket: NativeWebSocketSocket;
  headers: Headers;
  abort: AbortController;
  peer?: NativeWebSocketPeer;
  connecting?: Promise<void>;
  closing?: Promise<void>;
  stopped: boolean;
  extensionSeen: boolean;
  input: string[];
  inputBytes: number;
  output: string[];
  outputBytes: number;
  blocked: boolean;
  timer?: ReturnType<typeof setTimeout>;
  connectTimer?: ReturnType<typeof setTimeout>;
  work: Work[];
  steers: Steer[];
  recent: Map<string, Work>;
}
export interface NativeWebSocketOptions {
  connect?: NativeWebSocketConnect;
  isNativeModel(model: string): boolean;
  identify?(body: Json, headers: Headers): NativeWebSocketIdentity | undefined;
  maxMessageBytes?: number;
  maxEventBytes?: number;
  maxQueuedBytes?: number;
  maxBufferedBytes?: number;
  connectTimeoutMs?: number;
  backpressureTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}

/** One upstream socket per downstream socket. Transparent native frames/IDs; no local
 * response cache, generated terminal, body scrubbing, model mapping, pooling or replay. */
export function createNativeWebSocketAdapter(options: NativeWebSocketOptions) {
  const sessions = new Map<NativeWebSocketSocket, Session>();
  const cleanupFailures: unknown[] = [];
  const interrupted = new Set<string>();
  const identityKey = (identity: NativeWebSocketIdentity) => JSON.stringify([identity.threadId, identity.turnId]);
  const connect = options.connect ?? createNativeWebSocketConnector();
  // Match the existing Responses transport: large request/context payloads have
  // a separate allowance from individual upstream events and output backpressure.
  const maxMessage = options.maxMessageBytes ?? 64 * 1024 * 1024;
  const maxEvent = options.maxEventBytes ?? 16 * 1024 * 1024;
  const maxInput = options.maxQueuedBytes ?? 64 * 1024 * 1024;
  const maxBuffer = options.maxBufferedBytes ?? 32 * 1024 * 1024;
  let draining = false;

  function error(s: Session, code: string, stream?: string, status = 400): void {
    deliver(s, JSON.stringify({ type: "error", status, ...(stream !== undefined ? { stream_id: stream } : {}),
      error: { type: status >= 500 ? "server_error" : "invalid_request_error", code, source: "web2harness", retryable: false,
        message: `Native WebSocket request failed (${code}). No request was replayed.` } }));
  }
  function stop(s: Session, code = 1001): void {
    if (s.stopped) return;
    s.stopped = true;
    clearTimeout(s.timer); clearTimeout(s.connectTimer);
    s.input = []; s.inputBytes = 0; s.output = []; s.outputBytes = 0;
    s.abort.abort();
    s.peer?.terminate();
    s.socket.close(code, "Native Responses connection closed; no replay");
    // A late connector result is still task-owned and must terminate before settlement.
    s.closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => { await s.connecting; s.peer?.terminate(); await s.peer?.closed; })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("native_websocket_cleanup_timeout")), options.cleanupTimeoutMs ?? 120_000); }),
        ]);
        sessions.delete(s.socket);
        s.work = []; s.steers = []; s.recent.clear();
      } catch (cause) { cleanupFailures.push(cause); }
      finally { clearTimeout(timer); }
    })();
  }
  function fail(s: Session, code: string): void {
    if (s.stopped) return;
    error(s, code, undefined, 502);
    stop(s, 1011);
  }
  function flush(s: Session): void {
    while (!s.stopped && !s.blocked && s.output.length) {
      const text = s.output.shift()!;
      s.outputBytes -= Buffer.byteLength(text);
      let sent: number;
      try { sent = s.socket.send(text); } catch { stop(s, 1011); return; }
      if (sent === 0) { stop(s, 1011); return; }
      if (sent === -1) {
        // Bun accepted this frame into its buffer. Never send it again on drain.
        s.blocked = true;
        s.timer = setTimeout(() => stop(s, 1011), options.backpressureTimeoutMs ?? 30_000);
      }
    }
  }
  function deliver(s: Session, text: string): void {
    if (s.stopped) return;
    const bytes = Buffer.byteLength(text);
    if (bytes > maxEvent || s.outputBytes + bytes > maxBuffer || s.output.length >= 128) { stop(s, 1009); return; }
    s.output.push(text); s.outputBytes += bytes; flush(s);
  }
  function upstream(s: Session, data: unknown): void {
    if (s.stopped) return;
    if (typeof data !== "string" || Buffer.byteLength(data) > maxEvent) { fail(s, "native_websocket_invalid_frame"); return; }
    let event: unknown;
    try { event = JSON.parse(data); } catch { fail(s, "native_websocket_invalid_json"); return; }
    if (!object(event) || typeof event.type !== "string") {
      fail(s, "native_websocket_invalid_event"); return;
    }
    // The owned native upstream also sends codex.rate_limits,
    // codex.response.metadata and responsesapi.websocket_timing. Preserve typed
    // metadata/extension frames verbatim; only known response events below alter
    // our lifecycle accounting. Codex owns their interpretation.
    const stream = typeof event.stream_id === "string" ? event.stream_id : undefined;
    const response = object(event.response) ? event.response : undefined;
    const id = typeof response?.id === "string" ? response.id : undefined;
    if (event.type === "response.created") {
      if (!id || id.length > 512 || s.recent.has(id)) { fail(s, "native_websocket_invalid_response"); return; }
      let work = s.work.find(item => item.stream === stream && !item.id);
      if (!work) {
        const steer = s.steers.find(item => item.id && item.owner.stream === stream && !s.work.includes(item.owner));
        if (steer) { work = { stream, previous: steer.parent, identity: steer.owner.identity }; s.work.push(work); }
      }
      // A future native request extension may create a response. The peer belongs to
      // this connection; accept its actual ID without inventing extension semantics.
      if (!work && s.extensionSeen && s.work.length < 128) { work = { stream }; s.work.push(work); }
      if (!work) { fail(s, "native_websocket_unowned_response"); return; }
      work.id = id;
      s.recent.set(id, work);
      if (s.recent.size > 1_024) s.recent.delete(s.recent.keys().next().value!);
      if (work.previous) s.steers = s.steers.filter(item => item.parent !== work.previous);
    } else if (terminal.has(event.type)) {
      const index = s.work.findIndex(item => item.id === id && item.stream === stream);
      if (!id || index < 0) { fail(s, "native_websocket_unowned_terminal"); return; }
      // Upstream owns prefill semantics. Codex accepts the terminal event without
      // requiring an empty output array; retain any returned context items verbatim.
      s.work.splice(index, 1);
    } else if (event.type.startsWith("response.steer.")) {
      const value = object(event.steer) ? event.steer : {};
      const steer = s.steers.find(item => value.id ? item.id === value.id
        || (!item.id && item.parent === value.previous_response_id) : item.parent === value.previous_response_id);
      if (event.type === "response.steer.accepted") {
        if (!steer || typeof value.id !== "string") { fail(s, "native_websocket_unowned_steer"); return; }
        steer.id = value.id;
      } else if (event.type === "response.steer.failed" && steer) s.steers.splice(s.steers.indexOf(steer), 1);
    } else if (event.type === "error") {
      // A request-scoped rejection may precede response.created. Unscoped errors are fatal
      // with multiple outstanding lanes; do not guess which request can be retried.
      const candidates = s.work.filter(item => item.stream === stream);
      if (candidates.length === 1) s.work.splice(s.work.indexOf(candidates[0]!), 1);
      else { deliver(s, data); stop(s, 1011); return; }
    }
    deliver(s, data);
  }
  function sendInput(s: Session): void {
    if (!s.peer || s.stopped) return;
    for (const text of s.input.splice(0)) {
      s.inputBytes -= Buffer.byteLength(text);
      if (s.peer.bufferedAmount + Buffer.byteLength(text) > maxInput) { fail(s, "native_websocket_input_backpressure"); return; }
      try { s.peer.send(text); } catch { fail(s, "native_websocket_send_failed"); return; }
    }
  }
  function start(s: Session): void {
    if (s.connecting || s.stopped) return;
    let target: NativeWebSocketTarget;
    try { target = nativeWebSocketTarget(s.headers); }
    catch (cause) { error(s, cause instanceof Error ? cause.message : "native_websocket_invalid_provider"); stop(s, 1008); return; }
    s.connectTimer = setTimeout(() => fail(s, "native_websocket_connect_timeout"), options.connectTimeoutMs ?? 120_000);
    s.connecting = Promise.resolve().then(() => connect(target, {
      message: data => upstream(s, data),
      error: () => fail(s, "native_websocket_transport_failed"),
      close: () => {
        if (!s.stopped && (s.work.length || s.steers.length)) error(s, "native_websocket_incomplete", undefined, 502);
        stop(s);
      },
    }, s.abort.signal)).then(peer => {
      s.peer = peer; clearTimeout(s.connectTimer);
      if (s.stopped) peer.terminate(); else sendInput(s);
    }).catch(() => { fail(s, "native_websocket_connect_failed"); });
  }
  function message(socket: NativeWebSocketSocket, data: string | Buffer): void {
    const s = sessions.get(socket);
    if (!s || s.stopped) return;
    if (typeof data !== "string") { error(s, "invalid_websocket_frame"); return; }
    if (Buffer.byteLength(data) > maxMessage) { stop(s, 1009); return; }
    let event: unknown;
    try { event = JSON.parse(data); } catch { error(s, "invalid_json"); return; }
    if (!object(event)) { error(s, "invalid_websocket_event"); return; }
    const stream = event.stream_id;
    if (stream !== undefined && (typeof stream !== "string" || !/^[A-Za-z0-9_.-]{1,256}$/.test(stream))) { error(s, "invalid_stream_id"); return; }
    if (draining) { error(s, "server_draining", stream, 503); return; }
    if ("headers" in event || "authorization" in event) { error(s, "unsupported_websocket_headers", stream); return; }
    if (typeof event.model === "string" && !options.isNativeModel(event.model)) { error(s, "websocket_route_mismatch", stream); return; }
    if (event.type === "response.create") {
      if (typeof event.model !== "string" || !event.model || !options.isNativeModel(event.model)) { error(s, "websocket_route_mismatch", stream); return; }
      if (event.generate !== undefined && typeof event.generate !== "boolean") { error(s, "invalid_websocket_generate", stream); return; }
      if (event.background === true || event.stream === false) { error(s, "unsupported_websocket_transport_option", stream); return; }
      if (s.work.length >= 128) { error(s, "native_websocket_request_limit", stream); return; }
      let identity: NativeWebSocketIdentity | undefined;
      try { identity = options.identify?.(event, s.headers); } catch { error(s, "invalid_native_turn_identity", stream); return; }
      if (identity && (identity.threadId.length > 512 || identity.turnId.length > 512)) { error(s, "invalid_native_turn_identity", stream); return; }
      if (identity && interrupted.has(identityKey(identity))) { error(s, "client_cancelled", stream); return; }
      s.work.push({ stream, identity,
        ...(typeof event.previous_response_id === "string" ? { previous: event.previous_response_id } : {}) });
    } else if (event.type === "response.steer") {
      const parent = typeof event.previous_response_id === "string" ? event.previous_response_id : "";
      const owner = s.recent.get(parent);
      if (!owner) { error(s, "response_not_found"); return; }
      if (s.steers.length >= 64) { error(s, "too_many_pending_steers"); return; }
      s.steers.push({ parent, owner });
    } else if (typeof event.type === "string" && event.type.startsWith("response.")) {
      // Pass future native extensions unchanged. Their acceptance/lifecycle remains
      // upstream-owned; do not interpret an unknown request as locally completed.
      s.extensionSeen = true;
    } else { error(s, "unsupported_websocket_event", stream); return; }
    if (s.inputBytes + Buffer.byteLength(data) > maxInput) { fail(s, "native_websocket_input_limit"); return; }
    // Preserve original JSON, generate flag, opaque context, effort and IDs exactly.
    s.input.push(data); s.inputBytes += Buffer.byteLength(data);
    start(s); sendInput(s);
  }
  return {
    open(socket: NativeWebSocketSocket, headers: Headers): void {
      if (sessions.has(socket) || sessions.size >= 128) { socket.close(1013, "Native Responses connection limit"); return; }
      sessions.set(socket, { socket, headers: new Headers(headers), abort: new AbortController(), stopped: false, extensionSeen: false,
        input: [], inputBytes: 0, output: [], outputBytes: 0, blocked: false, work: [], steers: [], recent: new Map() });
    },
    message,
    drain(socket: NativeWebSocketSocket): void { const s = sessions.get(socket); if (s) { clearTimeout(s.timer); s.blocked = false; flush(s); } },
    close(socket: NativeWebSocketSocket): void { const s = sessions.get(socket); if (s) stop(s); },
    setDraining(value: boolean): void { draining = value; },
    activeCount(): number { return [...sessions.values()].reduce((n, s) => n + s.work.length + s.steers.length + s.output.length + Number(s.blocked), 0); },
    cancelTurn(identity: NativeWebSocketIdentity): number {
      interrupted.add(identityKey(identity));
      if (interrupted.size > 1_024) interrupted.delete(interrupted.values().next().value!);
      let cancelled = 0;
      for (const s of sessions.values()) if (s.work.some(item => item.identity?.threadId === identity.threadId && item.identity.turnId === identity.turnId)
        || s.steers.some(item => item.owner.identity?.threadId === identity.threadId && item.owner.identity.turnId === identity.turnId)) {
        cancelled += s.work.length; stop(s);
      }
      return cancelled;
    },
    cancelAll(): number { let cancelled = 0; for (const s of sessions.values()) { cancelled += s.work.length; stop(s); } return cancelled; },
    closeAll(): void { draining = true; for (const s of sessions.values()) stop(s); },
    async settled(): Promise<void> {
      await Promise.all([...sessions.values()].map(s => s.closing));
      if (cleanupFailures.length) throw new AggregateError([...cleanupFailures], "Native WebSocket cleanup failed");
    },
  };
}
