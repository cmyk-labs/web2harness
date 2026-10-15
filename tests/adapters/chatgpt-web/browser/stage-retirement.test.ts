import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";

type StageRunner = {
  runStage<T>(trace: string, stage: string, timeout: number,
    action: (signal: AbortSignal) => Promise<T>, clock: { suspendedMs(): number },
    waitForCleanup: boolean, retirement: { graceMs: number; closeOwnedPage(): Promise<void> }): Promise<T>;
};
const worker = () => Object.create(ChatGptBrowserWorker.prototype) as StageRunner;
const clock = { suspendedMs: () => 0 };

test("an unresponsive mutation cannot release its stage before the owned page closes", async () => {
  let finishClose!: () => void, startedClose!: () => void;
  const closing = new Promise<void>(resolve => { startedClose = resolve; });
  const closed = new Promise<void>(resolve => { finishClose = resolve; });
  let settled = false;
  const result = worker().runStage("hung-mutation", "prompt_attachment", 10,
    async () => await new Promise<never>(() => {}), clock, true, {
      graceMs: 100,
      closeOwnedPage: async () => { startedClose(); await closed; },
    }).then(() => undefined, error => error).finally(() => { settled = true; });
  await closing;
  expect(settled).toBeFalse();
  finishClose();
  expect(await result).toMatchObject({ code: "chatgpt_browser_unresponsive", retryable: false, status: 502 });
  expect(settled).toBeTrue();
});

test("normal aborted cleanup preserves the page and original stage timeout", async () => {
  let cleanupFinished = false, closeCount = 0;
  const result = worker().runStage("normal-cleanup", "prompt_attachment", 10,
    async signal => {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      cleanupFinished = true;
    }, clock, true, { graceMs: 100, closeOwnedPage: async () => { closeCount++; } });
  await expect(result).rejects.toThrow("ChatGPT browser stage timed out: prompt_attachment");
  expect(cleanupFinished).toBeTrue();
  expect(closeCount).toBe(0);
});

for (const closeFailure of ["reject", "unresponsive"] as const) {
  test(`failed page retirement is reported without claiming physical closure (${closeFailure})`, async () => {
    const result = worker().runStage("close-failure", "temporary_chat_preparation", 10,
      async () => await new Promise<never>(() => {}), clock, true, {
        graceMs: 20,
        closeOwnedPage: async () => {
          if (closeFailure === "reject") throw new Error("close transport failed");
          await new Promise<never>(() => {});
        },
      });
    await expect(result).rejects.toMatchObject({
      name: "ChatGptPersistentBrowserStateError",
      message: "ChatGPT stage timed out and its task page could not be closed",
    });
  });
}
