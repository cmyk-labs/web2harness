import { expect, test } from "bun:test";
import vm from "node:vm";
import { observeSendInput, reconcileSendAcceptance, type SendAcceptanceSnapshot } from "../../../../src/adapters/chatgpt-web/browser/send-input-probe";

function inputPage() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const timers = new Map<number, () => void>();
  let timer = 0;
  class Element { closest() { return true; } }
  class KeyboardEvent { key = "private-key"; }
  const target = new Element();
  const context = vm.createContext({ window: {}, Element, KeyboardEvent,
    document: { activeElement: target,
      addEventListener(type: string, fn: (event: any) => void) { const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set); },
      removeEventListener(type: string, fn: (event: any) => void) { listeners.get(type)?.delete(fn); } },
    setTimeout(fn: () => void) { timers.set(++timer, fn); return timer; }, clearTimeout(id: number) { timers.delete(id); },
  });
  return {
    page: { evaluate: async (fn: Function, argument: unknown) => {
      context.argument = argument; return vm.runInContext(`(${fn.toString()})(argument)`, context);
    } } as any,
    emit(type = "click") {
      const event = type === "keydown" ? new KeyboardEvent()
        : { type, target, isTrusted: true, defaultPrevented: false, privateText: "PRIVATE_PROMPT" };
      for (const fn of listeners.get(type) ?? []) fn(event);
      if ("defaultPrevented" in event) event.defaultPrevented = true;
    },
    expire() { for (const fn of [...timers.values()]) fn(); },
    get listeners() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
  };
}

test("expired input listener preserves bounded click evidence beyond the acknowledgement deadline", async () => {
  const f = inputPage(); const finish = await observeSendInput(f.page, "button");
  f.emit("keydown");
  for (let i = 0; i < 20; i++) f.emit();
  f.expire();
  expect(f.listeners).toBe(0);
  const result: any = await finish();
  expect(result).toMatchObject({ available: true, expired: true, droppedEvents: 4 });
  expect(result.events).toHaveLength(16);
  expect(result.events[0]).toMatchObject({ type: "click", prevented: true, sendTarget: true });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(await finish()).toMatchObject({ available: false, reason: "missing" });
});

test("a replaced probe cannot collect or dispose the next page owner's evidence", async () => {
  const f = inputPage(); const first = await observeSendInput(f.page, "button");
  f.emit();
  const next = await observeSendInput(f.page, "button");
  expect(await first()).toMatchObject({ available: false, reason: "replaced" });
  f.emit("submit");
  const result: any = await next();
  expect(result.events.map((e: any) => e.type)).toEqual(["submit"]);
  expect(result.expired).toBe(false);
  expect(f.listeners).toBe(0);
});

test("failed probe installation and reads are observation failures, not zero input evidence", async () => {
  const failed: any = { evaluate: async () => { throw new Error("fixture observation failed"); } };
  expect(await (await observeSendInput(failed, "button"))()).toMatchObject({ available: false, reason: "install_failed" });
  const f = inputPage(); const finish = await observeSendInput(f.page, "button");
  f.page.evaluate = failed.evaluate;
  expect(await finish()).toMatchObject({ available: false, reason: "read_failed" });
  f.expire(); expect(f.listeners).toBe(0);
});

const pending = (): SendAcceptanceSnapshot => ({ armed: true, matchedRequests: 1, responseReceived: true, status: 200, accepted: false });
const accepted = (): SendAcceptanceSnapshot => ({ ...pending(), accepted: true, projection: { inputBound: true } });

test("late bound input acceptance reconciles the original send without a mutation", async () => {
  let state = pending(), reads = 0;
  const timer = setTimeout(() => { state = accepted(); }, 15);
  try {
    expect(await reconcileSendAcceptance({ read: () => { reads++; return state; }, connected: () => true, timeoutMs: 300 })).toBe("confirmed");
    expect(reads).toBeGreaterThan(1);
  } finally { clearTimeout(timer); }
});

test("repeated identical observations never manufacture an input acknowledgement", async () => {
  let reads = 0;
  expect(await reconcileSendAcceptance({ read: () => { reads++; return pending(); }, connected: () => true, timeoutMs: 130 })).toBe("timeout");
  expect(reads).toBeGreaterThan(1);
});

test.each([
  { ...accepted(), matchedRequests: 2 },
  { ...accepted(), reason: "response_request_ambiguous" },
  { ...accepted(), projection: { inputBound: true, reason: "response_identity_mismatch" } },
])("conflicting identity defeats an earlier positive acceptance signal: %j", async state => {
  expect(await reconcileSendAcceptance({ read: () => state, connected: () => true })).toBe("ambiguous");
});

test("cancellation retires observation without converting late acceptance into success", async () => {
  const controller = new AbortController();
  let state = pending();
  const timer = setTimeout(() => { state = accepted(); controller.abort(); }, 15);
  try {
    expect(await reconcileSendAcceptance({ read: () => state, connected: () => true, signal: controller.signal })).toBe("cancelled");
  } finally { clearTimeout(timer); }
});

test("a disconnected page cannot use a stale positive acceptance snapshot", async () => {
  expect(await reconcileSendAcceptance({ read: accepted, connected: () => false })).toBe("disconnected");
});

test("lost observation and a transport response without bound input preserve uncertainty", async () => {
  expect(await reconcileSendAcceptance({ read: () => ({ ...pending(), reason: "response_observation_rebound" }), connected: () => true })).toBe("unavailable");
  expect(await reconcileSendAcceptance({ read: () => ({ ...accepted(), projection: { inputBound: false } }), connected: () => true, timeoutMs: 0 })).toBe("timeout");
});
