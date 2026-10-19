import { expect, test } from "bun:test";
import { ServerSentEventDecoder } from "../../../../src/adapters/chatgpt-web/browser/sse-decoder";
import { ChatGptResponseSource, responseSourceBlocksFallback } from "../../../../src/adapters/chatgpt-web/browser/response-source";
import { chatGptResponseRequestBinding } from "../../../../src/adapters/chatgpt-web/browser/response-stream";
import { parseNativeToolCallReply } from "../../../../src/adapters/chatgpt-web/tools/native-tool-call-block";

const binding = { userMessageId: "user-current", conversationId: "conversation-current" };
const user = { id: binding.userMessageId, author: { role: "user" }, channel: null, recipient: "all",
  content: { content_type: "text", parts: ["input"] }, status: "finished_successfully", end_turn: null, metadata: {} };
const message = (overrides = {}) => ({ id: "answer-current", author: { role: "assistant" }, channel: "final", recipient: "all",
  content: { content_type: "text", parts: [""] }, status: "in_progress", end_turn: null,
  metadata: { parent_id: user.id, citations: [], content_references: [] }, ...overrides });
const terminal = { p: "", o: "patch", v: [
  { p: "/message/status", o: "replace", v: "finished_successfully" },
  { p: "/message/end_turn", o: "replace", v: true },
  { p: "/message/metadata", o: "append", v: { is_complete: true, finish_details: { type: "stop" } } },
] };
const begin = () => ["v1", { type: "input_message", input_message: user, conversation_id: binding.conversationId },
  { p: "", o: "add", v: { message: message(), conversation_id: binding.conversationId, error: null } }];
const end = () => [terminal, { type: "message_stream_complete", conversation_id: binding.conversationId }, "[DONE]"];
const wire = (frames: unknown[], eol = "\n", space = " ") => Buffer.from(frames.map(f => `data:${space}${f === "[DONE]" ? f : JSON.stringify(f)}${eol}${eol}`).join(""));
function project(frames: unknown[], chunk = 17) {
  const source = new ChatGptResponseSource(binding), bytes = wire(frames);
  for (let i = 0; i < bytes.length; i += chunk) source.push(bytes.subarray(i, i + chunk));
  source.finish(); return source;
}

test("SSE framing supports BOM, CR/LF/CRLF, no space and multiline data across byte boundaries", () => {
  for (const newline of ["\r", "\n", "\r\n"]) for (const chunk of [1, 2, 7, 1024]) {
    const received: unknown[] = [], decoder = new ServerSentEventDecoder((data, event) => received.push({ data, event }));
    const bytes = Buffer.from(`\uFEFF:comment${newline}event:sample${newline}data:中文${newline}data: 第二行${newline}${newline}data:incomplete`);
    for (let i = 0; i < bytes.length; i += chunk) decoder.push(bytes.subarray(i, i + chunk));
    decoder.finish(); expect(received).toEqual([{ data: "中文\n第二行", event: "sample" }]);
  }
  expect(() => new ServerSentEventDecoder(() => {}).push(new Uint8Array([0xff]))).toThrow();
  expect(() => new ServerSentEventDecoder(() => {}, 4).push(Buffer.from("12345"))).toThrow("response_stream_size_limit");
});

test("v1 inherited paths and terminal patches preserve table growth, literal code and repeated paragraphs", () => {
  const first = "| 名称 | 值 |\n| --- | --- |\n| Al", last = "pha | beta_code |\n\n重复\n\n重复\n\n```ps1\nWrite-Output '中文'\n```";
  for (const size of [1, 2, 13, 4096]) {
    const result = project([...begin(), { p: "/message/content/parts/0", o: "append", v: first }, { v: last }, ...end()], size).result();
    expect(result).toEqual({ state: "complete", text: first + last, messageId: "answer-current", conversationId: binding.conversationId });
  }
});

test("replace modifies the candidate before commit; repeated strings are never deduplicated", () => {
  const result = project([...begin(), { p: "/message/content/parts/0", o: "append", v: "old" },
    { o: "replace", v: "new" }, { o: "append", v: "new" }, ...end()]).result();
  expect(result).toMatchObject({ state: "complete", text: "newnew" });
});

test("input acknowledgement hydrates the initial user snapshot without permitting known identity changes", () => {
  const prefix = ["v1", { p: "", o: "add", v: { message: user, conversation_id: binding.conversationId } },
    { type: "input_message", input_message: { ...user, metadata: { parent_id: "system" } }, conversation_id: binding.conversationId }];
  const answer = { p: "", o: "add", v: { message: message({ content: { content_type: "text", parts: ["answer"] } }), conversation_id: binding.conversationId } };
  expect(project([...prefix, answer, ...end()]).result()).toMatchObject({ state: "complete", text: "answer" });
  expect(project([...prefix, { type: "input_message", input_message: { ...user, metadata: { parent_id: "different-system" } } }]).result())
    .toMatchObject({ state: "rejected", reason: "response_identity_mismatch" });
});

test("an out-of-band input acknowledgement does not redirect the current assistant delta", () => {
  const source = project(["v1", { p: "", o: "add", v: { message: message(), conversation_id: binding.conversationId } },
    { type: "input_message", input_message: user, conversation_id: binding.conversationId },
    { p: "/message/content/parts/0", o: "append", v: "answer" }, ...end()]);
  expect(source.result()).toMatchObject({ state: "complete", text: "answer" });
});

test("private reasoning and tool bytes never reach an answer or telemetry", () => {
  const privateMessage = message({ id: "private", channel: "analysis", content: { content_type: "text", parts: ["PRIVATE_REASONING"] },
    status: "finished_successfully", end_turn: false });
  const source = project(["v1", { type: "input_message", input_message: user, conversation_id: binding.conversationId },
    { p: "", o: "add", v: { message: privateMessage, conversation_id: binding.conversationId } },
    { p: "/message/content/parts/0", o: "append", v: "MORE_PRIVATE_REASONING" },
    { p: "", o: "add", v: { message: message({ metadata: { parent_id: "private" } }), conversation_id: binding.conversationId } },
    { p: "/message/content/parts/0", o: "append", v: "public" }, ...end()]);
  expect(source.result()).toMatchObject({ state: "complete", text: "public" });
  expect(JSON.stringify(source.facts())).not.toContain("PRIVATE");
  expect(JSON.stringify(source)).not.toContain("PRIVATE");
});

test.each([
  ["DONE alone", ["[DONE]"], "response_identity_incomplete"],
  ["wrong input", [{ type: "input_message", input_message: { ...user, id: "old" }, conversation_id: binding.conversationId }], "response_identity_mismatch"],
  ["foreign conversation", [{ p: "", o: "add", v: { message: message(), conversation_id: "foreign" } }], "response_identity_mismatch"],
  ["unknown channel", [{ p: "", o: "add", v: { message: message({ channel: null }), conversation_id: binding.conversationId } }], "response_channel_unsupported"],
  ["unknown operation", [{ p: "/message/content/parts/0", o: "mystery", v: "text" }], "response_patch_unsupported"],
  ["server error", [{ error: { message: "private error" } }], "response_upstream_error"],
] as const)("%s cannot become a successful response", (_name, frames, reason) => {
  const source = project([...begin(), ...frames, { type: "message_stream_complete", conversation_id: binding.conversationId }, "[DONE]"]);
  expect(source.result()).toMatchObject({ state: "rejected", reason: _name === "DONE alone" ? "response_after_termination" : reason });
});

test("transport end and stream DONE do not replace the final message's terminal contract", () => {
  const content = { p: "/message/content/parts/0", o: "append", v: "answer" };
  expect(project([...begin(), content, "[DONE]"]).result()).toEqual({ state: "collecting" });
  expect(project([...begin(), content, { type: "message_stream_complete", conversation_id: binding.conversationId }, "[DONE]"]).result())
    .toMatchObject({ state: "rejected", reason: "response_final_message_ambiguous" });
  const partial = { ...terminal, v: [...terminal.v, { p: "/message/status", o: "replace", v: "finished_partial" }] };
  expect(project([...begin(), content, partial, { type: "message_stream_complete", conversation_id: binding.conversationId }, "[DONE]"]).result())
    .toMatchObject({ state: "rejected", reason: "response_message_incomplete" });
});

test("unbound ancestry, multiple finals, unresolved references and late data are refused", () => {
  const content = { p: "/message/content/parts/0", o: "append", v: "answer" };
  for (const [patch, reason] of [
    [{ p: "/message/metadata/parent_id", o: "replace", v: "old-answer" }, "response_parent_unbound"],
    [{ p: "/message/metadata/content_references", o: "replace", v: [{ type: "citation" }] }, "response_references_unsupported"],
  ] as const) expect(project([...begin(), content, patch, ...end()]).result()).toMatchObject({ state: "rejected", reason });
  const two = project([...begin(), content, terminal, { p: "", o: "add", v: { message: message({ id: "second" }), conversation_id: binding.conversationId } }, content, ...end()]);
  expect(two.result()).toMatchObject({ state: "rejected", reason: "response_final_message_ambiguous" });
  expect(project([...begin(), content, ...end(), content]).result()).toMatchObject({ state: "rejected", reason: "response_after_termination" });
  const late = new ChatGptResponseSource(binding);
  late.push(Buffer.concat([wire([...begin(), content, ...end()]), Buffer.from('data: {"unfinished":')]));
  late.finish();
  expect(late.result()).toMatchObject({ state: "rejected", reason: "response_after_termination" });
});

test("optional terminal metadata does not override successful completion, identity or explicit failure", () => {
  const candidate = (metadata: Record<string, unknown> = {}, status = "finished_successfully") => [
    "v1", { type: "input_message", input_message: user, conversation_id: binding.conversationId },
    { message: message({ status, end_turn: true, content: { content_type: "text", parts: ["complete answer"] },
      metadata: { parent_id: user.id, ...metadata } }), conversation_id: binding.conversationId },
    { type: "message_stream_complete", conversation_id: binding.conversationId }, "[DONE]",
  ];
  for (const metadata of [{}, { is_complete: true }, { finish_details: { type: "stop" } }]) {
    const result = project(candidate(metadata)).result();
    expect(result).toMatchObject({ state: "complete", text: "complete answer" });
    expect(responseSourceBlocksFallback(result)).toBe(false);
  }
  for (const [metadata, status, reason] of [
    [{ is_complete: false }, "finished_successfully", "response_message_incomplete"],
    [{ finish_details: { type: "length" } }, "finished_successfully", "response_message_incomplete"],
    [{ finish_details: {} }, "finished_successfully", "response_message_incomplete"],
    [{ finish_details: null }, "finished_successfully", "response_message_incomplete"],
    [{}, "finished_partial", "response_message_incomplete"],
    [{ parent_id: "unbound-parent" }, "finished_successfully", "response_parent_unbound"],
  ] as const) {
    const result = project(candidate(metadata, status)).result();
    expect(result).toEqual({ state: "rejected", reason });
    expect(responseSourceBlocksFallback(result)).toBe(true);
  }
  const noDone = project(candidate().slice(0, -1)).result();
  expect(noDone).toEqual({ state: "collecting" });
});

test("the message marker does not freeze the response before DONE", () => {
  const frames = [...begin(), { p: "/message/content/parts/0", o: "append", v: "complete" }, terminal,
    { type: "message_stream_complete", conversation_id: binding.conversationId }];
  const source = new ChatGptResponseSource(binding);
  source.push(wire(frames));
  expect(source.result()).toEqual({ state: "collecting" });
  source.push(wire([{ p: "/message/content/parts/0", o: "append", v: " answer" }, "[DONE]"]));
  source.finish();
  expect(source.result()).toMatchObject({ state: "complete", text: "complete answer" });
  for (const negative of [
    { p: "/message/metadata/is_complete", o: "replace", v: false },
    { p: "/message/metadata/finish_details", o: "replace", v: { type: "length" } },
    { p: "/message/status", o: "replace", v: "interrupted" },
  ]) {
    const result = project([...frames, negative, "[DONE]"]).result();
    expect(result).toEqual({ state: "rejected", reason: "response_message_incomplete" });
    expect(responseSourceBlocksFallback(result)).toBeTrue();
  }
  const unknown = project([...frames, { p: "/unsupported-projection", o: "replace", v: {} }, "[DONE]"]).result();
  expect(unknown).toEqual({ state: "rejected", reason: "response_patch_unsupported" });
  expect(responseSourceBlocksFallback(unknown)).toBeFalse();
  expect(project([...frames, "[DONE]", { p: "/message/content/parts/0", o: "append", v: "late" }]).result())
    .toEqual({ state: "rejected", reason: "response_after_termination" });
});

test("removing optional completion metadata restores absence, not explicit failure", () => {
  for (const keys of [["is_complete"], ["finish_details"], ["is_complete", "finish_details"]]) {
    const frames = [...begin(), { p: "/message/content/parts/0", o: "append", v: "complete answer" }, terminal,
      { p: "", o: "patch", v: keys.map(key => ({ p: `/message/metadata/${key}`, o: "remove" })) },
      { type: "message_stream_complete", conversation_id: binding.conversationId }, "[DONE]"];
    expect(project(frames).result()).toMatchObject({ state: "complete", text: "complete answer" });
    for (const [key, value] of [["is_complete", false], ["finish_details", { type: "length" }], ["finish_details", null]]) {
      const negative = [...frames.slice(0, -2), { p: `/message/metadata/${key}`, o: "add", v: value }, ...frames.slice(-2)];
      expect(project(negative).result()).toEqual({ state: "rejected", reason: "response_message_incomplete" });
    }
  }
});

test("request binding compares all text parts and retains edge whitespace and attachment parts", () => {
  const request = (parts: unknown[]) => ({ method: "POST", url: "https://chatgpt.com/backend-api/f/conversation",
    postData: JSON.stringify({ action: "next", conversation_id: binding.conversationId,
      messages: [{ ...user, content: { parts } }] }) });
  const attachment = { content_type: "image_asset_pointer", asset_pointer: "fixture-image" };
  for (const parts of [["input"], [attachment, "input"], ["in", attachment, "put"]]) {
    expect(chatGptResponseRequestBinding(request(parts), "input", binding.conversationId)).toEqual(binding);
  }
  for (const parts of [["input", "extra"], ["extra", "input"], [" input"], ["input\n"], ["input\t"], []]) {
    expect(chatGptResponseRequestBinding(request(parts), "input", binding.conversationId)).toBeUndefined();
  }
  expect(chatGptResponseRequestBinding(request([" input "]), " input ", binding.conversationId)).toEqual(binding);
  expect(chatGptResponseRequestBinding(request(["input"]), " input ", binding.conversationId)).toBeUndefined();
  expect(chatGptResponseRequestBinding(request(["a\nb"]), "a\r\nb", binding.conversationId)).toEqual(binding);
});

test("request binding requires this prompt, exact generation POST, user identity and conversation", () => {
  const request = { method: "POST", url: "https://chatgpt.com/backend-api/f/conversation", postData: JSON.stringify({ action: "next", conversation_id: binding.conversationId, messages: [user] }) };
  expect(chatGptResponseRequestBinding(request, "input", binding.conversationId)).toEqual(binding);
  for (const changed of [{ method: "GET" }, { url: `${request.url}/prepare` }, { postData: "{}" }]) {
    expect(chatGptResponseRequestBinding({ ...request, ...changed }, "input")).toBeUndefined();
  }
  expect(chatGptResponseRequestBinding(request, "different")).toBeUndefined();
  expect(chatGptResponseRequestBinding(request, "input", "old")).toBeUndefined();
});

test("complete source text retains exact native tool fences for the existing schema validator", () => {
  const text = '```codex_tool_calls\n{"calls":[{"name":"read_fixture","arguments":{"path":"input.txt"}}]}\n```';
  const result = project([...begin(), { p: "/message/content/parts/0", o: "append", v: text }, ...end()]).result();
  expect(result.state).toBe("complete");
  if (result.state !== "complete") throw new Error("Expected source");
  const tools = [{ type: "function" as const, name: "read_fixture", description: "Read a test fixture", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }];
  const parsed = parseNativeToolCallReply(result.text, tools);
  expect(parsed.issues).toEqual([]); expect(parsed.calls).toHaveLength(1);
  expect(parseNativeToolCallReply(result.text, []).calls).toHaveLength(0);
});

// Message topology observed in the 2026-10-18 owned DEV failure exports 3/5. Bodies and IDs
// are synthetic; this is a regression of the protocol shape, not a raw/private wire fixture.
test("completed descendant final supersedes an unfinished nonterminal commentary ancestor", () => {
  const commentary = message({ id: "progress", channel: "commentary", content: { content_type: "text", parts: ["Working"] } });
  const recap = message({ id: "recap", channel: null, content: { content_type: "reasoning_recap" },
    status: "finished_successfully", end_turn: false, metadata: { parent_id: commentary.id } });
  const final = message({ metadata: { parent_id: recap.id }, content: { content_type: "text", parts: ["Exact final"] } });
  const values = ["v1", { type: "input_message", input_message: user, conversation_id: binding.conversationId },
    ...[commentary, recap, final].map(m => ({ message: m, conversation_id: binding.conversationId })), ...end()];
  expect(project(values).result()).toMatchObject({ state: "complete", text: "Exact final" });
  for (const change of [
    { status: "finished_partial" }, { status: "error" }, { end_turn: true },
    { metadata: { parent_id: user.id, is_complete: false } },
    { metadata: { parent_id: user.id, finish_details: { type: "length" } } },
  ]) {
    const bad = structuredClone(values); (bad[2] as any).message = { ...commentary, ...change };
    expect(project(bad).result()).toMatchObject({ state: "rejected", reason: "response_message_incomplete" });
  }
  const sibling = structuredClone(values); (sibling[4] as any).message.metadata.parent_id = user.id;
  expect(project(sibling).result()).toMatchObject({ state: "rejected", reason: "response_message_incomplete" });
  const later = structuredClone(values); later.splice(later.length - 2, 0, { message: { ...commentary, id: "later", metadata: { parent_id: final.id } } } as any);
  expect(project(later).result()).toMatchObject({ state: "rejected", reason: "response_message_incomplete" });
});

test("semantic failure does not erase observed termination or mask later identity/server failures", () => {
  const unknown = { type: "unknown-control", payload: "not-authorized" };
  const source = project([...begin(), unknown, ...end()]);
  expect(source.result()).toEqual({ state: "rejected", reason: "response_event_unsupported" });
  expect(source.facts()).toMatchObject({ done: false, streamComplete: false, observedDone: true, observedStreamComplete: true });
  for (const [late, reason] of [
    [{ conversation_id: "foreign" }, "response_identity_mismatch"],
    [{ p: "", o: "add", v: { conversation_id: "foreign" } }, "response_identity_mismatch"],
    [{ p: "", o: "patch", v: [{ p: "/conversation_id", o: "replace", v: "foreign" }] }, "response_identity_mismatch"],
    [{ type: "input_message", input_message: { ...user, id: "foreign" } }, "response_identity_mismatch"],
    [{ p: "", o: "replace", v: { error_code: "failure" } }, "response_upstream_error"],
    [{ error: { message: "not telemetry" } }, "response_upstream_error"],
  ] as const) {
    const result = project([...begin(), unknown, late, ...end()]).result();
    expect(result).toEqual({ state: "rejected", reason }); expect(responseSourceBlocksFallback(result)).toBe(true);
  }
  expect(project([...begin(), unknown, ...end(), { v: "late" }]).result())
    .toEqual({ state: "rejected", reason: "response_after_termination" });
});
