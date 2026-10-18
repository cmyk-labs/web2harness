import type { CDPSession, Page } from "playwright-core";
import { ChatGptResponseSource, type ChatGptResponseBinding, type ChatGptResponseSourceResult } from "./response-source";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";
import type { ChatGptResponseEvidenceLimits } from "./response-evidence";

const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trim();
export function chatGptResponseRequestBinding(request: { method: string; url: string; postData?: string },
  prompt: string, conversationId?: string): ChatGptResponseBinding | undefined {
  try {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.origin !== "https://chatgpt.com"
      || !/^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname) || !request.postData || request.postData.length > 2_000_000) return;
    const body = JSON.parse(request.postData);
    if (body.action !== "next" || !Array.isArray(body.messages) || body.messages.length !== 1) return;
    const message = body.messages[0];
    if (message?.author?.role !== "user" || typeof message.id !== "string" || !message.id || message.id.length > 256
      || !Array.isArray(message.content?.parts)
      || !message.content.parts.some((part: unknown) => typeof part === "string" && normalize(part) === normalize(prompt))) return;
    if (body.conversation_id != null && (typeof body.conversation_id !== "string" || body.conversation_id.length > 256)) return;
    if (conversationId && body.conversation_id !== conversationId) return;
    return { userMessageId: message.id, ...(body.conversation_id ? { conversationId: body.conversation_id } : {}) };
  } catch { return; }
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
  private accepted = false;
  private responseReceived = false;
  private status?: number;
  private finished = false;
  private attempted = 0;
  private readonly traffic = new Map<string, { method: string; endpoint: string; status?: number; failed?: boolean; bound?: boolean }>();
  private droppedTraffic = 0;
  private pageExceptions = 0;
  private errorPage?: Page;
  private errorListener?: () => void;
  private bodyFallback = false;

  constructor(private readonly options: { captureEvidence?: boolean | ChatGptResponseEvidenceLimits } = {}) {}

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
      const session = await withChatGptBrowserObservationTimeout(connection, 1_000);
      this.session = session;
      const tree = await withChatGptBrowserObservationTimeout(session.send("Page.getFrameTree"), 1_000);
      this.frame = tree.frameTree.frame.id;
      session.on("Network.requestWillBeSent", event => {
        if (generation !== this.generation || this.prompt === undefined || event.frameId !== this.frame) return;
        let endpoint: string | undefined;
        try {
          const url = new URL(event.request.url);
          if (url.origin === "https://chatgpt.com") {
            if (/^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname)) endpoint = "generation";
            else if (/^\/backend-api\/(?:f\/)?conversation\/prepare$/.test(url.pathname)) endpoint = "prepare";
            else if (/^\/backend-api\/(?:f\/)?conversation\//.test(url.pathname)) endpoint = "conversation";
            else if (/^\/backend-api\/files(?:\/|$)/.test(url.pathname)) endpoint = "upload";
          }
        } catch { /* Only allowlisted route classes enter diagnostics. */ }
        if (endpoint) {
          if (this.traffic.size < 32) this.traffic.set(event.requestId, { method: ["POST", "GET", "PUT", "DELETE", "OPTIONS"].includes(event.request.method) ? event.request.method : "other", endpoint });
          else this.droppedTraffic++;
        }
        const binding = chatGptResponseRequestBinding(event.request, this.prompt, this.expectedConversation);
        const facts = this.traffic.get(event.requestId); if (facts) facts.bound = !!binding;
        if (!binding) return;
        this.attempted++;
        if (this.requestId) { this.unavailable = "response_request_ambiguous"; return; }
        this.requestId = event.requestId; this.binding = binding;
        this.source = new ChatGptResponseSource(binding, this.options.captureEvidence);
      });
      session.on("Network.responseReceived", event => {
        if (generation === this.generation) { const facts = this.traffic.get(event.requestId); if (facts) facts.status = event.response.status; }
        if (generation !== this.generation || event.requestId !== this.requestId) return;
        this.responseReceived = true; this.status = event.response.status;
        if (event.response.status !== 200 || !event.response.mimeType.includes("event-stream")) {
          this.unavailable = "response_transport_rejected"; return;
        }
        this.pending = []; this.pendingBytes = 0;
        this.activation = withChatGptBrowserObservationTimeout(
          session.send("Network.streamResourceContent", { requestId: event.requestId }), 2_000).then(result => {
          if (generation !== this.generation) return;
          this.consume(result.bufferedData);
          for (const chunk of this.pending ?? []) this.consume(chunk);
          this.pending = undefined;
        }).catch(() => {
          if (generation === this.generation) this.unavailable = "response_stream_unavailable";
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
        if (generation !== this.generation || event.requestId !== this.requestId) return;
        void (this.activation ?? Promise.resolve()).then(async () => {
          if (generation !== this.generation) return;
          if (this.unavailable === "response_stream_unavailable" && this.binding && this.status === 200) {
            // A short response can finish before streaming activates. Read that exact response;
            // this command does not make a network request or regenerate a model answer.
            const body = await withChatGptBrowserObservationTimeout(session.send("Network.getResponseBody", { requestId: event.requestId }), 2_000);
            if (generation !== this.generation) return;
            this.source?.clearEvidence();
            this.source = new ChatGptResponseSource(this.binding, this.options.captureEvidence);
            this.bodyFallback = true;
            this.unavailable = undefined;
            this.source.push(Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8"));
            this.refreshAccepted();
          }
          this.source?.finish(); this.finished = true;
        }).catch(() => { if (generation === this.generation) { this.unavailable ??= "response_body_unavailable"; this.finished = true; } });
      });
      session.on("Network.loadingFailed", event => {
        if (generation === this.generation) { const facts = this.traffic.get(event.requestId); if (facts) facts.failed = true; }
        if (generation !== this.generation || event.requestId !== this.requestId) return;
        void (this.activation ?? Promise.resolve()).then(() => {
          if (generation !== this.generation) return;
          // The site cancels its fetch after application-level completion. Preserve a proved
          // complete message; a cancellation before the terminators remains a failure.
          this.source?.finish(); this.finished = true;
          const facts = this.source?.facts();
          if (!facts?.done || !facts.streamComplete) this.unavailable ??= "response_transport_incomplete";
        });
      });
      await withChatGptBrowserObservationTimeout(session.send("Network.enable", { maxPostDataSize: 2_000_000 }), 1_000);
    } catch { this.unavailable ??= "response_observer_unavailable"; await this.detach(); }
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
  result(): ChatGptResponseSourceResult {
    if (this.unavailable) return { state: "rejected", reason: this.unavailable };
    if (!this.source) return { state: "collecting" };
    const result = this.source.result();
    if (result.state === "complete" && !this.finished) return { state: "collecting" };
    return result.state === "collecting" && this.finished ? { state: "rejected", reason: "response_stream_incomplete" } : result;
  }
  snapshot() { return { armed: this.prompt !== undefined, matchedRequests: this.attempted,
    responseReceived: this.responseReceived, status: this.status, accepted: this.accepted, finished: this.finished,
    reason: this.unavailable, projection: this.source?.facts(), traffic: [...this.traffic.values()], droppedTraffic: this.droppedTraffic, pageExceptions: this.pageExceptions }; }
  /** Private artifact, never normal logs. Export once on failure BEFORE detach. Default off.
   * The worker owns private-file policy/lifecycle; this observer performs no filesystem writes.
   */
  takeEvidence() {
    const observation = this.snapshot();
    const artifact = this.source?.takeEvidence();
    return artifact ? { ...artifact, observation, bodyFallback: this.bodyFallback } : undefined;
  }
  async detach(): Promise<void> {
    this.generation++;
    this.source?.clearEvidence();
    if (this.errorPage && this.errorListener) this.errorPage.off("pageerror", this.errorListener);
    this.errorPage = undefined; this.errorListener = undefined;
    const session = this.session; this.session = undefined;
    if (session) await withChatGptBrowserObservationTimeout(session.detach(), 1_000).catch(() => {});
  }
}
