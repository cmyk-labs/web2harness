// Adapted from miuuyy/codex-chatgpt-web 0486509, f137c2f and cdfceafd (MIT; see LICENSES).
import type { Page } from "playwright-core";
import { StringDecoder } from "node:string_decoder";
import { ChatGptWebAdapterError } from "../adapter-error";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";

export class ChatGptAttachmentUploadError extends ChatGptWebAdapterError {
  constructor(readonly fileName: string, message: string, status = 502) {
    super(status === 429
      ? "ChatGPT has reached its file-upload limit. Wait until the limit shown in ChatGPT clears before retrying. The original prompt and file bytes were preserved."
      : `ChatGPT attachment upload failed before the prompt was sent: ${message}. The original prompt and file bytes were preserved.`,
      { status, errorType: status === 429 ? "rate_limit_error" : "server_error",
        code: status === 429 ? "upload_quota_exceeded" : "chatgpt_attachment_upload_failed", retryable: false });
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
  const streams = new Map<string, { name: string; fileId?: string; decoder: StringDecoder; pending: string; buffered?: string[]; activation?: Promise<void> }>();
  let disposed = false;
  const newFile = () => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void ready.catch(() => {});
    return { ready, resolve, reject, failure: undefined as ChatGptAttachmentUploadError | undefined };
  };
  const files = new Map([...expected].map(name => [name, newFile()]));
  const fail = (name: string, message: string, status = 502) => {
    const file = files.get(name);
    if (disposed || !file || file.failure) return;
    file.failure = new ChatGptAttachmentUploadError(name, message, status);
    file.reject(file.failure);
  };
  const consume = (id: string, data: string, final = false) => {
    const stream = streams.get(id);
    if (!stream || disposed || completed.has(stream.name)) return;
    stream.pending += data;
    const lines = stream.pending.split(/\r?\n/);
    stream.pending = final ? "" : lines.pop()!;
    if (stream.pending.length > 1024 * 1024) return fail(stream.name, "unrecognized upload processing stream");
    for (const line of lines) {
      if (!line.trim()) continue;
      let envelope;
      try { envelope = JSON.parse(line); } catch { continue; }
      const event = envelope.data && typeof envelope.data === "object" ? envelope.data : envelope;
      const name = event.event ?? envelope.event;
      if (typeof name !== "string") continue;
      if (stream.fileId && event.file_id && event.file_id !== stream.fileId) continue;
      if (/\.(error|failed|cancelled|unknown)$/.test(name)) return fail(stream.name, `processing event ${name}`);
      if (name === "file.processing.completed") {
        completed.add(stream.name);
        files.get(stream.name)?.resolve();
        return;
      }
    }
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
    if (creation) { creations.set(event.requestId, body.file_name); return; }
    streams.set(event.requestId, { name: body.file_name, fileId: body.file_id, decoder: new StringDecoder("utf8"), pending: "", buffered: [] });
  };
  const onResponse = (event: any) => {
    const creation = creations.get(event.requestId);
    if (creation) {
      if (!disposed && (event.response.status < 200 || event.response.status >= 300)) {
        fail(creation, `file creation HTTP ${event.response.status}`, event.response.status);
      }
      // A file ID is not evidence that bytes were uploaded and processed.
      return;
    }
    const stream = streams.get(event.requestId);
    if (!stream || disposed) return;
    if (event.response.status < 200 || event.response.status >= 300) {
      fail(stream.name, `upload processing HTTP ${event.response.status}`, event.response.status);
      return;
    }
    // Processing-completed can arrive before the response closes; ChatGPT may then cancel it.
    // Stream the observed bytes rather than waiting for response.text() or a loadingfinished event.
    stream.activation = session.send("Network.streamResourceContent", { requestId: event.requestId }).then(result => {
      consume(event.requestId, stream.decoder.write(Buffer.from(result.bufferedData, "base64")));
      for (const data of stream.buffered ?? []) consume(event.requestId, stream.decoder.write(Buffer.from(data, "base64")));
      stream.buffered = undefined;
    }).catch(() => {
      // A short response may already be complete when streaming is enabled. A CDP
      // observation failure is not an upload failure: loadingFinished must validate
      // the complete body, or loadingFailed must report the transport failure.
      // Keep ready pending until that authoritative terminal event is processed.
    });
  };
  const onData = (event: any) => {
    const stream = streams.get(event.requestId);
    if (!stream || !event.data) return;
    if (stream.buffered) stream.buffered.push(event.data);
    else consume(event.requestId, stream.decoder.write(Buffer.from(event.data, "base64")));
  };
  const onFinished = (event: any) => {
    creations.delete(event.requestId);
    const stream = streams.get(event.requestId);
    if (!stream || disposed || completed.has(stream.name)) return;
    // Handles a short response which finished before streamResourceContent was enabled.
    void (stream.activation ?? Promise.resolve()).then(async () => {
      if (disposed || completed.has(stream.name) || streams.get(event.requestId) !== stream) return;
      const body = await session.send("Network.getResponseBody", { requestId: event.requestId });
      if (disposed || streams.get(event.requestId) !== stream) return;
      stream.pending = "";
      consume(event.requestId, body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body, true);
      if (!completed.has(stream.name)) fail(stream.name, "upload processing ended without a completion event");
    }).catch(() => { if (streams.get(event.requestId) === stream && !completed.has(stream.name)) fail(stream.name, "upload processing ended without confirmation"); });
  };
  const onFailed = (event: any) => {
    const creation = creations.get(event.requestId);
    if (creation) { creations.delete(event.requestId); fail(creation, "file creation connection failed"); }
    const stream = streams.get(event.requestId);
    if (stream) void (stream.activation ?? Promise.resolve()).then(() => {
      if (streams.get(event.requestId) === stream && !completed.has(stream.name)) fail(stream.name, "upload processing connection failed");
    });
  };
  const listeners: Record<string, (event: any) => void> = { "Network.requestWillBeSent": onRequest, "Network.responseReceived": onResponse,
    "Network.dataReceived": onData, "Network.loadingFinished": onFinished, "Network.loadingFailed": onFailed };
  const onEvent = (event: { method: string; params?: object }) => listeners[event.method]?.(event.params);
  session.on("event", onEvent);
  const dispose = async () => {
    disposed = true;
    for (const [name, file] of files) if (!completed.has(name)) {
      file.reject(new DOMException("Upload observation disposed", "AbortError"));
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
          const finish = (error?: unknown) => {
            clearTimeout(timer); waiting.removeEventListener("abort", abort);
            if (error !== undefined) no(error); else yes();
          };
          const abort = () => finish(waiting.reason ?? new DOMException("Upload observation aborted", "AbortError"));
          if (waiting.aborted) { abort(); return; }
          timer = setTimeout(() => finish(new Error(`ChatGPT attachment processing timed out after ${timeoutMs}ms`)), timeoutMs);
          waiting.addEventListener("abort", abort, { once: true });
          file.ready.then(() => finish(), finish);
        })));
      } finally { controller.abort(); }
    };
  return {
    throwIfFailed: () => { for (const file of files.values()) if (file.failure) throw file.failure; },
    fail,
    reset: (name: string) => {
      if (disposed || !files.has(name)) throw new Error("Upload observation is no longer owned");
      for (const [id, stream] of streams) if (stream.name === name) streams.delete(id);
      for (const [id, file] of creations) if (file === name) creations.delete(id);
      completed.delete(name);
      files.set(name, newFile());
    },
    wait: (signal?: AbortSignal, timeoutMs = 300_000) => wait([...expected], signal, timeoutMs),
    waitFor: (name: string, signal?: AbortSignal, timeoutMs = 300_000) => wait([name], signal, timeoutMs),
    dispose,
  };
}
