import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Page } from "playwright-core";
import { ChatGptTurnEvidence } from "../../../../src/adapters/chatgpt-web/browser/turn-evidence";

const request = (conversation: boolean) => ({
  method: () => conversation ? "POST" : "GET",
  url: () => conversation ? "https://chatgpt.com/backend-api/f/conversation?private=SECRET" : "https://chatgpt.com/assets/SECRET.js",
  resourceType: () => conversation ? "fetch" : "script",
  failure: () => ({ errorText: "net::ERR_CONNECTION_RESET private=SECRET" }),
});

test("late conversation status and failure survive a static-resource event and handle flood", () => {
  const page = new EventEmitter(), evidence = new ChatGptTurnEvidence();
  evidence.attach(page as unknown as Page);
  // Keep requests pending to exhaust both old limits before the actual send.
  for (let i = 0; i < 180; i++) page.emit("request", request(false));
  const turn = request(true);
  page.emit("request", turn);
  page.emit("response", { request: () => turn, status: () => 429 });
  page.emit("requestfailed", turn);
  for (let i = 0; i < 100; i++) page.emit("request", request(false));
  const snapshot = evidence.snapshot();
  expect(snapshot).toMatchObject({ conversationRequestObserved: true, conversationResponses: 1,
    conversationFailed: 1, conversationFinished: 0, upstreamContentObserved: false });
  expect(snapshot.events.filter(event => event.resourceKind === "conversation")).toMatchObject([
    { event: "requested" }, { event: "response", status: 429 }, { event: "failed", networkFailure: "connection" },
  ]);
  expect(snapshot.events.length).toBe(64);
  expect(snapshot.droppedEvents).toBe(219);
  expect(JSON.stringify(snapshot)).not.toContain("SECRET");
  evidence.detach();
});

test("a long conversation stream keeps recent terminal evidence bounded and counts every completion", () => {
  const page = new EventEmitter(), evidence = new ChatGptTurnEvidence();
  evidence.attach(page as unknown as Page);
  const turns = Array.from({ length: 180 }, () => request(true));
  for (const turn of turns) page.emit("request", turn);
  for (const turn of turns) {
    page.emit("response", { request: () => turn, status: () => 200 });
    page.emit("requestfinished", turn);
  }
  const snapshot = evidence.snapshot();
  expect(snapshot).toMatchObject({ conversationResponses: 180, conversationFinished: 180,
    conversationFailed: 0, upstreamContentObserved: false, droppedEvents: 476 });
  expect(snapshot.events).toHaveLength(64);
  expect(snapshot.events.at(-1)).toMatchObject({ resourceKind: "conversation", event: "finished" });
  evidence.detach();
});

test("a same-page rebind keeps submission facts while detached pages no longer change them", () => {
  const page = new EventEmitter(), rebound = new EventEmitter(), evidence = new ChatGptTurnEvidence();
  evidence.attach(page as unknown as Page);
  const turn = request(true); evidence.submissionStarted = true;
  page.emit("request", turn);
  evidence.attach(rebound as unknown as Page);
  page.emit("response", { request: () => turn, status: () => 401 });
  rebound.emit("response", { request: () => turn, status: () => 200 });
  rebound.emit("requestfinished", turn);
  expect(evidence.snapshot()).toMatchObject({ submissionStarted: true, conversationRequestObserved: true,
    conversationResponses: 1, conversationFinished: 1 });
  expect(evidence.snapshot().events.filter(event => event.event === "response")).toMatchObject([{ status: 200 }]);
  evidence.detach(); expect(rebound.listenerCount("requestfinished")).toBe(0);
});
