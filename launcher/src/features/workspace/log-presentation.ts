import type { LogRecord } from "../../types";

export interface JsonLogPart { text: string; kind: string; match: boolean }

/** Match compact JSON like the backend; formatting inserts only whitespace outside strings. */
export function jsonLogParts(record: LogRecord, formatted: boolean, search: string): JsonLogPart[] {
  const compact = JSON.stringify(record);
  const display = formatted ? JSON.stringify(record, null, 2) : compact;
  const needle = search.slice(0, 200).toLowerCase();
  const plain = compact.length > 32768;
  if (plain && !needle) return [{ text: display, kind: "plain", match: false }];
  const matches: { start: number; end: number }[] = [];
  if (needle) {
    const lower = compact.toLowerCase();
    // Some Unicode characters expand when lowercased (for example İ -> i + dot).
    // Map those search offsets back to the original JSON rather than shifting marks.
    const starts: number[] = [], ends: number[] = [];
    if (lower.length !== compact.length) {
      let position = 0;
      for (const character of compact) {
        for (let i = 0; i < character.toLowerCase().length; i++) { starts.push(position); ends.push(position + character.length); }
        position += character.length;
      }
    }
    for (let start = lower.indexOf(needle); start >= 0; start = lower.indexOf(needle, start + needle.length)) {
      matches.push({ start: starts[start] ?? start, end: ends[start + needle.length - 1] ?? start + needle.length });
      if (matches.length >= 200) break;
    }
  }
  const parts: JsonLogPart[] = [];
  const append = (text: string, kind: string, match: boolean) => {
    const previous = parts.at(-1);
    if (plain && previous?.match === match) previous.text += text;
    else parts.push({ text, kind: plain ? "plain" : kind, match });
  };
  const tokens = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|\s+|./g;
  let offset = 0, matchIndex = 0;
  for (const token of display.matchAll(tokens)) {
    const text = token[0];
    if (/^\s+$/.test(text)) { append(text, "space", false); continue; }
    const kind = text.startsWith('"')
      ? (/^\s*:/.test(display.slice(token.index + text.length)) ? "key" : "string")
      : /^-?\d/.test(text) ? "number" : /^(true|false|null)$/.test(text) ? "literal" : "punctuation";
    const end = offset + text.length;
    let cursor = offset;
    while (cursor < end) {
      while (matches[matchIndex] && matches[matchIndex].end <= cursor) matchIndex++;
      const hit = matches[matchIndex];
      const highlighted = !!hit && hit.start <= cursor;
      const next = hit ? Math.min(end, highlighted ? hit.end : hit.start) : end;
      append(text.slice(cursor - offset, next - offset), kind, highlighted);
      cursor = next;
    }
    offset = end;
  }
  return parts;
}
