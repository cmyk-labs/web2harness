import { expect, test } from "bun:test";
import { estimateChatGptWebInputTokens } from "../../../src/adapters/chatgpt-web/usage";
import { compileChatGptWebPrompt } from "../../../src/adapters/chatgpt-web/prompt/compile";
import { compiledChatGptWebMessages, estimateCompiledChatGptWebInputTokens, estimateCompiledChatGptWebMessageTokens } from "../../../src/adapters/chatgpt-web/prompt/input-tokens";
import { assertChatGptWebInputWithinLimits } from "../../../src/adapters/chatgpt-web/browser/browser-worker";
import { estimateTokens } from "../../../src/lib/token-estimate";
import { resolveChatGptWebContextLimits, resolveChatGptWebTransportLimits } from "../../../src/models/chatgpt-web-models";
import type { CodexParsedRequest } from "../../../src/types";

const capabilities = { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true };

function request(text: string): CodexParsedRequest {
  return {
    modelId: "gpt-5.6-sol",
    stream: false,
    context: { messages: [{ role: "user", content: text, timestamp: 1 }] },
    options: { reasoning: "high" },
  };
}

test.each([
  ["highly compressible", "a".repeat(480_000)],
  ["ordinary repeated words", `${"word ".repeat(79_999)}word`],
])("%s context uses tokenizer-derived usage without character-pressure inflation", (_label, text) => {
  expect(estimateChatGptWebInputTokens(request(text), capabilities)).toBeLessThan(100_000);
}, 15_000);


test("context files preserve whole records and use one physical message", () => {
  for (const text of ["word ".repeat(90_000), "x".repeat(600_000)]) {
    const parsed = request(text);
    const compiled = compileChatGptWebPrompt(parsed, capabilities, undefined, { experimentalContextFiles: true });
    expect(compiled.contextFile).toBeDefined();
    expect(JSON.parse(compiled.contextFile!.text).messages[0].content).toBe(text);
    expect(compiledChatGptWebMessages(compiled)).toEqual([compiled.text]);
    expect(compiled.text.length).toBeLessThan(10_000);
    expect(estimateCompiledChatGptWebInputTokens(compiled, parsed.modelId)).toBeGreaterThan(estimateTokens(text, parsed.modelId));
    expect(estimateCompiledChatGptWebMessageTokens(compiled, parsed.modelId)).toBeLessThan(3_000);
  }
}, 30_000);

test("file transfer alone keeps the standard total context ceiling; explicit triple budget changes only that ceiling", () => {
  const parsed = request("word ".repeat(120_000));
  const normal = { ...capabilities, experimentalContextFiles: true, experimentalContextTripleBudget: false };
  const triple = { ...normal, experimentalContextTripleBudget: true };
  const compiled = compileChatGptWebPrompt(parsed, normal, undefined, { experimentalContextFiles: true });
  const expanded = compileChatGptWebPrompt(parsed, triple, undefined, { experimentalContextFiles: true });
  expect(compiled).toEqual(expanded);
  const total = estimateCompiledChatGptWebInputTokens(compiled, parsed.modelId);
  const visible = estimateCompiledChatGptWebMessageTokens(compiled, parsed.modelId);
  expect(() => assertChatGptWebInputWithinLimits(total, visible, parsed.modelId, "high", normal, compiled.text.length)).toThrow("context window");
  expect(() => assertChatGptWebInputWithinLimits(total, visible, parsed.modelId, "high", triple, compiled.text.length)).not.toThrow();
}, 30_000);

test("compaction file retains all context above the legacy inline byte cap", () => {
  const parsed = request("x".repeat(160_000));
  parsed._compactionRequest = true;
  const compiled = compileChatGptWebPrompt(parsed, capabilities, undefined, { experimentalContextFiles: true });
  expect(compiled.trimmedCompactionMessages).toBeUndefined();
  expect(JSON.parse(compiled.contextFile!.text).messages[0].content).toBe(parsed.context.messages[0]!.content);
});

test.each([false, true])("context files enforce exact total and inline boundaries with triple budget=%s", tripleBudget => {
  const selected = { ...capabilities, experimentalContextFiles: true, experimentalContextTripleBudget: tripleBudget };
  const model = "gpt-5.6-sol";
  const { contextWindow } = resolveChatGptWebContextLimits(model, "high", selected);
  const { browserMessageTokenLimit, browserComposerCharLimit } = resolveChatGptWebTransportLimits(model, "high", selected);
  expect(browserMessageTokenLimit).toBeDefined();
  expect(browserComposerCharLimit).toBeDefined();
  // Total input must leave room for an answer; the visible message may reach its own limit.
  expect(() => assertChatGptWebInputWithinLimits(contextWindow - 1, browserMessageTokenLimit!, model, "high", selected, browserComposerCharLimit!)).not.toThrow();
  for (const total of [contextWindow, contextWindow + 1]) {
    expect(() => assertChatGptWebInputWithinLimits(total, 1, model, "high", selected, 1)).toThrow("context window");
  }
  expect(() => assertChatGptWebInputWithinLimits(contextWindow - 1, browserMessageTokenLimit! + 1, model, "high", selected, 1)).toThrow("visible message tokens");
  expect(() => assertChatGptWebInputWithinLimits(contextWindow - 1, 1, model, "high", selected, browserComposerCharLimit! + 1)).toThrow("inline characters");
});
