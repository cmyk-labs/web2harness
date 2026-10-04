import {
  CHATGPT_WEB_BACKEND_MODEL, CHATGPT_WEB_LUNA_BACKEND_MODEL,
  CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL, CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL,
  type ChatGptWebAutomaticModelRoute, type ChatGptWebModelRoute, type ChatGptWebZeroRiskModelRoute,
  type ChatGptWebAdapterEffort,
} from "./chatgpt-web-model-types";

/** Observed ChatGPT slider positions. Codex labels do not imply a different browser model. */
export const CHATGPT_WEB_EFFORT_MODES = {
  low: { displayLabel: "Instant", uiEffortIndex: 0 },
  medium: { displayLabel: "Medium", uiEffortIndex: 1 },
  high: { displayLabel: "High", uiEffortIndex: 2 },
  xhigh: { displayLabel: "Extra High", uiEffortIndex: 3, requires: "extraHighAvailable" },
  max: { displayLabel: "Pro", uiEffortIndex: 4, requires: "proAvailable" },
} as const satisfies Record<ChatGptWebAdapterEffort, {
  displayLabel: string;
  uiEffortIndex: number;
  requires?: "extraHighAvailable" | "proAvailable";
}>;

export const CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE: ChatGptWebZeroRiskModelRoute = {
  slug: "chatgpt-web/zero-risk",
  displayName: "ChatGPT Web — Zero Risk",
  description: "Zero Risk keeps model selection and prompt submission under your control while preserving the native Codex harness.",
  interactionMode: "manual",
  backendModel: CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL,
  codexEffort: "low",
  adapterEffort: "low",
  requiresPro: false,
};

export const CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE: ChatGptWebZeroRiskModelRoute = {
  slug: "chatgpt-web/zero-risk-pro",
  displayName: "ChatGPT Web — Zero Risk Pro",
  description: "Explicit Pro-sized Zero Risk context; select ChatGPT Pro manually for every turn.",
  interactionMode: "manual",
  backendModel: CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL,
  codexEffort: "low",
  adapterEffort: "low",
  requiresPro: true,
};

export const CHATGPT_WEB_LEGACY_LUNA_MODEL_ROUTE: ChatGptWebAutomaticModelRoute = {
  slug: "chatgpt-web/luna",
  displayName: "ChatGPT Web — Luna",
  description: "ChatGPT Web Luna for accounts without the Sol model selector.",
  interactionMode: "automatic",
  backendModel: CHATGPT_WEB_LUNA_BACKEND_MODEL,
  codexEffort: "low",
  adapterEffort: "low",
  requiresPro: false,
  legacy: true,
};

export const CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE: ChatGptWebModelRoute = {
  slug: "chatgpt-web/think",
  displayName: "ChatGPT Web — Think",
  description: "ChatGPT Web Think for Luna-only accounts.",
  interactionMode: "automatic",
  backendModel: CHATGPT_WEB_LUNA_BACKEND_MODEL,
  codexEffort: "low",
  // The backend model remains Luna. This internal adapter effort distinguishes the explicit
  // Think route after Codex has selected its separate catalog row.
  adapterEffort: "medium",
  requiresPro: false,
  legacy: true,
};

export const CHATGPT_WEB_LUNA_MODEL_ROUTE: ChatGptWebAutomaticModelRoute = {
  slug: "chatgpt-web/gpt-5.6-luna",
  displayName: "GPT-5.6 Luna · Ordinary / Think (Web)",
  description: "ChatGPT Luna. Light selects the ordinary mode; Medium enables Think.",
  interactionMode: "automatic",
  backendModel: CHATGPT_WEB_LUNA_BACKEND_MODEL,
  codexEffort: "low",
  adapterEffort: "low",
  supportedCodexEfforts: ["low", "medium"],
  requiresPro: false,
};

export const CHATGPT_WEB_LUNA_MODEL_ROUTES: readonly ChatGptWebModelRoute[] = [
  CHATGPT_WEB_LUNA_MODEL_ROUTE,
];

/**
 * Preserve the exact pre-6.0 bindings for saved tasks, including the old unpinned Pro route.
 * Native Codex may normalize its technical effort; these identities have always owned the mode.
 */
export const CHATGPT_WEB_LEGACY_MODEL_ROUTES: readonly ChatGptWebAutomaticModelRoute[] = [
  {
    slug: "chatgpt-web/light",
    displayName: "ChatGPT Web — Instant",
    description: "ChatGPT Web Instant through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "low",
    adapterEffort: "low",
    requiresPro: false,
    legacy: true,
  },
  {
    slug: "chatgpt-web/medium",
    displayName: "ChatGPT Web — Medium",
    description: "ChatGPT Web Medium through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "medium",
    adapterEffort: "medium",
    requiresPro: false,
    legacy: true,
  },
  {
    slug: "chatgpt-web/high",
    displayName: "ChatGPT Web — High",
    description: "ChatGPT Web High through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "high",
    adapterEffort: "high",
    requiresPro: false,
    legacy: true,
  },
  {
    slug: "chatgpt-web/extra-high",
    displayName: "ChatGPT Web — Extra High",
    description: "Account-gated ChatGPT Web Extra High through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "xhigh",
    adapterEffort: "xhigh",
    requiresPro: false,
    requiresExtraHigh: true,
    legacy: true,
  },
  {
    slug: "chatgpt-web/pro",
    displayName: "ChatGPT Web — Pro",
    description: "Account-gated ChatGPT Pro through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "ultra",
    adapterEffort: "max",
    requiresPro: true,
    legacy: true,
  },
];

/** Kept for saved tasks and accounts whose Instant budget differs from Thinking. */
export const CHATGPT_WEB_INSTANT_MODEL_ROUTE: ChatGptWebAutomaticModelRoute = {
  slug: "chatgpt-web/gpt-5.6-sol-instant",
  displayName: "GPT-5.6 Sol · Instant (Web)",
  description: "GPT-5.6 Sol Instant through ChatGPT, with its own context and compaction budget.",
  interactionMode: "automatic",
  backendModel: CHATGPT_WEB_BACKEND_MODEL,
  modelFamily: "5.6",
  codexEffort: "low",
  adapterEffort: "low",
  supportedCodexEfforts: ["low"],
  requiresPro: false,
  legacy: true,
};

export const CHATGPT_WEB_BUDGET_FALLBACK_ROUTES: readonly ChatGptWebAutomaticModelRoute[] = [
  CHATGPT_WEB_INSTANT_MODEL_ROUTE,
];

/** Add named browser models here. Account resolution groups only identical context contracts. */
export const CHATGPT_WEB_MODEL_ROUTES: readonly ChatGptWebAutomaticModelRoute[] = [
  {
    slug: "chatgpt-web/gpt-5.6-sol",
    displayName: "GPT-5.6 Sol (Web)",
    description: "GPT-5.6 Sol through ChatGPT. Low selects Instant when it shares the Thinking budget; otherwise Instant has its own entry. Default: High.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    modelFamily: "5.6",
    codexEffort: "high",
    adapterEffort: "high",
    supportedCodexEfforts: ["low", "medium", "high", "xhigh"],
    contextFallbacks: { low: CHATGPT_WEB_INSTANT_MODEL_ROUTE.slug },
    requiresPro: false,
  },
  {
    slug: "chatgpt-web/gpt-5.6-pro",
    displayName: "GPT-5.6 Sol Pro (Web)",
    description: "GPT-5.6 Sol Pro through ChatGPT. The fixed Max effort selects Pro.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    modelFamily: "5.6",
    codexEffort: "max",
    adapterEffort: "max",
    supportedCodexEfforts: ["max"],
    requiresPro: true,
  },
  {
    slug: "chatgpt-web/gpt-6-pro",
    displayName: "GPT-6 Pro (Web)",
    description: "GPT-6 Pro, powered by GPT-6 Astra in ChatGPT. The fixed Max effort selects Pro.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    modelFamily: "6",
    codexEffort: "max",
    adapterEffort: "max",
    supportedCodexEfforts: ["max"],
    requiresPro: true,
  },
];
