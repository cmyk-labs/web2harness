import { expect, test } from "bun:test";
import { createContextFile, validateContextFile } from "../../../../src/adapters/chatgpt-web/prompt/context-attachments";
import { compileChatGptWebPrompt } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import { chatGptPromptFilePayloads } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { estimateTokens } from "../../../../src/lib/token-estimate";
import { resolveChatGptWebMessageTokenBudget, resolveChatGptWebTransportLimits } from "../../../../src/models/chatgpt-web-models";
import type { CodexParsedRequest } from "../../../../src/types";

const capabilities = { localToolsEnabled: false, nativeToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: false };
const options = { experimentalContextFiles: true };
function request(text: string): CodexParsedRequest {
  return { modelId: "gpt-5.6-sol", stream: false, options: { reasoning: "low" }, context: {
    systemPrompt: ["Keep the user's original constraints."], messages: [{ role: "user", content: text, timestamp: 1 }],
  } };
}
function compile(parsed: CodexParsedRequest) { return compileChatGptWebPrompt(parsed, capabilities, undefined, options); }

test("small contexts remain inline and disabling file transfer never changes the transport", () => {
  const small = compile(request("Read the file and report."));
  expect(small.contextFile).toBeUndefined();
  expect(small.text).toContain("<codex_context_json>");
  const large = request("word ".repeat(30_000));
  expect(compileChatGptWebPrompt(large, capabilities).contextFile).toBeUndefined();
  expect(compile(large).contextFile).toBeDefined();
});

test("the 80 percent composer threshold triggers independently of token density", () => {
  const parsed = request("");
  const initial = compile(parsed);
  const limit = resolveChatGptWebTransportLimits("gpt-5.6-sol", "low", capabilities).browserComposerCharLimit!;
  const boundary = Math.floor(limit * 0.8);
  parsed.context.messages[0]!.content = " ".repeat(boundary - initial.text.length - 1);
  expect(compile(parsed).contextFile).toBeUndefined();
  parsed.context.messages[0]!.content += " ";
  expect(compile(parsed).contextFile).toBeDefined();
});

test("context attachment is byte-identical to the inline JSON including tool calls, results and schema", () => {
  const parsed = request("任务开始\n" + "word ".repeat(30_000));
  parsed.context.tools = [{ name: "exec", description: "Run a command", parameters: { type: "object", properties: { cmd: { type: "string" } } } }];
  parsed.context.messages.push(
    { role: "assistant", content: [{ type: "toolCall", id: "call_123", name: "exec", arguments: { cmd: "echo 中文" } }], timestamp: 2 },
    { role: "toolResult", toolCallId: "call_123", toolName: "exec", content: "exit=1\nC:\\test\nline 2", isError: true, timestamp: 3 },
    { role: "user", content: "保留上面的错误并继续", timestamp: 4 },
  );
  const inline = compileChatGptWebPrompt(parsed, capabilities);
  const file = compile(parsed);
  expect(file.contextFile!.text).toBe(inline.text.split("<codex_context_json>\n")[1]!.split("\n</codex_context_json>")[0]);
  expect(file.text).toContain("codex_tool_calls");
  expect(file.text).toContain("cannot be read completely");
  const payloads = chatGptPromptFilePayloads(file);
  expect(payloads).toHaveLength(1);
  expect(payloads[0]!.mimeType).toBe("text/plain");
  expect(payloads[0]!.buffer.toString("utf8")).toBe(file.contextFile!.text);
});

test("invalid context attachments and excessive attachment count fail explicitly", () => {
  const contextFile = createContextFile(JSON.stringify({ version: 3, system: [], messages: [] }));
  expect(() => validateContextFile(contextFile)).not.toThrow();
  expect(() => validateContextFile({ ...contextFile, text: contextFile.text + " " })).toThrow("does not match");
  expect(() => validateContextFile({ name: "../context.txt", text: "data" })).toThrow("Invalid");
  expect(() => createContextFile(JSON.stringify({ version: 3, system: [], messages: ["x".repeat(20_000_001)] }))).toThrow("20 MB");
  expect(() => chatGptPromptFilePayloads({ text: "Read the file", contextFile, images: Array.from({ length: 10 }, (_, i) => ({ ref: `image-${i}`, imageUrl: "data:image/png;base64,iVBORw==" })) })).toThrow("10 attachments");
});

test("token pressure uses 80 percent of the normal single-message budget independently of triple context", () => {
  const empty = compile(request(""));
  const threshold = Math.floor(resolveChatGptWebMessageTokenBudget("gpt-5.6-sol", "low", capabilities) * 0.8);
  const words = threshold - estimateTokens(empty.text, "gpt-5.6-sol");
  const below = request("word ".repeat(words - 30));
  const above = request("word ".repeat(words + 30));
  const inline = compileChatGptWebPrompt(above, capabilities);
  expect(estimateTokens(compileChatGptWebPrompt(below, capabilities).text, "gpt-5.6-sol")).toBeLessThan(threshold);
  expect(estimateTokens(inline.text, "gpt-5.6-sol")).toBeGreaterThanOrEqual(threshold);
  expect(compile(below).contextFile).toBeUndefined();
  expect(compile(above).contextFile).toBeDefined();
  expect(compileChatGptWebPrompt(above, { ...capabilities, experimentalContextFiles: true, experimentalContextTripleBudget: true }, undefined, options)).toEqual(compile(above));
});
