import { diagnosticContext, diagnosticEvent, diagnosticReference } from "../../diagnostics";

type Stage = "observed" | "projected" | "journaled" | "emitter_returned" | "emitter_failed";
type Evidence = {
  source: "dom_commentary" | "native_reply" | "adapter_commentary";
  sourceText?: string;
  expectedText?: string;
  actualText?: string;
  fragmentText?: string;
  slot?: string;
  continuation?: boolean;
  complete?: boolean;
  transformation?: "dom_whitespace_v1" | "native_tool_blocks_v1" | "identity_v1";
};

/** Metadata only. An emitter return is not an acknowledgement from the Codex client. */
export class ChatGptPublicTextEvidence {
  private readonly context: Record<string, unknown>;
  private readonly counts = new Map<Stage, number>();
  private sequence = 0;

  constructor(traceId?: string, roundKey?: string) {
    this.context = { ...diagnosticContext.getStore(), ...(traceId ? { traceId } : {}),
      ...(roundKey ? { roundRef: diagnosticReference(roundKey) } : {}) };
  }

  record(stage: Stage, evidence: Evidence): void {
    // Diagnostics cannot change execution, even if hashing or the sink fails.
    try {
      const count = this.counts.get(stage) ?? 0;
      this.counts.set(stage, Math.min(count + 1, 65));
      if (count >= 64) {
        if (count === 64) diagnosticEvent("info", "browser.public_text_evidence_limited", {
          ...this.context, stage, limit: 64,
        });
        return;
      }
      const fingerprint = (value: string) => ({
        chars: value.length, utf8Bytes: Buffer.byteLength(value), diagnosticRef: diagnosticReference(value),
      });
      const matches = evidence.expectedText !== undefined && evidence.actualText !== undefined
        ? evidence.expectedText === evidence.actualText : undefined;
      diagnosticEvent(matches === false || stage === "emitter_failed" ? "warning" : "info", "browser.public_text_evidence", {
        ...this.context, stage, source: evidence.source, sequence: ++this.sequence,
        ...(evidence.slot === undefined ? {} : { block: { diagnosticRef: diagnosticReference(evidence.slot) } }),
        ...(evidence.transformation ? { transformation: { type: evidence.transformation } } : {}),
        ...(evidence.sourceText === undefined ? {} : { sourceTextEvidence: fingerprint(evidence.sourceText) }),
        ...(evidence.expectedText === undefined ? {} : { expectedTextEvidence: fingerprint(evidence.expectedText) }),
        ...(evidence.actualText === undefined ? {} : { actualTextEvidence: fingerprint(evidence.actualText) }),
        ...(evidence.fragmentText === undefined ? {} : { fragmentEvidence: fingerprint(evidence.fragmentText) }),
        ...(evidence.continuation === undefined ? {} : { continuation: evidence.continuation }),
        ...(evidence.complete === undefined ? {} : { complete: evidence.complete }),
        ...(matches === undefined ? {} : { matches }),
        // Transport/SSE acknowledgement requires evidence beyond this callback.
        clientAcknowledged: false,
      });
    } catch { /* Optional evidence never authorizes replay or changes a delivered answer. */ }
  }
}
