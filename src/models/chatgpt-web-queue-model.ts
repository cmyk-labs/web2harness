import { CHATGPT_WEB_BACKEND_MODEL, type ChatGptWebModelFamily } from "./chatgpt-web-model-types";

/** Requested model metadata only. Never use this label for execution or replay identity. */
export function chatGptWebQueueModel(modelId: string, family?: ChatGptWebModelFamily, effort?: string): string {
  if (modelId !== CHATGPT_WEB_BACKEND_MODEL) return modelId;
  return `gpt-${family ?? "5.6"}-${effort === "max" ? "pro" : "sol"}`;
}
