import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../../src/config";
import { startServer } from "../../src/server";
import * as browserWorkers from "../../src/adapters/chatgpt-web/browser/browser-worker";
import { operationStage } from "../../src/runtime/operation-stage";

test("signal shutdown cancels owned HTTP work and closes transport after independent cleanup", async () => {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, "web2harness-signal-shutdown-"));
  const previous = process.env.WEB2HARNESS_HOME;
  process.env.WEB2HARNESS_HOME = root;
  const previousListeners = new Set(process.listeners("SIGTERM"));
  const previousInterruptListeners = new Set(process.listeners("SIGINT"));
  let releaseCleanup!: () => void;
  const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const cleanup = spyOn(browserWorkers, "closeChatGptBrowserWorkers").mockImplementation(() => operationStage("cleanup", () => cleanupGate));
  let upstreamSignal!: AbortSignal;
  let acknowledgeRequest!: () => void;
  let releaseUpstream!: (response: Response) => void;
  const requestStarted = new Promise<void>(resolve => { acknowledgeRequest = resolve; });
  const server = startServer({ ...defaultConfig("browser-only"), port: 0 }, {
    fetchUpstream: request => {
      upstreamSignal = request.signal;
      acknowledgeRequest();
      // Deliberately ignore cancellation: shutdown must still close this socket.
      return new Promise<Response>(resolve => { releaseUpstream = resolve; });
    },
  });
  const stop = spyOn(server, "stop");
  const request = fetch(`http://127.0.0.1:${server.port}/v1/alpha/search`, {
    method: "POST",
    headers: { authorization: "Bearer fixture-native-session", "content-type": "application/json" },
    body: JSON.stringify({ query: "fixture shutdown" }),
  }).catch(() => null);
  try {
    await requestStarted;
    const shutdown = process.listeners("SIGTERM").find(listener => !previousListeners.has(listener))!;
    shutdown("SIGTERM");
    expect(upstreamSignal.aborted).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    releaseCleanup();
    await request;
    expect(stop).toHaveBeenCalledWith(true);
  } finally {
    releaseCleanup();
    releaseUpstream?.(new Response(null, { status: 204 }));
    await server.stop(true);
    stop.mockRestore();
    cleanup.mockRestore();
    for (const listener of process.listeners("SIGTERM")) if (!previousListeners.has(listener)) process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT")) if (!previousInterruptListeners.has(listener)) process.removeListener("SIGINT", listener);
    if (previous === undefined) delete process.env.WEB2HARNESS_HOME;
    else process.env.WEB2HARNESS_HOME = previous;
    expect(dirname(root)).toBe(parent);
    rmSync(root, { recursive: true, force: true });
  }
});

test("authenticated shutdown streams independent cleanup owners and completes only after both finish", async () => {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, "web2harness-shutdown-stages-"));
  const previous = process.env.WEB2HARNESS_HOME;
  const previousListeners = new Set(process.listeners("SIGTERM"));
  const previousInterruptListeners = new Set(process.listeners("SIGINT"));
  process.env.WEB2HARNESS_HOME = root;
  let releaseFirst!: () => void, releaseSecond!: () => void;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  const cleanup = spyOn(browserWorkers, "closeChatGptBrowserWorkers").mockImplementation(async () => {
    await Promise.all([operationStage("cleanup", () => first), operationStage("cleanup", () => second)]);
  });
  const config = { ...defaultConfig("browser-only"), port: 0 };
  const server = startServer(config);
  const endpoint = `http://127.0.0.1:${server.port}`;
  const headers = { authorization: `Bearer ${config.controlToken}` };
  let reading: Promise<void> | undefined;
  try {
    expect((await fetch(`${endpoint}/admin/drain`, { method: "POST", headers })).status).toBe(200);
    const response = await fetch(`${endpoint}/admin/shutdown`, { method: "POST", headers: { ...headers, accept: "application/x-ndjson" } });
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    const messages: Record<string, unknown>[] = [];
    const decoder = new TextDecoder();
    let pending = "";
    let ownersStarted!: () => void;
    const started = new Promise<void>(resolve => { ownersStarted = resolve; });
    reading = (async () => {
      for await (const bytes of response.body!) {
        pending += decoder.decode(bytes, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          messages.push(JSON.parse(pending.slice(0, newline)));
          pending = pending.slice(newline + 1);
          if (messages.filter(message => message.event === "begin" && message.stage === "cleanup").length >= 2) ownersStarted();
        }
      }
    })();
    void reading.catch(() => {});
    const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
    // Await the actual streamed ownership evidence, not a guessed number of event-loop turns.
    await started;
    expect(messages[0]).toEqual({ type: "accepted", pid: process.pid });
    expect(messages.filter(message => message.event === "begin" && message.stage === "cleanup").length).toBeGreaterThanOrEqual(2);
    releaseFirst();
    await flush();
    expect(messages.some(message => message.type === "result")).toBe(false);
    releaseSecond();
    await reading;
    expect(messages.at(-1)).toEqual({ type: "result", status: "ok", pid: process.pid });
  } finally {
    releaseFirst(); releaseSecond();
    cleanup.mockRestore();
    await server.stop(true);
    await reading?.catch(() => {});
    for (const listener of process.listeners("SIGTERM")) if (!previousListeners.has(listener)) process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT")) if (!previousInterruptListeners.has(listener)) process.removeListener("SIGINT", listener);
    if (previous === undefined) delete process.env.WEB2HARNESS_HOME;
    else process.env.WEB2HARNESS_HOME = previous;
    expect(dirname(root)).toBe(parent);
    rmSync(root, { recursive: true, force: true });
  }
});
