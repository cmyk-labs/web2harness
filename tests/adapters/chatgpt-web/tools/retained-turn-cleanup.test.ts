import { expect, test } from "bun:test";
import { ChatGptTurnSessions, ChatGptTraceFeed, ChatGptTextFeed } from "../../../../src/adapters/chatgpt-web/tools/turn-execution";

const { releaseRetainedConversation } = require("../../../../launcher/electron/runtime/retained-turn-release.cjs");

function fixture() {
  const sessions = new ChatGptTurnSessions();
  const host = {
    turnTabs: new Map<string, { id: string; traceId: string; status: string; conversationKey: string; awaitingToolResults: boolean }>(),
    removeTurnTab(tab: { id: string }, abort: boolean) { expect(abort).toBe(false); this.turnTabs.delete(tab.id); },
    logger: { info() {} },
  };
  function runtime(traceId: string, key: string, physicalSettlement = Promise.resolve()) {
    return {
      mode: "read-only" as const, browser: Promise.resolve("native tool calls"), physicalSettlement,
      conversationKey: key, trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(), cancel() {},
      releaseRetainedTurn: async () => { releaseRetainedConversation(host, key, traceId); },
    };
  }
  async function retained(id: string, owner: string, key: string) {
    host.turnTabs.set(id, { id, traceId: id, conversationKey: key, status: "ready", awaitingToolResults: true });
    const session = sessions.getOrCreate(id, () => runtime(id, key), id, owner, "native-turn", owner);
    await session.browserOutcome;
    await session.physicalSettlement;
    return session;
  }
  return { sessions, host, runtime, retained };
}

test("compaction retires request-keyed tool pages while keeping native replay and other threads intact", async () => {
  const { sessions, host, retained, runtime } = fixture();
  const old = await retained("round-hash-old", "thread-a", "a".repeat(64));
  await retained("other-thread", "thread-b", "b".repeat(64));
  // Same history, next tool-result request: the retained page must remain protected.
  await sessions.getOrCreateAfterOwnerRetirement("same-history", "thread-a", () => runtime("same-history", "a".repeat(64)),
    "same-history", undefined, "native-turn", "thread-a", undefined, { key: "a".repeat(64) });
  expect(host.turnTabs.get("round-hash-old")?.awaitingToolResults).toBe(true);
  const compact = await sessions.getOrCreateAfterOwnerRetirement("compaction-hash", "thread-a", () => ({
    ...runtime("compaction-hash", "unused"), conversationKey: undefined,
  }), "compaction-hash", undefined, "native-turn", "thread-a", undefined, {});
  await compact.physicalSettlement;
  expect(host.turnTabs.has("round-hash-old")).toBe(false);
  expect(host.turnTabs.get("other-thread")?.awaitingToolResults).toBe(true);
  expect(sessions.find("round-hash-old")).toBe(old);
  expect(old.settledOutcome()).toEqual({ type: "final", answer: "native tool calls" });
  expect(old.conversationKey()).toBeUndefined();
});

test("revised history retires the old epoch but late cancellation cannot close its newer owner", async () => {
  const { sessions, host, retained, runtime } = fixture();
  const key = "a".repeat(64);
  await retained("old-request", "thread-a", key);
  // The same physical page has since been handed to another native turn.
  host.turnTabs.get("old-request")!.traceId = "new-request";
  await sessions.cancelNativeTurn("thread-a", "native-turn", new Error("interrupted")).settlement;
  expect(host.turnTabs.get("old-request")?.traceId).toBe("new-request");
  expect(host.turnTabs.get("old-request")?.awaitingToolResults).toBe(true);
  // A new conversation epoch releases only pages that still belong to its old responses.
  await retained("other-old", "thread-c", "c".repeat(64));
  await sessions.getOrCreateAfterOwnerRetirement("revised", "thread-c", () => runtime("revised", "d".repeat(64)),
    "revised", undefined, "new-turn", "thread-c", undefined, { key: "d".repeat(64) });
  expect(host.turnTabs.has("other-old")).toBe(false);
  expect(host.turnTabs.has("old-request")).toBe(true);
});

test("exact native cancellation releases a settled tool page only after physical helper cleanup", async () => {
  const { sessions, host, runtime } = fixture();
  let settle!: () => void;
  const physical = new Promise<void>(resolve => { settle = resolve; });
  const key = "a".repeat(64);
  host.turnTabs.set("cancelled", { id: "cancelled", traceId: "cancelled", conversationKey: key, status: "ready", awaitingToolResults: true });
  const session = sessions.getOrCreate("request-hash", () => runtime("cancelled", key, physical),
    "cancelled", "thread-a", "turn-a", "thread-a");
  await session.browserOutcome;
  const cancel = sessions.cancelNativeTurn("thread-a", "turn-a", new Error("interrupted"));
  expect(cancel.cancelled).toBe(1);
  expect(host.turnTabs.has("cancelled")).toBe(true);
  settle();
  await cancel.settlement;
  expect(host.turnTabs.has("cancelled")).toBe(false);
});

test("a release failure stays observable and a later admission retries physical cleanup", async () => {
  const { sessions, host, retained, runtime } = fixture();
  const old = await retained("old-request", "thread-a", "a".repeat(64));
  const release = old.runtime.releaseRetainedTurn!;
  old.runtime.releaseRetainedTurn = async () => { throw new Error("release channel failed"); };
  const next = () => sessions.getOrCreateAfterOwnerRetirement("new-request", "thread-a",
    () => runtime("new-request", "b".repeat(64)), "new-request", undefined, "next-turn", "thread-a", undefined, { key: "b".repeat(64) });
  await expect(next()).rejects.toThrow("release channel failed");
  expect(host.turnTabs.has("old-request")).toBe(true);
  expect(sessions.find("new-request")).toBeUndefined();
  old.runtime.releaseRetainedTurn = release;
  await next();
  expect(host.turnTabs.has("old-request")).toBe(false);
});
