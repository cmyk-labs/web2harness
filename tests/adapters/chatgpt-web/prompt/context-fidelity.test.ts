import { chatGptConversationKey, rememberRetainedConversationSource, retainedConversationResumeRequest } from "../../../../src/adapters/chatgpt-web/conversation/conversation-key";
import { describe, expect, test } from "bun:test";
import { parseRequest } from "../../../../src/responses/parser";
import { compileChatGptWebPrompt, CHATGPT_MAX_INPUT_IMAGES } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import { originalToolCatalog } from "../../../../src/adapters/chatgpt-web/prompt/source-context";
import { parseNativeToolCallReply } from "../../../../src/adapters/chatgpt-web/tools/native-tool-call-block";
import { validateToolCallBatch } from "../../../../src/adapters/chatgpt-web/tools/tool-call-policy";
import { toolIdentityKey } from "../../../../src/types";
import { defaultConfig } from "../../../../src/config";
import { responseRequest } from "../../../../src/server";
import { encodeCompactionSummary } from "../../../../src/responses/compaction";

const capabilities = { nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true };
const model = "gpt-5.6-sol";
const tools = [{
  type: "namespace", name: "functions", description: "Original Code Mode namespace",
  tools: [{ type: "custom", name: "exec", description: "Use tools.clock__curr_time and setTimeout. Nested exports are supplied by ALL_TOOLS.", format: { type: "grammar", syntax: "lark", definition: "start: SOURCE\nSOURCE: /[\\s\\S]+/" } }],
}, {
  type: "namespace", name: "clock", description: "Top-level time tools",
  tools: [{ type: "function", name: "sleep", description: "Wait", strict: true, parameters: { type: "object", properties: { duration_ms: { type: "number" } }, required: ["duration_ms"], additionalProperties: false } }],
}, { type: "function", name: "clock__sleep", description: "A distinct literal name", parameters: { type: "object" } }];
const fence = (calls: unknown[]) => `\`\`\`codex_tool_calls\n${JSON.stringify({ calls })}\n\`\`\``;
const compile = (body: Record<string, unknown>, contextFiles = false) => compileChatGptWebPrompt(parseRequest({ model, ...body }), capabilities, undefined, { experimentalContextFiles: contextFiles });
const envelope = (compiled: ReturnType<typeof compile>) => JSON.parse(compiled.contextFile?.text ?? compiled.text.split("<codex_context_json>\n")[1]!.split("\n</codex_context_json>")[0]!);

describe("original Codex context", () => {
  test("preserves roles, block boundaries, metadata, ordering, arguments and original tools", () => {
    const input = [
      { role: "developer", content: [{ type: "input_text", text: "<model_switch>old</model_switch>" }] },
      { role: "system", content: [{ type: "input_text", text: "system at this position", source: "original" }] },
      { role: "developer", content: [{ type: "input_text", text: "<skills_instructions>old</skills_instructions>" }] },
      { role: "user", content: [{ type: "input_text", text: "A" }, { type: "input_text", text: "B" }], internal_chat_message_metadata_passthrough: { turn_id: "current", content_item_kinds: ["plain"] } },
      { type: "function_call", id: "fc_original", call_id: "c1", namespace: "clock", name: "sleep", arguments: "{ invalid historical arguments" },
      { type: "function_call_output", call_id: "c1", output: [{ type: "input_text", text: "TypeError: unavailable" }], is_error: true },
      { role: "developer", content: "<model_switch>new</model_switch>" },
      { role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "original commentary", annotations: [{ type: "fixture" }] }] },
      { type: "agent_message", author: "worker", recipient: "parent", content: [{ type: "input_text", text: "agent result" }] },
    ];
    const body = { instructions: "original instructions", input, tools, parallel_tool_calls: false };
    const result = envelope(compile(body));
    expect(result.input).toEqual(input);
    expect(result.instructions).toBe(body.instructions);
    expect(result.tools).toEqual(tools);
    expect(result.controls.parallel_tool_calls).toBe(false);
    expect(result.input[5].is_error).toBe(true);
  });

  test("a source snapshot does not change when the caller or runtime index changes", () => {
    const body = { model, input: [{ role: "user", content: "original" }], tools: structuredClone(tools) };
    const parsed = parseRequest(body);
    body.input[0]!.content = "changed";
    parsed.context.messages.length = 0;
    parsed.context.tools![0]!.description = "changed index";
    const result = envelope(compileChatGptWebPrompt(parsed, capabilities));
    expect(result.input[0].content).toBe("original");
    expect(result.tools).toEqual(tools);
  });

  test("handle-shaped task text is literal data and private request metadata is excluded", () => {
    const text = `request_${"a".repeat(32)} turn_${"b".repeat(32)} binding_${"c".repeat(32)}`;
    const result = compile({ input: text, client_metadata: { private_route: "DO_NOT_SEND" }, authorization: "DO_NOT_SEND" });
    expect(envelope(result).input).toBe(text);
    expect(result.text).not.toContain("DO_NOT_SEND");
  });

  test("additional_tools and tool search results keep original source and namespace descriptions", () => {
    const input = [
      { type: "additional_tools", role: "developer", tools: tools.slice(0, 1) },
      { type: "tool_search_output", call_id: "discovery", status: "completed", tools: tools.slice(1), extra: "original" },
    ];
    const parsed = parseRequest({ model, input });
    expect(envelope(compileChatGptWebPrompt(parsed, capabilities)).input).toEqual(input);
    expect(originalToolCatalog(parsed.context.source, parsed.context.tools!)).toEqual(tools);
    expect(parsed.context.tools![0]!.namespace).toBe("functions");
    const failed = parseRequest({ model, input: [{ ...input[1], status: "failed" }] });
    expect(failed.context.tools).toBeUndefined();
  });

  test("attachment references preserve original content types, positions and bytes, including 1px images", () => {
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const data = Buffer.from("ALPHA\r\nBETA").toString("base64");
    const result = compile({ input: [{ role: "user", content: [
      { type: "input_text", text: "before" }, { type: "input_image", image_url: image, detail: "original" },
      { type: "input_file", filename: "source.txt", file_data: data }, { type: "input_text", text: "after" },
    ] }] });
    const blocks = envelope(result).input[0].content;
    expect(blocks.map((part: { type: string }) => part.type)).toEqual(["input_text", "input_image", "input_file", "input_text"]);
    expect(result.images[0]).toMatchObject({ imageUrl: image, detail: "original", ref: blocks[1].attachment_ref });
    expect(result.files![0]).toMatchObject({ data, name: blocks[2].attachment_ref });
    expect(result.text).not.toContain(data);
  });

  test("image overflow and unsupported content fail before dropping any context", () => {
    expect(() => compile({ input: [{ role: "user", content: Array.from({ length: CHATGPT_MAX_INPUT_IMAGES + 1 }, () => ({ type: "input_image", image_url: "data:image/png;base64,aA==" })) }] })).toThrow("No images were omitted");
    expect(() => compile({ input: [{ type: "message", role: "user", content: [{ type: "input_audio", data: "opaque" }] }] })).toThrow("Unsupported Codex content type");
    expect(() => compile({ input: [{ type: "future_protocol_item", value: "must not disappear" }] })).toThrow("Unsupported Codex input type");
    expect(() => compile({ input: [{ type: "reasoning", encrypted_content: "provider-private" }] })).toThrow("Opaque Codex");
  });

  test("compaction source is complete or rejected; file transport is byte-identical", () => {
    const input = [{ role: "user", content: "earlier original " + "x".repeat(180_000) }, { type: "compaction_trigger" }];
    expect(() => compile({ input })).toThrow("No history was trimmed");
    const result = compile({ input }, true);
    expect(result.contextFile).toBeDefined();
    expect(envelope(result).input).toEqual(input);
    expect(result.trimmedCompactionMessages).toBeUndefined();
  });

  test("bridge-owned compaction can be decoded without inventing a user message", () => {
    const input = [{ type: "compaction", encrypted_content: encodeCompactionSummary("original summary") }];
    const result = envelope(compile({ input }));
    expect(result.input).toEqual(input);
    expect(result.transport_decoded).toEqual([{ input_index: 0, type: "compaction", value: "original summary" }]);
  });
});

describe("original tool identity and scope", () => {
  test("namespaced and literal underscore names remain distinct", () => {
    const parsed = parseRequest({ model, tools });
    const result = parseNativeToolCallReply(fence([
      { type: "function_call", namespace: "clock", name: "sleep", arguments: { duration_ms: 15 } },
      { type: "function_call", name: "clock__sleep", arguments: {} },
    ]), parsed.context.tools!);
    expect(result.issues).toEqual([]);
    expect(result.calls.map(call => call.wireName)).toEqual([toolIdentityKey("clock", "sleep"), toolIdentityKey(undefined, "clock__sleep")]);
    expect(parseNativeToolCallReply(fence([{ namespace: "clock", name: "clock__sleep", arguments: {} }]), parsed.context.tools!).issues).toHaveLength(1);
  });

  test("top-level sleep does not become an exec export and raw erroneous JS is not repaired", () => {
    const parsed = parseRequest({ model, tools: tools.slice(0, 2) });
    const input = "// @exec: {\"yield_time_ms\": 1}\nawait tools.clock__sleep({duration_ms:15000});\n";
    const result = parseNativeToolCallReply(fence([{ type: "custom_tool_call", namespace: "functions", name: "exec", input }]), parsed.context.tools!);
    expect(result.issues).toEqual([]);
    expect(result.calls[0]!.arguments.input).toBe(input);
    expect(parseNativeToolCallReply(fence([{ name: "clock__sleep", arguments: {} }]), parsed.context.tools!).issues).toHaveLength(1);
    const prompt = compileChatGptWebPrompt(parsed, capabilities);
    expect(envelope(prompt).tools).toEqual(tools.slice(0, 2));
    expect(prompt.text).toContain("top-level tools do not imply nested exports");
  });

  test("kind, allowed tools, no-tools, required calls and parallel limits are enforced", () => {
    const call = { callId: "fixture", wireName: toolIdentityKey("clock", "sleep"), freeform: false, arguments: { duration_ms: 1 } };
    const request = (controls: Record<string, unknown>) => parseRequest({ model, tools, ...controls });
    expect(() => validateToolCallBatch(request({ tool_choice: "none" }), [call])).toThrow("none");
    expect(() => validateToolCallBatch(request({ tool_choice: "required" }), [])).toThrow("requires");
    expect(() => validateToolCallBatch(request({ parallel_tool_calls: false }), [call, call])).toThrow("parallel_tool_calls");
    expect(() => validateToolCallBatch(request({ tool_choice: { type: "function", name: "clock__sleep" } }), [call])).toThrow("outside");
    expect(() => validateToolCallBatch(request({ tool_choice: { type: "allowed_tools", mode: "required", tools: [{ type: "function", namespace: "clock", name: "sleep" }] } }), [call])).not.toThrow();
    expect(() => validateToolCallBatch(request({}), [{ ...call, freeform: true }])).toThrow("kind");
  });

  for (const stream of [false, true]) test(`structured calls round-trip through server and ${stream ? "SSE" : "JSON"}`, async () => {
    const source = "await tools.clock__curr_time({});\ntext('\\n');\n";
    const response = await responseRequest(new Request("http://localhost/v1/responses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web/gpt-5.6-sol", stream, tools, input: "fixture" }),
    }), defaultConfig("native-tools"), () => ({
      name: "fidelity-fixture", async runTurn(parsed, _incoming, emit) {
        const reply = parseNativeToolCallReply(fence([
          { type: "custom_tool_call", namespace: "functions", name: "exec", input: source },
          { type: "function_call", namespace: "clock", name: "sleep", arguments: { duration_ms: 17 } },
          { type: "function_call", name: "clock__sleep", arguments: {} },
        ]), parsed.context.tools!);
        expect(reply.issues).toEqual([]);
        reply.calls.forEach((call, index) => {
          emit({ type: "tool_call_start", id: `call_${index}`, name: call.wireName });
          emit({ type: "tool_call_delta", arguments: JSON.stringify(call.arguments) });
          emit({ type: "tool_call_end" });
        });
        emit({ type: "done", endTurn: false });
      },
    }), { rememberState: false });
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = stream ? text.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6))).find(event => event.type === "response.completed").response : JSON.parse(text);
    expect(body.output).toEqual([
      expect.objectContaining({ type: "custom_tool_call", namespace: "functions", name: "exec", call_id: "call_0", input: source }),
      expect.objectContaining({ type: "function_call", namespace: "clock", name: "sleep", call_id: "call_1", arguments: '{"duration_ms":17}' }),
      expect.objectContaining({ type: "function_call", name: "clock__sleep", call_id: "call_2", arguments: "{}" }),
    ]);
    expect(body.output[2].namespace).toBeUndefined();
  });
});


test("retained context appends only a verified completed prefix and rebuilds on edits", () => {
  const namespace = "fidelity-prefix-fixture";
  const metadata = { "x-codex-turn-metadata": JSON.stringify({ thread_id: "fidelity-prefix-thread", turn_id: "turn-1" }) };
  const input = [{ role: "developer", content: "keep exact rule" }, { role: "user", content: "first" }];
  const first = parseRequest({ model, instructions: "original", input, tools, client_metadata: metadata });
  const key = chatGptConversationKey(first, namespace)!;
  expect(key).toBeString();
  expect(retainedConversationResumeRequest(first, key)).toBe(first);
  rememberRetainedConversationSource(first, namespace, key);
  const suffix = [{ type: "function_call", name: "sleep", namespace: "clock", call_id: "call-sleep", arguments: '{"duration_ms":1}' }, { type: "function_call_output", call_id: "call-sleep", output: "ok" }];
  const next = parseRequest({ model, instructions: "original", input: [...input, ...suffix], tools, client_metadata: metadata });
  expect(chatGptConversationKey(next, namespace)).toBe(key);
  const resume = retainedConversationResumeRequest(next, key)!;
  const payload = envelope(compileChatGptWebPrompt(resume, capabilities));
  expect(payload.input).toEqual(suffix);
  expect(payload.transport_context).toMatchObject({ mode: "append", prefix_items: 2, prefix_sha256: expect.any(String) });
  expect(next.context.source!.input).toEqual([...input, ...suffix]);
  const edited = parseRequest({ model, instructions: "original", input: [{ role: "developer", content: "changed rule" }, ...input.slice(1), ...suffix], tools, client_metadata: metadata });
  expect(chatGptConversationKey(edited, namespace)).not.toBe(key);
  expect(retainedConversationResumeRequest(edited, key)).toBe(edited);
  const changedInstructions = parseRequest({ model, instructions: "changed", input: [...input, ...suffix], tools, client_metadata: metadata });
  expect(chatGptConversationKey(changedInstructions, namespace)).not.toBe(key);
  expect(envelope(compileChatGptWebPrompt(edited, capabilities)).transport_context).toEqual({ mode: "complete" });
});


test("bridge framing follows original context without inserting a task summary", () => {
  const compiled = compile({ instructions: "original policy", input: [{ role: "user", content: "original task" }] });
  const contextStart = compiled.text.indexOf("<codex_context_json>");
  const contextEnd = compiled.text.indexOf("</codex_context_json>");
  const protocol = compiled.text.indexOf("<codex_bridge_protocol>");
  expect(compiled.text.slice(0, contextStart).trim().split("\n")).toHaveLength(1);
  expect(protocol).toBeGreaterThan(contextEnd);
  expect(envelope(compiled).input).toEqual([{ role: "user", content: "original task" }]);
});
