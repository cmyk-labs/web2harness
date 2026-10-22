import { ServerSentEventDecoder } from "./sse-decoder";
import { ChatGptResponseEvidence, type ChatGptResponseEvidenceLimits } from "./response-evidence";
import { ChatGptDeltaCursor, patchResponseValue, isValuelessResponseRemoval } from "./response-protocol";
import { responseContent } from "./response-content";
import { responseCandidateDiagnostics } from "./response-candidate-diagnostics";

type Json = Record<string, any>;
type Message = { id: string; role: string; channel: unknown; recipient: unknown; status: unknown;
  endTurn: unknown; contentType: unknown; parts?: string[]; discarded: boolean; parent?: string;
  hidden: boolean; references: unknown[]; citations: unknown[]; fallback?: Json; complete?: boolean; finishType?: string };
export interface ChatGptResponseBinding { userMessageId: string; conversationId?: string }
export type ChatGptResponseSourceResult =
  | { state: "collecting" }
  | { state: "awaiting_final"; conversationId: string; userMessageId: string }
  | { state: "rejected"; reason: string; kind?: "invalid" | "unsupported" | "unavailable" }
  | { state: "complete"; text: string; messageId: string; conversationId: string };

// Unsupported presentation/observation can use the independent DOM validator. Positive evidence
// of a different request, unfinished final or server failure must never be hidden by that fallback.
export function responseSourceBlocksFallback(result: ChatGptResponseSourceResult): boolean {
  return result.state === "rejected" && result.kind !== "unsupported" && result.kind !== "unavailable";
}

const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const publicText = (m: Message) => m.role === "assistant" && ["final", "commentary"].includes(m.channel as string)
  && m.recipient === "all" && !m.hidden && m.contentType === "text";
const ancillaryTypes = new Set(["resume_conversation_token", "message_marker", "server_ste_metadata",
  "conversation_detail_metadata", "title_generation", "conversation_title", "moderation", "url_moderation"]);

/** Reconstruct only explicitly public response content. Facts never contain text or source IDs.
 * The v1 delta encoding inherits p/o between top-level frames; patch children use their own context.
 */
export class ChatGptResponseSource {
  private newDecoder() { return new ServerSentEventDecoder((data, event) => {
    this.completedContent = undefined;
    this.evidence?.capture(data, event);
    // Framing/termination observation survives an unsupported semantic event. These facts do
    // not repair the projection or authorize delivery; they prevent a parser failure from
    // being mislabeled as a network interruption. Later identity/server errors still win.
    try {
      if (this.observedDone) { this.reject("response_after_termination", true); return; }
      if (event === "error") { this.reject("response_upstream_error", true); return; }
      const value: unknown = data === "[DONE]" ? undefined : JSON.parse(data);
      try { this.observeBoundary(data, event, value); }
      catch (error) { this.reject(this.errorReason(error), true); return; }
      if (!this.failure) this.event(data, event, value);
    } catch (error) { this.reject(this.errorReason(error)); }
  }); }
  private decoder = this.newDecoder();
  private readonly evidence?: ChatGptResponseEvidence;
  private decoderFailed = false;
  private readonly messages = new Map<string, Message>();
  private readonly cursor = new ChatGptDeltaCursor<Message>();
  private get current() { return this.cursor.current; }
  private set current(value: Message | undefined) { this.cursor.current = value; }
  private conversation?: string;
  private inputSeen = false;
  private streamComplete = false;
  private done = false;
  private observedDone = false;
  private observedStreamComplete = false;
  private observedPath = "";
  private observedOperation = "add";
  private failure?: string;
  private definitiveFailure = false;
  private resumeNeedsProof = false;
  private frames = 0;
  private transportFrames = 0;
  private completedContent?: ChatGptResponseSourceResult;
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
      if (discardedData && this.observedDone) this.reject("response_after_termination");
    } catch { this.evidence?.finish(true); this.reject("response_stream_malformed"); }
  }
  private errorReason(error: unknown): string {
    return error instanceof Error && /^(response_[a-z_]+)$/.test(error.message) ? error.message : "response_stream_malformed";
  }
  takeEvidence() { return this.evidence?.take(this.binding); }
  clearEvidence(): void { this.evidence?.clear(); }
  /** Each resumed HTTP stream starts its own framing and patch context; logical messages stay. */
  beginTransport(): void {
    if (this.done) throw Error("response_after_termination");
    this.decoder = this.newDecoder(); this.decoderFailed = false; this.cursor.reset();
    this.transportFrames = 0;
    this.streamComplete = false; this.observedStreamComplete = false;
    this.resumeNeedsProof = true;
    this.observedPath = ""; this.observedOperation = "add";
    this.evidence?.beginTransport();
  }
  hasMessage(id: string): boolean { return this.messages.has(id); }
  reject(reason: string, definitive = false): void {
    this.completedContent = undefined;
    if (!this.failure || (definitive && !this.definitiveFailure)) {
      this.failure = reason;
      this.definitiveFailure = definitive;
    }
  }
  facts() { const result = this.result(); return { frames: this.frames, messageCount: this.messages.size, inputBound: this.inputSeen,
    done: this.done, streamComplete: this.streamComplete, observedDone: this.observedDone, observedStreamComplete: this.observedStreamComplete,
    reason: result.state === "rejected" ? result.reason : this.failure, evidence: this.evidence?.summary(),
    candidateAudit: responseCandidateDiagnostics([...this.messages.values()], this.binding.userMessageId),
    publicStates: [...this.messages.values()].filter(publicText).map(m => ({ channel: m.channel,
      finished: m.status === "finished_successfully", endTurn: m.endTurn === true,
      complete: m.complete === true, stopped: m.finishType === "stop",
      // Optional metadata absence differs from explicit negative completion evidence.
      completion: m.complete === undefined ? "missing" : m.complete ? "complete" : "incomplete",
      finish: m.finishType === undefined ? "missing" : m.finishType === "stop" ? "stop" : "other" })) }; }

  private completedMessage(savedAncestors?: ReadonlySet<string>): Message | Exclude<ChatGptResponseSourceResult, { state: "complete" }> {
    if (this.failure) return { state: "rejected", reason: this.failure };
    if (!this.done || !this.streamComplete) return { state: "collecting" };
    if (!this.inputSeen || !this.conversation) return { state: "rejected", reason: "response_identity_incomplete" };
    if ([...this.messages.values()].some(m => publicText(m) && (m.complete === false
      || (m.finishType !== undefined && m.finishType !== "stop")
      || (m.status !== undefined && m.status !== "in_progress" && m.status !== "finished_successfully")))) {
      return { state: "rejected", reason: "response_message_incomplete" };
    }
    const finals = [...this.messages.values()].filter(m => m.role === "assistant" && m.channel === "final"
      && m.recipient === "all" && !m.hidden && m.endTurn === true);
    if (finals.length === 0) {
      // An ended transport without a public final is not evidence of conflicting answers.
      // Keep the exact turn identity for bounded, read-only reconciliation.
      return { state: "awaiting_final", conversationId: this.conversation, userMessageId: this.binding.userMessageId };
    }
    if (finals.length > 1) return { state: "rejected", reason: "response_final_message_ambiguous" };
    const message = finals[0]!;
    if (message.status !== "finished_successfully" || message.complete === false
      || (message.finishType !== undefined && message.finishType !== "stop")) {
      return { state: "rejected", reason: "response_message_incomplete" };
    }
    const seen = new Set(savedAncestors);
    if (savedAncestors) {
      if (!seen.has(message.id) || !seen.has(this.binding.userMessageId)) return { state: "rejected", reason: "response_parent_unbound" };
    } else {
      let ancestor: Message | undefined = message;
      while (ancestor && ancestor.id !== this.binding.userMessageId && !seen.has(ancestor.id)) {
        seen.add(ancestor.id); ancestor = ancestor.parent ? this.messages.get(ancestor.parent) : undefined;
      }
      if (ancestor?.id !== this.binding.userMessageId) return { state: "rejected", reason: "response_parent_unbound" };
    }
    // In the owned 2026-10-18 captures, public commentary remains in_progress without terminal
    // metadata, then a descendant reasoning/final phase completes normally. Only this exact
    // ancestor shape can be superseded by the proved final. A sibling/later message, explicit
    // incomplete/aborted state, or a commentary claiming end_turn is not such evidence.
    for (const prior of this.messages.values()) {
      if (!publicText(prior)) continue;
      if (prior.complete === false || (prior.finishType !== undefined && prior.finishType !== "stop")) {
        return { state: "rejected", reason: "response_message_incomplete" };
      }
      if (prior.status === "finished_successfully") continue;
      const superseded = prior.channel === "commentary" && prior.status === "in_progress"
        && seen.has(prior.id) && prior.id !== message.id && prior.endTurn !== true
        && prior.complete === undefined && prior.finishType === undefined;
      if (!superseded) return { state: "rejected", reason: "response_message_incomplete" };
    }
    return message;
  }

  lifecycle(): { state: "unknown" | "generating" | "awaiting_final" | "complete" | "interrupted" | "failed"; messageId?: string; conversationId?: string } {
    if (this.completedContent?.state === "complete") return { state: "complete",
      messageId: this.completedContent.messageId, conversationId: this.completedContent.conversationId };
    if (this.completedContent && responseSourceBlocksFallback(this.completedContent)) return { state: "failed" };
    const message = this.completedMessage();
    if ("state" in message) {
      if (message.state === "rejected") return { state: message.reason === "response_message_incomplete" ? "interrupted" : "failed" };
      if (message.state === "awaiting_final") return { state: "awaiting_final", conversationId: message.conversationId };
      return { state: this.inputSeen ? "generating" : "unknown" };
    }
    return { state: "complete", messageId: message.id, conversationId: this.conversation };
  }

  result(): ChatGptResponseSourceResult {
    if (this.completedContent) return this.completedContent;
    return this.projectResult();
  }
  private projectResult(savedAncestors?: ReadonlySet<string>): ChatGptResponseSourceResult {
    const message = this.completedMessage(savedAncestors);
    if ("state" in message) return message;
    try {
      if (message.discarded && !message.fallback) throw Error("response_content_unsupported");
      return this.completedContent = { state: "complete", text: responseContent(message), messageId: message.id, conversationId: this.conversation! };
    } catch (error) {
      return this.completedContent = { state: "rejected", reason: this.errorReason(error), kind: "unsupported" };
    }
  }

  /** Project only the active saved-chat branch bound to this submission.
   * A readback never repairs positive stream errors or imports another user turn.
   * Private ancestor bodies are discarded by readMessage, just as in stream projection.
   */
  reconcileSavedConversation(value: unknown): ChatGptResponseSourceResult {
    const original = this.result();
    if (original.state !== "awaiting_final") return original;
    if (!object(value) || (value.conversation_id ?? value.id) !== original.conversationId
      || typeof value.current_node !== "string") return original;
    const branch: Json[] = [];
    let savedAncestors: Set<string> | undefined;
    if (object(value.mapping)) {
      const seen = new Set<string>();
      let id: unknown = value.current_node;
      while (typeof id === "string" && !seen.has(id) && branch.length < 256) {
        seen.add(id);
        const node = value.mapping[id];
        if (!object(node) || !object(node.message) || node.message.id !== id) return original;
        const m = node.message;
        if (m.author?.role === "user" && m.id !== this.binding.userMessageId) return original;
        branch.push({ ...m, metadata: { ...m.metadata, parent_id: node.parent } });
        if (id === this.binding.userMessageId) break;
        id = node.parent;
      }
      if (branch.at(-1)?.id !== this.binding.userMessageId) return original;
      branch.reverse();
    } else if (Array.isArray(value.messages)) {
      // The current endpoint returns an ordered active-branch window. Saving can omit and
      // reparent private nodes, so stream parent IDs are not a cross-representation contract.
      // Bind the exact submitted user and current leaf by the page's two turn identifiers.
      const start = value.messages.findIndex(m => m?.id === this.binding.userMessageId && m.author?.role === "user");
      if (start < 0 || value.messages.at(-1)?.id !== value.current_node) return original;
      const user = value.messages[start], exchange = user.metadata?.turn_exchange_id, working = user.metadata?.working_turn_id;
      if (typeof exchange !== "string" || !exchange || typeof working !== "string" || !working) return original;
      savedAncestors = new Set();
      for (const m of value.messages.slice(start)) {
        if (!object(m) || typeof m.id !== "string" || (m !== user && m.author?.role === "user")
          || m.metadata?.turn_exchange_id !== exchange || m.metadata?.working_turn_id !== working) return original;
        if (savedAncestors.has(m.id)) return { state: "rejected", reason: "response_identity_mismatch" };
        savedAncestors.add(m.id); branch.push(m);
        if (branch.length > 256) return original;
      }
    } else return original;
    const candidate = new ChatGptResponseSource({ ...this.binding, conversationId: original.conversationId });
    candidate.conversation = original.conversationId;
    try {
      for (const m of branch) {
        const known = this.messages.get(m.id);
        if (known && known.role !== m.author?.role) return { state: "rejected", reason: "response_identity_mismatch" };
        candidate.readMessage(m, false);
      }
      candidate.done = candidate.streamComplete = true;
      const result = candidate.projectResult(savedAncestors);
      // A public final followed by another active phase is not the branch's final answer.
      if (result.state === "complete" && result.messageId !== value.current_node) return original;
      if (result.state === "complete" || responseSourceBlocksFallback(result)) this.completedContent = result;
      return result;
    } catch (error) {
      return { state: "rejected", reason: this.errorReason(error) };
    }
  }

  private bindConversation(id: unknown): void {
    if (id === undefined || id === null) return;
    if (typeof id !== "string" || !id || id.length > 256 || (this.conversation && this.conversation !== id)
      || (this.binding.conversationId && this.binding.conversationId !== id)) throw new Error("response_identity_mismatch");
    this.conversation = id;
  }
  private observeBoundary(data: string, event: string, value: unknown): void {
    if (this.observedDone) throw new Error("response_after_termination");
    if (event === "error") throw new Error("response_upstream_error");
    if (data === "[DONE]") { this.observedDone = true; return; }
    if (!object(value)) return;
    this.bindConversation(value.conversation_id);
    if (value.error || value.error_code || value.type === "error") throw new Error("response_upstream_error");
    if (value.type === "input_message"
      && (value.input_message?.id !== this.binding.userMessageId || value.input_message?.author?.role !== "user")) {
      throw new Error("response_identity_mismatch");
    }
    if (Object.hasOwn(value, "v") || isValuelessResponseRemoval(value)) {
      if (typeof value.p === "string") this.observedPath = value.p;
      if (typeof value.o === "string") this.observedOperation = value.o;
      this.observePatchBoundary(this.observedPath, this.observedOperation, value.v, 0);
    }
    if (ancillaryTypes.has(value.type)) return;
    if (value.type === "message_stream_complete") this.observedStreamComplete = true;
  }
  private observePatchBoundary(path: string, operation: string, value: unknown, depth: number): void {
    if (depth > 16) return;
    if (operation === "patch") {
      if (!Array.isArray(value) || value.length > 4096) return;
      for (const patch of value) {
        if (object(patch) && typeof patch.p === "string" && typeof patch.o === "string") {
          this.observePatchBoundary(`${path}${patch.p}`, patch.o, patch.v, depth + 1);
        }
      }
    } else if (["add", "replace", "append"].includes(operation)) {
      if (path === "/conversation_id") this.bindConversation(value);
      if (path === "" && object(value)) {
        this.bindConversation(value.conversation_id);
        if (value.error || value.error_code || value.type === "error") throw new Error("response_upstream_error");
      }
    }
  }
  private event(data: string, event: string, value: unknown): void {
    if (this.done) throw new Error("response_after_termination");
    if (event === "error") throw new Error("response_upstream_error");
    if (data === "[DONE]") { this.done = true; return; }
    this.frames++;
    this.transportFrames++;
    if (value === "v1" && this.transportFrames === 1) return;
    if (!object(value)) throw new Error("response_encoding_unsupported");
    this.cursor.select(value);
    this.bindConversation(value.conversation_id);
    if (value.error || value.error_code || value.type === "error") throw new Error("response_upstream_error");
    if (ancillaryTypes.has(value.type)) return;
    // A message marker is not the SSE response boundary. Continue projecting until DONE;
    // result() requires both markers and the final state before any text can be delivered.
    if (value.type === "message_stream_complete") { this.streamComplete = true; return; }
    if (value.type === "input_message") {
      this.readMessage(value.input_message, false);
      if (value.input_message?.id !== this.binding.userMessageId || value.input_message?.author?.role !== "user") {
        throw new Error("response_identity_mismatch");
      }
      this.inputSeen = true; return;
    }
    if (value.message) { this.readMessage(value.message); return; }
    if (Object.hasOwn(value, "v") || isValuelessResponseRemoval(value)) {
      this.apply(this.cursor.path, this.cursor.operation, value.v, 0); return;
    }
    throw new Error("response_event_unsupported");
  }
  private readMessage(value: unknown, selectCurrent = true): void {
    if (!object(value) || typeof value.id !== "string" || !value.id || value.id.length > 256 || !object(value.author) || !object(value.content)) {
      throw new Error("response_message_unsupported");
    }
    if (selectCurrent && this.resumeNeedsProof) {
      if (!this.messages.has(value.id)) throw Error("response_resume_unbound");
      this.resumeNeedsProof = false;
    }
    if (this.messages.size >= 256 && !this.messages.has(value.id)) throw new Error("response_message_size_limit");
    const metadata = object(value.metadata) ? value.metadata : {};
    const m: Message = { id: value.id, role: value.author.role, channel: value.channel, recipient: value.recipient,
      status: value.status, endTurn: value.end_turn, contentType: value.content.content_type, discarded: false,
      hidden: metadata.is_visually_hidden_from_conversation === true, references: [], citations: [] };
    this.metadata(m, metadata, false);
    this.content(m, value.content.parts);
    // Non-public messages can be ancestors of the eventual final. content() discards their
    // bodies; retaining the structural node does not make it public or establish completion.
    const previous = this.messages.get(m.id);
    if (previous && (previous.role !== m.role || (previous.parent && m.parent && previous.parent !== m.parent))) throw new Error("response_identity_mismatch");
    // The initial user snapshot omits parent_id; the input_message acknowledgement hydrates it.
    // An omitted field is not contradictory identity evidence. Two different known parents are.
    m.parent ??= previous?.parent;
    const updated = previous ? Object.assign(previous, m) : m;
    this.messages.set(m.id, updated);
    // Some completed Web streams carry the request's exact user snapshot as a root
    // delta without a separate input_message acknowledgement. Both identify the
    // same bound request; neither an unrelated user nor assistant snapshot does.
    if (m.id === this.binding.userMessageId && m.role === "user") this.inputSeen = true;
    if (selectCurrent) this.current = updated;
  }
  private content(m: Message, value: unknown): void {
    if (publicText(m)) {
      if (!Array.isArray(value) || !value.every(p => typeof p === "string")) { m.parts = undefined; m.discarded = true; return; }
      m.parts = [...value];
      m.discarded = false;
    } else { m.parts = undefined; m.discarded = true; }
  }
  private metadata(m: Message, value: Json, append: boolean): void {
    if (!append) { m.parent = undefined; m.references = []; m.citations = []; m.fallback = undefined; m.complete = undefined; m.finishType = undefined; }
    if (Object.hasOwn(value, "parent_id")) m.parent = typeof value.parent_id === "string" ? value.parent_id : undefined;
    if (Object.hasOwn(value, "is_visually_hidden_from_conversation")) m.hidden = value.is_visually_hidden_from_conversation === true;
    if (Object.hasOwn(value, "is_complete")) m.complete = value.is_complete === true;
    if (Object.hasOwn(value, "finish_details")) {
      m.finishType = typeof value.finish_details?.type === "string" ? value.finish_details.type : "invalid";
    }
    if (Object.hasOwn(value, "content_references")) {
      if (!Array.isArray(value.content_references)) throw new Error("response_references_unsupported");
      m.references = publicText(m) ? structuredClone(value.content_references) : [];
    }
    if (Object.hasOwn(value, "citations")) {
      if (!Array.isArray(value.citations)) throw new Error("response_references_unsupported");
      m.citations = publicText(m) ? structuredClone(value.citations) : [];
    }
    if (Object.hasOwn(value, "model_dil_v2") && publicText(m)) {
      const dil = value.model_dil_v2;
      m.fallback = object(dil) ? {
        ...(Object.hasOwn(dil, "fallbackMarkdown") ? { fallbackMarkdown: dil.fallbackMarkdown } : {}),
        ...(Object.hasOwn(dil, "fallbackMarkdownVersion") ? { fallbackMarkdownVersion: dil.fallbackMarkdownVersion } : {}),
      } : undefined;
    }
    if (!publicText(m)) { m.parts = undefined; m.fallback = undefined; m.references = []; m.citations = []; }
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
      if (["content_references", "citations", "model_dil_v2"].includes(key)) {
        if (!publicText(m)) return;
        const property = key === "content_references" ? "references" : key === "citations" ? "citations" : "fallback";
        const updated = patchResponseValue(m[property] ?? (property === "fallback" ? {} : []), [], operation, value);
        this.metadata(m, { [key]: updated ?? (property === "fallback" ? {} : []) }, true);
        return;
      }
      if (/^(content_references|citations|model_dil_v2)\//.test(key)) {
        if (!publicText(m)) return;
        const [field, ...tail] = key.split("/");
        if (field === "model_dil_v2" && !["fallbackMarkdown", "fallbackMarkdownVersion"].includes(tail[0]!)) return;
        const property = field === "content_references" ? "references" : field === "citations" ? "citations" : "fallback";
        (m as any)[property] = patchResponseValue(m[property], tail, operation, value);
        return;
      }
      if (key.includes("/")) {
        if (/^(finish_details|parent_id|is_complete|is_visually_hidden_from_conversation)\//.test(key)) throw new Error("response_patch_unsupported");
      } else if (operation === "remove" && key === "is_complete") m.complete = undefined;
      else if (operation === "remove" && key === "finish_details") m.finishType = undefined;
      else this.metadata(m, { [key]: operation === "remove" ? undefined : value }, true);
      return;
    }
    const scalar = { "/message/channel": "channel", "/message/status": "status", "/message/end_turn": "endTurn",
      "/message/recipient": "recipient", "/message/content/content_type": "contentType" } as const;
    if (Object.hasOwn(scalar, path) && ["add", "replace"].includes(operation)) {
      (m as any)[scalar[path as keyof typeof scalar]] = value;
      if (!publicText(m)) { m.parts = undefined; m.fallback = undefined; m.references = []; m.citations = []; m.discarded = true; }
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
