import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { Page, Locator } from "playwright-core";
import { ChatGptPreparationBudget, CHATGPT_PREPARATION_BUDGET_MS, CHATGPT_UNSUBMITTED_PREPARATION,
  preparationError, proveUnsubmittedPreparation, waitForChatGptReadiness, type ChatGptReadinessSnapshot } from "../../../../src/adapters/chatgpt-web/browser/page-readiness";
import { ChatGptBrowserWorker, type BrowserTurn } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { ChatGptExternalTurnProgress } from "../../../../src/adapters/chatgpt-web/tools/turn-progress";
import { ChatGptTurnEvidence } from "../../../../src/adapters/chatgpt-web/browser/turn-evidence";
import { StandaloneRequestQueue } from "../../../../src/browser/standalone-request-queue";
import { bridgeToResponsesSSE } from "../../../../src/responses/stream";
import type { AdapterEvent } from "../../../../src/types";
import { ChatGptStreamProjection } from "../../../../src/adapters/chatgpt-web/browser/stream-evidence";
import { ChatGptBrowserObservationTimeoutError } from "../../../../src/adapters/chatgpt-web/browser/turn-observation";

test("bounded SSE projection distinguishes visible prose, tool messages and DONE without retaining bodies", () => {
  const projection = new ChatGptStreamProjection();
  const message = (role: string, channel: string, content_type: string, text: string) => ({
    message: { author: { role }, channel, content: { content_type, parts: [text], text } },
  });
  const frames = [message("assistant", "analysis", "text", "PRIVATE_REASONING"),
    message("assistant", "commentary", "code", "PRIVATE_TOOL_ARGUMENTS"),
    message("tool", "commentary", "text", "PRIVATE_TOOL_RESULT"),
    message("assistant", "final", "text", "结果"), { p: "/message/content/parts/0", o: "append", v: "完成" }];
  const bytes = Buffer.from(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n");
  for (let i = 0; i < bytes.length; i += 7) projection.push(bytes.subarray(i, i + 7).toString("base64"));
  expect(projection.facts).toMatchObject({ done: true, assistantMessageSeen: true,
    toolMessageSeen: true, toolResultSeen: true, visibleTextChars: 2, visibleDeltaChars: 2, malformedFrames: 0 });
  expect(JSON.stringify(projection.facts)).not.toContain("PRIVATE");
  const oversized = new ChatGptStreamProjection(); oversized.push("A".repeat(1_400_001));
  expect(oversized.facts).toMatchObject({ truncated: true, done: false, visibleTextChars: 0 });
});

const empty: ChatGptReadinessSnapshot = { documentComplete: true, surfaceBound: true, composers: 0, editable: false,
  userTurns: 0, assistantTurns: 0, stopButtons: 0, unknownEditors: 1, signIn: false, expired: false,
  verification: false, subscriptionFailure: false };
const unsent = { reused: false, submissionStarted: false, conversationRequestObserved: false };

test("readiness waits for editable hydration and gives explicit auth/challenge errors before a composer", async () => {
  const composer = {} as Locator;
  const page = { locator: () => ({ filter: () => ({ first: () => composer }) }) } as unknown as Page;
  let now = 0, reads = 0;
  const options = { deadline: 1_000, now: () => now, sleep: async (ms: number) => { now += ms; } };
  expect(await waitForChatGptReadiness(page, { ...options, read: async () => {
    reads += 1;
    return reads < 3 ? empty : { ...empty, composers: 1, editable: true };
  } })).toBe(composer);
  expect(reads).toBe(3);
  for (const [flag, code] of [["signIn", "chatgpt_sign_in_required"], ["expired", "chatgpt_session_expired"],
    ["verification", "chatgpt_verification_required"], ["subscriptionFailure", "chatgpt_subscription_unavailable"]] as const) {
    await rejects(waitForChatGptReadiness(page, { ...options, read: async () => ({ ...empty, [flag]: true }) }), { code });
  }
  await rejects(waitForChatGptReadiness(page, { ...options, read: async () => ({ ...empty, composers: 2 }) }),
    { code: "chatgpt_page_structure_unsupported" });
  await rejects(waitForChatGptReadiness(page, { ...options, read: async () => empty }), { code: "chatgpt_composer_unavailable" });
  expect(now).toBe(1_000);
  const abort = new AbortController(); abort.abort();
  await rejects(waitForChatGptReadiness(page, { ...options, signal: abort.signal, read: async () => { throw new Error("read after cancel"); } }),
    { name: "AbortError" });
});

test("readiness retries observation timeouts only within the original deadline and retains their cause", async () => {
  const error = new ChatGptBrowserObservationTimeoutError(5_000);
  let now = 0;
  let reads = 0;
  await rejects(waitForChatGptReadiness({} as Page, {
    deadline: 250, now: () => now, sleep: async ms => { now += ms; },
    read: async () => { reads++; throw error; },
  }), failure => {
    expect(failure).toMatchObject({ code: "chatgpt_composer_unavailable", status: 502, retryable: false });
    expect((failure as Error).cause).toBe(error);
    return true;
  });
  expect(now).toBe(250);
  expect(reads).toBe(3);
});

test("readiness cancellation during observation recovery stops further reads", async () => {
  const abort = new AbortController();
  let reads = 0;
  await rejects(waitForChatGptReadiness({} as Page, {
    deadline: 1_000, now: () => 0, signal: abort.signal,
    sleep: async () => { abort.abort(); },
    read: async () => { reads++; throw new ChatGptBrowserObservationTimeoutError(5_000); },
  }), { name: "AbortError" });
  expect(reads).toBe(1);
});

test("prepared alone never authorizes recovery; missing or positive submission evidence denies it", () => {
  expect(proveUnsubmittedPreparation(empty, unsent)).toBeTrue();
  expect(proveUnsubmittedPreparation(undefined, unsent)).toBeFalse();
  for (const flag of ["reused", "submissionStarted", "conversationRequestObserved"] as const) {
    expect(proveUnsubmittedPreparation(empty, { ...unsent, [flag]: true })).toBeFalse();
  }
  for (const field of ["userTurns", "assistantTurns", "stopButtons"] as const) {
    expect(proveUnsubmittedPreparation({ ...empty, [field]: 1 }, unsent)).toBeFalse();
  }
  for (const field of ["signIn", "expired", "verification", "subscriptionFailure"] as const) {
    expect(proveUnsubmittedPreparation({ ...empty, [field]: true }, unsent)).toBeFalse();
  }
  expect(proveUnsubmittedPreparation(empty, { ...unsent, progress: { revision: 1, lastToolBatchRevision: 0, activeToolCalls: 0 } })).toBeFalse();
});

test("navigation and both observations share one deadline and one consumed recovery", () => {
  const budget = new ChatGptPreparationBudget();
  expect(budget.start(10)).toBe(10 + CHATGPT_PREPARATION_BUDGET_MS);
  expect(budget.start(30_010)).toBe(90_010);
  expect(budget.recover(30_010)).toBeTrue();
  expect(budget.recover(31_010)).toBeFalse();
  expect(budget.start(80_010)).toBe(90_010);
  const timedOut = new ChatGptPreparationBudget(); timedOut.start(10);
  expect(timedOut.recover(90_010)).toBeFalse();
  const closed = new ChatGptPreparationBudget(); closed.start(10); closed.closedAt = 20;
  expect(closed.recover(30)).toBeFalse();
});

test("actual Responses failure frames keep page errors, generic 503, overload, auth and limits distinct", async () => {
  const cases: Array<[Extract<AdapterEvent, { type: "error" }>, string]> = [
    [{ type: "error", message: "ChatGPT composer is unavailable. Reload ChatGPT and retry the task." }, "upstream_server_error"],
    [{ type: "error", message: "Service temporarily unavailable", status: 503 }, "upstream_server_error"],
    [{ type: "error", message: "Server is overloaded", status: 503 }, "server_is_overloaded"],
    [{ type: "error", message: "Model unavailable" }, "invalid_request_error"],
    [{ type: "error", message: "Rate limit exceeded", status: 429 }, "rate_limit_exceeded"],
    [{ type: "error", message: "Authentication failed", status: 401 }, "invalid_api_key"],
  ];
  for (const code of ["chatgpt_composer_unavailable", "chatgpt_preparation_timeout", "chatgpt_sign_in_required"] as const) {
    const error = preparationError(code);
    cases.push([{ type: "error", message: error.message, status: error.status, errorType: error.errorType,
      code: error.code, retryable: false }, code]);
  }
  for (const [event, code] of cases) {
    const body = await new Response(bridgeToResponsesSSE((async function* () { yield event; })(), "gpt-6-sol")).text();
    const failed = body.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)))
      .find(item => item.type === "response.failed");
    expect(failed.response.error.code).toBe(code);
    expect(failed.response.error.message).toBe(event.message);
  }
});

test("page transport evidence is bounded, redacted, sticky across rebinding and does not invent SSE content", () => {
  const page = new EventEmitter(); const otherPage = new EventEmitter();
  const evidence = new ChatGptTurnEvidence(); evidence.attach(page as unknown as Page);
  const request = { method: () => "POST", url: () => "https://chatgpt.com/backend-api/f/conversation?token=PRIVATE",
    resourceType: () => "fetch", failure: () => ({ errorText: "net::ERR_CONNECTION_RESET secret=PRIVATE" }) };
  page.emit("request", request); page.emit("response", { request: () => request, status: () => 200 });
  page.emit("requestfailed", request);
  for (let i = 0; i < 200; i++) page.emit("request", { ...request, method: () => "GET", resourceType: () => "script" });
  evidence.attach(otherPage as unknown as Page);
  expect(page.listenerCount("request")).toBe(0);
  const snapshot = evidence.snapshot();
  expect(snapshot).toMatchObject({ conversationRequestObserved: true, conversationResponses: 1,
    conversationFailed: 1, conversationFinished: 0, upstreamContentObserved: false });
  expect(snapshot.events.length).toBeLessThanOrEqual(64);
  expect(snapshot.droppedEvents).toBeGreaterThan(0);
  const { safeDetail } = require("../../../../launcher/shared/diagnostic-event.cjs");
  expect(JSON.stringify(safeDetail(snapshot))).toContain('"networkFailure":"connection"');
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
  evidence.detach(); expect(otherPage.listenerCount("request")).toBe(0);
});

test("real queue releases failed preparation before re-admission, preserves budget on reconnect and never multiplies retries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cgw-preparation-"));
  const queue = await StandaloneRequestQueue.open(join(directory, "state.json"));
  await queue.updateSettings({ maxConcurrent: 1, queueTimeoutMinutes: 5, minSendIntervalSeconds: 1 });
  const admissions: string[] = []; const settled: string[] = []; const deadlines: number[] = [];
  let calls = 0;
  const progress = new ChatGptExternalTurnProgress();
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { browserHost: "managed-chrome" }, activeRuns: new Map(), preparationBudgets: new Map(),
    requestQueueTarget: async () => ({ request: async (action: string, input: any) => {
      if (action === "enqueue") {
        expect(queue.snapshot().active).toBe(0);
        admissions.push(input.job.id);
      }
      const result = await queue.request(action, input);
      if (action === "settle") { settled.push(input.id); expect(queue.snapshot().active).toBe(0); }
      return result;
    } }),
    runExclusive: async (turn: BrowserTurn) => {
      calls++; deadlines.push(turn.preparationDeadline!);
      if (calls === 1) throw preparationError(CHATGPT_UNSUBMITTED_PREPARATION);
      await turn.onSendActivated?.(); return "done";
    },
  }) as ChatGptBrowserWorker;
  const key = createHash("sha256").update(directory).digest("hex");
  const turn: BrowserTurn = { traceId: "preparation-test", preparationKey: key,
    scheduling: { id: key, groupId: "test", model: "gpt-6-sol", mode: "mcp-bridge", bytes: 1 },
    modelId: "gpt-6-sol", externalProgress: progress,
    capabilities: { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
    prepare: async () => ({ text: "test", images: [], release() {} }), onTextDelta() {} };
  try {
    expect(await worker.run(turn)).toBe("done");
    expect(admissions.length).toBe(2); expect(new Set(admissions).size).toBe(2);
    expect(settled).toEqual(admissions); expect(deadlines[0]).toBe(deadlines[1]);
    await rejects(worker.run({ ...turn, traceId: "reconnected" }));
    expect(calls).toBe(2);
    const originalBudget = (worker as any).preparationBudgets.get(key);
    originalBudget.deadline = Date.now() - 1;
    const retryId = createHash("sha256").update(`${key}:retry:1`).digest("hex");
    expect(await worker.run({ ...turn, traceId: "authorized-model-retry", allowPreparationRecovery: false,
      scheduling: { ...turn.scheduling!, id: retryId } })).toBe("done");
    expect(calls).toBe(3);
    expect((worker as any).preparationBudgets.get(key)).toBe(originalBudget);
    expect(originalBudget.recoveries).toBe(1);
    expect(originalBudget.deadline).toBeLessThan(Date.now());
    for (const scenario of ["generic-retry", "send-started", "tool-accepted", "release-failed", "cancelled", "exhausted"] as const) {
      const scenarioKey = createHash("sha256").update(scenario).digest("hex");
      let attempts = 0;
      const abort = new AbortController(); const toolProgress = new ChatGptExternalTurnProgress();
      (worker as any).runExclusive = async (current: BrowserTurn) => {
        attempts++;
        if (scenario === "send-started") await current.onSendActivated?.();
        if (scenario === "tool-accepted") toolProgress.recordToolBatch(1);
        if (scenario === "release-failed") throw new AggregateError([preparationError(CHATGPT_UNSUBMITTED_PREPARATION)], "release failed");
        if (scenario === "cancelled") abort.abort();
        throw preparationError(CHATGPT_UNSUBMITTED_PREPARATION);
      };
      await rejects(worker.run({ ...turn, traceId: scenario, preparationKey: scenarioKey, abortSignal: abort.signal,
        scheduling: { ...turn.scheduling!, id: scenarioKey }, externalProgress: toolProgress,
        allowPreparationRecovery: scenario !== "generic-retry" }));
      expect(attempts).toBe(scenario === "exhausted" ? 2 : 1);
      expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0 });
    }
  } finally {
    await queue.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
