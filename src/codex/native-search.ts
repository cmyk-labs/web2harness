import { isChatGptWebModelSlug, lookupChatGptWebModelRoute } from "../models/chatgpt-web-models";

export class NativeSearchModelError extends Error {}

/** Resolve only our own aliases for the native search service, never select a fallback model.
 * Codex still runs web.run and owns its search settings, commands, history and credentials.
 * This does not send a model-generation request to the native Responses endpoint. */
export function resolveNativeSearchModel(model: string): string {
  if (!isChatGptWebModelSlug(model)) return model;
  const route = lookupChatGptWebModelRoute(model);
  if (!route) throw new NativeSearchModelError(`Unknown ChatGPT Web search model: ${model}`);
  if (route.interactionMode !== "automatic") {
    throw new NativeSearchModelError("Native standalone search requires an explicitly selected automatic Web model; the manual browser model has no verified native search identity");
  }
  if (route.backendModel === "gpt-5.6-luna") return route.backendModel;
  return `gpt-${route.modelFamily ?? "5.6"}-${route.requiresPro ? "pro" : "sol"}`;
}
