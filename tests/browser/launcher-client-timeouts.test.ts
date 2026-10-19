import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectLauncherBrowserHost, selectLauncherPage, LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../../src/browser/launcher-client";
import type { Browser, BrowserContext, CDPSession } from "playwright-core";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "web2harness-client-stages-"));
  const path = join(root, "descriptor.json");
  writeFileSync(path, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND, profile: "development", pid: process.pid,
    endpoint: "http://127.0.0.1:39110", control: { endpoint: "http://127.0.0.1:39111", token: "a".repeat(48) },
    helper: { executable: process.execPath, script: import.meta.path }, partition: "persist:web2harness-dev-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: "a".repeat(32), surfaceTargets: { ["a".repeat(32)]: "owned-target" },
    createdAt: new Date().toISOString() }), { mode: 0o600 });
  let now = Date.now(), nextId = 0;
  const dateNow = spyOn(Date, "now").mockImplementation(() => now);
  const timers = new Map<number, { at: number; callback: () => void }>();
  const set = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms: number) => {
    const id = ++nextId;
    timers.set(id, { at: now + ms, callback });
    return id;
  }) as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation(((id: number) => { timers.delete(id); }) as typeof clearTimeout);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (_url, options) => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      options?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    } });
    return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
  }) as typeof fetch);
  return { path, timers,
    send: (message: unknown) => stream.enqueue(new TextEncoder().encode(`${JSON.stringify(message)}\n`)),
    tick(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    dispose() { fetchMock.mockRestore(); clear.mockRestore(); set.mockRestore(); dateNow.mockRestore(); rmSync(root, { recursive: true, force: true }); },
  };
}

test("streamed session/capability stages remain independent past the old 30/120-second caps", async () => {
  const f = fixture();
  try {
    const stages: string[] = [];
    const pending = inspectLauncherBrowserHost(f.path, { detectCapabilities: true, onStage: stage => stages.push(stage) });
    await flush();
    for (const [sequence, stage, elapsed] of [[1, "startup", 29_000], [2, "connection", 119_000], [3, "controls", 119_000], [4, "inspection", 59_000], [5, "inspection", 59_000]] as const) {
      f.send({ type: "stage", sequence, stage });
      await flush();
      f.tick(elapsed);
    }
    f.send({ type: "result", value: { authenticated: true, temporary: true, url: "https://chatgpt.com/?temporary-chat=true",
      solAvailable: true, extraHighAvailable: false, proAvailable: false } });
    expect((await pending).solAvailable).toBe(true);
    expect(stages).toEqual(["connection", "running"]);
    expect(f.timers.size).toBe(0);
  } finally { f.dispose(); }
});

test("delegated worker failures and caller cancellation remain distinct without a client operation cap", async () => {
  const f = fixture();
  try {
    const stalled = inspectLauncherBrowserHost(f.path);
    void stalled.catch(() => {});
    await flush();
    f.send({ type: "stage", sequence: 1, stage: "inspection" });
    await flush();
    f.tick(31 * 60_000);
    expect(f.timers.size).toBe(0);
    f.send({ type: "error", message: "worker inspection stage timed out" });
    await expect(stalled).rejects.toThrow("worker inspection stage timed out");
    const controller = new AbortController();
    const cancelled = inspectLauncherBrowserHost(f.path, { abortSignal: controller.signal });
    void cancelled.catch(() => {});
    await flush();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(f.timers.size).toBe(0);
  } finally { f.dispose(); }
});

test("replayed stage notifications cannot renew an inspection timer", async () => {
  const f = fixture();
  try {
    const pending = inspectLauncherBrowserHost(f.path);
    void pending.catch(() => {});
    await flush();
    for (let i = 0; i < 2; i++) f.send({ type: "stage", sequence: 1, stage: "inspection" });
    await expect(pending).rejects.toThrow("stage ownership is invalid");
  } finally { f.dispose(); }
});

test("CDP session acquisition retires a late resource after cancellation", async () => {
  const f = fixture();
  try {
    let complete!: (session: CDPSession) => void;
    let detached = 0;
    const context = { pages: () => [{}], newCDPSession: () => new Promise<CDPSession>(resolve => { complete = resolve; }) } as unknown as BrowserContext;
    const browser = { contexts: () => [context] } as unknown as Browser;
    const controller = new AbortController();
    const pending = selectLauncherPage(browser, { surfaceId: "owned", surfaceTargets: { owned: "target" } } as never, 120_000, undefined, controller.signal);
    void pending.catch(() => {});
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    complete({ detach: async () => { detached++; } } as CDPSession);
    await flush();
    expect(detached).toBe(1);
    expect(f.timers.size).toBe(0);
  } finally { f.dispose(); }
});

test("a hung native target inspection expires its own sixty-second stage and detaches", async () => {
  const f = fixture();
  try {
    let detached = 0;
    let inspectionStarted!: () => void;
    const inspecting = new Promise<void>(resolve => { inspectionStarted = resolve; });
    const context = { pages: () => [{}], newCDPSession: async () => ({
      send: () => { inspectionStarted(); return new Promise(() => {}); }, detach: async () => { detached++; },
    }) } as unknown as BrowserContext;
    const browser = { contexts: () => [context] } as unknown as Browser;
    const pending = selectLauncherPage(browser, { surfaceId: "owned", surfaceTargets: { owned: "target" } } as never, 1);
    void pending.catch(() => {});
    await inspecting;
    f.tick(60_000);
    await flush();
    expect(detached).toBe(1);
    f.tick(100);
    await expect(pending).rejects.toThrow("did not expose its owned browser surface");
    expect(f.timers.size).toBe(0);
  } finally { f.dispose(); }
});
