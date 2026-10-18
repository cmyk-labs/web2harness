import { ServerSentEventDecoder } from "./sse-decoder";
import { ChatGptResponseEvidence, type ChatGptResponseEvidenceLimits } from "./response-evidence";

type Json = Record<string, any>;
type Message = { id: string; role: string; channel: unknown; recipient: unknown; status: unknown;
  endTurn: unknown; contentType: unknown; parts?: string[]; discarded: boolean; parent?: string;
  hidden: boolean; references: unknown[]; citations: unknown[]; complete?: boolean; finishType?: string };
export interface ChatGptResponseBinding { userMessageId: string; conversationId?: string }
export type ChatGptResponseSourceResult =
  | { state: "collecting" }
  | { state: "rejected"; reason: string }
  | { state: "complete"; text: string; messageId: string; conversationId: string };

// Unsupported presentation/observation can use the independent DOM validator. Positive evidence
// of a different request, unfinished final or server failure must never be hidden by that fallback.
export function responseSourceBlocksFallback(result: ChatGptResponseSourceResult): boolean {
  return result.state === "rejected" && ["response_identity_mismatch", "response_parent_unbound",
    "response_after_termination", "response_upstream_error", "response_message_incomplete",
    "response_final_message_ambiguous", "response_transport_rejected", "response_request_ambiguous"].includes(result.reason);
}

const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const publicText = (m: Message) => m.role === "assistant" && ["final", "commentary"].includes(m.channel as string)
  && m.recipient === "all" && !m.hidden && m.contentType === "text";
const ancillaryTypes = new Set(["resume_conversation_token", "message_marker", "server_ste_metadata",
  "conversation_detail_metadata", "title_generation", "conversation_title", "moderation"]);

/** Reconstruct only explicitly public response content. Facts never contain text or source IDs.
 * The v1 delta encoding inherits p/o between top-level frames; patch children use their own context.
 */
export class ChatGptResponseSource {
  private readonly decoder = new ServerSentEventDecoder((data, event) => {
    this.evidence?.capture(data, event);
    if (this.failure) return;
    // Projection failures must not abort framing/capture of later events in the same chunk.
    try { this.event(data, event); } catch (error) { this.reject(this.errorReason(error)); }
  });
  private readonly evidence?: ChatGptResponseEvidence;
  private decoderFailed = false;
  private readonly messages = new Map<string, Message>();
  private current?: Message;
  private path = "";
  private operation = "add";
  private conversation?: string;
  private inputSeen = false;
  private streamComplete = false;
  private done = false;
  private failure?: string;
  private frames = 0;
  constructor(private readonly binding: ChatGptResponseBinding, captureEvidence?: boolean | ChatGptResponseEvidenceLimits) {
    if (captureEvidence) this.evidence = new ChatGptResponseEvidence(captureEvidence === true ? {} : captureEvidence);
  }

  push(bytes: Uint8Array): void {
    if (this.decoderFailed) return;
    try { this.decoder.push(bytes); }
    catch (error) { this.decoderFailed = true; this.evidence?.framingFailure(); this.reject(this.errorReason(error)); }
  }
  finish(): void {
    if (this.decoderFailed) { this.evidence?.finish(true); return; }
    try {
      const { discardedData } = this.decoder.finish();
      this.evidence?.finish(discardedData);
      if (discardedData && this.done) this.reject("response_after_termination");
    } catch { this.evidence?.finish(true); this.reject("response_stream_malformed"); }
  }
  private errorReason(error: unknown): string {
    return error instanceof Error && /^(response_[a-z_]+)$/.test(error.message) ? error.message : "response_stream_malformed";
  }
  takeEvidence() { return this.evidence?.take(this.binding); }
  clearEvidence(): void { this.evidence?.clear(); }
  reject(reason: string): void { this.failure ??= reason; }
  facts() { const result = this.result(); return { frames: this.frames, messageCount: this.messages.size, inputBound: this.inputSeen,
    done: this.done, streamComplete: this.streamComplete, reason: result.state === "rejected" ? result.reason : this.failure, evidence: this.evidence?.summary(),
    publicStates: [...this.messages.values()].filter(publicText).map(m => ({ channel: m.channel,
      finished: m.status === "finished_successfully", endTurn: m.endTurn === true,
      complete: m.complete === true, stopped: m.finishType === "stop",
      // Missing metadata and explicit negative evidence are distinct diagnoses. Missing fields
      // never authorize source delivery; unknown upstream strings never enter telemetry.
      completion: m.complete === undefined ? "missing" : m.complete ? "complete" : "incomplete",
      finish: m.finishType === undefined ? "missing" : m.finishType === "stop" ? "stop" : "other" })) }; }

  result(): ChatGptResponseSourceResult {
    if (this.failure) return { state: "rejected", reason: this.failure };
    if (!this.done || !this.streamComplete) return { state: "collecting" };
    if (!this.inputSeen || !this.conversation) return { state: "rejected", reason: "response_identity_incomplete" };
    const finals = [...this.messages.values()].filter(m => publicText(m) && m.channel === "final" && m.endTurn === true);
    if (finals.length !== 1) return { state: "rejected", reason: "response_final_message_ambiguous" };
    const message = finals[0]!;
    if (message.status !== "finished_successfully" || message.complete === false
      || (message.finishType !== undefined && message.finishType !== "stop")) {
      return { state: "rejected", reason: "response_message_incomplete" };
    }
    // A public message with no known terminal state may be an unfinished later tool phase.
    if ([...this.messages.values()].some(m => publicText(m) && m.status !== "finished_successfully")) {
      return { state: "rejected", reason: "response_message_incomplete" };
    }
    let ancestor: Message | undefined = message;
    const seen = new Set<string>();
    while (ancestor && ancestor.id !== this.binding.userMessageId && !seen.has(ancestor.id)) {
      seen.add(ancestor.id); ancestor = ancestor.parent ? this.messages.get(ancestor.parent) : undefined;
    }
    if (ancestor?.id !== this.binding.userMessageId) return { state: "rejected", reason: "response_parent_unbound" };
    // Observed completed Web messages can omit these metadata fields. That is insufficient
    // evidence for source delivery, not positive evidence of interruption. Only after binding
    // and terminal status checks may the independent DOM completion/coverage validator decide.
    // Explicit false/non-stop values above still forbid fallback even when another field is absent.
    if (message.complete === undefined || message.finishType === undefined) {
      return { state: "rejected", reason: "response_terminal_metadata_unavailable" };
    }
    if (message.discarded || !message.parts) return { state: "rejected", reason: "response_content_unsupported" };
    // Rendering rich references requires their source metadata. Never leak unresolved private-use
    // markers as a successful plain-text answer; the independently checked DOM path may recover it.
    if (message.references.length || message.citations.length || /[\uE000-\uF8FF]/u.test(message.parts.join(""))) {
      return { state: "rejected", reason: "response_references_unsupported" };
    }
    const text = message.parts.join("");
    if (!text.trim()) return { state: "rejected", reason: "response_empty" };
    return { state: "complete", text, messageId: message.id, conversationId: this.conversation };
  }

  private bindConversation(id: unknown): void {
    if (id === undefined || id === null) return;
    if (typeof id !== "string" || !id || id.length > 256 || (this.conversation && this.conversation !== id)
      || (this.binding.conversationId && this.binding.conversationId !== id)) throw new Error("response_identity_mismatch");
    this.conversation = id;
  }
  private event(data: string, event: string): void {
    if (this.done) throw new Error("response_after_termination");
    if (event === "error") throw new Error("response_upstream_error");
    if (data === "[DONE]") { this.done = true; return; }
    const value: unknown = JSON.parse(data); this.frames++;
    if (value === "v1" && this.frames === 1) return;
    if (!object(value)) throw new Error("response_encoding_unsupported");
    this.bindConversation(value.conversation_id);
    if (value.error || value.error_code || value.type === "error") throw new Error("response_upstream_error");
    if (ancillaryTypes.has(value.type)) return;
    // Observed completed streams allow conversation_detail_metadata after this marker, then
    // DONE. A new content/input mutation cannot repair a message after its completion boundary.
    if (this.streamComplete) throw new Error("response_after_termination");
    if (value.type === "message_stream_complete") { this.streamComplete = true; return; }
    if (value.type === "input_message") {
      this.readMessage(value.input_message, false);
      if (value.input_message?.id !== this.binding.userMessageId || value.input_message?.author?.role !== "user") {
        throw new Error("response_identity_mismatch");
      }
      this.inputSeen = true; return;
    }
    if (value.message) { this.readMessage(value.message); return; }
    if (Object.hasOwn(value, "v")) {
      if (typeof value.p === "string") this.path = value.p;
      if (typeof value.o === "string") this.operation = value.o;
      this.apply(this.path, this.operation, value.v, 0); return;
    }
    throw new Error("response_event_unsupported");
  }
  private readMessage(value: unknown, selectCurrent = true): void {
    if (!object(value) || typeof value.id !== "string" || !value.id || value.id.length > 256 || !object(value.author) || !object(value.content)) {
      throw new Error("response_message_unsupported");
    }
    if (this.messages.size >= 256 && !this.messages.has(value.id)) throw new Error("response_message_size_limit");
    const metadata = object(value.metadata) ? value.metadata : {};
    const m: Message = { id: value.id, role: value.author.role, channel: value.channel, recipient: value.recipient,
      status: value.status, endTurn: value.end_turn, contentType: value.content.content_type, discarded: false,
      hidden: metadata.is_visually_hidden_from_conversation === true, references: [], citations: [] };
    this.metadata(m, metadata, false);
    this.content(m, value.content.parts);
    if (m.role === "assistant" && m.contentType === "text" && !["final", "commentary", "analysis"].includes(m.channel as string)) {
      throw new Error("response_channel_unsupported");
    }
    const previous = this.messages.get(m.id);
    if (previous && (previous.role !== m.role || (previous.parent && m.parent && previous.parent !== m.parent))) throw new Error("response_identity_mismatch");
    // The initial user snapshot omits parent_id; the input_message acknowledgement hydrates it.
    // An omitted field is not contradictory identity evidence. Two different known parents are.
    m.parent ??= previous?.parent;
    this.messages.set(m.id, m);
    if (selectCurrent) this.current = m;
  }
  private content(m: Message, value: unknown): void {
    if (publicText(m)) {
      if (!Array.isArray(value) || !value.every(p => typeof p === "string")) throw new Error("response_content_unsupported");
      m.parts = [...value];
    } else { m.parts = undefined; m.discarded = true; }
  }
  private metadata(m: Message, value: Json, append: boolean): void {
    if (!append) { m.parent = undefined; m.references = []; m.citations = []; m.complete = undefined; m.finishType = undefined; }
    if (Object.hasOwn(value, "parent_id")) m.parent = typeof value.parent_id === "string" ? value.parent_id : undefined;
    if (Object.hasOwn(value, "is_visually_hidden_from_conversation")) m.hidden = value.is_visually_hidden_from_conversation === true;
    if (Object.hasOwn(value, "is_complete")) m.complete = value.is_complete === true;
    if (Object.hasOwn(value, "finish_details")) {
      m.finishType = typeof value.finish_details?.type === "string" ? value.finish_details.type : "invalid";
    }
    if (Object.hasOwn(value, "content_references")) {
      if (!Array.isArray(value.content_references)) throw new Error("response_references_unsupported");
      m.references = value.content_references.length ? [true] : [];
    }
    if (Object.hasOwn(value, "citations")) {
      if (!Array.isArray(value.citations)) throw new Error("response_references_unsupported");
      m.citations = value.citations.length ? [true] : [];
    }
    if (!publicText(m)) m.parts = undefined;
  }
  private apply(path: string, operation: string, value: unknown, depth: number): void {
    if (depth > 16) throw new Error("response_patch_size_limit");
    if (operation === "patch") {
      if (!Array.isArray(value) || value.length > 4096) throw new Error("response_patch_unsupported");
      for (const patch of value) {
        if (!object(patch) || typeof patch.p !== "string" || typeof patch.o !== "string") throw new Error("response_patch_unsupported");
        this.apply(`${path}${patch.p}`, patch.o, patch.v, depth + 1);
      }
      return;
    }
    if (!["add", "replace", "append", "remove"].includes(operation)) throw new Error("response_patch_unsupported");
    if (path === "" && ["add", "replace"].includes(operation) && object(value)) {
      this.bindConversation(value.conversation_id);
      if (value.error || value.error_code) throw new Error("response_upstream_error");
      this.readMessage(value.message); return;
    }
    if (path === "/message" && ["add", "replace"].includes(operation)) { this.readMessage(value); return; }
    if (path === "/conversation_id") { this.bindConversation(value); return; }
    const m = this.current;
    if (!m) throw new Error("response_patch_unbound");
    if (path === "/message/metadata" && object(value)) { this.metadata(m, value, operation === "append"); return; }
    if (path.startsWith("/message/metadata/")) {
      const key = path.slice("/message/metadata/".length);
      if (key.includes("/")) {
        if (/^(content_references|citations)\//.test(key)) throw new Error("response_references_unsupported");
        if (/^(finish_details|parent_id|is_complete|is_visually_hidden_from_conversation)\//.test(key)) throw new Error("response_patch_unsupported");
      } else this.metadata(m, { [key]: operation === "remove" ? undefined : value }, true);
      return;
    }
    const scalar = { "/message/channel": "channel", "/message/status": "status", "/message/end_turn": "endTurn",
      "/message/recipient": "recipient", "/message/content/content_type": "contentType" } as const;
    if (Object.hasOwn(scalar, path) && ["add", "replace"].includes(operation)) {
      (m as any)[scalar[path as keyof typeof scalar]] = value;
      if (!publicText(m)) { m.parts = undefined; m.discarded = true; }
      return;
    }
    if (path === "/message/content" && object(value) && ["add", "replace"].includes(operation)) {
      m.contentType = value.content_type; this.content(m, value.parts); return;
    }
    if (path === "/message/content/parts" && ["add", "replace"].includes(operation)) { this.content(m, value); return; }
    const part = /^\/message\/content\/parts\/(0|[1-9]\d*)$/.exec(path);
    if (part) {
      if (!publicText(m)) { m.discarded = true; return; }
      if (typeof value !== "string" || !m.parts || Number(part[1]) >= 256) throw new Error("response_content_unsupported");
      const index = Number(part[1]);
      if (index > m.parts.length || operation === "remove") throw new Error("response_patch_unsupported");
      m.parts[index] = operation === "append" ? (m.parts[index] ?? "") + value : value;
      return;
    }
    // Hidden content may vary, but never contributes bytes to the public answer.
    if (path.startsWith("/message/content/") && !publicText(m)) return;
    if (["/message/update_time", "/message/create_time", "/message/weight"].includes(path)) return;
    throw new Error("response_patch_unsupported");
  }
}
