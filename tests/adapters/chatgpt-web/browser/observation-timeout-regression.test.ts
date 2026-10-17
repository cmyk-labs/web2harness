import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Locator, Page } from "playwright-core";
import { chromium } from "playwright-core";
import {
  proveUnsubmittedPreparation,
  readChatGptReadiness,
  waitForChatGptReadiness,
  type ChatGptReadinessSnapshot,
} from "../../../../src/adapters/chatgpt-web/browser/page-readiness";
import {
  CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS,
  ChatGptBrowserObservationTimeoutError,
  withChatGptBrowserObservationTimeout,
} from "../../../../src/adapters/chatgpt-web/browser/turn-observation";
import { ChatGptTurnEvidence } from "../../../../src/adapters/chatgpt-web/browser/turn-evidence";

// Pure in-memory fixtures: no browser, helper, network, credentials, or filesystem state.
const ready: ChatGptReadinessSnapshot = {
  documentComplete: true, surfaceBound: true, composers: 1, editable: true,
  userTurns: 0, assistantTurns: 0, stopButtons: 0, unknownEditors: 0,
  signIn: false, expired: false, verification: false, subscriptionFailure: false,
};

function pageFixture() {
  const composer = {} as Locator;
  const page = {
    locator: () => ({ filter: () => ({ first: () => composer }) }),
  } as unknown as Page;
  return { page, composer };
}

test("readiness accepts the same pending probe when it responds within the original preparation deadline", async () => {
  // Regression for trace e10d628345ef: this is intentionally red before the repair.
  // Exercise the real 2000ms timeout wrapper with an in-memory Page. A second evaluate is forbidden:
  // a Promise.race timeout leaves the first operation pending and cannot authorize an overlapping read.
  const { page, composer } = pageFixture();
  let reads = 0;
  let resolveRead!: (value: ChatGptReadinessSnapshot) => void;
  const pending = new Promise<ChatGptReadinessSnapshot>(resolve => { resolveRead = resolve; });
  Object.assign(page, { evaluate: () => {
    reads += 1;
    if (reads > 1) throw new Error("must not start a duplicate DOM read after a probe timeout");
    return pending;
  } });
  const deadline = Date.now() + 30_000;
  const timer = setTimeout(() => resolveRead(ready), 2_100);
  const observed: ChatGptReadinessSnapshot[] = [];
  try {
    const result = await waitForChatGptReadiness(page, {
      deadline,
      onSnapshot: snapshot => { observed.push(snapshot); },
    });
    expect(result).toBe(composer);
    expect(reads).toBe(1);
    expect(observed).toEqual([ready]);
    expect(Date.now()).toBeLessThan(deadline);
  } finally {
    clearTimeout(timer);
    resolveRead(ready);
    await pending;
  }
});

test("readiness uses its explicit 2000ms probe cap and clips the last probe to the original deadline", async () => {
  const { page } = pageFixture();
  let now = 0;
  const budgets: number[] = [];
  expect(CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS).toBe(5_000);
  await rejects(waitForChatGptReadiness(page, {
    deadline: 2_250,
    now: () => now,
    sleep: async ms => { now += ms; },
    read: async (_page, budget) => {
      budgets.push(budget);
      now += budget;
      return { ...ready, composers: 0, editable: false };
    },
  }), { code: "chatgpt_composer_unavailable" });
  expect(budgets).toEqual([2_000, 150]);
  expect(now).toBe(2_250);
});

test("a ready snapshot that arrives after the preparation deadline is not accepted", async () => {
  const { page } = pageFixture();
  let now = 0;
  await rejects(waitForChatGptReadiness(page, {
    deadline: 100,
    now: () => now,
    read: async () => { now = 101; return ready; },
    sleep: async () => { throw new Error("must not sleep after expiry"); },
  }), { code: "chatgpt_composer_unavailable" });
});

test("readiness never treats authentication, challenge, or ambiguous-composer failures as transient probes", async () => {
  const { page } = pageFixture();
  const scenarios: Array<[Partial<ChatGptReadinessSnapshot>, string]> = [
    [{ signIn: true }, "chatgpt_sign_in_required"],
    [{ expired: true }, "chatgpt_session_expired"],
    [{ verification: true }, "chatgpt_verification_required"],
    [{ subscriptionFailure: true }, "chatgpt_subscription_unavailable"],
    [{ composers: 2 }, "chatgpt_page_structure_unsupported"],
  ];
  for (const [snapshot, code] of scenarios) {
    let reads = 0;
    await rejects(waitForChatGptReadiness(page, {
      deadline: 30_000, now: () => 0,
      read: async () => { reads += 1; return { ...ready, ...snapshot }; },
      sleep: async () => { throw new Error("must not retry explicit page failure"); },
    }), { code });
    expect(reads).toBe(1);
  }
});

test("probe timeout does not settle or cancel the underlying read", async () => {
  let settled = false;
  let resolveRead!: (value: string) => void;
  const read = new Promise<string>(resolve => { resolveRead = resolve; });
  void read.then(() => { settled = true; });
  try {
    await rejects(withChatGptBrowserObservationTimeout(read, 5), ChatGptBrowserObservationTimeoutError);
    expect(settled).toBeFalse();
  } finally {
    resolveRead("late snapshot");
    await read;
  }
  expect(settled).toBeTrue();
});

test("a settled page-read failure preserves its original error and cause", async () => {
  const { page } = pageFixture();
  const cause = new Error("original transport cause");
  const failure = new Error("page read rejected", { cause });
  Object.assign(page, { evaluate: () => Promise.reject(failure) });
  await rejects(waitForChatGptReadiness(page, {
    deadline: Date.now() + 30_000,
  }), error => error === failure && error instanceof Error && error.cause === cause);
});

test("a fresh empty ready page cannot erase a conservative conversation POST observation", () => {
  const page = new EventEmitter();
  const evidence = new ChatGptTurnEvidence();
  evidence.attach(page as unknown as Page);
  try {
    // Synthetic child path demonstrates classifier breadth, not the historical request's URL.
    page.emit("request", {
      method: () => "POST",
      url: () => "https://chatgpt.com/backend-api/f/conversation/synthetic-initialization",
      resourceType: () => "fetch",
    });
    const transport = evidence.snapshot();
    expect(transport).toMatchObject({ submissionStarted: false, conversationRequestObserved: true,
      conversationResponses: 0, conversationFinished: 0, conversationFailed: 0 });
    expect(proveUnsubmittedPreparation(ready, {
      reused: false,
      submissionStarted: transport.submissionStarted,
      conversationRequestObserved: transport.conversationRequestObserved,
    })).toBeFalse();
  } finally {
    evidence.detach();
  }
});

test("expired preparation retains its timeout cause and a recovery read shares the outstanding probe", async () => {
  const { page } = pageFixture();
  let resolveRead!: (value: ChatGptReadinessSnapshot) => void;
  let reads = 0;
  const pending = new Promise<ChatGptReadinessSnapshot>(resolve => { resolveRead = resolve; });
  Object.assign(page, { evaluate: () => { reads += 1; return pending; } });
  try {
    await rejects(waitForChatGptReadiness(page, { deadline: Date.now() + 30 }), (error: any) => {
      expect(error.code).toBe("chatgpt_composer_unavailable");
      expect(error.cause).toBeInstanceOf(ChatGptBrowserObservationTimeoutError);
      return true;
    });
    const recovery = readChatGptReadiness(page, 500);
    resolveRead(ready);
    expect(await recovery).toEqual(ready);
    expect(reads).toBe(1);
  } finally { resolveRead(ready); await pending; }
});

test("abort during a slow observation cannot accept a late ready snapshot", async () => {
  const { page } = pageFixture();
  const controller = new AbortController();
  const reason = new DOMException("owned task cancelled", "AbortError");
  let resolveRead!: (value: ChatGptReadinessSnapshot) => void;
  const pending = new Promise<ChatGptReadinessSnapshot>(resolve => { resolveRead = resolve; });
  Object.assign(page, { evaluate: () => pending });
  let delivered = false;
  const waiting = waitForChatGptReadiness(page, {
    deadline: Date.now() + 500, signal: controller.signal, onSnapshot: () => { delivered = true; },
  });
  controller.abort(reason);resolveRead(ready);
  await rejects(waiting, error => error === reason);
  expect(delivered).toBeFalse();
});

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("a busy real renderer becomes ready without another DOM probe or send", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<textarea id="prompt-textarea"></textarea>');
    const evaluate = page.evaluate.bind(page);
    let reads = 0;
    const busy = evaluate(() => {
      const end = performance.now() + 2_200;
      while (performance.now() < end) { /* controlled local renderer stall */ }
    });
    page.evaluate = ((...args: any[]) => { reads += 1; return (evaluate as any)(...args); }) as Page["evaluate"];
    const composer = await waitForChatGptReadiness(page, { deadline: Date.now() + 10_000 });
    await busy;
    expect(await composer.getAttribute("id")).toBe("prompt-textarea");
    expect(reads).toBe(1);
    expect(await composer.inputValue()).toBe("");
  } finally { await browser.close(); }
}, 15_000);
