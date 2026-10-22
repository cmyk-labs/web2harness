import { estimateTokens } from "../../lib/token-estimate";
import {
  isChatGptWebZeroRiskBackendModel,
} from "../../models/chatgpt-web-models";
import type { CodexParsedRequest, CodexUsage } from "../../types";
import { estimateCompiledChatGptWebInputTokens } from "./prompt/input-tokens";
import {
  compileChatGptWebPrompt,
  type CompileChatGptWebPromptOptions,
} from "./prompt/compile";
import { resolveChatGptWebModelMode, type ChatGptWebCapabilities } from "./model";
import type { BrokerToolRequest } from "./tools/turn-broker";
import type { HandoffProtocol } from "../../../launcher/shared/handoff-protocol.cjs";

// Match the host's 24-byte hex handle shape without reading a real capability. Token
// counts remain estimates: random handle contents and platform processing can differ.
const ESTIMATE_BINDING_SUFFIX = "0".repeat(48);

export interface ChatGptWebRoundEvidence {
  answer?: string;
  reasoning?: string[];
  toolRequests?: BrokerToolRequest[];
}

function conservativeTextTokens(text: string, modelId: string): number {
  return estimateTokens(text, modelId);
}

export function estimateChatGptWebInputTokens(
  parsed: CodexParsedRequest,
  capabilities: ChatGptWebCapabilities,
  options: CompileChatGptWebPromptOptions = {},
): number {
  const manual = isChatGptWebZeroRiskBackendModel(parsed.modelId);
  const mode = manual
    ? { localTools: true }
    : resolveChatGptWebModelMode(parsed.modelId, parsed.options.reasoning, capabilities);
  const compiled = compileChatGptWebPrompt(
    parsed,
    capabilities,
    mode.localTools ? `${manual ? "request" : "turn"}_${ESTIMATE_BINDING_SUFFIX}` : undefined,
    {
      ...options,
      ...(manual ? { manualControl: true as const } : {}),
      estimateOnly: true,
    },
  );
  return estimateCompiledChatGptWebInputTokens(compiled, parsed.modelId);
}

function roundEvidenceText(evidence: ChatGptWebRoundEvidence): string {
  return JSON.stringify({
    reasoning: evidence.reasoning ?? [],
    ...(evidence.answer !== undefined ? { answer: evidence.answer } : {}),
    ...(evidence.toolRequests ? {
      tool_calls: evidence.toolRequests.map(request => ({
        call_id: request.callId,
        name: request.wireName,
        ...(request.freeform
          ? { input: request.input ?? "" }
          : { arguments: request.arguments ?? {} }),
      })),
    } : {}),
  });
}

export function estimateChatGptWebUsage(
  parsed: CodexParsedRequest,
  evidence: ChatGptWebRoundEvidence,
  capabilities: ChatGptWebCapabilities,
  experimentalContextFiles = false,
  experimentalSkillAttachments = false,
  mcpHandoffProtocol?: HandoffProtocol,
): CodexUsage {
  const inputTokens = estimateChatGptWebInputTokens(parsed, capabilities, {
    experimentalSkillAttachments,
    experimentalContextFiles,
    ...(mcpHandoffProtocol !== undefined ? { toolBatchHandoff: true, handoffProtocol: mcpHandoffProtocol } : {}),
  });
  const outputTokens = conservativeTextTokens(roundEvidenceText(evidence), parsed.modelId);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimated: true,
  };
}
