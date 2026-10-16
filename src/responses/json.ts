import type { AdapterEvent, CodexMessagePhase, CodexProviderContinuationState, CodexUsage } from "../types";
import { encodeCompactionSummary } from "./compaction";
import { encodeReasoningEnvelope, type ReasoningEnvelope } from "./reasoning-envelope";
import { uuid, responsesUsage, adapterFailureFromEvent, plaintextCollaborationFields, type OutputItem } from "./encoding";
import { responseTerminal, type AdapterTerminalEvent } from "./terminal";

export function buildResponseJSON(
  events: AdapterEvent[],
  modelId: string,
  options?: {
    hideThinkingSummary?: boolean;
    toolNsMap?: Map<string, { namespace: string; name: string }>;
    freeformToolNames?: Set<string>;
    toolSearchToolNames?: Set<string>;
    /** Remote compaction v2 turn — append one synthetic compaction output item (see bridgeToResponsesSSE). */
    compaction?: boolean;
    onProviderState?: (state: CodexProviderContinuationState) => void;
  },
): Record<string, unknown> {
  const responseId = `resp_${uuid()}`;
  const output: OutputItem[] = [];
  let usage: CodexUsage | undefined;
  let terminalEvent: AdapterTerminalEvent | undefined;
  let endTurn: boolean | undefined;
  let compactionText = "";

  let currentText = "";
  let currentTextPhase: CodexMessagePhase | undefined;
  let currentSummaryReasoning = "";
  let currentRawReasoning = "";
  // Opaque signed-reasoning round-trip (batch): see bridgeToResponsesSSE counterpart.
  let batchSignature: string | undefined;
  let batchRedacted: string[] = [];
  let currentToolCallId = "";
  let currentToolCallName = "";
  let currentToolCallArgs = "";
  const freeformInput = (args: string): string => {
    try { const o = JSON.parse(args); if (o && typeof o.input === "string") return o.input; } catch { /* raw */ }
    return args;
  };
  const parseArgsObj = (args: string): Record<string, unknown> => {
    try { const o = JSON.parse(args); return o && typeof o === "object" ? o : {}; } catch { return {}; }
  };

  const flushText = () => {
    if (!currentText) return;
    output.push({
      type: "message", id: `msg_${uuid()}`, role: "assistant", status: "completed",
      content: [{ type: "output_text", text: currentText, annotations: [] }],
      ...(currentTextPhase ? { phase: currentTextPhase } : {}),
    });
    currentText = "";
    currentTextPhase = undefined;
  };
  const flushSummaryReasoning = () => {
    if (!currentSummaryReasoning && !batchSignature && batchRedacted.length === 0) return;
    const envelope: ReasoningEnvelope = {};
    if (batchSignature) envelope.sig = batchSignature;
    if (batchRedacted.length > 0) envelope.red = batchRedacted;
    const hidden = options?.hideThinkingSummary === true;
    if (hidden && currentSummaryReasoning && (envelope.sig || envelope.red)) envelope.txt = currentSummaryReasoning;
    const encrypted = envelope.sig || envelope.red || envelope.txt ? encodeReasoningEnvelope(envelope) : undefined;
    batchSignature = undefined;
    batchRedacted = [];
    if (hidden && !encrypted) { currentSummaryReasoning = ""; return; }
    output.push({
      type: "reasoning", id: `rs_${uuid()}`,
      summary: !hidden && currentSummaryReasoning ? [{ type: "summary_text", text: currentSummaryReasoning }] : [],
      ...(encrypted ? { encrypted_content: encrypted } : {}),
    });
    currentSummaryReasoning = "";
  };
  const flushRawReasoning = () => {
    if (!currentRawReasoning) return;
    if (options?.hideThinkingSummary === true) {
      // Same contract as the streaming path: no visible reasoning, txt-only envelope round-trip.
      output.push({
        type: "reasoning", id: `rs_${uuid()}`, summary: [],
        encrypted_content: encodeReasoningEnvelope({ txt: currentRawReasoning }),
      });
      currentRawReasoning = "";
      return;
    }
    output.push({
      type: "reasoning", id: `rs_${uuid()}`, summary: [],
      content: [{ type: "reasoning_text", text: currentRawReasoning }],
    });
    currentRawReasoning = "";
  };
  const flushToolCall = () => {
    if (!currentToolCallId) return;
    const mapped = options?.toolNsMap?.get(currentToolCallName);
    const realName = mapped?.name ?? currentToolCallName;
    const ns = mapped?.namespace;
    const toolSearch = options?.toolSearchToolNames?.has(currentToolCallName) ?? false;
    const freeform = !toolSearch && (options?.freeformToolNames?.has(currentToolCallName) ?? false);
    if (toolSearch) {
      output.push({
        type: "tool_search_call", id: `tsc_${uuid()}`,
        call_id: currentToolCallId, execution: "client",
        arguments: parseArgsObj(currentToolCallArgs), status: "completed",
      });
    } else if (freeform) {
      output.push({
        type: "custom_tool_call", id: `ctc_${uuid()}`,
        call_id: currentToolCallId, name: realName,
        input: freeformInput(currentToolCallArgs), status: "completed",
        ...(ns ? { namespace: ns } : {}),
      });
    } else {
      output.push({
        type: "function_call", id: `fc_${uuid()}`,
        call_id: currentToolCallId, name: realName,
        arguments: currentToolCallArgs || "{}", status: "completed",
        ...(ns ? { namespace: ns } : {}),
        ...plaintextCollaborationFields(ns, realName),
      });
    }
    currentToolCallId = "";
    currentToolCallName = "";
    currentToolCallArgs = "";
  };

  for (const e of events) {
    switch (e.type) {
      case "assistant_boundary":
        flushText();
        flushSummaryReasoning();
        flushRawReasoning();
        flushToolCall();
        break;
      case "text_delta":
        if (currentText && currentTextPhase !== e.phase) flushText();
        if (currentSummaryReasoning) flushSummaryReasoning();
        if (currentRawReasoning) flushRawReasoning();
        if (currentToolCallId) flushToolCall();
        // Compaction turns keep the summary out of normal message output (replay dedup — see
        // bridgeToResponsesSSE); it ships only inside the synthetic compaction item below.
        if (options?.compaction) compactionText += e.text;
        else {
          currentTextPhase = e.phase;
          currentText += e.text;
        }
        break;
      case "thinking_delta":
        if (currentText) flushText();
        if (currentRawReasoning) flushRawReasoning();
        if (currentToolCallId) flushToolCall();
        currentSummaryReasoning += e.thinking;
        break;
      case "thinking_signature":
        // End of the current thinking block — flush it WITH the signature envelope so the
        // block/signature pairing survives multi-block turns.
        batchSignature = e.signature;
        flushSummaryReasoning();
        break;
      case "redacted_thinking":
        batchRedacted.push(e.data);
        break;
      case "reasoning_raw_delta":
        if (currentText) flushText();
        if (currentSummaryReasoning) flushSummaryReasoning();
        if (currentToolCallId) flushToolCall();
        currentRawReasoning += e.text;
        break;
      case "tool_call_start":
        if (currentText) flushText();
        if (currentSummaryReasoning) flushSummaryReasoning();
        if (currentRawReasoning) flushRawReasoning();
        flushToolCall();
        currentToolCallId = e.id;
        currentToolCallName = e.name;
        currentToolCallArgs = "";
        break;
      case "tool_call_delta":
        currentToolCallArgs += e.arguments;
        break;
      case "tool_call_end":
        flushToolCall();
        break;
      case "error":
        terminalEvent = e;
        usage = e.usage ?? usage;
        break;
      case "incomplete":
      case "done":
        terminalEvent = e;
        usage = e.usage;
        endTurn = e.endTurn;
        if (e.providerState) options?.onProviderState?.(e.providerState);
        break;
    }
    // Match streaming: events after the first terminal do not belong to this response.
    if (terminalEvent) break;
  }
  flushText();
  flushSummaryReasoning();
  flushRawReasoning();
  flushToolCall();
  // A truncated turn must never become replacement history. Emit a compaction item only after
  // authoritative turn completion.
  const terminal = responseTerminal(terminalEvent);
  if (options?.compaction && terminal.compactionAllowed) {
    output.push({ type: "compaction", id: `cmp_${uuid()}`, encrypted_content: encodeCompactionSummary(compactionText) });
  }

  const errorEvent = terminalEvent?.type === "error" ? terminalEvent : undefined;
  const failure = errorEvent ? adapterFailureFromEvent(errorEvent) : undefined;
  return {
    id: responseId, object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: terminal.status,
    model: modelId, output,
    ...(endTurn !== undefined ? { end_turn: endTurn } : {}),
    ...(failure ? { error: failure.error, last_error: failure.error } : {}),
    ...(errorEvent?.retryable !== undefined ? { retryable: errorEvent.retryable } : {}),
    ...(terminal.status === "incomplete" ? { incomplete_details: terminal.incompleteDetails } : {}),
    usage: responsesUsage(usage),
  };
}
