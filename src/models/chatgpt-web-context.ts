import {
  CHATGPT_WEB_BACKEND_MODEL, CHATGPT_WEB_LUNA_BACKEND_MODEL,
  CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL, CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL,
  type ChatGptWebBackendModel, type ChatGptWebZeroRiskBackendModel,
  type ChatGptWebAdapterEffort, type ChatGptWebAccountCapabilities,
} from "./chatgpt-web-model-types";

import budgetOptions from "../../launcher/shared/context-budget-options.json";
import { contextBudgetValues } from "../../launcher/shared/context-budget-values";
/** Shared Codex-facing policy; not a measurement of ChatGPT's physical model capacity. */
export const CHATGPT_WEB_CONTEXT_WINDOW = budgetOptions.defaults.standard;
export const CHATGPT_WEB_EFFECTIVE_CONTEXT_WINDOW_PERCENT = budgetOptions.effectivePercent;
export const CHATGPT_WEB_AUTO_COMPACT_TOKEN_LIMIT = contextBudgetValues(CHATGPT_WEB_CONTEXT_WINDOW).autoCompactTokenLimit;
export const CHATGPT_WEB_CONTEXT_BUDGET_MULTIPLIER = budgetOptions.tripleMultiplier;

/** Independent visible-message transport limits; file transport does not expand these. */
export const CHATGPT_WEB_INSTANT_COMPOSER_CHAR_LIMIT = 211_256;
export const CHATGPT_WEB_MEDIUM_HIGH_COMPOSER_CHAR_LIMIT = 1_048_572;
export const CHATGPT_WEB_PRO_STANDARD_MESSAGE_TOKEN_LIMIT = 103_000;
export const CHATGPT_WEB_PRO_MODEL_MESSAGE_TOKEN_LIMIT = 104_000;
export const CHATGPT_WEB_PRO_INSTANT_COMPOSER_CHAR_LIMIT = 545_000;
// Reasoning-mode web messages reject larger payloads even when the composer accepts them.
export const CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT = 500_000;
export const CHATGPT_WEB_PRO_MODEL_COMPOSER_CHAR_LIMIT = 1_635_000;
/** Hidden product prompt and native schema reserve included in usage estimates. */
export const CHATGPT_WEB_PLATFORM_RESERVE_TOKENS = 8_192;
export function chatGptWebImageTokenReserve(detail?: string): number {
  return detail === "original" ? 8_192 : 4_096;
}

export interface ChatGptWebContextLimits {
  contextWindow: number;
  effectiveContextWindowPercent: number;
  autoCompactTokenLimit: number;
}

export interface ChatGptWebTransportLimits {
  browserMessageTokenLimit?: number;
  browserComposerCharLimit?: number;
}

/** One Codex catalog row has one context contract, even when it exposes several efforts. */
export function sameChatGptWebContextLimits(
  left: ChatGptWebContextLimits,
  right: ChatGptWebContextLimits,
): boolean {
  return left.contextWindow === right.contextWindow
    && left.autoCompactTokenLimit === right.autoCompactTokenLimit
    && left.effectiveContextWindowPercent === right.effectiveContextWindowPercent;
}

export function isChatGptWebZeroRiskBackendModel(
  model: string,
): model is ChatGptWebZeroRiskBackendModel {
  return model === CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL
    || model === CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL;
}

/** Only automatic Sol Instant is Fast; manual protocol low and Luna keep their standard contract. */
export function resolveChatGptWebContextLimits(
  backendModel: ChatGptWebBackendModel,
  effort: ChatGptWebAdapterEffort,
  capabilities: ChatGptWebAccountCapabilities,
): ChatGptWebContextLimits {
  if (isChatGptWebZeroRiskBackendModel(backendModel)) {
    if (capabilities.experimentalContextFiles) throw new Error("Zero Risk does not support Context as File");
  } else if (backendModel !== CHATGPT_WEB_LUNA_BACKEND_MODEL && !capabilities.proAvailable
    && effort !== "low" && effort !== "medium" && effort !== "high"
    && !(effort === "xhigh" && capabilities.extraHighAvailable)) {
    throw new Error(`ChatGPT Plus context limit is not defined for unavailable effort: ${effort}`);
  }
  const group = backendModel === CHATGPT_WEB_BACKEND_MODEL && effort === "low" ? "fast" : "standard";
  const window = budgetOptions.defaults[group];
  const { contextWindow, effectiveContextWindowPercent, autoCompactTokenLimit } = contextBudgetValues(window, backendModel === CHATGPT_WEB_BACKEND_MODEL
    && capabilities.experimentalContextFiles === true && capabilities.experimentalContextTripleBudget === true);
  return { contextWindow, effectiveContextWindowPercent, autoCompactTokenLimit };
}

/** Resolve limits of one visible ChatGPT composer message, independently of model context. */
export function resolveChatGptWebTransportLimits(
  backendModel: ChatGptWebBackendModel,
  effort: ChatGptWebAdapterEffort,
  capabilities: ChatGptWebAccountCapabilities,
): ChatGptWebTransportLimits {
  if (isChatGptWebZeroRiskBackendModel(backendModel)) return {};
  if (backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) return {};
  if (!capabilities.proAvailable) {
    if (effort === "low") {
      return { browserComposerCharLimit: CHATGPT_WEB_INSTANT_COMPOSER_CHAR_LIMIT };
    }
    if (effort === "medium" || effort === "high" || (effort === "xhigh" && capabilities.extraHighAvailable)) {
      return { browserComposerCharLimit: CHATGPT_WEB_MEDIUM_HIGH_COMPOSER_CHAR_LIMIT };
    }
    throw new Error(`ChatGPT Plus transport limit is not defined for unavailable effort: ${effort}`);
  }
  if (effort === "low") {
    return {
      browserMessageTokenLimit: CHATGPT_WEB_PRO_STANDARD_MESSAGE_TOKEN_LIMIT,
      browserComposerCharLimit: CHATGPT_WEB_PRO_INSTANT_COMPOSER_CHAR_LIMIT,
    };
  }
  if (effort === "max") {
    return {
      browserMessageTokenLimit: CHATGPT_WEB_PRO_MODEL_MESSAGE_TOKEN_LIMIT,
      browserComposerCharLimit: CHATGPT_WEB_PRO_MODEL_COMPOSER_CHAR_LIMIT,
    };
  }
  return {
    browserMessageTokenLimit: CHATGPT_WEB_PRO_STANDARD_MESSAGE_TOKEN_LIMIT,
    browserComposerCharLimit: CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT,
  };
}

/** Preserve the measured inline allowance independently of the unified history window. */
export function resolveChatGptWebMessageTokenBudget(
  backendModel: typeof CHATGPT_WEB_BACKEND_MODEL,
  effort: ChatGptWebAdapterEffort,
  capabilities: ChatGptWebAccountCapabilities,
  imageTokens = 0,
): number {
  const { browserMessageTokenLimit } = resolveChatGptWebTransportLimits(backendModel, effort, capabilities);
  const visibleAllowance = browserMessageTokenLimit
    ?? (effort === "low" ? 41_000 : 90_000) - CHATGPT_WEB_PLATFORM_RESERVE_TOKENS - 1;
  return Math.max(0, visibleAllowance - imageTokens);
}
