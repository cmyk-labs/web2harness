import type { Page, Request, Response } from "playwright-core";

type ResourceKind = "document" | "script" | "stylesheet" | "conversation" | "other";
type NetworkFailure = "aborted" | "network_changed" | "connection" | "timeout" | "other";

export function conversationRequest(request: Pick<Request, "url" | "method">): boolean {
  if (request.method() !== "POST") return false;
  try {
    const url = new URL(request.url());
    return url.origin === "https://chatgpt.com" && /^\/backend-api\/(?:f\/)?conversation(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}

/** Per-owned-page transport facts. No URL, body, headers, arbitrary error strings, or hidden reasoning. */
export class ChatGptTurnEvidence {
  private page?: Page;
  private readonly requests = new Map<Request, ResourceKind>();
  private readonly events: Array<{ resourceKind: ResourceKind; event: "requested" | "response" | "finished" | "failed";
    status?: number; networkFailure?: NetworkFailure; atMs: number }> = [];
  private readonly startedAt = Date.now();
  conversationRequestObserved = false;
  submissionStarted = false;
  conversationResponses = 0;
  conversationFinished = 0;
  conversationFailed = 0;
  droppedEvents = 0;
  private record(kind: ResourceKind, event: "requested" | "response" | "finished" | "failed", extra = {}) {
    if (this.events.length >= 64) {
      this.droppedEvents += 1;
      if (kind !== "conversation") return;
      // Asset loading precedes submission and can exhaust the budget. Preserve the recent
      // conversation facts that explain a failed send, without increasing retained data.
      const asset = this.events.findIndex(item => item.resourceKind !== "conversation");
      this.events.splice(asset < 0 ? 0 : asset, 1);
    }
    this.events.push({ resourceKind: kind, event, atMs: Date.now() - this.startedAt, ...extra });
  }
  private requestKind(request: Request): ResourceKind | undefined {
    // Conversation identity is available on every callback. Neither a full handle budget
    // nor a same-page rebind should hide its response status or terminal event.
    return this.requests.get(request) ?? (conversationRequest(request) ? "conversation" : undefined);
  }
  private onRequest = (request: Request) => {
    let kind: ResourceKind = conversationRequest(request) ? "conversation" : "other";
    if (kind === "conversation") this.conversationRequestObserved = true;
    else if (["document", "script", "stylesheet"].includes(request.resourceType())) kind = request.resourceType() as ResourceKind;
    if (kind === "other") return;
    // Bound retained request handles too; absence of request details never clears the sticky send flag.
    if (this.requests.size < 128) this.requests.set(request, kind);
    this.record(kind, "requested");
  };
  private onResponse = (response: Response) => {
    const kind = this.requestKind(response.request());
    if (!kind) return;
    if (kind === "conversation") this.conversationResponses += 1;
    this.record(kind, "response", { status: response.status() });
  };
  private onFinished = (request: Request) => {
    const kind = this.requestKind(request); this.requests.delete(request);
    if (!kind) return;
    if (kind === "conversation") this.conversationFinished += 1;
    this.record(kind, "finished");
  };
  private onFailed = (request: Request) => {
    const kind = this.requestKind(request); this.requests.delete(request);
    if (!kind) return;
    if (kind === "conversation") this.conversationFailed += 1;
    const raw = request.failure()?.errorText ?? "";
    const failure: NetworkFailure = /ERR_ABORTED/.test(raw) ? "aborted" : /NETWORK_CHANGED/.test(raw) ? "network_changed"
      : /TIMED_OUT/.test(raw) ? "timeout" : /CONNECTION|DISCONNECTED|NAME_NOT_RESOLVED/.test(raw) ? "connection" : "other";
    this.record(kind, "failed", { networkFailure: failure });
  };
  attach(page: Page): void {
    this.detach(); this.page = page;
    page.on("request", this.onRequest); page.on("response", this.onResponse);
    page.on("requestfinished", this.onFinished); page.on("requestfailed", this.onFailed);
  }
  snapshot() {
    return { submissionStarted: this.submissionStarted, conversationRequestObserved: this.conversationRequestObserved,
      conversationResponses: this.conversationResponses, conversationFinished: this.conversationFinished,
      conversationFailed: this.conversationFailed, droppedEvents: this.droppedEvents,
      // Transport completion is not SSE [DONE], nor proof that the response contained visible prose.
      upstreamContentObserved: false, events: [...this.events] };
  }
  detach(): void {
    this.page?.off("request", this.onRequest); this.page?.off("response", this.onResponse);
    this.page?.off("requestfinished", this.onFinished); this.page?.off("requestfailed", this.onFailed);
    this.page = undefined; this.requests.clear();
  }
}
