import { CHATGPT_WEB_PLATFORM_RESERVE_TOKENS, chatGptWebImageTokenReserve } from "../../../models/chatgpt-web-models";
import { skillFileTokens } from "./skill-attachments";
import { estimateTokens } from "../../../lib/token-estimate";
import type { CompiledChatGptWebPrompt } from "./compile";

/**
 * The Free/Luna product accepted measured browser inputs at 25,400 and 28,547 estimated tokens,
 * but rejected the same shape at 32,283 before producing a response. This is a ChatGPT browser
 * transport boundary, not Luna's model context window, and applies to normal and checkpoint turns.
 */
export const CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET = 28_000;

export function compiledChatGptWebMessages(compiled: CompiledChatGptWebPrompt): string[] {
  return [compiled.text];
}

export function compiledChatGptWebMaxMessageChars(compiled: CompiledChatGptWebPrompt): number {
  return Math.max(...compiledChatGptWebMessages(compiled).map(message => message.length));
}

/** Tokens present in the one visible browser message, excluding hidden product/tool reserves. */
export function estimateCompiledChatGptWebMessageTokens(
  compiled: CompiledChatGptWebPrompt,
  modelId: string,
): number {
  const messages = compiledChatGptWebMessages(compiled);
  return Math.max(...messages.map((message, index) => estimateTokens(message, modelId)
    + (index === messages.length - 1 ? skillFileTokens(compiled.skillFiles, modelId) : 0)));
}

export function estimateCompiledChatGptWebInputTokens(
  compiled: CompiledChatGptWebPrompt,
  modelId: string,
): number {
  const imageTokens = estimateChatGptWebImageTokens(compiled);
  const messageTokens = compiledChatGptWebMessages(compiled)
    .reduce((total, message) => total + estimateTokens(message, modelId), 0);
  const contextTokens = compiled.contextFile ? estimateTokens(compiled.contextFile.text, modelId) : 0;
  return CHATGPT_WEB_PLATFORM_RESERVE_TOKENS + messageTokens + contextTokens + imageTokens + skillFileTokens(compiled.skillFiles, modelId);
}

export function estimateChatGptWebImageTokens(compiled: CompiledChatGptWebPrompt): number {
  return compiled.images.reduce(
    (total, image) => total + chatGptWebImageTokenReserve(image.detail),
    0,
  );
}
