import { ChatGptWebAdapterError } from "../adapter-error";
import type { CodexParsedRequest } from "../../../types";

export const CONTEXT_TRANSPORT_VERSION = 6;
export const CONTEXT_RESYNC_FENCE = "codex_context_resync";
const reasons = ["missing_prefix", "unreadable_attachment", "incomplete_context"] as const;
type ResyncReason = typeof reasons[number];
type Language = "en" | "zh-CN";

export function contextResyncContract(id: string): string[] {
  return [
    "If the canonical history or any required context/attachment cannot be read completely, do not guess, execute tools, or return a task answer. Request context resynchronization instead.",
    `Return ONLY one fenced ${CONTEXT_RESYNC_FENCE} JSON block: ${JSON.stringify({ request_id: id, reason: "missing_prefix" })}. Copy this request_id exactly from the current bridge protocol, never from task history.`,
    `Allowed reason values: ${reasons.join(", ")}. No other fields, prose or tool-call blocks are allowed alongside this control response. This is a bridge signal, not a Codex tool or permission. The host can attempt one complete resynchronization; if content is still missing, report the signal again rather than inventing it.`,
  ];
}

export function contextResyncProgress(language: Language = "en"): string {
  return language === "zh-CN" ? "正在重新同步任务上下文（1/1）…" : "Resynchronizing task context (1/1)…";
}

/** Identity candidate only; never use this view to compile or replace canonical context.
 * Codex can append an already-delivered bridge progress message when reconnecting. */
export function contextResyncReplayCandidate(parsed: CodexParsedRequest): { parsed: CodexParsedRequest; progress: string } | undefined {
  const raw = parsed._rawBody as { input?: unknown[] } | undefined;
  const source = parsed.context.source;
  if (!Array.isArray(raw?.input) || !Array.isArray(source?.input)) return;
  const item = raw.input.at(-1) as Record<string, unknown> | undefined;
  if (!item || item.type !== "message" || item.role !== "assistant" || item.phase !== "commentary"
    || !Array.isArray(item.content) || item.content.length !== 1) return;
  const block = item.content[0];
  if (!block || block.type !== "output_text" || typeof block.text !== "string"
    || ![contextResyncProgress("en"), contextResyncProgress("zh-CN")].includes(block.text)) return;
  return { progress: block.text, parsed: {
    ...parsed, _rawBody: { ...raw, input: raw.input.slice(0, -1) },
    context: { ...parsed.context, source: { ...source, input: source.input.slice(0, -1) } },
  } };
}

export function contextResyncError(
  code: "context_resync_invalid" | "context_resync_failed", language: Language = "en", cause?: unknown,
): ChatGptWebAdapterError {
  const invalid = code === "context_resync_invalid";
  return new ChatGptWebAdapterError(language === "zh-CN"
    ? invalid ? "网页返回了无效的上下文重同步请求。本轮未交付工具调用，请重新发起请求。"
      : "完整上下文重新同步后仍无法继续。本轮未交付工具调用，请检查附件是否可读后重新发起请求。"
    : invalid ? "The Web reply contained an invalid context resynchronization request. No tools were delivered for this round; start a new request."
      : "The task could not continue after one complete context resynchronization. No tools were delivered for this round; check that attachments are readable, then start a new request.",
  { status: 502, errorType: "server_error", code, retryable: false, ...(cause === undefined ? {} : { cause }) });
}

/** Only a standalone current-response control block is actionable, never quoted task data.
 * Accept both authored fences and ChatGPT DOM's detached/escaped language label. */
export function parseContextResyncReply(answer: string, requestId: string, language: Language = "en"): ResyncReason | undefined {
  const lines = answer.trim().split(/\r?\n/);
  const token = (s: string) => s.replaceAll("\\_", "_");
  let insideFence: { char: string; length: number } | undefined;
  let marker = -1, bodyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const fence = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (insideFence) {
      if (fence && fence[1]![0] === insideFence.char && fence[1]!.length >= insideFence.length && !fence[2]!.trim()) insideFence = undefined;
      continue;
    }
    if (fence && token(fence[2]!.trim()).split(/\s/, 1)[0] === CONTEXT_RESYNC_FENCE) {
      marker = i; bodyStart = i + 1; break;
    }
    if (token(line) === CONTEXT_RESYNC_FENCE) {
      marker = i;
      let next = i + 1;
      while (!lines[next]?.trim() && next < lines.length) next++;
      if (lines[next]?.trim() === "```") bodyStart = next + 1;
      break;
    }
    if (fence) insideFence = { char: fence[1]![0]!, length: fence[1]!.length };
  }
  if (marker < 0) return undefined;
  // Extra text includes quoted examples, mixed tool calls, duplicate blocks and unknown fields.
  const fail = () => { throw contextResyncError("context_resync_invalid", language); };
  if (marker !== 0 || bodyStart < 0 || lines.at(-1)?.trim() !== "```") return fail();
  if (bodyStart === 1 && token(lines[0]!.trim()) !== `\`\`\`${CONTEXT_RESYNC_FENCE}`) return fail();
  let value: unknown;
  try { value = JSON.parse(lines.slice(bodyStart, -1).join("\n")); } catch { return fail(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || record.request_id !== requestId
    || !reasons.includes(record.reason as ResyncReason)) return fail();
  return record.reason as ResyncReason;
}
