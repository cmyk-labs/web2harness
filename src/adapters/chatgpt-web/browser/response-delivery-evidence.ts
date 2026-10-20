import { createHash } from "node:crypto";
import type { ChatGptResponseDomSnapshot } from "./response-dom";
import type { ChatGptResponseStream } from "./response-stream";

/** Private opt-in evidence. Diagnostics never authorize delivery or compare different renderings
 * as a success gate. Only the public answer projection is retained, not DOM HTML or trace blocks. */
export function chatGptResponseDeliveryEvidence(input: {
  traceId: string;
  selectedSource: "response" | "dom";
  delivered: string;
  source: ChatGptResponseStream;
  dom?: ChatGptResponseDomSnapshot;
}) {
  const text = (value: string) => ({ text: value, chars: value.length,
    sha256: createHash("sha256").update(value).digest("hex") });
  const result = input.source.result();
  return {
    version: 1, format: "chatgpt-public-response-delivery", traceId: input.traceId,
    capturedAt: new Date().toISOString(), selectedSource: input.selectedSource,
    delivered: text(input.delivered),
    source: result.state === "complete"
      ? { state: result.state, messageId: result.messageId, conversationId: result.conversationId, ...text(result.text) }
      : result,
    observation: input.source.snapshot(),
    events: input.source.takeEvidence(),
    dom: input.dom ? {
      state: input.dom.contentState, messageId: input.dom.messageId,
      visible: text(input.dom.visibleText),
      // Text is a secondary DOM observation, not a claim of Markdown byte equivalence.
      segments: input.dom.markdownSegments.map(segment => ({ tag: segment.tag, text: segment.text })),
    } : { state: "unobserved" },
  };
}
