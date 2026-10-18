import type { ChatGptResponseBinding } from "./response-source";

export interface ChatGptResponseEvidenceLimits { maxBytes?: number; maxEvents?: number }
type ResponseEvidenceEvent = "message" | "delta_encoding" | "delta";
/** Exact event names observed in the 2026-10-18 owned DEV SSE capture. Unknown names may
 * contain private values and are never retained verbatim or admitted to diagnostic replay. */
export function isResponseEvidenceEvent(event: unknown): event is ResponseEvidenceEvent {
  return event === "message" || event === "delta_encoding" || event === "delta";
}
export interface ChatGptResponseEvidenceRecord {
  sequence: number;
  dataBytes: number;
  kind: "original" | "projected" | "withheld";
  event: ResponseEvidenceEvent | "error" | "other";
  /** Original dispatched SSE data, or explicitly privacy-projected JSON. Never a wire-byte claim. */
  data?: string;
  shape: "encoding" | "done" | "message" | "patch" | "control" | "unknown" | "malformed";
}
export interface ChatGptResponseEvidenceArtifact {
  version: 1;
  format: "chatgpt-public-response-events";
  binding: ChatGptResponseBinding;
  records: ChatGptResponseEvidenceRecord[];
  summary: ReturnType<ChatGptResponseEvidence["summary"]>;
}

type Json = Record<string, any>;
type Visibility = { id: string; role?: unknown; channel?: unknown; recipient?: unknown; contentType?: unknown; hidden?: boolean };
const object = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const publicText = (m?: Visibility) => m?.role === "assistant" && (m.channel === "final" || m.channel === "commentary")
  && m.recipient === "all" && m.contentType === "text" && !m.hidden;
const controlTypes = new Set(["message_stream_complete", "resume_conversation_token", "message_marker", "server_ste_metadata",
  "conversation_detail_metadata", "title_generation", "conversation_title", "moderation"]);
const operations = new Set(["add", "replace", "append", "remove", "patch"]);
const finite = (value: number | undefined, fallback: number, ceiling: number) =>
  value === undefined ? fallback : Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback;
const id = (v: unknown): string => { if (typeof v !== "string" || !v || v.length > 256) throw Error(); return v; };
const enumValue = (v: unknown, allowed: readonly unknown[]): unknown => { if (!allowed.includes(v)) throw Error(); return v; };

/** Opt-in private diagnostics, never telemetry or answer authority. Unknown values are withheld,
 * not guessed. Known ignored metadata and non-public bodies are removed explicitly. Only the
 * original data of provably public/control-only events is retained verbatim; no request/header
 * capture. A later visibility change revokes earlier content-bearing records for that message.
 */
export class ChatGptResponseEvidence {
  #records: Array<ChatGptResponseEvidenceRecord & { owners: string[] }> = [];
  #current?: Visibility;
  #path = "";
  #operation = "add";
  #bytes = 0;
  #seen = 0;
  #dropped = 0;
  #withheld = 0;
  #projected = 0;
  #framing = false;
  #ended = false;
  #taken = false;
  #full = false;
  #revokedInEvent = new Set<string>();
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  constructor(limits: ChatGptResponseEvidenceLimits = {}) {
    this.#maxBytes = finite(limits.maxBytes, 2 * 1024 * 1024, 4 * 1024 * 1024);
    this.#maxEvents = finite(limits.maxEvents, 2048, 4096);
  }
  capture(data: string, event: string): void {
    if (this.#taken) return;
    const sequence = ++this.#seen;
    this.#revokedInEvent.clear();
    const owners = new Set<string>();
    let shape: ChatGptResponseEvidenceRecord["shape"] = "unknown";
    let safe: string | undefined;
    let kind: ChatGptResponseEvidenceRecord["kind"] = "withheld";
    try {
      if (!isResponseEvidenceEvent(event)) throw Error(); // Error/unknown payloads can contain private text.
      if (data === "[DONE]") {
        if (event !== "message") throw Error();
        shape = "done"; safe = data;
      }
      else {
        let v: unknown;
        try { v = JSON.parse(data); } catch { shape = "malformed"; throw Error(); }
        if (v === "v1" && event !== "delta") { shape = "encoding"; safe = data; }
        else if (object(v) && event !== "delta_encoding") {
          if (event === "delta" && !Object.hasOwn(v, "v")) throw Error();
          shape = v.message || v.type === "input_message" ? "message" : Object.hasOwn(v, "v") ? "patch" : "control";
          const projected = this.frame(v, owners);
          safe = JSON.stringify(v) === JSON.stringify(projected) ? data : JSON.stringify(projected);
        } else throw Error();
      }
      kind = safe === data ? "original" : "projected";
    } catch {
      // An unknown mutation may change visibility. Forget that context and revoke its captured
      // text until a complete new message snapshot establishes public identity again.
      if (this.#current) this.revoke(this.#current.id);
      this.#current = undefined;
    }
    if ([...owners].some(owner => this.#revokedInEvent.has(owner))) { safe = undefined; kind = "withheld"; }
    if (this.#full) { this.#dropped++; return; }
    const record = { sequence, dataBytes: Buffer.byteLength(data), kind,
      event: isResponseEvidenceEvent(event) || event === "error" ? event : "other", shape,
      ...(safe === undefined ? {} : { data: safe }) } as ChatGptResponseEvidenceRecord;
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (this.#records.length >= this.#maxEvents || this.#bytes + bytes > this.#maxBytes) {
      this.#full = true; this.#dropped++; return;
    }
    this.#bytes += bytes;
    if (kind === "withheld") this.#withheld++;
    if (kind === "projected") this.#projected++;
    this.#records.push({ ...record, owners: [...owners] });
  }
  finish(discardedData = false): void { this.#ended = true; this.#framing ||= discardedData; }
  framingFailure(): void { this.#framing = true; }
  summary() { return { events: this.#seen, retained: this.#records.length, retainedBytes: this.#bytes,
    projected: this.#projected, withheld: this.#withheld, dropped: this.#dropped,
    framingIncomplete: this.#framing, ended: this.#ended,
    replayable: this.#ended && !this.#framing && !this.#withheld && !this.#dropped }; }
  take(binding: ChatGptResponseBinding): ChatGptResponseEvidenceArtifact | undefined {
    if (this.#taken) return;
    const result: ChatGptResponseEvidenceArtifact = { version: 1, format: "chatgpt-public-response-events",
      binding: { ...binding }, summary: this.summary(), records: this.#records.map(({ owners: _, ...record }) => record) };
    this.clear(); return result;
  }
  clear(): void { this.#records = []; this.#current = undefined; this.#taken = true; }
  private revoke(messageId: string): void {
    this.#revokedInEvent.add(messageId);
    for (const record of this.#records) if (record.data !== undefined && record.owners.includes(messageId)) {
      if (record.kind === "projected") this.#projected--;
      record.data = undefined; record.kind = "withheld"; this.#withheld++;
    }
    // Do not refund the allocation budget: revoked events cannot cause unbounded retention churn.
  }
  private metadata(v: unknown): Json {
    if (!object(v)) throw Error();
    const out: Json = {};
    for (const [key, value] of Object.entries(v)) {
      if (key === "parent_id") out[key] = id(value);
      else if (key === "is_complete" || key === "is_visually_hidden_from_conversation") out[key] = enumValue(value, [true, false]);
      else if (key === "finish_details") {
        if (!object(value)) throw Error();
        out[key] = { type: enumValue(value.type, ["stop", "length", "max_tokens", "interrupted"]) };
        if (Object.hasOwn(value, "stop_tokens")) {
          if (!Array.isArray(value.stop_tokens) || value.stop_tokens.length > 32 || !value.stop_tokens.every(Number.isSafeInteger)) throw Error();
          out[key].stop_tokens = value.stop_tokens;
        }
      } else if (key === "citations" || key === "content_references") {
        if (!Array.isArray(value)) throw Error();
        out[key] = value.length ? [{}] : [];
      }
    }
    return out;
  }
  private message(v: unknown, owners: Set<string>, select = true): Json {
    if (!object(v) || !object(v.author) || !object(v.content)) throw Error();
    const m: Visibility = { id: id(v.id), role: v.author.role, channel: v.channel, recipient: v.recipient,
      contentType: v.content.content_type, hidden: v.metadata?.is_visually_hidden_from_conversation === true };
    if (!publicText(m)) this.revoke(m.id);
    if (select) this.#current = m;
    const out: Json = {};
    // Preserve field order and distinguish absent fields from explicitly false/null fields.
    for (const [key, value] of Object.entries(v)) {
      if (key === "id") out[key] = m.id;
      else if (key === "author") out[key] = { role: enumValue(v.author.role, ["user", "assistant", "system", "tool", "developer"]) };
      else if (key === "channel") out[key] = enumValue(value, [null, "final", "commentary", "analysis"]);
      else if (key === "recipient") { if (value === "all") out[key] = value; } // Tool names need not be retained.
      else if (key === "status") out[key] = enumValue(value, ["in_progress", "finished_successfully", "finished_partial"]);
      else if (key === "end_turn") out[key] = enumValue(value, [null, true, false]);
      else if (key === "metadata") out[key] = this.metadata(value);
      else if (key === "content") {
        out[key] = { content_type: enumValue(v.content.content_type,
          ["text", "code", "thoughts", "reasoning_recap", "model_editable_context", "execution_output", "multimodal_text", "tether_browsing_display"]) };
        if (publicText(m)) {
          if (!Array.isArray(v.content.parts) || !v.content.parts.every((p: unknown) => typeof p === "string")) throw Error();
          out[key].parts = v.content.parts; owners.add(m.id);
        }
      }
    }
    return out;
  }
  private frame(v: Json, owners: Set<string>): Json {
    if (v.error || v.error_code || v.type === "error") throw Error();
    const out: Json = {};
    if (v.type === "input_message") {
      for (const key of Object.keys(v)) {
        if (key === "type") out.type = v.type;
        if (key === "conversation_id") out[key] = id(v[key]);
        if (key === "input_message") out[key] = this.message(v[key], owners, false);
      }
      return out;
    }
    if (controlTypes.has(v.type)) {
      for (const key of Object.keys(v)) {
        if (key === "type") out.type = v.type;
        if (key === "conversation_id" || key === "message_id") out[key] = id(v[key]);
      }
      return out;
    }
    if (v.message) return this.envelope(v, owners);
    if (!Object.hasOwn(v, "v")) throw Error();
    if (v.p !== undefined) { if (typeof v.p !== "string") throw Error(); this.#path = v.p; }
    if (v.o !== undefined) { if (!operations.has(v.o)) throw Error(); this.#operation = v.o; }
    const value = this.patch(this.#path, this.#operation, v.v, owners, 0);
    for (const key of Object.keys(v)) {
      if (key === "p" || key === "o") out[key] = v[key];
      if (key === "v") out.v = value;
      if (key === "conversation_id") out[key] = id(v[key]);
    }
    return out;
  }
  private envelope(v: Json, owners: Set<string>): Json {
    const out: Json = {};
    for (const key of Object.keys(v)) {
      if (key === "message") out[key] = this.message(v[key], owners);
      if (key === "conversation_id") out[key] = id(v[key]);
      if (key === "error" && v[key] === null) out[key] = null;
    }
    return out;
  }
  private patch(path: string, operation: string, value: unknown, owners: Set<string>, depth: number): unknown {
    if (depth > 16 || !operations.has(operation)) throw Error();
    if (operation === "patch") {
      if (!Array.isArray(value) || value.length > 4096) throw Error();
      return value.map(p => {
        if (!object(p) || typeof p.p !== "string" || !operations.has(p.o)) throw Error();
        const out = this.patch(path + p.p, p.o, p.v, owners, depth + 1);
        return { p: p.p, o: p.o, ...(Object.hasOwn(p, "v") ? { v: out } : {}) };
      });
    }
    if (path === "" && object(value)) return this.envelope(value, owners);
    if (path === "/message") return this.message(value, owners);
    if (path === "/conversation_id") return id(value);
    const m = this.#current;
    if (!m) throw Error();
    if (["/message/update_time", "/message/create_time", "/message/weight"].includes(path)) {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) throw Error();
      return value;
    }
    if (path === "/message/status") return enumValue(value, ["in_progress", "finished_successfully", "finished_partial"]);
    if (path === "/message/end_turn") return enumValue(value, [true, false, null]);
    if (path === "/message/metadata") {
      const out = this.metadata(value);
      if (out.is_visually_hidden_from_conversation === true) { m.hidden = true; this.revoke(m.id); }
      return out;
    }
    if (path.startsWith("/message/metadata/")) {
      const key = path.slice("/message/metadata/".length);
      if (["conversation_followup_suggestions_eligible", "can_save"].includes(key)) return enumValue(value, [true, false]);
      if (["reasoning_title", "reasoning_titles", "aggregate_result/status", "aggregate_result/update_time",
        "aggregate_result/end_time", "aggregate_result/jupyter_messages"].includes(key)) return operation === "remove" ? undefined : null;
      if (!["parent_id", "is_complete", "finish_details", "is_visually_hidden_from_conversation", "citations", "content_references"].includes(key)) throw Error();
      if (operation === "remove") return undefined;
      const out = this.metadata({ [key]: value });
      if (key === "is_visually_hidden_from_conversation") { m.hidden = value === true; if (m.hidden) this.revoke(m.id); }
      return out[key];
    }
    if (path === "/message/channel" || path === "/message/recipient" || path === "/message/content/content_type") {
      if (path === "/message/channel") m.channel = enumValue(value, ["final", "commentary", "analysis", null]);
      if (path === "/message/recipient") m.recipient = enumValue(value, ["all"]);
      if (path === "/message/content/content_type") m.contentType = enumValue(value, ["text"]);
      if (!publicText(m)) this.revoke(m.id);
      return value;
    }
    if (path === "/message/content/parts" || /^\/message\/content\/parts\/(0|[1-9]\d*)$/.test(path)) {
      if (!publicText(m)) return path === "/message/content/parts" ? [] : "";
      if (path.endsWith("/parts") ? !Array.isArray(value) || !value.every(p => typeof p === "string") : typeof value !== "string") throw Error();
      owners.add(m.id); return value;
    }
    // Observed hidden code/thought updates are needed to replay cursor/terminal ordering, but
    // their payload is never evidence for a public answer and must not be retained.
    if (!publicText(m) && path === "/message/content/thoughts" && Array.isArray(value)) return [];
    if (!publicText(m) && path === "/message/content/text" && typeof value === "string") return "";
    // Unknown paths may encode secrets in the path itself, and cannot be called original evidence.
    throw Error();
  }
}
