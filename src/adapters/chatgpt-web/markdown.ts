import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { createDocument } from "@mixmark-io/domino";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

turndown.use(gfm);
turndown.remove(["button", "script", "style"]);
turndown.addRule("preserveCodexPlanBlockTags", {
  filter: "p",
  replacement: content => {
    // Codex recognizes these standalone control lines verbatim. Restore only paragraph text:
    // a post-conversion replacement would also rewrite literal escapes in fenced code.
    const paragraph = content.replace(/^([ \t]*)<(\/?)proposed\\_plan>([ \t]*)$/gm, "$1<$2proposed_plan>$3");
    return `\n\n${paragraph}\n\n`;
  },
});
turndown.addRule("linkInlineFilePaths", {
  filter: node => inlineFilePath(node) !== undefined,
  replacement: (_content, node) => {
    const path = node.textContent!;
    const target = path.replaceAll("\\", "/");
    // Code text becomes a plain link label, where backslashes and emphasis must be escaped.
    return `[${turndown.escape(path)}](<${target}>)`;
  },
});
turndown.addRule("compactListItem", {
  filter: "li",
  replacement: (content, node, options) => {
    const parent = node.parentNode as HTMLElement | null;
    let prefix = `${options.bulletListMarker} `;
    if (parent?.nodeName === "OL") {
      const start = Number(parent.getAttribute("start") ?? "1");
      const index = Array.prototype.indexOf.call(parent.children, node) as number;
      prefix = `${start + index}. `;
    }
    const normalized = content
      .replace(/^\n+|\n+$/g, "")
      .replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
    return `${prefix}${normalized}${node.nextSibling ? "\n" : ""}`;
  },
});
turndown.addRule("preserveKatexSource", {
  filter: node => node.classList.contains("katex") && node.hasAttribute("data-codex-latex"),
  replacement: (_content, node) => {
    const source = (node as HTMLElement).getAttribute("data-codex-latex")!;
    return node.parentElement?.classList.contains("katex-display")
      ? `\n\n\\[\n${source}\n\\]\n\n`
      : `\\(${source}\\)`;
  },
});

function preserveSemanticMarkup(html: string): string | HTMLElement {
  const root = createDocument().createElement("div");
  root.innerHTML = html;
  for (const decorative of Array.from(root.querySelectorAll('[aria-hidden="true"], [data-markdown-copy="exclude"]'))) decorative.remove();
  if (root.querySelector("svg, canvas, iframe, video, audio, .chart-widget-container, [data-code-block-preview-pane]")) {
    throw new Error("ChatGPT answer contains a semantic component without a supported complete representation");
  }
  for (const image of Array.from(root.querySelectorAll("img"))) {
    const source = image.getAttribute("src") ?? "";
    if (!/^(?:https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,|sandbox:\/)/i.test(source)) {
      throw new Error("ChatGPT answer image has no transferable source reference");
    }
  }
  // Activity renders inline code as a SPAN. Preserve the same code semantics as CODE,
  // including literal backslashes and fence characters, when token spans finish hydrating.
  for (const span of Array.from(root.querySelectorAll('span[data-markdown-copy="inline-code"]'))) {
    const code = root.ownerDocument.createElement("code");
    code.textContent = span.textContent;
    span.parentNode!.replaceChild(code, span);
  }
  for (const math of Array.from(root.querySelectorAll(".katex"))) {
    if (math.closest("pre, code")) continue;
    const sources = math.querySelectorAll('annotation[encoding="application/x-tex"]');
    if (sources.length !== 1) throw new Error("ChatGPT formula does not contain one unambiguous LaTeX source");
    const source = sources[0]!.textContent ?? "";
    // Capture before Turndown collapses whitespace: newlines matter in TeX
    // comments. Carry the source as data while removing the duplicated MathML
    // and visual layers from this conversion-only DOM.
    math.setAttribute("data-codex-latex", source);
    math.textContent = source;
  }
  return root;
}

function inlineFilePath(node: Node): string | undefined {
  if (node.nodeName !== "CODE") return undefined;
  for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (["A", "PRE"].includes(ancestor.nodeName)) return undefined;
  }

  const path = node.textContent ?? "";
  if (path !== path.trim() || /[\s`<>()[\]]/.test(path)) return undefined;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return undefined;

  const withoutLocation = path.replace(/:\d+(?::\d+)?$/, "");
  const separator = Math.max(withoutLocation.lastIndexOf("/"), withoutLocation.lastIndexOf("\\"));
  if (separator < 0) return undefined;

  const basename = withoutLocation.slice(separator + 1);
  if (!/\.[a-z\d][a-z\d._-]*$/i.test(basename)) return undefined;
  return path;
}

function obsidianWikiLink(value: string): string | undefined {
  const separator = value.indexOf("|");
  const target = (separator >= 0 ? value.slice(0, separator) : value).trim();
  const label = (separator >= 0 ? value.slice(separator + 1) : value).trim();
  if (!target || !label || /[<>]/.test(target)) return undefined;

  const fragmentAt = target.indexOf("#");
  const note = fragmentAt >= 0 ? target.slice(0, fragmentAt) : target;
  const fragment = fragmentAt >= 0 ? target.slice(fragmentAt) : "";
  const extension = note.slice(note.lastIndexOf("/") + 1).includes(".");
  const path = note && !extension ? `${note}.md` : note;
  return `[${label}](<${path}${fragment}>)`;
}

function linkObsidianWikiLinks(markdown: string): string {
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let mathEnd: "\\)" | "\\]" | undefined;
  return markdown.split("\n").map(line => {
    const fenceRun = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      const closingRun = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
      if (closingRun?.[0] === fence.marker && closingRun.length >= fence.length) fence = undefined;
      return line;
    }
    if (!mathEnd && fenceRun) {
      fence = { marker: fenceRun[0] as "`" | "~", length: fenceRun.length };
      return line;
    }

    let result = "";
    let inlineCodeTicks = 0;
    for (let index = 0; index < line.length;) {
      if (mathEnd) {
        const end = line.indexOf(mathEnd, index);
        if (end < 0) return result + line.slice(index);
        result += line.slice(index, end + mathEnd.length);
        index = end + mathEnd.length;
        mathEnd = undefined;
        continue;
      }
      if (line[index] === "`") {
        let end = index + 1;
        while (line[end] === "`") end += 1;
        const ticks = end - index;
        inlineCodeTicks = inlineCodeTicks === 0 ? ticks : ticks === inlineCodeTicks ? 0 : inlineCodeTicks;
        result += line.slice(index, end);
        index = end;
        continue;
      }
      // Restore Turndown-escaped wiki brackets only in prose, never inside a
      // formula or code example. Double brackets can be valid LaTeX content.
      const escapedWiki = line.startsWith("\\[\\[", index);
      if (inlineCodeTicks === 0 && (escapedWiki || line.startsWith("[[", index))) {
        const delimiterLength = escapedWiki ? 4 : 2;
        const end = line.indexOf(escapedWiki ? "\\]\\]" : "]]", index + delimiterLength);
        if (end >= 0) {
          const value = line.slice(index + delimiterLength, end);
          const linked = line[index - 1] !== "!" ? obsidianWikiLink(value) : undefined;
          result += linked ?? `[[${value}]]`;
          index = end + delimiterLength;
          continue;
        }
      }
      if (inlineCodeTicks === 0 && (line.startsWith("\\(", index) || line.startsWith("\\[", index))) {
        mathEnd = line[index + 1] === "(" ? "\\)" : "\\]";
        result += line.slice(index, index + 2);
        index += 2;
        continue;
      }
      result += line[index];
      index += 1;
    }
    return result;
  }).join("\n");
}

export function chatGptHtmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  return linkObsidianWikiLinks(turndown.turndown(preserveSemanticMarkup(html))).trim();
}

export interface ChatGptMarkdownSegment {
  key: string;
  tag?: string;
  html: string;
  text: string;
  linkTargets?: string[];
  group?: string;
  sourceStart?: number;
  sourceEnd?: number;
  streamable: boolean;
}

export class ChatGptMarkdownConsistencyError extends Error {
  constructor(message: string, readonly diagnostic?: {
    reason: "emitted_content_changed" | "incomplete_snapshot";
    observedTextChars: number;
    committedTextChars: number;
    observedSegments?: number;
  }) {
    super(message);
    this.name = "ChatGptMarkdownConsistencyError";
  }
}

/** Latest full snapshot and actual outward bytes have separate ownership.
 * Un-emitted revisions may be freely replaced. Completeness is established by the source
 * reader, never inferred from stable node identities, elapsed time or historical drafts. */
export class ChatGptMarkdownBuffer {
  private latest: ChatGptMarkdownSegment[] = [];
  private emitted = "";
  private serialized?: string;
  private signature?: string;
  private conflict?: ChatGptMarkdownConsistencyError;

  constructor(
    private readonly transform: (markdown: string) => string = markdown => markdown,
    private readonly delivery: "append" | "buffered" = "append",
  ) {}

  observe(segments: ChatGptMarkdownSegment[]): string {
    const signature = JSON.stringify(segments.map(({ html, group, streamable }) => [html, group, streamable]));
    if (signature !== this.signature) {
      this.latest = segments.map(segment => ({ ...segment }));
      this.signature = signature;
      this.serialized = undefined;
      this.conflict = undefined;
    }
    if (this.delivery === "buffered") return "";
    // Only structurally closed leading blocks are candidates for append delivery.
    // The renderer must provide a complete current snapshot; partial DOM is held by its reader.
    let count = 0;
    while (count < this.latest.length && this.latest[count]!.streamable) {
      const segment = this.latest[count]!;
      if (!segment.text.trim() && !chatGptHtmlToMarkdown(segment.html)) break;
      count++;
    }
    const candidate = this.serialize(this.latest.slice(0, count));
    // A shorter structurally closed prefix can merely mean that its final block is now pending.
    // Check the full candidate against bytes already sent, not that temporary frontier.
    this.assertEmittedPrefix(this.preview());
    if (candidate.length <= this.emitted.length) return "";
    this.assertEmittedPrefix(candidate);
    const delta = candidate.slice(this.emitted.length);
    this.emitted = candidate;
    return delta;
  }

  private serialize(segments: ChatGptMarkdownSegment[]): string {
    let markdown = "", lastGroup: string | undefined;
    for (const segment of segments) {
      const block = this.transform(chatGptHtmlToMarkdown(segment.html));
      if (!block) continue;
      markdown += (markdown ? segment.group !== undefined && segment.group === lastGroup ? "\n" : "\n\n" : "") + block;
      lastGroup = segment.group;
    }
    return markdown;
  }

  private assertEmittedPrefix(markdown: string): void {
    if (markdown.startsWith(this.emitted)) return;
    this.conflict = new ChatGptMarkdownConsistencyError("ChatGPT changed content already emitted to the caller", {
      reason: "emitted_content_changed", observedTextChars: markdown.length,
      committedTextChars: this.emitted.length, observedSegments: this.latest.length,
    });
    throw this.conflict;
  }

  preview(): string {
    return this.serialized ??= this.serialize(this.latest);
  }

  /** Pure preparation: a failed or retried broker fence cannot consume an output delta. */
  prepareFinal(): { markdown: string; delta: string } {
    const markdown = this.preview();
    this.assertEmittedPrefix(markdown);
    return { markdown, delta: markdown.slice(this.emitted.length) };
  }

  finish(): { markdown: string; delta: string } {
    const final = this.prepareFinal();
    this.emitted = final.markdown;
    return final;
  }

  deliveryState() {
    return { delivery: this.delivery, emittedChars: this.emitted.length, observedSegments: this.latest.length };
  }

  failureEvidence() {
    if (!this.conflict) return undefined;
    return { version: 2, format: "chatgpt-public-markdown-buffer", ...this.deliveryState(),
      conflict: this.conflict.diagnostic, emitted: this.emitted, observed: structuredClone(this.latest) };
  }
}
