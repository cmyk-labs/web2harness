import { expect, test } from "bun:test";
import { ChatGptResponseSource, responseSourceBlocksFallback } from "../../../../src/adapters/chatgpt-web/browser/response-source";

const user = { id: "user", author: { role: "user" }, content: { content_type: "text", parts: ["task"] } };
const final = { id: "answer", author: { role: "assistant" }, channel: "final", recipient: "all",
  status: "finished_successfully", end_turn: true, content: { content_type: "text", parts: ["Exact **answer**"] },
  metadata: { is_complete: true, finish_details: { type: "stop" } } };
const wire = (events: unknown[]) => Buffer.from(events.map(e => `data: ${e === "[DONE]" ? e : JSON.stringify(e)}\n\n`).join(""));
function pending(extra: unknown[] = []) {
  const source = new ChatGptResponseSource({ userMessageId: "user", conversationId: "chat" });
  source.push(wire([{ type: "input_message", input_message: user, conversation_id: "chat" }, ...extra,
    { type: "message_stream_complete", conversation_id: "chat" }, "[DONE]"]));
  source.finish(); return source;
}
function saved() { return { conversation_id: "chat", current_node: "answer", mapping: {
  user: { parent: "old", message: user },
  hidden: { parent: "user", message: { id: "hidden", author: { role: "tool" }, channel: "analysis",
    content: { content_type: "text", parts: ["NEVER_EXPOSE_PRIVATE"] } } },
  answer: { parent: "hidden", message: final },
} }; }

test("zero public finals await reconciliation without becoming a successful response", () => {
  const source = pending();
  expect(source.result()).toEqual({ state: "awaiting_final", conversationId: "chat", userMessageId: "user" });
  expect(source.lifecycle().state).toBe("awaiting_final");
  expect(responseSourceBlocksFallback(source.result())).toBeFalse();
});

test("same-turn saved final recovers exact public text; private ancestors stay private", () => {
  const source = pending();
  expect(source.reconcileSavedConversation(saved())).toEqual({ state: "complete", text: "Exact **answer**", messageId: "answer", conversationId: "chat" });
  expect(source.result().state).toBe("complete");
  expect(source.lifecycle()).toMatchObject({ state: "complete", messageId: "answer" });
  expect(JSON.stringify(source)).not.toContain("NEVER_EXPOSE_PRIVATE");
});

test("foreign conversation, branch, user turn, cycle, and unfinished leaf cannot recover", () => {
  const snapshots: any[] = [saved(), saved(), saved(), saved(), saved()];
  snapshots[0].conversation_id = "foreign";
  snapshots[1].mapping.answer.parent = "absent";
  snapshots[2].mapping.hidden.message.author.role = "user";
  snapshots[3].mapping.hidden.parent = "answer";
  snapshots[4].mapping.answer.message = { ...final, end_turn: false, status: "in_progress" };
  for (const snapshot of snapshots) expect(pending().reconcileSavedConversation(snapshot).state).toBe("awaiting_final");
});

test("only the active descendant branch is projected, never an unrelated sibling final", () => {
  const snapshot: any = saved();
  snapshot.mapping.foreign = { parent: "user", message: { ...final, id: "foreign", content: { content_type: "text", parts: ["WRONG_BRANCH"] } } };
  expect(pending().reconcileSavedConversation(snapshot)).toMatchObject({ state: "complete", text: "Exact **answer**" });
});

test("a later private/tool phase does not let an earlier public final end the turn", () => {
  const snapshot: any = saved();
  snapshot.mapping.active = { parent: "answer", message: { id: "active", author: { role: "tool" },
    status: "in_progress", content: { content_type: "text", parts: ["PRIVATE_ACTIVE"] } } };
  snapshot.current_node = "active";
  expect(pending().reconcileSavedConversation(snapshot).state).toBe("awaiting_final");
});

test("paginated active-branch readback uses exact turn identity across omitted/reparented private nodes", () => {
  const turn = { turn_exchange_id: "exchange", working_turn_id: "working" };
  const hidden = { id: "hidden", author: { role: "tool" }, channel: "analysis",
    content: { content_type: "text", parts: ["NEVER_EXPOSE_PRIVATE"] }, metadata: { parent_id: "user" } };
  const recap = { id: "recap", author: { role: "assistant" }, recipient: "all", channel: null,
    content: { content_type: "reasoning_recap", parts: ["PRIVATE_RECAP"] }, metadata: { ...turn, parent_id: "hidden" } };
  const snapshot = { conversation_id: "chat", current_node: "answer", messages: [{ ...user, metadata: turn },
    { ...recap, metadata: { ...turn, parent_id: "saved-private-node" } },
    { ...final, metadata: { ...final.metadata, ...turn, parent_id: "recap" } }],
    page_info: { has_previous_page: false, has_next_page: false } };
  const source = pending([{ message: hidden }, { message: recap }]);
  expect(source.reconcileSavedConversation(snapshot)).toMatchObject({ state: "complete", text: "Exact **answer**" });
  expect(JSON.stringify(source)).not.toContain("NEVER_EXPOSE_PRIVATE");
  expect(JSON.stringify(source)).not.toContain("PRIVATE_RECAP");
  expect(pending().reconcileSavedConversation(snapshot).state).toBe("complete");
  // The user, active leaf and both turn IDs are required; list proximity alone is insufficient.
  for (const changed of [
    { ...snapshot, messages: snapshot.messages.slice(1) },
    { ...snapshot, messages: [user, ...snapshot.messages.slice(1)] },
    { ...snapshot, messages: [...snapshot.messages.slice(0, 2), { ...final, metadata: { ...turn, working_turn_id: "foreign" } }] },
    { ...snapshot, messages: [...snapshot.messages.slice(0, 2), { ...final, metadata: { ...turn, turn_exchange_id: "foreign" } }] },
    { ...snapshot, messages: [snapshot.messages[0], { ...user, id: "another-user", metadata: turn }, snapshot.messages[2]] },
  ]) expect(pending().reconcileSavedConversation(changed).state).toBe("awaiting_final");
  const missingTip = { ...snapshot, current_node: "hidden" };
  expect(pending([{ message: hidden }]).reconcileSavedConversation(missingTip).state).toBe("awaiting_final");
});

test("readback cannot repair upstream errors, conflicting identities, interruption, or conflicting finals", () => {
  const upstream = pending([{ error: { message: "upstream failure" } }]);
  expect(upstream.reconcileSavedConversation(saved())).toMatchObject({ state: "rejected", reason: "response_upstream_error" });
  for (const change of [
    { status: "finished_partial" },
    { metadata: { is_complete: false } },
    { metadata: { finish_details: { type: "length" } } },
  ]) {
    const snapshot = saved(); snapshot.mapping.answer.message = { ...final, ...change } as typeof final;
    expect(pending().reconcileSavedConversation(snapshot)).toMatchObject({ state: "rejected", reason: "response_message_incomplete" });
  }
  const conflict: any = saved();
  conflict.mapping.hidden.message = { ...final, id: "hidden" };
  expect(pending().reconcileSavedConversation(conflict)).toMatchObject({ state: "rejected", reason: "response_final_message_ambiguous" });
  const known = pending([{ message: { ...final, id: "hidden", end_turn: false, metadata: { parent_id: "user" } } }]);
  expect(known.reconcileSavedConversation(saved())).toMatchObject({ state: "rejected", reason: "response_identity_mismatch" });
});
