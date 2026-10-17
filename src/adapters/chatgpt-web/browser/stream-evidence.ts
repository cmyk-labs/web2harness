import type { CDPSession, Page } from "playwright-core";
import { StringDecoder } from "node:string_decoder";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";
import { ChatGptMcpCallObservation } from "./mcp-call-observation";

/** Bounded SSE facts. Only a transient connector-result buffer is inspected for fixed errors;
 * no bodies, tool arguments or hidden reasoning are returned in telemetry. */
export class ChatGptStreamProjection {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private bytes = 0;
  private role?: string;
  private channel?: string;
  private contentType?: string;
  private deltaPath = "";
  private currentMessage?: { id: unknown; author: unknown; recipient: unknown };
  private toolResult?: { metadata: { parent_id?: string }; content: { content_type: "text"; parts: string[] } };
  constructor(private readonly mcp?: ChatGptMcpCallObservation) {}
  readonly facts = { frames: 0, done: false, errorEvents: 0, assistantMessageSeen: false,
    unclassifiedMessageSeen: false,
    visibleTextChars: 0, visibleDeltaChars: 0, toolMessageSeen: false, toolResultSeen: false,
    truncated: false, malformedFrames: 0 };
  push(base64: string): void {
    if (this.facts.truncated || !base64) return;
    // Bound allocation before decoding; a large or unsupported stream remains explicitly incomplete.
    if (base64.length > 1_400_000 || (this.bytes += base64.length) > 12_000_000) {
      this.facts.truncated = true; this.buffer = ""; return;
    }
    this.buffer += this.decoder.write(Buffer.from(base64, "base64"));
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end).trimEnd(); this.buffer = this.buffer.slice(end + 1);
      if (!line.startsWith("data: ")) continue;
      if (line === "data: [DONE]") { this.facts.done = true; continue; }
      if (line.length > 512_000) { this.facts.truncated = true; this.buffer = ""; return; }
      try { this.scan(JSON.parse(line.slice(6))); this.facts.frames += 1; }
      catch { this.facts.malformedFrames += 1; }
    }
    if (this.buffer.length > 512_000) { this.facts.truncated = true; this.buffer = ""; }
  }
  private scan(value: unknown, depth = 0): void {
    if (!value || typeof value !== "object" || depth > 8) return;
    const v = value as Record<string, any>;
    if (v.error || v.type === "error") this.facts.errorEvents += 1;
    if (v.author && v.content) {
      this.currentMessage = { id: v.id, author: { role: v.author.role, name: v.author.name }, recipient: v.recipient };
      this.deltaPath = "";
      this.toolResult = v.author.role === "tool" && v.author.name === "api_tool.call_tool"
        && v.content.content_type === "text" && Array.isArray(v.content.parts) && v.content.parts.length <= 16
        && v.content.parts.every((part: unknown) => typeof part === "string")
        && v.content.parts.join("").length <= 16_384
        ? { metadata: { parent_id: typeof v.metadata?.parent_id === "string" ? v.metadata.parent_id : undefined },
          content: { content_type: "text", parts: [...v.content.parts] } } : undefined;
      this.mcp?.observe({ ...this.currentMessage, metadata: v.metadata,
        ...(v.author.role === "tool" ? { content: v.content } : {}) });
      this.role = ["assistant", "tool", "user"].includes(v.author.role) ? v.author.role : undefined;
      this.channel = ["final", "commentary", "analysis"].includes(v.channel) ? v.channel : undefined;
      this.contentType = ["text", "code"].includes(v.content.content_type) ? v.content.content_type : undefined;
      if (this.role === "assistant") this.facts.assistantMessageSeen = true;
      if (this.role === "assistant" && (!this.channel || !this.contentType)) this.facts.unclassifiedMessageSeen = true;
      if (this.role === "tool") this.facts.toolResultSeen = true;
      if (this.role === "assistant" && this.contentType === "code") this.facts.toolMessageSeen = true;
      if (this.visible()) {
        const parts = Array.isArray(v.content.parts) ? v.content.parts : [];
        this.facts.visibleTextChars = Math.max(this.facts.visibleTextChars,
          parts.reduce((sum: number, part: unknown) => sum + (typeof part === "string" ? part.length : 0), 0));
      }
      return; // Do not traverse message content or metadata, including analysis and tool arguments.
    }
    if (typeof v.p === "string") this.deltaPath = v.p;
    if (this.currentMessage) {
      if (this.deltaPath === "/message/metadata" && v.v && typeof v.v === "object" && !Array.isArray(v.v)) {
        if (this.toolResult) this.toolResult.metadata = { parent_id: typeof v.v.parent_id === "string" ? v.v.parent_id : undefined };
        this.mcp?.observe({ ...this.currentMessage, metadata: v.v });
      } else if (this.deltaPath === "/message/metadata/connector_tool_payload" && v.o !== "append") {
        this.mcp?.observe({ ...this.currentMessage, metadata: { connector_tool_payload: v.v } });
      }
      if (this.toolResult && typeof v.v === "string") {
        const part = /^\/message\/content\/parts\/(\d+)$/.exec(this.deltaPath);
        if (this.deltaPath === "/message/metadata/parent_id") this.toolResult.metadata.parent_id = v.v;
        if (part) {
          const index = Number(part[1]);
          if (index >= 16 || v.v.length + this.toolResult.content.parts.join("").length > 16_384) this.toolResult = undefined;
          else this.toolResult.content.parts[index] = v.o === "append" ? (this.toolResult.content.parts[index] ?? "") + v.v : v.v;
        }
      }
      if (this.toolResult) this.mcp?.observe({ ...this.currentMessage, ...this.toolResult });
    }
    if (typeof v.v === "string") {
      if (this.deltaPath === "/message/channel") this.channel = ["final", "commentary", "analysis"].includes(v.v) ? v.v : undefined;
      else if (this.visible() && /^\/message\/content\/parts\/\d+$/.test(this.deltaPath)) this.facts.visibleDeltaChars += v.v.length;
    }
    for (const child of Object.values(v)) {
      if (Array.isArray(child)) for (const entry of child.slice(0, 128)) this.scan(entry, depth + 1);
      else if (child && typeof child === "object") this.scan(child, depth + 1);
    }
  }
  private visible() { return this.role === "assistant" && this.contentType === "text"
    && (this.channel === "final" || this.channel === "commentary"); }
}

/** Read-only CDP telemetry on this exact owned page. Unsupported CDP never changes task behavior. */
export class ChatGptStreamEvidence {
  readonly mcp: ChatGptMcpCallObservation;
  constructor(binding?: string) { this.mcp = new ChatGptMcpCallObservation(binding); }
  private session?: CDPSession;
  private generation = 0;
  private readonly streams = new Map<string, ChatGptStreamProjection>();
  private readonly pending = new Map<string, { chunks: string[]; chars: number }>();
  private readonly prior: ReturnType<ChatGptStreamEvidence["snapshot"]>["streams"] = [];
  private unavailable = false;
  private attached = false;
  async attach(page: Page): Promise<void> {
    await this.detach();
    const generation = this.generation;
    try {
      const connection = page.context().newCDPSession(page);
      void connection.then(session => { if (generation !== this.generation) void session.detach().catch(() => {}); }).catch(() => {});
      const session = await withChatGptBrowserObservationTimeout(connection, 1_000);
      this.session = session;
      session.on("Network.responseReceived", event => {
        let url: URL;
        try { url = new URL(event.response.url); } catch { return; }
        if (url.origin !== "https://chatgpt.com" || !/^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname)
          || !event.response.mimeType.includes("event-stream")) return;
        if (this.streams.size + this.prior.length >= 4) { this.unavailable = true; return; }
        const projection = new ChatGptStreamProjection(this.mcp); this.streams.set(event.requestId, projection);
        this.pending.set(event.requestId, { chunks: [], chars: 0 });
        void session.send("Network.streamResourceContent", { requestId: event.requestId }).then(result => {
          if (generation !== this.generation) return;
          projection.push(result.bufferedData);
          for (const chunk of this.pending.get(event.requestId)?.chunks ?? []) projection.push(chunk);
          this.pending.delete(event.requestId);
        }).catch(() => { this.pending.delete(event.requestId); this.unavailable = true; });
      });
      session.on("Network.dataReceived", event => {
        if (!event.data) return;
        const pending = this.pending.get(event.requestId);
        if (!pending) { this.streams.get(event.requestId)?.push(event.data); return; }
        if ((pending.chars += event.data.length) > 1_400_000) {
          this.streams.get(event.requestId)!.facts.truncated = true; pending.chunks = []; return;
        }
        pending.chunks.push(event.data);
      });
      await withChatGptBrowserObservationTimeout(session.send("Network.enable"), 1_000);
      this.attached = true;
    } catch { this.unavailable = true; await this.detach(); }
  }
  snapshot(): { attached: boolean; unavailable: boolean; mcp: ReturnType<ChatGptMcpCallObservation["snapshot"]>; streams: Array<ChatGptStreamProjection["facts"]> } {
    return { attached: this.attached, unavailable: this.unavailable, mcp: this.mcp.snapshot(),
      streams: [...this.prior, ...[...this.streams.values()].map(stream => ({ ...stream.facts }))] };
  }
  async detach(): Promise<void> {
    this.generation += 1;
    const session = this.session; this.session = undefined;
    this.prior.push(...[...this.streams.values()].map(stream => ({ ...stream.facts })));
    this.streams.clear();
    this.pending.clear();
    if (session) await withChatGptBrowserObservationTimeout(session.detach(), 1_000).catch(() => { this.unavailable = true; });
  }
}
