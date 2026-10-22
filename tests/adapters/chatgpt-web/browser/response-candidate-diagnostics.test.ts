import { expect, test } from "bun:test";
import { ChatGptResponseSource } from "../../../../src/adapters/chatgpt-web/browser/response-source";
import { responseCandidateDiagnostics, type ResponseCandidateStructure } from "../../../../src/adapters/chatgpt-web/browser/response-candidate-diagnostics";
import { replayChatGptResponseEvidence } from "../../../../src/adapters/chatgpt-web/browser/response-replay";
import { safeDetail } from "../../../../launcher/shared/diagnostic-event.cjs";
import { parentMissingFinal, childMissingFinal } from "../../../fixtures/chatgpt-missing-final-2026-10-22";

type Event = { event: string; value: unknown };
function project(binding: { userMessageId: string; conversationId?: string }, events: Event[], chunk = 17) {
  const source = new ChatGptResponseSource(binding, true);
  const bytes = Buffer.from(events.map(({ event, value }) =>
    `event: ${event}\ndata: ${value === "[DONE]" ? value : JSON.stringify(value)}\n\n`).join(""));
  for (let offset = 0; offset < bytes.length; offset += chunk) source.push(bytes.subarray(offset, offset + chunk));
  source.finish(); return source;
}

const structure = (overrides: Partial<ResponseCandidateStructure> = {}): ResponseCandidateStructure => ({
  id: "answer", role: "assistant", channel: "final", recipient: "all", status: "finished_successfully", endTurn: true,
  contentType: "text", hidden: false, parent: "user", ...overrides,
});
const inputStructure = structure({ id: "user", role: "user", channel: null, parent: undefined, endTurn: null });

test.each([
  ["parent", parentMissingFinal, 25, 10, 5, 3],
  ["child", childMissingFinal, 30, 12, 6, 4],
] as const)("%s incident: structure census and chunked projection keep the missing-final negative", (_label, fixture, events, messages, assistants, hiddenCommentary) => {
  expect(fixture.events).toHaveLength(events);
  // Direct snapshot census, independent of the runtime merger, visibility filter and diagnostics.
  const snapshots = fixture.events.flatMap(event => {
    const frame = event.value as any;
    return frame?.v?.message ? [frame.v.message] : frame?.input_message ? [frame.input_message] : [];
  });
  expect(snapshots).toHaveLength(messages);
  expect(snapshots.filter(message => message.author.role === "assistant")).toHaveLength(assistants);
  expect(snapshots.filter(message => message.channel === "final")).toHaveLength(0);
  expect(snapshots.filter(message => message.channel === "commentary" && message.metadata.is_visually_hidden_from_conversation === true))
    .toHaveLength(hiddenCommentary);
  expect(snapshots.filter(message => message.content.content_type === "thoughts")).toHaveLength(2);
  for (const chunk of [1, 17, 65536]) {
    const source = project(fixture.binding, fixture.events, chunk);
    expect(source.result()).toEqual({ state: "awaiting_final", ...fixture.binding });
    const audit = source.facts().candidateAudit;
    expect(source.facts()).toMatchObject({ done: true, streamComplete: true, inputBound: true, publicStates: [] });
    expect(audit).toMatchObject({ messageCount: messages, assistantCount: assistants, publicTextCount: 0,
      structuralFinalCount: 0, omittedCandidates: 0, rejectionCounts: { channel_not_final: messages,
        hidden: hiddenCommentary * 2 + 1, content_not_text: 2, recipient_not_all: hiddenCommentary,
        input_unbound: 0, end_turn_not_true: messages } });
    expect(audit.candidates.map(candidate => candidate.inputBinding.status))
      .toEqual(["current_input", ...Array(messages - 1).fill("descendant")]);
    // New facts remain useful after the normal telemetry sanitizer, without changing its policy.
    expect(safeDetail({ projection: { candidateAudit: audit } })).toEqual({ projection: { candidateAudit: audit } });
    expect(JSON.stringify(audit)).not.toContain("node-");
    expect(JSON.stringify(audit)).not.toContain("conversation-fixture");
    const artifact = source.takeEvidence()!;
    expect(artifact.summary).toMatchObject({ events, withheld: 0, dropped: 0, replayable: true });
    expect(replayChatGptResponseEvidence(artifact, chunk)).toMatchObject({ state: "replayed",
      result: source.result(), facts: { candidateAudit: audit } });
  }
});

test.each([parentMissingFinal, childMissingFinal])("an explicit final descendant after the incident structure remains deliverable", fixture => {
  const last = [...fixture.events].reverse().find(event => (event.value as any)?.v?.message);
  const parent = (last!.value as any).v.message.id;
  const answer = { id: "synthetic-final", author: { role: "assistant" }, channel: "final", recipient: "all",
    status: "finished_successfully", end_turn: true, content: { content_type: "text", parts: ["Public final"] },
    metadata: { parent_id: parent, is_complete: true, finish_details: { type: "stop" } } };
  const events = [...fixture.events.slice(0, -2), { event: "delta", value: { p: "", o: "add", c: 100,
    v: { message: answer, conversation_id: fixture.binding.conversationId } } }, ...fixture.events.slice(-2)];
  const source = project(fixture.binding, events);
  expect(source.result()).toMatchObject({ state: "complete", text: "Public final" });
  expect(source.facts().candidateAudit).toMatchObject({ publicTextCount: 1, structuralFinalCount: 1 });
  expect(source.facts().candidateAudit.candidates.at(-1)?.rejected).toEqual({});
});

test("candidate diagnostics explain incomplete, hidden, unbound and nonpublic structures without reading bodies", () => {
  const source = { ...structure({ id: "PRIVATE_ID", parent: "PRIVATE_PARENT", role: "PRIVATE_ROLE", channel: "PRIVATE_CHANNEL",
    recipient: "PRIVATE_TOOL", contentType: "PRIVATE_CONTENT_KIND", status: "PRIVATE_STATUS", finishType: "PRIVATE_FINISH",
    endTurn: "PRIVATE_END", complete: false, hidden: true }),
    get parts() { throw Error("diagnostics must not read bodies"); }, get fallback() { throw Error("no fallback body access"); } };
  const audit = responseCandidateDiagnostics([inputStructure, source], "user");
  expect(audit.candidates[1]).toMatchObject({ role: "other", channel: "other", recipient: { type: "other" },
    contentType: { type: "other" }, status: "other", endTurn: { status: "other" }, hidden: true,
    completion: { status: "incomplete" }, finish: { type: "other" }, inputBinding: { status: "unbound" } });
  expect(Object.keys(audit.candidates[1]!.rejected)).toHaveLength(10);
  expect(JSON.stringify(audit)).not.toContain("PRIVATE");
  expect(safeDetail(audit)).toEqual(audit);
});

test("binding diagnostics refuse a foreign user, a missing parent, a cycle and a non-user with the current ID", () => {
  for (const [extra, answer, relation] of [
    [[structure({ id: "other-user", role: "user", parent: "user" })], structure({ parent: "other-user" }), "other_input"],
    [[], structure({ parent: "missing" }), "unbound"],
    [[structure({ id: "loop", parent: "answer" })], structure({ parent: "loop" }), "cycle"],
    [[structure({ id: "user", role: "assistant", parent: undefined })], structure(), "unbound"],
  ] as const) {
    const audit = responseCandidateDiagnostics([inputStructure, ...extra, answer], "user");
    expect(audit.candidates.at(-1)?.inputBinding.status).toBe(relation);
    expect(audit.candidates.at(-1)?.rejected.input_unbound).toBeTrue();
  }
});

test("aggregate reasons include omitted candidates and optional completion metadata stays optional", () => {
  const messages = [inputStructure, ...Array.from({ length: 40 }, (_, i) => structure({ id: `answer-${i}` }))];
  const audit = responseCandidateDiagnostics(messages, "user");
  expect(audit).toMatchObject({ messageCount: 41, assistantCount: 40, structuralFinalCount: 40,
    rejectionCounts: { role_not_assistant: 1, input_unbound: 0, completion_incomplete: 0, finish_not_stop: 0 }, omittedCandidates: 9 });
  expect(audit.candidates).toHaveLength(32);
  expect(audit.candidates[1]).toMatchObject({ completion: { status: "missing" }, finish: { type: "missing" }, rejected: {} });
});

test("structural candidates never override ambiguous finals or unsupported public content", () => {
  const input = { id: "user", author: { role: "user" }, content: { content_type: "text" } };
  const answer = { id: "answer", author: { role: "assistant" }, channel: "final", recipient: "all", status: "finished_successfully",
    end_turn: true, content: { content_type: "text", parts: ["public"] }, metadata: { parent_id: "user" } };
  const frames = (answers: unknown[]) => ["v1", { type: "input_message", input_message: input, conversation_id: "conversation" },
    ...answers.map(message => ({ message, conversation_id: "conversation" })), { type: "message_stream_complete" }, "[DONE]"]
    .map(value => ({ event: "message", value }));
  const ambiguous = project({ userMessageId: "user" }, frames([answer, { ...answer, id: "second" }]));
  expect(ambiguous.facts().candidateAudit.structuralFinalCount).toBe(2);
  expect(ambiguous.result()).toMatchObject({ state: "rejected", reason: "response_final_message_ambiguous" });
  const unsupported = project({ userMessageId: "user" }, frames([{ ...answer, content: { content_type: "text" } }]));
  expect(unsupported.facts().candidateAudit.structuralFinalCount).toBe(1);
  expect(unsupported.result()).toMatchObject({ state: "rejected", reason: "response_content_unsupported" });
});
