import { expect, test } from "bun:test";
import { savedChatTask } from "../../../../src/adapters/chatgpt-web/conversation/saved-chat-task";
import { assertSavedChatIdentity } from "../../../../src/adapters/chatgpt-web/browser/saved-chat";
import type { CodexParsedRequest } from "../../../../src/types";

function request(text: string, thread = "thread-one"): CodexParsedRequest {
  return {
    modelId: "chatgpt-web", stream: true, options: {}, context: { messages: [] },
    _rawBody: { client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: thread, turn_id: "turn-one" }) },
      input: [{ type: "message", role: "user", content: text, internal_chat_message_metadata_passthrough: { turn_id: "turn-one" } }] },
  };
}

test("saved task metadata follows the thread and extracts the IDE request", () => {
  const parsed = request("# Context from my IDE setup:\n## Active file: README.md\n## My request:\n修复登录问题");
  const first = savedChatTask(parsed)!;
  expect(first.taskName).toBe("修复登录问题");
  expect(first.kind).toBe("dialogue");
  expect(savedChatTask({ ...parsed, _compactionRequest: true })).toEqual({ ...first, kind: "compaction" });
  expect(savedChatTask(request("another request"))!.taskKey).toBe(first.taskKey);
  expect(savedChatTask(request("same words", "other-thread"))!.taskKey).not.toBe(first.taskKey);
  expect(savedChatTask({ ...parsed, _rawBody: {} })).toBeUndefined();
});

test("task titles are bounded and exclude control characters", () => {
  expect(Array.from(savedChatTask(request("长".repeat(200)))!.taskName)).toHaveLength(36);
  expect(savedChatTask(request("修复\n登录\t问题"))!.taskName).toBe("修复 登录 问题");
});

test("incremental submission requires the exact saved conversation even after a same-page reload", () => {
  const page = { url: () => "https://chatgpt.com/c/expected?model=pro" };
  expect(() => assertSavedChatIdentity(page, "expected")).not.toThrow();
  for (const url of ["https://chatgpt.com/", "https://chatgpt.com/c/other", "https://example.com/c/expected"]) {
    expect(() => assertSavedChatIdentity({ url: () => url }, "expected")).toThrow("conversation changed");
  }
});
