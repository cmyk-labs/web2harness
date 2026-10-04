export const CHATGPT_WEB_MODEL_PREFIX = "chatgpt-web/";
export const CHATGPT_WEB_BACKEND_MODEL = "gpt-5.6-sol";
export const CHATGPT_WEB_LUNA_BACKEND_MODEL = "gpt-5.6-luna";
/** Internal adapter identity for a turn whose ChatGPT model is selected by the user in the launcher. */
export const CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL = "chatgpt-web-zero-risk";
/** Internal adapter identity for the explicitly enabled, Pro-sized Zero Risk context profile. */
export const CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL = "chatgpt-web-zero-risk-pro";

export type ChatGptWebAutomaticBackendModel =
  | typeof CHATGPT_WEB_BACKEND_MODEL
  | typeof CHATGPT_WEB_LUNA_BACKEND_MODEL;
export type ChatGptWebBackendModel =
  | ChatGptWebAutomaticBackendModel
  | ChatGptWebZeroRiskBackendModel;
export type ChatGptWebZeroRiskBackendModel =
  | typeof CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL
  | typeof CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL;

export type ChatGptWebCodexEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ChatGptWebAdapterEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type ChatGptWebModelFamily = "5.6" | "6";

interface ChatGptWebModelRouteBase {
  slug: string;
  displayName: string;
  description: string;
  codexEffort: ChatGptWebCodexEffort;
  requiresPro: boolean;
  requiresExtraHigh?: boolean;
  /** Old task identities remain resolvable, but are omitted from the picker. */
  legacy?: boolean;
  /** Omission denotes an immutable route, including all pre-6.0 task identities. */
  supportedCodexEfforts?: readonly ChatGptWebCodexEffort[];
}

export interface ChatGptWebAutomaticModelRoute extends ChatGptWebModelRouteBase {
  interactionMode: "automatic";
  backendModel: ChatGptWebAutomaticBackendModel;
  adapterEffort: ChatGptWebAdapterEffort;
  /** Exact browser family, independent of the generic adapter's context/transport profile. */
  modelFamily?: ChatGptWebModelFamily;
  /** Expose a separate fixed route when this effort cannot share the default context contract. */
  contextFallbacks?: Partial<Record<ChatGptWebAdapterEffort, string>>;
}

export interface ChatGptWebZeroRiskModelRoute extends ChatGptWebModelRouteBase {
  interactionMode: "manual";
  backendModel: ChatGptWebZeroRiskBackendModel;
  /** Technical protocol value only; Zero Risk must not use it to choose the ChatGPT model. */
  adapterEffort: "low";
}

export type ChatGptWebModelRoute = ChatGptWebAutomaticModelRoute | ChatGptWebZeroRiskModelRoute;

export interface ChatGptWebAccountCapabilities {
  solAvailable: boolean;
  /** Missing in older saved observations; setup must probe before exposing Extra High. */
  extraHighAvailable?: boolean;
  proAvailable: boolean;
  experimentalContextFiles?: boolean;
  experimentalContextTripleBudget?: boolean;
  browserInteractionMode?: "automatic" | "manual";
  zeroRiskProEnabled?: boolean;
}
