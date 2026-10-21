import { diagnosticContext, diagnosticError, diagnosticEvent } from "../../../diagnostics";
import { ChatGptWebAdapterError } from "../adapter-error";

type UploadEvent = "creation_requested" | "creation_response" | "processing_requested" | "processing_response"
  | "processing_started" | "file_ready" | "processing_completed" | "processing_failed" | "unrecognized_event"
  | "malformed_event" | "streaming_unavailable" | "body_unavailable" | "stream_ended" | "connection_failed"
  | "card_failed" | "upload_started" | "reconciliation_started" | "body_available" | "readback_retry";

/** Bounded, payload-free state per owned file attempt. Never store file names or response bodies here. */
export class ChatGptAttachmentObservation {
  private readonly context = { ...diagnosticContext.getStore() };
  private readonly startedAt = Date.now();
  private lastEventAt?: number;
  private lastEvent?: UploadEvent;
  private readonly recorded = new Set<UploadEvent>();
  private terminal = false;
  readonly state = {
    upload: { phase: "prepared" },
    observer: { status: "observing" },
    creationObserved: false,
    processingObserved: false,
    creationStatus: undefined as number | undefined,
    processingStatus: undefined as number | undefined,
    streamingFailed: false,
    bodyReadFailed: false,
    bodyReadAttempts: 0,
    completed: false,
    processingBytes: 0,
    malformedEvents: 0,
    unrecognizedEvents: 0,
    ignoredFileEvents: 0,
    cardCount: undefined as number | undefined,
    failedCardCount: undefined as number | undefined,
  };

  constructor(readonly fileIndex: number, readonly attempt = 1) {}

  note(event: UploadEvent): void {
    if (this.terminal) return;
    this.lastEvent = event;
    this.lastEventAt = Date.now();
    if (event === "upload_started") this.state.upload.phase = "uploading";
    if (event === "creation_requested") this.state.upload.phase = "creating";
    if (event === "processing_requested" || event === "processing_started") this.state.upload.phase = "processing";
    if (event === "processing_completed") this.state.upload.phase = "completed";
    if (event === "processing_failed" || event === "card_failed") this.state.upload.phase = "failed";
    if (event === "streaming_unavailable" || event === "body_unavailable" || event === "connection_failed") {
      this.state.observer.status = "unavailable";
    }
    if (event === "reconciliation_started" || event === "readback_retry") this.state.observer.status = "reconciling";
    if (event === "body_available" || event === "processing_completed") this.state.observer.status = "observing";
    // One record per fixed event kind and attempt, independent of stream size or UI polling.
    if (this.recorded.has(event)) return;
    this.recorded.add(event);
    diagnosticEvent("info", "browser.attachment_stage", {
      ...this.context, fileIndex: this.fileIndex, attempt: this.attempt, ...this.state,
      phase: "file_attachment", lastEvent: { type: event }, sequence: this.recorded.size,
      elapsedMs: Math.max(0, this.lastEventAt - this.startedAt),
    });
  }

  report(outcome: "succeeded" | "failed" | "cancelled" | "timed-out", error?: unknown, timeoutMs?: number): void {
    if (this.terminal) return;
    this.terminal = true;
    if (outcome !== "succeeded" && this.state.upload.phase !== "failed") this.state.observer.status = "unconfirmed";
    const now = Date.now();
    diagnosticEvent(outcome === "failed" || outcome === "timed-out" ? "warning" : "info", "browser.attachment_observation", {
      ...this.context, fileIndex: this.fileIndex, attempt: this.attempt, ...this.state,
      phase: "file_attachment", outcome, elapsedMs: Math.max(0, now - this.startedAt),
      ...(this.lastEventAt === undefined ? {} : { lastEventAgeMs: Math.max(0, now - this.lastEventAt), lastEvent: { type: this.lastEvent } }),
      ...(timeoutMs === undefined ? {} : { timeoutMs, reason: this.state.processingObserved
        ? "processing_completion_unconfirmed" : this.state.creationObserved ? "processing_not_observed" : "upload_not_observed" }),
      ...(error === undefined ? {} : {
        errorRef: diagnosticError(error).errorRef,
        code: error instanceof ChatGptWebAdapterError ? error.code : "attachment_observation_cancelled",
      }),
    });
  }
}
