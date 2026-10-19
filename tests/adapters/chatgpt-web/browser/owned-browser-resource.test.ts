import { expect, spyOn, test } from "bun:test";
import { acquireOwnedBrowserResource } from "../../../../src/adapters/chatgpt-web/browser/owned-browser-resource";
import { ChatGptBrowserWorker } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";

test("pending browser creation times out and closes only its late resource", async () => {
  let ready!: (resource: object) => void;
  const resource = {}, closed: object[] = [];
  const opening = new Promise<object>(resolve => { ready = resolve; });
  await expect(acquireOwnedBrowserResource(() => opening, async value => { closed.push(value); }, undefined, 10))
    .rejects.toMatchObject({ name: "ChatGptBrowserObservationTimeoutError" });
  expect(closed).toEqual([]);
  ready(resource);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(closed).toEqual([resource]);
});

test("cancelled acquisition retires a late result; normal acquisition transfers ownership", async () => {
  const controller = new AbortController();
  let ready!: (resource: object) => void;
  const resource = {}, closed: object[] = [];
  const result = acquireOwnedBrowserResource(() => new Promise<object>(resolve => { ready = resolve; }),
    async value => { closed.push(value); }, controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  ready(resource);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(closed).toEqual([resource]);
  const normal = {};
  expect(await acquireOwnedBrowserResource(async () => normal, async value => { closed.push(value); })).toBe(normal);
  expect(closed).toEqual([resource]);
});

test("browser cleanup has its own limit and does not declare an unclosed browser released", async () => {
  const browser = { close: () => new Promise<void>(() => {}) };
  const worker: any = { browser, activeRuns: new Map(), maintenanceTail: Promise.resolve() };
  const originalTimeout = globalThis.setTimeout;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: any[]) => void, ms: number, ...args: any[]) =>
    originalTimeout(fn, ms === 120_000 ? 10 : ms, ...args)) as typeof setTimeout);
  try {
    await expect(ChatGptBrowserWorker.prototype.close.call(worker))
      .rejects.toMatchObject({ name: "ChatGptBrowserObservationTimeoutError" });
    expect(worker.browser).toBe(browser);
  } finally { timer.mockRestore(); }
});
