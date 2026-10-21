// Adapted from miuuyy/codex-chatgpt-web 0486509, f137c2f and cdfceafd (MIT; see LICENSES).
import type { Page } from "playwright-core";
import { StringDecoder } from "node:string_decoder";
import { ChatGptWebAdapterError } from "../adapter-error";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";
import { ChatGptAttachmentObservation } from "./attachment-observation";

export class ChatGptAttachmentUploadError extends ChatGptWebAdapterError {
  /** Local single-file recovery only; never authorizes replay of a Codex request. */
  get recoverable(): boolean {
    return this.status === 408 || (this.status >= 500 && this.status !== 501 && this.status !== 505);
  }
  constructor(readonly fileName: string, message: string, status = 502) {
    super(status === 429
      ? "ChatGPT has reached its file-upload limit. Wait until the limit shown in ChatGPT clears before retrying. The original prompt and file bytes were preserved."
      : `ChatGPT attachment upload failed before the prompt was sent: ${message}. The original prompt and file bytes were preserved.`,
      { status, errorType: status === 429 ? "rate_limit_error" : "server_error",
        code: status === 429 ? "upload_quota_exceeded" : "chatgpt_attachment_upload_failed", retryable: false });
  }
}

// Observation uncertainty must never enter the explicit-upload-failure recovery branch.
export class ChatGptAttachmentObservationError extends ChatGptWebAdapterError {
  constructor(message: string, code: "chatgpt_attachment_processing_timeout" | "chatgpt_attachment_observation_failed") {
    super(`ChatGPT attachment ${message}. Completion could not be confirmed; the prompt was not sent. The original prompt and file bytes were preserved.`,
      { status: 502, errorType: "server_error", code, retryable: false });
  }
}

/** Observe only processing requests for files attached by this turn, on its owned frame. */
export async function observeChatGptAttachmentUploads(page: Page, names: string[]) {
  let abandoned = false;
  const opening = page.context().newCDPSession(page).then(async session => {
    if (abandoned) {
      await withChatGptBrowserObservationTimeout(session.detach(), 30_000).catch(() => {});
      throw new Error("Upload observer initialization expired");
    }
    return session;
  });
  const session = await withChatGptBrowserObservationTimeout(opening, 30_000).catch(error => { abandoned = true; throw error; });
  const origin = new URL(page.url()).origin;
  const { frameTree } = await withChatGptBrowserObservationTimeout(session.send("Page.getFrameTree"), 30_000).catch(async error => {
    await withChatGptBrowserObservationTimeout(session.detach(), 30_000).catch(() => {});
    throw error;
  });
  const expected = new Set(names);
  const completed = new Set<string>();
  const creations = new Map<string, string>();
  const streams = new Map<string, { name: string; fileId?: string; decoder: StringDecoder; pending: string;
    buffered?: string[]; activation?: Promise<void>; ended?: boolean; reads: number; readback?: Promise<void> }>();
  let disposed = false;
  const newFile = (index: number, attempt = 1) => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void ready.catch(() => {});
    return { ready, resolve, reject, observation: new ChatGptAttachmentObservation(index, attempt),
      lifetime: new AbortController(), deadline: Infinity, fileId: undefined as string | undefined,
      failure: undefined as Error | undefined };
  };
  const files = new Map([...expected].map((name, index) => [name, newFile(index)]));
  const rejectFile = (name: string, error: Error, outcome: "failed" | "cancelled" | "timed-out" = "failed", timeoutMs?: number) => {
    const file = files.get(name);
    if (disposed || !file || file.failure || completed.has(name)) return;
    file.failure = error;
    if (error instanceof ChatGptAttachmentUploadError) file.observation.state.upload.phase = "failed";
    file.observation.report(outcome, error, timeoutMs);
    file.reject(error);
    file.lifetime.abort(error);
  };
  const fail = (name: string, message: string, status = 502) =>
    rejectFile(name, new ChatGptAttachmentUploadError(name, message, status));
  const unconfirmed = (name: string, message: string) =>
    rejectFile(name, new ChatGptAttachmentObservationError(message, "chatgpt_attachment_observation_failed"));
  const consume = (id: string, data: string, final = false) => {
    const stream = streams.get(id);
    if (!stream || disposed || completed.has(stream.name) || files.get(stream.name)?.failure) return;
    const observation = files.get(stream.name)!.observation;
    observation.state.processingBytes += Buffer.byteLength(data);
    stream.pending += data;
    const lines = stream.pending.split(/\r?\n/);
    stream.pending = final ? "" : lines.pop()!;
    if (stream.pending.length > 1024 * 1024) return unconfirmed(stream.name, "has an unrecognized upload processing stream");
    for (const line of lines) {
      if (!line.trim()) continue;
      let envelope;
      try { envelope = JSON.parse(line); } catch {
        observation.state.malformedEvents++; observation.note("malformed_event"); continue;
      }
      if (!envelope || typeof envelope !== "object") {
        observation.state.malformedEvents++; observation.note("malformed_event"); continue;
      }
      const event = envelope.data && typeof envelope.data === "object" ? envelope.data : envelope;
      const name = event.event ?? envelope.event;
      if (typeof name !== "string") { observation.state.unrecognizedEvents++; observation.note("unrecognized_event"); continue; }
      if (stream.fileId && event.file_id && event.file_id !== stream.fileId) { observation.state.ignoredFileEvents++; continue; }
      if (/\.(error|failed|cancelled|unknown)$/.test(name)) {
        observation.note("processing_failed");
        return fail(stream.name, `processing event ${/^file\.processing\.(error|failed|cancelled|unknown)$/.test(name) ? name : "failed"}`);
      }
      if (name === "file.processing.completed") {
        completed.add(stream.name);
        observation.state.completed = true;
        observation.note("processing_completed");
        observation.report("succeeded");
        files.get(stream.name)?.resolve();
        files.get(stream.name)?.lifetime.abort();
        return;
      }
      if (name === "file.processing.file_ready") observation.note("file_ready");
      else if (name === "file.processing.started") observation.note("processing_started");
      else { observation.state.unrecognizedEvents++; observation.note("unrecognized_event"); }
    }
  };
  // A response-body read observes the original request; it never repeats its POST.
  // Share one reconciliation per request, with at most two bounded reads per attempt.
  const reconcile = (id: string): Promise<void> => {
    const stream = streams.get(id);
    const file = stream && files.get(stream.name);
    if (!stream || !file || disposed || file.failure || completed.has(stream.name)) return Promise.resolve();
    if (stream.readback) return stream.readback;
    const current = () => !disposed && streams.get(id) === stream && files.get(stream.name) === file
      && !file.failure && !completed.has(stream.name) && !file.lifetime.signal.aborted;
    const read = async () => {
      file.observation.note("reconciliation_started");
      while (current() && stream.reads < 2) {
        const remaining = file.deadline - performance.now();
        if (remaining <= 0) return;
        stream.reads++;
        file.observation.state.bodyReadAttempts++;
        if (stream.reads > 1) file.observation.note("readback_retry");
        let abort!: () => void;
        const stopped = new Promise<never>((_resolve, reject) => {
          abort = () => reject(file.lifetime.signal.reason);
          file.lifetime.signal.addEventListener("abort", abort, { once: true });
        });
        try {
          const body = await withChatGptBrowserObservationTimeout(Promise.race([
            session.send("Network.getResponseBody", { requestId: id }), stopped,
          ]), Math.min(30_000, remaining));
          if (!current()) return;
          file.observation.note("body_available");
          stream.pending = "";
          consume(id, body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body, true);
          if (current() && stream.ended) unconfirmed(stream.name, "upload processing ended without a completion event");
          return;
        } catch {
          if (!current()) return;
          file.observation.state.bodyReadFailed = true;
          file.observation.note("body_unavailable");
          // Before a terminal event, a body may simply not be available yet.
          if (!stream.ended) return;
        } finally { file.lifetime.signal.removeEventListener("abort", abort); }
      }
      if (current() && stream.ended) unconfirmed(stream.name, "upload processing ended without confirmation");
    };
    stream.readback = read().finally(() => { stream.readback = undefined; });
    return stream.readback;
  };
  const onRequest = (event: any) => {
    if (disposed || event.frameId !== frameTree.frame.id || event.request.method !== "POST") return;
    const url = new URL(event.request.url);
    const creation = url.pathname === "/backend-api/files";
    if (url.origin !== origin || !(creation || url.pathname === "/backend-api/files/process_upload_stream"
      || /^\/backend-api\/files\/upload_reservations\/[^/]+\/claim_and_finish$/.test(url.pathname))) return;
    let body;
    try { body = JSON.parse(event.request.postData ?? ""); } catch { return; }
    if (!expected.has(body?.file_name)) return;
    const file = files.get(body.file_name)!;
    if (file.failure || completed.has(body.file_name)) return;
    const observation = file.observation;
    if (creation) {
      observation.state.creationObserved = true; observation.note("creation_requested");
      creations.set(event.requestId, body.file_name); return;
    }
    const fileId = typeof body.file_id === "string" ? body.file_id : undefined;
    if (fileId && file.fileId && fileId !== file.fileId) {
      unconfirmed(body.file_name, "processing identity changed within one upload attempt"); return;
    }
    file.fileId ??= fileId;
    observation.state.processingObserved = true; observation.note("processing_requested");
    streams.set(event.requestId, { name: body.file_name, fileId, decoder: new StringDecoder("utf8"), pending: "", buffered: [], reads: 0 });
  };
  const onResponse = (event: any) => {
    const creation = creations.get(event.requestId);
    if (creation) {
      const file = files.get(creation)!;
      if (disposed || file.failure || completed.has(creation)) return;
      const observation = file.observation;
      observation.state.creationStatus = event.response.status; observation.note("creation_response");
      if (!disposed && (event.response.status < 200 || event.response.status >= 300)) {
        fail(creation, `file creation HTTP ${event.response.status}`, event.response.status);
      }
      // A file ID is not evidence that bytes were uploaded and processed.
      return;
    }
    const stream = streams.get(event.requestId);
    if (!stream || disposed) return;
    const observation = files.get(stream.name)!.observation;
    observation.state.processingStatus = event.response.status; observation.note("processing_response");
    if (event.response.status < 200 || event.response.status >= 300) {
      fail(stream.name, `upload processing HTTP ${event.response.status}`, event.response.status);
      return;
    }
    // Processing-completed can arrive before the response closes; ChatGPT may then cancel it.
    // Stream the observed bytes rather than waiting for response.text() or a loadingfinished event.
    stream.activation = withChatGptBrowserObservationTimeout(session.send("Network.streamResourceContent", { requestId: event.requestId }), 30_000).then(result => {
      if (disposed || streams.get(event.requestId) !== stream) return;
      consume(event.requestId, stream.decoder.write(Buffer.from(result.bufferedData, "base64")));
      for (const data of stream.buffered ?? []) consume(event.requestId, stream.decoder.write(Buffer.from(data, "base64")));
      stream.buffered = undefined;
    }).catch(() => {
      // Observation failure is not upload failure. Read the original request
      // within its current attempt and processing deadline.
      if (!disposed && streams.get(event.requestId) === stream && !completed.has(stream.name)) {
        observation.state.streamingFailed = true; observation.note("streaming_unavailable");
        void reconcile(event.requestId);
      }
    });
  };
  const onData = (event: any) => {
    const stream = streams.get(event.requestId);
    if (!stream || !event.data || disposed || completed.has(stream.name) || files.get(stream.name)?.failure) return;
    if (stream.buffered) stream.buffered.push(event.data);
    else consume(event.requestId, stream.decoder.write(Buffer.from(event.data, "base64")));
  };
  const onFinished = (event: any) => {
    creations.delete(event.requestId);
    const stream = streams.get(event.requestId);
    if (!stream || disposed || completed.has(stream.name)) return;
    const observation = files.get(stream.name)!.observation;
    stream.ended = true;
    observation.note("stream_ended");
    // Read immediately: a stuck stream activation must not hold up a completed response.
    void reconcile(event.requestId);
  };
  const onFailed = (event: any) => {
    const creation = creations.get(event.requestId);
    if (creation) {
      files.get(creation)!.observation.note("connection_failed");
      creations.delete(event.requestId);
      unconfirmed(creation, "file creation connection ended without confirmation");
    }
    const stream = streams.get(event.requestId);
    if (stream && !disposed && !completed.has(stream.name)) {
      stream.ended = true;
      files.get(stream.name)!.observation.note("connection_failed");
      // Some cancellations arrive after completion bytes but before the observer reads them.
      void reconcile(event.requestId);
    }
  };
  const listeners: Record<string, (event: any) => void> = { "Network.requestWillBeSent": onRequest, "Network.responseReceived": onResponse,
    "Network.dataReceived": onData, "Network.loadingFinished": onFinished, "Network.loadingFailed": onFailed };
  const onEvent = (event: { method: string; params?: object }) => listeners[event.method]?.(event.params);
  session.on("event", onEvent);
  const dispose = async () => {
    disposed = true;
    for (const [name, file] of files) if (!completed.has(name)) {
      const error = new DOMException("Upload observation disposed", "AbortError");
      file.observation.report("cancelled", error);
      file.reject(error); file.lifetime.abort(error);
    }
    session.off("event", onEvent);
    await withChatGptBrowserObservationTimeout(session.detach(), 30_000).catch(() => {});
  };
  try { await withChatGptBrowserObservationTimeout(session.send("Network.enable"), 30_000); } catch (error) { await dispose(); throw error; }
  const wait = async (names: string[], signal?: AbortSignal, timeoutMs = 300_000) => {
      const controller = new AbortController();
      const waiting = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        await Promise.all(names.map(name => new Promise<void>((yes, no) => {
          const file = files.get(name)!;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let probe: ReturnType<typeof setTimeout> | undefined;
          let settled = false;
          const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer); clearTimeout(probe); waiting.removeEventListener("abort", abort);
            if (error !== undefined) no(error); else yes();
          };
          const abort = () => {
            const error = waiting.reason ?? new DOMException("Upload observation aborted", "AbortError");
            if (!settled) rejectFile(name, error, "cancelled");
            finish(error);
          };
          if (waiting.aborted) { abort(); return; }
          file.deadline = Math.min(file.deadline, performance.now() + timeoutMs);
          const remaining = Math.max(0, file.deadline - performance.now());
          timer = setTimeout(() => {
            const error = new ChatGptAttachmentObservationError(`processing timed out after ${timeoutMs}ms`, "chatgpt_attachment_processing_timeout");
            rejectFile(name, error, "timed-out", timeoutMs);
            finish(error);
          }, remaining);
          // One last read window can recover missed data/terminal events. Never extend the deadline.
          probe = setTimeout(() => {
            for (const [id, stream] of streams) if (stream.name === name) void reconcile(id);
          }, Math.max(0, remaining - Math.min(30_000, remaining / 2)));
          waiting.addEventListener("abort", abort, { once: true });
          file.ready.then(() => finish(), finish);
        })));
      } finally { controller.abort(); }
    };
  return {
    started: (name: string) => files.get(name)?.observation.note("upload_started"),
    throwIfFailed: () => { for (const file of files.values()) if (file.failure) throw file.failure; },
    fail,
    recordCardState: (name: string, count: number, failedCount: number) => {
      const file = files.get(name);
      if (disposed || !file || completed.has(name)) return;
      file.observation.state.cardCount = count;
      file.observation.state.failedCardCount = failedCount;
      if (failedCount > 0) file.observation.note("card_failed");
    },
    reset: (name: string) => {
      if (disposed || !files.has(name)) throw new Error("Upload observation is no longer owned");
      for (const [id, stream] of streams) if (stream.name === name) streams.delete(id);
      for (const [id, file] of creations) if (file === name) creations.delete(id);
      completed.delete(name);
      const previous = files.get(name)!.observation;
      files.get(name)!.lifetime.abort();
      files.set(name, newFile(previous.fileIndex, previous.attempt + 1));
    },
    wait: (signal?: AbortSignal, timeoutMs = 300_000) => wait([...expected], signal, timeoutMs),
    waitFor: (name: string, signal?: AbortSignal, timeoutMs = 300_000) => wait([name], signal, timeoutMs),
    dispose,
  };
}
