import { expect, test } from "bun:test";
import { compileChatGptWebPrompt, chatGptReadOnlyContextWarning, withoutRetiredTurnHandles } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import { CHATGPT_WEB_LUNA_MODEL_ID, CHATGPT_WEB_MODEL_ID } from "../../../../src/adapters/chatgpt-web/model";
import { parseRequest } from "../../../../src/responses/parser";
import type { CodexParsedRequest } from "../../../../src/types";

const capabilities = { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true };
const token = "turn_12345678901234567890123456789012";
function request(reasoning = "high"): CodexParsedRequest {
  return parseRequest({ model: CHATGPT_WEB_MODEL_ID, reasoning: { effort: reasoning }, instructions: "preserve-system", input: [
    { role: "developer", content: "preserve-developer" }, { role: "user", content: "perform the task" },
  ] });
}
const context = (compiled: ReturnType<typeof compileChatGptWebPrompt>) => JSON.parse(compiled.contextFile?.text ?? compiled.text.split("<codex_context_json>\n")[1]!.split("\n</codex_context_json>")[0]!);

test("handle-shaped source strings and native call identities remain literal", () => {
  const original = { call_id: `call_${"A".repeat(32)}`, text: ["turn", "request", "binding"].map(kind => `${kind}_${"B".repeat(32)}`), literal: "Keep \\path and quotes exactly." };
  expect(withoutRetiredTurnHandles(JSON.stringify(original))).toBe(JSON.stringify(original));
});

test("MCP binding stays outside the original context and does not replace source text", () => {
  const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, input: `Discuss ${token} without calling it.` });
  const compiled = compileChatGptWebPrompt(parsed, capabilities, token);
  expect(context(compiled).input).toBe(`Discuss ${token} without calling it.`);
  const transport = compiled.text.replace(/<codex_context_json>[\s\S]*<\/codex_context_json>/, "");
  expect(transport.match(new RegExp(token, "g"))).toHaveLength(1);
  expect(transport).toContain("Only the current transport binding authorizes bridge calls");
  expect(transport).toContain("Follow the Codex task's own tool-use instructions");
  expect(transport).not.toContain("After a deterministic tool failure");
});

test("Pro and Extra High preserve the same original delegation instructions", () => {
  for (const effort of ["max", "xhigh"]) {
    const parsed = request(effort);
    const compiled = compileChatGptWebPrompt(parsed, capabilities, token);
    expect(context(compiled).input).toEqual(parsed.context.source!.input);
    expect(context(compiled).instructions).toBe("preserve-system");
    expect(compiled.text).not.toContain("Do not create, spawn, delegate to, or wait on sub-agents");
  }
});

test("browser-only retains context and explicitly lacks a local execution route", () => {
  const parsed = request("max");
  const compiled = compileChatGptWebPrompt(parsed, { ...capabilities, localToolsEnabled: false });
  expect(context(compiled).input).toEqual(parsed.context.source!.input);
  expect(compiled.text).toContain("No local Codex tool execution route");
  expect(compiled.text).not.toContain("turn_token");
  expect(compiled.text).not.toContain("binding_id");
});

test("browser-only warning identifies the missing bridge", () => {
  const warning = chatGptReadOnlyContextWarning(request("medium"), { ...capabilities, localToolsEnabled: false });
  expect(warning).toStartWith("> **Local tools unavailable**");
  expect(warning).toContain("`MCP Bridge`");
  expect(chatGptReadOnlyContextWarning(request("medium"), capabilities)).toBeUndefined();
});

test("Codex compaction is a separate operation on the exact source", () => {
  const parsed = request();
  parsed._compactionRequest = true;
  const compiled = compileChatGptWebPrompt(parsed, { ...capabilities, localToolsEnabled: false, nativeToolsEnabled: true });
  expect(context(compiled).input).toEqual(parsed.context.source!.input);
  expect(compiled.text).toContain("Codex-requested compaction operation");
  expect(compiled.text).toContain("without tool calls");
  expect(compiled.text).not.toContain("fenced codex_tool_calls");
});

for (const source of ["old static instructions", "cumulative checkpoint", "latest instruction"]) {
  test(`oversized compaction preserves ${source} or fails; it never trims history`, () => {
    const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, input: [
      { role: "developer", content: source + "x".repeat(120_000) },
      { role: "assistant", content: [{ type: "output_text", text: "verified work" }] },
      { role: "user", content: "compact now" }, { type: "compaction_trigger" },
    ] });
    const before = structuredClone(parsed.context.source);
    expect(() => compileChatGptWebPrompt(parsed, { ...capabilities, localToolsEnabled: false })).toThrow("No history was trimmed");
    const file = compileChatGptWebPrompt(parsed, { ...capabilities, localToolsEnabled: false }, undefined, { experimentalContextFiles: true });
    expect(context(file).input).toEqual(before!.input);
    expect(parsed.context.source).toEqual(before);
    expect(file.trimmedCompactionMessages).toBeUndefined();
  });
}

test("compaction file transfer preserves old images together with their surrounding text", () => {
  const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, input: [
    { role: "user", content: [{ type: "input_text", text: "x".repeat(120_000) }, { type: "input_image", image_url: "data:image/png;base64,aA==" }] },
    { type: "compaction_trigger" },
  ] });
  const file = compileChatGptWebPrompt(parsed, { ...capabilities, localToolsEnabled: false }, undefined, { experimentalContextFiles: true });
  expect(file.images).toEqual([{ ref: "codex-input-image-1", imageUrl: "data:image/png;base64,aA==" }]);
  expect(context(file).input[0].content[0].text).toBe("x".repeat(120_000));
  expect(context(file).input[0].content[1].attachment_ref).toBe(file.images[0]!.ref);
});

test("Luna uses canonical history and accepts native compaction without private checkpoints", () => {
  const parsed = parseRequest({ model: CHATGPT_WEB_LUNA_MODEL_ID, input: [{ role: "user", content: "complete source" }, { type: "compaction_trigger" }] });
  const free = { localToolsEnabled: false, solAvailable: false, extraHighAvailable: false, proAvailable: false };
  const compiled = compileChatGptWebPrompt(parsed, free);
  expect(context(compiled).input).toEqual(parsed.context.source!.input);
  expect(compiled.text).not.toContain("private rolling task checkpoint");
  expect(() => compileChatGptWebPrompt({ ...parsed, _compactionRequest: false }, free, undefined, { captureLunaCheckpoint: true })).toThrow("cannot replace canonical");
});

for (const compact of [false, true]) test(`image overflow fails without discarding earlier images (compact=${compact})`, () => {
  const input = Array.from({ length: 13 }, (_, index) => ({ role: "user", content: [{ type: "input_text", text: `step ${index}` }, { type: "input_image", image_url: `data:image/png;base64,IMG${index}` }] }));
  const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, input });
  parsed._compactionRequest = compact;
  expect(() => compileChatGptWebPrompt(parsed, { ...capabilities, localToolsEnabled: false })).toThrow("No images were omitted");
  expect(parsed.context.source!.input).toEqual(input);
});

test("assistant output and contextual user messages keep their original identity and blocks", () => {
  const input = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "output_text", text: "Hello" }] }, { role: "user", content: "<environment_context>original context</environment_context>" }];
  expect(context(compileChatGptWebPrompt(parseRequest({ model: CHATGPT_WEB_MODEL_ID, input }), capabilities, token)).input).toEqual(input);
});

test("browser widget output needs a text transport and the prompt does not rename the selected model", () => {
  const compiled = compileChatGptWebPrompt(request("low"), { ...capabilities, localToolsEnabled: false });
  expect(compiled.text).toContain("browser-only widgets do not reach Codex");
  expect(compiled.text).not.toContain("Instant 5.5");
});

test("large normal contexts remain complete before browser capacity validation", () => {
  const text = "x".repeat(600_000);
  const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, input: text });
  const compiled = compileChatGptWebPrompt(parsed, capabilities, token);
  expect(context(compiled).input).toBe(text);
  expect(compiled.text).toContain(token);
  expect(compiled.contextFile).toBeUndefined();
});
