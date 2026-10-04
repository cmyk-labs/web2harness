import {
  CHATGPT_WEB_BACKEND_MODEL,
  CHATGPT_WEB_LUNA_BACKEND_MODEL,
  CHATGPT_WEB_EFFORT_MODES,
  type ChatGptWebAdapterEffort,
} from "../../models/chatgpt-web-models";

export const CHATGPT_WEB_MODEL_ID = CHATGPT_WEB_BACKEND_MODEL;
export const CHATGPT_WEB_LUNA_MODEL_ID = CHATGPT_WEB_LUNA_BACKEND_MODEL;

export interface ChatGptWebCapabilities {
  localToolsEnabled: boolean;
  /**
   * Native-tools relay: the model decides tool calls as codex_tool_calls text and the bridge
   * relays them back as Responses call items. Mutually exclusive with localToolsEnabled in
   * practice — the broker-driven connector is available only in MCP Bridge mode.
   */
  nativeToolsEnabled?: boolean;
  solAvailable: boolean;
  extraHighAvailable: boolean;
  proAvailable: boolean;
  experimentalContextFiles?: boolean;
  experimentalContextTripleBudget?: boolean;
}

export interface ChatGptWebModelMode {
  modelId: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  displayLabel: "Luna" | "Think" | "Instant" | "Medium" | "High" | "Extra High" | "Pro";
  uiEffortIndex: 0 | 1 | 2 | 3 | 4 | null;
  thinkEnabled: boolean;
  localTools: boolean;
  /** This round relays codex_tool_calls decisions to the Codex-native tool loop. */
  nativeTools: boolean;
}

export function resolveChatGptWebModelMode(
  modelId: string,
  reasoning: string | undefined,
  capabilities: ChatGptWebCapabilities,
): ChatGptWebModelMode {
  if (modelId === CHATGPT_WEB_LUNA_MODEL_ID) {
    if (capabilities.solAvailable) {
      throw new Error("ChatGPT Luna is not available while the account exposes the Sol model selector");
    }
    const effort = reasoning ?? "low";
    if (effort !== "low" && effort !== "medium") {
      throw new Error(`ChatGPT Luna mode is not supported: ${effort}`);
    }
    const thinkEnabled = effort === "medium";
    return {
      modelId,
      effort,
      displayLabel: thinkEnabled ? "Think" : "Luna",
      uiEffortIndex: null,
      thinkEnabled,
      localTools: capabilities.localToolsEnabled,
      // Luna keeps a read-only surface in the native-tools relay for now; its routes stay plain
      // browser conversations instead of codex_tool_calls producers.
      nativeTools: false,
    };
  }
  if (modelId !== CHATGPT_WEB_MODEL_ID) {
    throw new Error(`ChatGPT web model is not supported: ${modelId}`);
  }
  if (!capabilities.solAvailable) {
    throw new Error("ChatGPT Sol modes are not available for this Luna-only account");
  }
  const effort = reasoning ?? "high";
  const nativeTools = capabilities.nativeToolsEnabled === true;
  if (!Object.hasOwn(CHATGPT_WEB_EFFORT_MODES, effort)) {
    throw new Error(`ChatGPT web effort is not supported: ${effort}`);
  }
  const selectedEffort = effort as ChatGptWebAdapterEffort;
  const selected = CHATGPT_WEB_EFFORT_MODES[selectedEffort];
  if ("requires" in selected && !capabilities[selected.requires]) {
    throw new Error(`ChatGPT ${selected.displayLabel} effort is not available for this account`);
  }
  return {
    modelId, effort: selectedEffort, displayLabel: selected.displayLabel,
    uiEffortIndex: selected.uiEffortIndex, thinkEnabled: false,
    localTools: capabilities.localToolsEnabled, nativeTools,
  };
}
