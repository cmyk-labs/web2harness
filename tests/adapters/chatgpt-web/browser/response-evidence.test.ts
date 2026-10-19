import { expect, spyOn, test } from "bun:test";
import { ChatGptResponseSource } from "../../../../src/adapters/chatgpt-web/browser/response-source";
import { replayChatGptResponseEvidence } from "../../../../src/adapters/chatgpt-web/browser/response-replay";
import type { ChatGptResponseEvidenceLimits } from "../../../../src/adapters/chatgpt-web/browser/response-evidence";
import { ServerSentEventDecoder } from "../../../../src/adapters/chatgpt-web/browser/sse-decoder";

const binding = { userMessageId: "current-user", conversationId: "current-conversation" };
const input = { type: "input_message", conversation_id: binding.conversationId,
  input_message: { id: binding.userMessageId, author: { role: "user" }, content: { content_type: "text" } } };
const message = (overrides = {}) => ({ id: "public-answer", author: { role: "assistant" }, channel: "final", recipient: "all",
  status: "in_progress", end_turn: null, content: { content_type: "text", parts: [""] }, metadata: { parent_id: binding.userMessageId }, ...overrides });
const envelope = (m = message()) => ({ p: "", o: "add", v: { message: m, conversation_id: binding.conversationId, error: null } });
// Shapes observed in the saved 2026-10-17 samples, with entirely synthetic content/identities.
const terminal = { p: "", o: "patch", v: [
  { p: "/message/status", o: "replace", v: "finished_successfully" },
  { p: "/message/end_turn", o: "replace", v: true },
  { p: "/message/metadata", o: "append", v: { is_complete: true, finish_details: { type: "stop", stop_tokens: [200002] } } },
] };
const tail = [{ type: "message_stream_complete", conversation_id: binding.conversationId },
  { type: "conversation_detail_metadata", conversation_id: binding.conversationId }, "[DONE]"];
const delta = (v: string) => ({ p: "/message/content/parts/0", o: "append", v });
const frames = (extra: unknown[] = []) => ["v1", input, envelope(), delta("| 名称 | 值 |\n| --- | --- |\n| A | B |"),
  { v: "\n\nrepeat\n\nrepeat\n\n```txt\nexact\n```" }, ...extra, terminal, ...tail];
const wire = (values: unknown[]) => Buffer.from(values.map(v => `data: ${v === "[DONE]" ? v : JSON.stringify(v)}\n\n`).join(""));
function capture(values: unknown[], limits: boolean | ChatGptResponseEvidenceLimits = true, chunk = 13) {
  const source = new ChatGptResponseSource(binding, limits), bytes = wire(values);
  for (let offset = 0; offset < bytes.length; offset += chunk) source.push(bytes.subarray(offset, offset + chunk));
  source.finish(); return source;
}
function captureNamed(events: Array<{ event: string; value: unknown }>, chunk = 13) {
  const source = new ChatGptResponseSource(binding, true);
  const bytes = Buffer.from(events.map(({ event, value }) =>
    `event: ${event}\ndata: ${value === "[DONE]" ? value : JSON.stringify(value)}\n\n`).join(""));
  for (let offset = 0; offset < bytes.length; offset += chunk) source.push(bytes.subarray(offset, offset + chunk));
  source.finish(); return source;
}
// Exact event names/associations observed in owned-smoke-stream.private.sse (2026-10-18).
// All fixture identities, bodies and tokens below are synthetic; the private capture is not checked in.
const namedFrames = (values: unknown[]): Array<{ value: unknown; event: "delta_encoding" | "delta" | "message" }> => values.map(value => ({ value,
  event: value === "v1" ? "delta_encoding"
    : value && typeof value === "object" && Object.hasOwn(value, "v") ? "delta" : "message" }));

test("opt-in original event data replays exact tables, code and repetition at arbitrary UTF-8 boundaries", () => {
  for (const size of [1, 2, 17, 65536]) {
    const source = capture(frames(), true, size), result = source.result(), artifact = source.takeEvidence()!;
    expect(artifact.summary).toMatchObject({ projected: 0, withheld: 0, dropped: 0, replayable: true });
    const replay = replayChatGptResponseEvidence(artifact, size);
    expect(replay).toMatchObject({ state: "replayed", fidelity: "original-events", result });
    expect(artifact.records.filter(r => r.kind === "original").map(r => r.data))
      .toEqual(frames().map(v => v === "[DONE]" ? v : JSON.stringify(v)));
    expect(source.takeEvidence()).toBeUndefined();
    expect(JSON.stringify(source.facts())).not.toContain("repeat");
  }
  expect(capture(frames(), false).takeEvidence()).toBeUndefined();
});

test("redacted user, hidden reasoning, tool and metadata bodies retain an explicit diagnostic projection", () => {
  const source = capture(["v1", { ...input, input_message: { ...input.input_message,
    content: { content_type: "text", parts: ["SECRET_PROMPT"] }, metadata: { attachments: [{ token: "SECRET_UPLOAD" }] } } },
    envelope(message({ id: "hidden", channel: "analysis", content: { content_type: "text", parts: ["SECRET_REASONING"] },
      metadata: { parent_id: binding.userMessageId, reasoning_title: "SECRET_TITLE" } })), delta("SECRET_REASONING_DELTA"),
    envelope(message({ id: "tool", author: { role: "tool" }, channel: null, recipient: "tool-name",
      content: { content_type: "execution_output", text: "SECRET_TOOL" }, metadata: { parent_id: "hidden" } })),
    envelope(message({ metadata: { parent_id: "tool", request_id: "SECRET_REQUEST", reasoning_title: "SECRET_TITLE" } })),
    delta("public exact text"), terminal, ...tail]);
  const artifact = source.takeEvidence()!;
  expect(JSON.stringify(artifact)).not.toContain("SECRET");
  expect(JSON.stringify(source)).not.toContain("SECRET");
  expect(artifact.summary.projected).toBeGreaterThan(0);
  expect(artifact.summary.replayable).toBe(true);
  expect(replayChatGptResponseEvidence(artifact)).toMatchObject({ state: "replayed", fidelity: "privacy-projected",
    result: { state: "complete", text: "public exact text" } });
});

test.each([
  ["complete missing", { finish_details: { type: "stop" } }, "missing", "stop", undefined],
  ["complete false", { is_complete: false, finish_details: { type: "stop" } }, "incomplete", "stop", "response_message_incomplete"],
  ["finish missing", { is_complete: true }, "complete", "missing", undefined],
  ["length limit", { is_complete: true, finish_details: { type: "length" } }, "complete", "other", "response_message_incomplete"],
] as const)("completion diagnostics replay %s with the same delivery decision", (_name, metadata, completion, finish, reason) => {
  const source = capture(["v1", input, envelope(message({ status: "finished_successfully", end_turn: true,
    content: { content_type: "text", parts: ["answer"] }, metadata: { parent_id: binding.userMessageId, ...metadata } })), ...tail]);
  expect(source.result()).toMatchObject(reason ? { state: "rejected", reason } : { state: "complete", text: "answer" });
  expect(source.facts()).toMatchObject({ reason, publicStates: [{ completion, finish }] });
  expect(replayChatGptResponseEvidence(source.takeEvidence()!)).toMatchObject({ state: "replayed", result: source.result(),
    facts: { reason, publicStates: [{ completion, finish }] } });
});

test("unknown event failure captures the remaining same-chunk terminal events without storing unknown secrets", () => {
  const source = capture(frames([{ type: "future-protocol", payload: "SECRET_UNKNOWN", private_header: "SECRET_TOKEN" }]), true, 65536);
  expect(source.result()).toEqual({ state: "rejected", reason: "response_event_unsupported" });
  const artifact = source.takeEvidence()!;
  expect(JSON.stringify(artifact)).not.toContain("SECRET");
  expect(artifact.records.at(-1)).toMatchObject({ kind: "original", shape: "done", data: "[DONE]" });
  expect(artifact.summary.withheld).toBeGreaterThan(0);
  expect(replayChatGptResponseEvidence(artifact)).toEqual({ state: "unavailable", reason: "evidence_incomplete" });
});

test.each(["metadata", "channel", "same-batch", "after-budget"])("visibility revocation erases prior public bytes: %s", mode => {
  const hidden = mode === "channel" ? { p: "/message/channel", o: "replace", v: "analysis" }
    : { p: "/message/metadata/is_visually_hidden_from_conversation", o: "replace", v: true };
  const source = capture(["v1", input, envelope(), ...(mode === "same-batch"
    ? [{ p: "", o: "patch", v: [delta("REVOKED_CONTENT"), hidden] }]
    : [delta("REVOKED_CONTENT"), hidden]), ...tail], mode === "after-budget" ? { maxEvents: 4 } : true);
  const artifact = source.takeEvidence()!;
  expect(JSON.stringify(artifact)).not.toContain("REVOKED_CONTENT");
  expect(artifact.summary.replayable).toBe(false);
  expect(replayChatGptResponseEvidence(artifact).state).toBe("unavailable");
});

test("event and byte budgets retain a bounded prefix and never replay a truncated artifact", () => {
  for (const limits of [{ maxBytes: 1200 }, { maxEvents: 4 }]) {
    const artifact = capture(frames(Array.from({ length: 100 }, () => delta("public"))), limits).takeEvidence()!;
    expect(artifact.summary.dropped).toBeGreaterThan(0);
    expect(artifact.summary.retainedBytes).toBeLessThanOrEqual(limits.maxBytes ?? 2 * 1024 * 1024);
    expect(artifact.records.length).toBeLessThanOrEqual(limits.maxEvents ?? 2048);
    expect(replayChatGptResponseEvidence(artifact)).toEqual({ state: "unavailable", reason: "evidence_incomplete" });
  }
});

test("truncated SSE and malformed UTF-8 preserve a framing gap instead of a successful replay", () => {
  for (const late of [Buffer.from('data: {"private":"SECRET_PARTIAL'), Buffer.from([0xff])]) {
    const source = new ChatGptResponseSource(binding, true);
    source.push(wire(frames())); source.push(late); source.finish();
    const artifact = source.takeEvidence()!;
    expect(artifact.summary.framingIncomplete).toBe(true);
    expect(JSON.stringify(artifact)).not.toContain("SECRET");
    expect(replayChatGptResponseEvidence(artifact).state).toBe("unavailable");
  }
});

test("fault injection: removal, reordering and false completeness cannot silently repair a replay", () => {
  const artifact = capture(frames()).takeEvidence()!;
  const removed = structuredClone(artifact); removed.records.splice(3, 1);
  const reordered = structuredClone(artifact); [reordered.records[3], reordered.records[4]] = [reordered.records[4]!, reordered.records[3]!];
  const unavailable = structuredClone(artifact); unavailable.summary.ended = false;
  for (const changed of [removed, reordered, unavailable]) {
    expect(replayChatGptResponseEvidence(changed)).toEqual({ state: "unavailable", reason: "evidence_incomplete" });
  }
});

test("an unknown path cannot smuggle content through diagnostic path strings", () => {
  const artifact = capture(frames([{ p: "/message/metadata/SECRET_PATH", o: "replace", v: "SECRET_VALUE" }])).takeEvidence()!;
  expect(JSON.stringify(artifact)).not.toContain("SECRET");
  expect(artifact.summary.withheld).toBeGreaterThan(0);
});

test("observed hidden thought/code and tool terminal patches replay ordering without their payload", () => {
  const source = capture(["v1", input,
    envelope(message({ id: "thought", channel: null, content: { content_type: "thoughts" } })),
    { p: "/message/content/thoughts", o: "append", v: [{ summary: "SECRET_SUMMARY", content: "SECRET_REASONING" }] },
    { v: [{ summary: "SECRET_INHERITED", content: "SECRET_REASONING" }] },
    envelope(message({ id: "code", recipient: "python", channel: null, content: { content_type: "code", text: "SECRET_CODE" },
      metadata: { parent_id: "thought" } })),
    { p: "", o: "patch", v: [{ p: "/message/content/text", o: "append", v: "SECRET_CODE_APPEND" },
      { p: "/message/status", o: "replace", v: "finished_successfully" },
      { p: "/message/metadata/reasoning_title", o: "remove" }] },
    envelope(message({ id: "tool", author: { role: "tool" }, channel: null, content: { content_type: "execution_output" },
      metadata: { parent_id: "code" } })),
    { p: "", o: "patch", v: [{ p: "/message/update_time", o: "replace", v: 1234 },
      { p: "/message/status", o: "replace", v: "finished_successfully" },
      { p: "/message/metadata/aggregate_result/jupyter_messages", o: "append", v: [{ parent_header: "SECRET_HEADER", content: "SECRET_OUTPUT" }] }] },
    envelope(message({ metadata: { parent_id: "tool" } })), delta("exact public"), terminal,
    { p: "/message/metadata/conversation_followup_suggestions_eligible", o: "replace", v: true }, ...tail]);
  const artifact = source.takeEvidence()!;
  expect(JSON.stringify(artifact)).not.toContain("SECRET");
  expect(artifact.summary.replayable).toBe(true);
  expect(replayChatGptResponseEvidence(artifact)).toMatchObject({ state: "replayed", fidelity: "privacy-projected", result: source.result() });
  expect(source.result()).toMatchObject({ state: "complete", text: "exact public" });
});

test("message-marker tail changes replay before DONE and reject after DONE", () => {
  const source = capture([...frames().slice(0, -2), delta("late mutation"), ...tail.slice(1)]);
  expect(source.result()).toMatchObject({ state: "complete" });
  expect((source.result() as { text: string }).text.endsWith("late mutation")).toBeTrue();
  expect(replayChatGptResponseEvidence(source.takeEvidence()!)).toMatchObject({ state: "replayed", result: source.result() });
  const afterDone = capture([...frames(), delta("late mutation")]);
  expect(afterDone.result()).toEqual({ state: "rejected", reason: "response_after_termination" });
  expect(replayChatGptResponseEvidence(afterDone.takeEvidence()!)).toMatchObject({ state: "replayed", result: afterDone.result() });
});

test.each(["future-SECRET_EVENT", "error"])("unverified or error event names cannot retain otherwise public payloads: %s", event => {
  const values = frames();
  const source = captureNamed(values.map((value, index) => ({
    event: index === 3 ? event : "message", value: index === 3 ? delta("SECRET_PAYLOAD") : value,
  })), 1);
  const artifact = source.takeEvidence()!;
  expect(artifact.records[3]).toMatchObject({ event: event === "error" ? "error" : "other", kind: "withheld" });
  expect(artifact.records[3]!.data).toBeUndefined();
  expect(JSON.stringify(artifact)).not.toContain("SECRET");
  expect(artifact.summary.replayable).toBe(false);
  expect(replayChatGptResponseEvidence(artifact)).toEqual({ state: "unavailable", reason: "evidence_incomplete" });
  expect(artifact.records.at(-1)).toMatchObject({ shape: "done", data: "[DONE]" });
});

test("a forged unverified event name cannot be replayed as an ordinary message", () => {
  const artifact = capture(frames()).takeEvidence()!;
  for (const event of ["future-protocol", "message\ndata: [DONE]", "error"]) {
    const changed = structuredClone(artifact);
    Object.assign(changed.records[0]!, { event });
    expect(replayChatGptResponseEvidence(changed)).toEqual({ state: "unavailable", reason: "evidence_invalid" });
  }
});

test("observed encoding and delta names survive exact-data capture and the actual replay wire", () => {
  const events = namedFrames(frames());
  for (const size of [1, 17, 65536]) {
    const source = captureNamed(events, size), artifact = source.takeEvidence()!;
    expect(artifact.summary).toMatchObject({ projected: 0, withheld: 0, dropped: 0, replayable: true });
    expect(artifact.records.map(r => r.event)).toEqual(events.map(e => e.event));
    expect(artifact.records.map(r => r.data)).toEqual(events.map(e => e.value === "[DONE]" ? e.value : JSON.stringify(e.value)));
    expect(artifact.records[0]).toMatchObject({ event: "delta_encoding", shape: "encoding", data: '"v1"' });
    const dispatched: Array<{ event: string; data: string }> = [];
    const decoder = new ServerSentEventDecoder((data, event) => dispatched.push({ event, data }));
    const push = ChatGptResponseSource.prototype.push;
    const spy = spyOn(ChatGptResponseSource.prototype, "push").mockImplementation(function (this: ChatGptResponseSource, bytes) {
      decoder.push(bytes); return push.call(this, bytes);
    });
    try {
      expect(replayChatGptResponseEvidence(artifact, size)).toMatchObject({ state: "replayed", fidelity: "original-events",
        result: source.result() });
      decoder.finish();
      expect(dispatched).toEqual(artifact.records.map(r => ({ event: r.event, data: r.data! })));
    } finally { spy.mockRestore(); }
  }
});

test("named deltas project observed hidden context and recap bodies while preserving parent lineage", () => {
  const context = envelope(message({ id: "context", channel: null,
    content: { content_type: "model_editable_context", model_set_context: "SECRET_CONTEXT", repository: "SECRET_REPOSITORY",
      repo_summary: "SECRET_SUMMARY", structured_context: { value: "SECRET_STRUCTURED" } },
    metadata: { parent_id: binding.userMessageId, is_visually_hidden_from_conversation: true } }));
  const recap = envelope(message({ id: "recap", channel: null,
    content: { content_type: "reasoning_recap", content: "SECRET_RECAP" }, metadata: { parent_id: "context" } }));
  const final = envelope(message({ metadata: { parent_id: "recap" } }));
  const source = captureNamed(namedFrames(["v1",
    { type: "resume_conversation_token", conversation_id: binding.conversationId, token: "SECRET_TOKEN" }, input,
    { ...context, c: "SECRET_CURSOR" }, { v: recap.v, c: "SECRET_CURSOR" }, { v: final.v, c: "SECRET_CURSOR" },
    delta("exact public text"), terminal, ...tail]), 1);
  const artifact = source.takeEvidence()!;
  expect(artifact.summary).toMatchObject({ withheld: 0, dropped: 0, replayable: true });
  expect(artifact.summary.projected).toBeGreaterThan(0);
  expect(JSON.stringify(artifact)).not.toContain("SECRET");
  expect(JSON.parse(artifact.records[3]!.data!).v.message.content).toEqual({ content_type: "model_editable_context" });
  expect(JSON.parse(artifact.records[4]!.data!).v.message.content).toEqual({ content_type: "reasoning_recap" });
  expect(source.result()).toMatchObject({ state: "complete", text: "exact public text" });
  expect(replayChatGptResponseEvidence(artifact)).toMatchObject({ state: "replayed", fidelity: "privacy-projected",
    result: source.result(), facts: { inputBound: true, done: true, streamComplete: true,
      publicStates: [{ finished: true, endTurn: true, completion: "complete", finish: "stop" }] } });
});

test.each([
  ["delta_encoding", { v: "SECRET_MISLABELLED_PATCH" }],
  ["delta_encoding", "SECRET_UNKNOWN_ENCODING"],
  ["delta", "v1"],
  ["delta", "[DONE]"],
  ["delta", { type: "resume_conversation_token", token: "SECRET_MISLABELLED_CONTROL" }],
  ["delta", { p: "/message/SECRET_UNKNOWN_PATH", o: "append", v: "SECRET_VALUE" }],
  ["delta", { v: null, error: "SECRET_ERROR" }],
] as const)("known event names do not authorize unknown or mislabelled payloads: %s", (event, value) => {
  const artifact = captureNamed([{ event, value }]).takeEvidence()!;
  expect(artifact.records[0]).toMatchObject({ event, kind: "withheld" });
  expect(artifact.records[0]!.data).toBeUndefined();
  expect(JSON.stringify(artifact)).not.toContain("SECRET");
  expect(replayChatGptResponseEvidence(artifact)).toEqual({ state: "unavailable", reason: "evidence_incomplete" });
});
