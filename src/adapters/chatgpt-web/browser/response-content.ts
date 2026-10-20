type Json = Record<string, any>;

/** Convert the observed complete public representation. Offsets are Unicode code points,
 * never UTF-16 indices; no Unicode normalization or cross-representation equality test. */
export function responseContent(message: { parts?: string[]; fallback?: Json; references: unknown[]; citations: unknown[] }): string {
  const fallback = message.fallback;
  let text: string;
  if (fallback && Object.hasOwn(fallback, "fallbackMarkdown")) {
    if (fallback.fallbackMarkdownVersion !== 1 || typeof fallback.fallbackMarkdown !== "string") throw Error("response_content_version_unsupported");
    text = fallback.fallbackMarkdown;
  } else {
    if (!message.parts) throw Error("response_content_unsupported");
    text = message.parts.join("");
  }
  if (message.citations.length) throw Error("response_citations_unsupported");
  const codepoints = Array.from(text);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const value of message.references) {
    if (!value || typeof value !== "object") throw Error("response_references_unsupported");
    const ref = value as Json;
    if (ref.type !== "client_defined_widget" || ref.category !== "code_block") throw Error("response_references_unsupported");
    const start = ref.start_idx, end = ref.end_idx;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > codepoints.length
      || typeof ref.matched_text !== "string" || codepoints.slice(start, end).join("") !== ref.matched_text) {
      throw Error("response_reference_range_invalid");
    }
    ranges.push({ start, end });
    // A code reference supplies semantic code, not executable renderer JavaScript.
    // If fallback already contains that exact fenced block, do not insert it twice.
    if (ref.type === "client_defined_widget" && ref.category === "code_block"
      && ref.data?.widget_type === "code_block" && typeof ref.data.content === "string"
      && typeof ref.data.language === "string" && /^[a-zA-Z0-9_+#.-]{0,64}$/.test(ref.data.language)) {
      const existing = /^(`{3,})([^\n]*)\n([\s\S]*)\n\1$/.exec(ref.matched_text);
      if (existing && existing[2] === ref.data.language && existing[3] === ref.data.content) continue;
      const ticks = Math.max(3, ...[...ref.data.content.matchAll(/`+/g)].map(match => match[0].length + 1));
      const fence = "`".repeat(ticks);
      replacements.push({ start, end, text: `${fence}${ref.data.language}\n${ref.data.content}\n${fence}` });
    } else {
      // Unknown charts/media are not replaced with a label or an invented local file.
      throw Error("response_references_unsupported");
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.start < ranges[i - 1]!.end) throw Error("response_reference_range_invalid");
  }
  replacements.sort((a, b) => a.start - b.start);
  for (const replacement of replacements.reverse()) codepoints.splice(replacement.start, replacement.end - replacement.start, replacement.text);
  text = codepoints.join("");
  if (!text.trim()) throw Error("response_empty");
  return text;
}
