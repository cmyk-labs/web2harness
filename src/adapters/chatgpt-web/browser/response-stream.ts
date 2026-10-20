import type { CDPSession, Page } from "playwright-core";
import { ChatGptResponseSource, responseSourceBlocksFallback, type ChatGptResponseBinding, type ChatGptResponseSourceResult } from "./response-source";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";
import type { ChatGptResponseEvidenceLimits } from "./response-evidence";
import { chatGptPromptTextEquivalent } from "./composer";

const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

function submittedPromptEquivalent(expected: string, submitted: string): boolean {
  if (chatGptPromptTextEquivalent(expected, submitted)) return true;
  // The Markdown composer serializes plain text with punctuation escapes and automatic
  // links. Undo one serialization layer, then require the entire original prompt again.
  // Do not rewrite the submitted request, collapse whitespace, or discard link destinations.
  const unescape = (text: string) => text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1");
  const text = submitted.replace(/\[(https?:\/\/(?:\\.|[^\[\]\\\r\n])*)\]\(((?:\\.|[^()\\\r\n])*)\)/g,
    (link, label: string, destination: string) => unescape(label) === unescape(destination) ? label : link);
  return chatGptPromptTextEquivalent(expected, unescape(text));
}

export function chatGptResponseRequestBinding(request: { method: string; url: string; postData?: string },
  prompt: string, conversationId?: string): ChatGptResponseBinding | undefined {
  return inspectRequestBinding(request, prompt, conversationId).binding;
}

function inspectRequestBinding(request: { method: string; url: string; postData?: string },
  prompt: string, conversationId?: string): { binding?: ChatGptResponseBinding; reason?: string } {
  try {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.origin !== "https://chatgpt.com"
      || !/^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname)) return { reason: "request_route_unmatched" };
    if (!request.postData) return { reason: "request_body_unavailable" };
    if (request.postData.length > 2_000_000) return { reason: "request_body_size_limit" };
    const body = JSON.parse(request.postData);
    if (body.action !== "next") return { reason: "request_action_unmatched" };
    if (!Array.isArray(body.messages) || body.messages.length !== 1) return { reason: "request_messages_unmatched" };
    const message = body.messages[0];
    if (message?.author?.role !== "user" || typeof message.id !== "string" || !message.id || message.id.length > 256) return { reason: "request_user_unmatched" };
    const textParts = Array.isArray(message.content?.parts)
      ? message.content.parts.filter((part: unknown): part is string => typeof part === "string") : [];
    if (!textParts.length || !submittedPromptEquivalent(normalize(prompt), normalize(textParts.join("")))) {
      return { reason: "request_prompt_unmatched" };
    }
    if (body.conversation_id != null && (typeof body.conversation_id !== "string" || body.conversation_id.length > 256)) return { reason: "request_conversation_invalid" };
    if (conversationId && body.conversation_id !== conversationId) return { reason: "request_conversation_unmatched" };
    return { binding: { userMessageId: message.id, ...(body.conversation_id ? { conversationId: body.conversation_id } : {}) } };
  } catch { return { reason: "request_encoding_invalid" }; }
}

/** Passive observation of one actual submission on one owned page. Never sends/replays a request.
 * Any lost observation makes the source incomplete; it does not permit a different answer or tools.
 */
export class ChatGptResponseStream {
  private session?: CDPSession;
  private generation = 0;
  private frame?: string;
  private prompt?: string;
  private expectedConversation?: string;
  private requestId?: string;
  private binding?: ChatGptResponseBinding;
  private source?: ChatGptResponseSource;
  private pending?: string[];
  private pendingBytes = 0;
  private activation?: Promise<void>;
  private unavailable?: string;
  private invalid = false;
  private resumed = 0;
  private accepted = false;
  private responseReceived = false;
  private status?: number;
  private finished = false;
  private settling = false;
  private attempted = 0;
  private readonly traffic = new Map<string, { method: string; endpoint: string; status?: number; failed?: boolean; bound?: boolean; reason?: string }>();
  private droppedTraffic = 0;
  private pageExceptions = 0;
  private errorPage?: Page;
  private errorListener?: () => void;
  private bodyFallback = false;
  private bodyRecoveryAttempted = false;
  private transportFailed = false;
  private readonly readbacks = new Map<string, { status?: number }>();
  private readbackCount = 0;
  private readbackResult?: ChatGptResponseSourceResult;

  constructor(private readonly options: { captureEvidence?: boolean | ChatGptResponseEvidenceLimits; operationTimeoutMs?: number; savedChatReadback?: boolean } = {}) {}
  private get operationTimeoutMs() { return this.options.operationTimeoutMs ?? 120_000; }

  async attach(page: Page): Promise<void> {
    if (this.prompt !== undefined) this.unavailable ??= "response_observation_rebound";
    await this.detach();
    const generation = this.generation;
    this.errorPage = page;
    this.errorListener = () => { if (generation === this.generation && this.prompt !== undefined) this.pageExceptions++; };
    page.on("pageerror", this.errorListener);
    try {
      const connection = page.context().newCDPSession(page);
      void connection.then(session => { if (generation !== this.generation) void session.detach().catch(() => {}); }).catch(() => {});
      const session = await withChatGptBrowserObservationTimeout(connection, this.operationTimeoutMs);
      this.session = session;
      const tree = await withChatGptBrowserObservationTimeout(session.send("Page.getFrameTree"), this.operationTimeoutMs);
      this.frame = tree.frameTree.frame.id;
      session.on("Network.requestWillBeSent", event => {
        if (generation !== this.generation || this.prompt === undefined || event.frameId !== this.frame) return;
        let endpoint: string | undefined;
        try {
          const url = new URL(event.request.url);
          if (url.origin === "https://chatgpt.com") {
            const pending = this.source?.result();
            if (this.options.savedChatReadback && event.request.method === "GET" && pending?.state === "awaiting_final"
              && ["conversation", "conversations"].some(route =>
                url.pathname === `/backend-api/${route}/${encodeURIComponent(pending.conversationId)}`)) {
              this.readbacks.set(event.requestId, {});
            }
            if (/^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname)) endpoint = "generation";
            else if (/^\/backend-api\/(?:f\/)?conversation\/prepare$/.test(url.pathname)) endpoint = "prepare";
            else if (/^\/backend-api\/(?:f\/)?conversations?\//.test(url.pathname)) endpoint = "conversation";
            else if (/^\/backend-api\/files(?:\/|$)/.test(url.pathname)) endpoint = "upload";
          }
        } catch { /* Only allowlisted route classes enter diagnostics. */ }
        if (endpoint) {
          if (this.traffic.size < 32) this.traffic.set(event.requestId, { method: ["POST", "GET", "PUT", "DELETE", "OPTIONS"].includes(event.request.method) ? event.request.method : "other", endpoint });
          else this.droppedTraffic++;
        }
        // Observe the site's automatic resume only. The next source snapshot must prove
        // an already-bound message identity; route/frame/conversation alone are insufficient.
        if (event.request.url === "https://chatgpt.com/backend-api/f/conversation/resume"
          && this.requestId && this.transportFailed && this.source && !this.invalid) {
          if (this.source.lifecycle().state === "complete") return;
          try { this.source.beginTransport(); }
          catch {
            this.unavailable = "response_after_termination";
            this.invalid = true;
            return;
          }
          this.requestId = event.requestId;
          this.finished = false; this.settling = false; this.transportFailed = false;
          this.pending = undefined; this.activation = undefined; this.pendingBytes = 0;
          this.unavailable = undefined; this.resumed++;
          return;
        }
        const inspected = inspectRequestBinding(event.request, this.prompt, this.expectedConversation);
        const binding = inspected.binding;
        const facts = this.traffic.get(event.requestId);
        if (facts) { facts.bound = !!binding; if (endpoint === "generation" && !binding) facts.reason = inspected.reason; }
        if (!binding) return;
        this.attempted++;
        if (this.requestId) { this.unavailable = "response_request_ambiguous"; this.invalid = true; return; }
        this.requestId = event.requestId; this.binding = binding;
        this.source = new ChatGptResponseSource(binding, this.options.captureEvidence);
      });
      session.on("Network.responseReceived", event => {
        if (generation === this.generation) { const facts = this.traffic.get(event.requestId); if (facts) facts.status = event.response.status; }
        if (generation === this.generation) {
          const readback = this.readbacks.get(event.requestId);
          if (readback) readback.status = event.response.status;
        }
        if (generation !== this.generation || event.requestId !== this.requestId) return;
        this.responseReceived = true; this.status = event.response.status;
        if (event.response.status !== 200 || !event.response.mimeType.includes("event-stream")) {
          this.unavailable = "response_transport_rejected"; this.invalid = true; return;
        }
        this.pending = []; this.pendingBytes = 0;
        this.activation = withChatGptBrowserObservationTimeout(
          session.send("Network.streamResourceContent", { requestId: event.requestId }), this.operationTimeoutMs).then(result => {
          if (generation !== this.generation || event.requestId !== this.requestId) return;
          this.consume(result.bufferedData);
          for (const chunk of this.pending ?? []) this.consume(chunk);
          this.pending = undefined;
        }).catch(() => {
          if (generation === this.generation && event.requestId === this.requestId) this.unavailable = "response_stream_unavailable";
        });
      });
      session.on("Network.dataReceived", event => {
        if (generation !== this.generation || event.requestId !== this.requestId || !event.data) return;
        if (this.pending) {
          if ((this.pendingBytes += event.data.length) > 4_000_000) {
            this.unavailable = "response_stream_size_limit"; this.pending = []; return;
          }
          this.pending.push(event.data);
        } else this.consume(event.data);
      });
      session.on("Network.loadingFinished", event => {
        if (generation === this.generation && this.readbacks.has(event.requestId)) {
          void this.readSavedConversation(session, event.requestId, generation);
        }
        if (generation !== this.generation || event.requestId !== this.requestId) return;
        void this.completeTransport(session, event.requestId, generation, false);
      });
      session.on("Network.loadingFailed", event => {
        this.readbacks.delete(event.requestId);
        if (generation === this.generation) { const facts = this.traffic.get(event.requestId); if (facts) facts.failed = true; }
        if (generation !== this.generation || event.requestId !== this.requestId) return;
        this.transportFailed = true;
        void this.completeTransport(session, event.requestId, generation, true);
      });
      await withChatGptBrowserObservationTimeout(session.send("Network.enable", { maxPostDataSize: 2_000_000 }), this.operationTimeoutMs);
    } catch { this.unavailable ??= "response_observer_unavailable"; await this.detach(); }
  }

  private async readSavedConversation(session: CDPSession, requestId: string, generation: number): Promise<void> {
    const readback = this.readbacks.get(requestId);
    this.readbacks.delete(requestId);
    if (readback?.status !== 200) return;
    try {
      const body = await withChatGptBrowserObservationTimeout(session.send("Network.getResponseBody", { requestId }), this.operationTimeoutMs);
      if (generation !== this.generation || typeof body.body !== "string" || body.body.length > 24 * 1024 * 1024) return;
      const bytes = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8");
      if (bytes.length > 16 * 1024 * 1024) return;
      const result = this.source?.reconcileSavedConversation(JSON.parse(bytes.toString("utf8")));
      this.readbackCount++;
      if (result?.state === "complete" || (result && responseSourceBlocksFallback(result))) this.readbackResult = result;
    } catch {
      // Missing/cache-evicted readback is an observation failure, not a new generation.
    }
  }

  private async completeTransport(session: CDPSession, requestId: string, generation: number, failed: boolean): Promise<void> {
    if (generation !== this.generation || requestId !== this.requestId || this.settling) return;
    this.settling = true;
    try {
      await this.activation;
      if (generation !== this.generation || requestId !== this.requestId || this.finished) return;
      this.transportFailed = failed;
      this.source?.finish();
      const projection = this.source?.result();
      // A completed HTTP response may outlive a missed CDP activation/chunk. Read only that
      // response, once. Unsupported semantics and positive failure evidence are not retried
      // or overwritten. In particular an aborted partial fetch cannot authorize a body read.
      if (!failed && this.resumed === 0 && !this.bodyRecoveryAttempted && this.binding && this.status === 200
        && (!projection || !responseSourceBlocksFallback(projection))
        && (this.unavailable === "response_stream_unavailable"
          || (!this.unavailable && projection?.state === "collecting"))) {
        this.bodyRecoveryAttempted = true;
        const body = await withChatGptBrowserObservationTimeout(session.send("Network.getResponseBody", { requestId }), this.operationTimeoutMs);
        if (generation !== this.generation || requestId !== this.requestId) return;
        if (typeof body.body !== "string" || body.body.length > 24 * 1024 * 1024) throw Error("Response body unavailable");
        const bytes = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8");
        if (bytes.length > 16 * 1024 * 1024) throw Error("Response body unavailable");
        this.source?.clearEvidence();
        this.source = new ChatGptResponseSource(this.binding, this.options.captureEvidence);
        this.bodyFallback = true;
        this.unavailable = undefined;
        this.source.push(bytes); this.source.finish(); this.refreshAccepted();
      }
      const facts = this.source?.facts();
      // A late site fetch cancellation after application termination is normal. Observation
      // termination is independent of successful body projection (e.g. unknown event forms).
      if (failed && (!facts?.observedDone || !facts.observedStreamComplete)) this.unavailable ??= "response_transport_incomplete";
    } catch {
      if (generation === this.generation && requestId === this.requestId) this.unavailable ??= "response_body_unavailable";
    } finally {
      if (generation === this.generation && requestId === this.requestId) this.finished = true;
    }
  }

  activate(prompt: string, conversationId?: string): void {
    if (this.prompt !== undefined) throw new Error("Response source cannot be reused for a second send");
    this.prompt = prompt; this.expectedConversation = conversationId;
  }
  private consume(base64: string): void {
    if (base64.length > 4_000_000) { this.unavailable = "response_stream_size_limit"; return; }
    this.source?.push(Buffer.from(base64, "base64")); this.refreshAccepted();
  }
  private refreshAccepted(): void {
    if (!this.unavailable && this.status === 200 && this.source?.facts().inputBound) this.accepted = true;
  }
  submissionAccepted(): boolean { return this.accepted; }
  lifecycle() { return this.invalid ? { state: "failed" as const } : this.source?.lifecycle() ?? { state: "unknown" as const }; }
  result(): ChatGptResponseSourceResult {
    const projection = this.source?.result();
    if (projection && responseSourceBlocksFallback(projection)) return projection;
    if (this.invalid) return { state: "rejected", reason: this.unavailable!, kind: "invalid" };
    if (this.readbackResult) return this.readbackResult;
    if (projection?.state === "complete") return projection;
    if (this.unavailable) return { state: "rejected", reason: this.unavailable, kind: "unavailable" };
    if (!this.source) return { state: "collecting" };
    const result = this.source.result();
    return result.state === "collecting" && this.finished ? { state: "rejected", reason: "response_stream_incomplete", kind: "unavailable" } : result;
  }
  snapshot() { return { armed: this.prompt !== undefined, matchedRequests: this.attempted,
    responseReceived: this.responseReceived, status: this.status, accepted: this.accepted, finished: this.finished, resumed: this.resumed,
    reason: this.unavailable, transportFailed: this.transportFailed, bodyRecoveryAttempted: this.bodyRecoveryAttempted,
    projection: this.source?.facts(), readbackCount: this.readbackCount,
    traffic: [...this.traffic.values()], droppedTraffic: this.droppedTraffic, pageExceptions: this.pageExceptions }; }
  /** Private artifact, never normal logs. Export once on failure BEFORE detach. Default off.
   * The worker owns private-file policy/lifecycle; this observer performs no filesystem writes.
   */
  takeEvidence() {
    const observation = this.snapshot();
    const artifact = this.source?.takeEvidence();
    return artifact ? { ...artifact, observation, bodyFallback: this.bodyFallback, savedReadback: this.readbackResult } : undefined;
  }
  async detach(): Promise<void> {
    this.generation++;
    this.source?.clearEvidence();
    if (this.errorPage && this.errorListener) this.errorPage.off("pageerror", this.errorListener);
    this.errorPage = undefined; this.errorListener = undefined;
    const session = this.session; this.session = undefined;
    if (session) await withChatGptBrowserObservationTimeout(session.detach(), 30_000).catch(() => {});
  }
}
