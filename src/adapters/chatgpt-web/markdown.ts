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
turndown.addRule("removeImages", {
  filter: node => ["IMG", "PICTURE", "SOURCE"].includes(node.nodeName),
  replacement: () => "",
});
turndown.addRule("removeSvg", {
  filter: node => node.nodeName === "SVG",
  replacement: () => "",
});
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
  if (!html.includes("katex") && !html.includes("inline-code")) return html;
  const root = createDocument().createElement("div");
  root.innerHTML = html;
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

interface ChatGptMarkdownCandidate extends ChatGptMarkdownSegment {
  changedAt: number;
  streamableAt?: number;
}

interface CommittedChatGptMarkdownSegment {
  key: string;
  tag?: string;
  text: string;
  linkTargets?: string[];
  sourceStart?: number;
  sourceEnd?: number;
}

export class ChatGptMarkdownConsistencyError extends Error {
  constructor(message: string, readonly diagnostic?: {
    reason: "text_changed" | "link_target_changed" | "block_order_changed" | "source_range_overlap" | "unanchored_snapshot" | "missing_pending_content";
    observedStart?: number;
    observedEnd?: number;
    committedStart?: number;
    committedEnd?: number;
    observedTextChars: number;
    committedTextChars: number;
    observedTag?: string;
    committedTag?: string;
    observedIndex: number;
    committedIndex: number;
    observedSegments?: number;
    committedSegments?: number;
  }) {
    super(message);
    this.name = "ChatGptMarkdownConsistencyError";
  }
}

/**
 * Converts structurally completed ChatGPT DOM blocks into an append-only Markdown stream.
 *
 * ChatGPT can rewrite old HTML while hydrating citations and controls, so a character prefix is
 * not a safe commit boundary. It can also virtualize an already-rendered prefix, so later DOM
 * snapshots are partial observations rather than the response ledger. The browser supplies source
 * ranges for semantic blocks and marks a block streamable only after a following block exists.
 * Once committed, a missing prefix is harmless; changing text at a committed source range remains
 * an explicit protocol error because Responses deltas cannot be retracted.
 */
export class ChatGptMarkdownBuffer {
  private readonly candidates = new Map<string, ChatGptMarkdownCandidate>();
  private readonly committed: CommittedChatGptMarkdownSegment[] = [];
  private latest: ChatGptMarkdownSegment[] = [];
  private markdown = "";
  private lastGroup: string | undefined;
  private consistencyError: ChatGptMarkdownConsistencyError | undefined;
  private observed: ChatGptMarkdownSegment[] = [];
  private emittedChars = 0;
  private rebuilt = false;

  constructor(
    private readonly transform: (markdown: string) => string = markdown => markdown,
    private readonly stabilityMs = 750,
    private readonly delivery: "append" | "buffered" = "append",
  ) {
    if (!Number.isFinite(stabilityMs) || stabilityMs < 0) {
      throw new Error("ChatGPT Markdown stability window must be a non-negative finite number");
    }
  }

  observe(segments: ChatGptMarkdownSegment[], now = Date.now()): string {
    this.observed = segments.map(segment => ({ ...segment }));
    const reconciled = this.reconcile(segments);
    if (reconciled instanceof ChatGptMarkdownConsistencyError) {
      this.consistencyError = reconciled;
      return "";
    }
    // A disappearing pending block is not proof that the model removed it. Keep the last
    // covered projection until the same blocks return (possibly edited), or an equivalent
    // complete projection proves coverage. Never commit stale pending text as a fallback.
    if (!this.coversPending(reconciled)) {
      this.consistencyError = new ChatGptMarkdownConsistencyError("ChatGPT final DOM is missing previously observed pending content", {
        reason: "missing_pending_content", observedTextChars: segments.reduce((n, s) => n + s.text.length, 0),
        committedTextChars: this.markdown.length, observedIndex: -1, committedIndex: -1,
        observedSegments: segments.length, committedSegments: this.committed.length,
      });
      return "";
    }
    this.consistencyError = undefined;
    this.latest = reconciled.map(segment => ({ ...segment }));

    const visibleCandidates = new Set<string>();
    for (const segment of reconciled) {
      const candidateId = this.candidateId(segment);
      visibleCandidates.add(candidateId);
      const previous = this.candidates.get(candidateId);
      const unchanged = previous
        && previous.key === segment.key
        && previous.tag === segment.tag
        && previous.html === segment.html
        && previous.text === segment.text
        && previous.group === segment.group
        && previous.sourceStart === segment.sourceStart
        && previous.sourceEnd === segment.sourceEnd;
      this.candidates.set(candidateId, {
        ...segment,
        changedAt: unchanged ? previous.changedAt : now,
        ...(segment.streamable ? {
          streamableAt: unchanged && previous.streamableAt !== undefined
            ? previous.streamableAt
            : now,
        } : {}),
      });
    }
    for (const candidateId of this.candidates.keys()) {
      if (!visibleCandidates.has(candidateId)) this.candidates.delete(candidateId);
    }

    let delta = "";
    let committedCount = 0;
    while (committedCount < reconciled.length) {
      const segment = reconciled[committedCount]!;
      const candidateId = this.candidateId(segment);
      const candidate = this.candidates.get(candidateId);
      if (!candidate?.streamable || candidate.streamableAt === undefined) break;
      if (now - Math.max(candidate.changedAt, candidate.streamableAt) < this.stabilityMs) break;
      // An empty DOM placeholder has delivered no content and can still hydrate.
      // Keep it and the following blocks pending so later text cannot be inserted
      // ahead of an already-delivered suffix. Structural Markdown (e.g. HR) is real content.
      if (!candidate.text.trim() && !chatGptHtmlToMarkdown(candidate.html)) break;
      delta += this.commit(candidate);
      this.committed.push(this.committedSegment(candidate));
      this.candidates.delete(candidateId);
      committedCount += 1;
    }
    this.latest = this.latest.slice(committedCount);
    if (this.delivery === "buffered") return "";
    this.emittedChars += delta.length;
    return delta;
  }

  /** Read the complete current projection without committing unstable tail blocks. */
  preview(): string {
    if (this.consistencyError) {
      const covered = this.coveredBufferedSnapshot();
      if (!covered) throw this.consistencyError;
      return covered.markdown;
    }
    return this.projectPending();
  }

  private projectPending(pending = this.latest): string {
    const copy = new ChatGptMarkdownBuffer(this.transform, this.stabilityMs);
    copy.markdown = this.markdown;
    copy.lastGroup = this.lastGroup;
    for (const segment of pending) copy.commit(segment);
    return copy.markdown;
  }

  private coversPending(pending: ChatGptMarkdownSegment[]): boolean {
    if (!this.observed.length && (this.markdown || this.projectPending())) return false;
    let after = -1;
    for (const previous of this.latest) {
      if (!chatGptHtmlToMarkdown(previous.html)) continue;
      const index = pending.findIndex((next, i) => i > after && (
        (!!chatGptHtmlToMarkdown(next.html) && next.tag === previous.tag
          && (next.sourceStart !== undefined && previous.sourceStart !== undefined
            ? next.sourceStart === previous.sourceStart
            : next.key === previous.key || (next.text === previous.text && next.html === previous.html)))
        || this.extendsPendingContent(previous, next)
      ));
      if (index < 0) {
        // Equivalent pending wrappers can merge/split without stable node identities.
        const known = this.projectPending();
        return (!!known && this.projectPending(pending).startsWith(known))
          || this.coversResegmentedPending(pending);
      }
      after = index;
    }
    return true;
  }

  private coversResegmentedPending(pending: ChatGptMarkdownSegment[]): boolean {
    // Compare the entire pending sequence, not individual DOM identities. A renderer can
    // merge wrappers while the last inline/code block hydrates. Only reuse the existing
    // pending-tail rules when serialization preserves every block separator exactly.
    const aggregate = (segments: ChatGptMarkdownSegment[]) => {
      const html = segments.map(segment => segment.html).join("");
      const projection = new ChatGptMarkdownBuffer(this.transform, this.stabilityMs);
      for (const segment of segments) projection.commit(segment);
      if (this.transform(chatGptHtmlToMarkdown(html)) !== projection.markdown) return undefined;
      return { key: "pending-projection", tag: "div", html,
        text: segments.map(segment => segment.text).join(""), streamable: false };
    };
    const previous = aggregate(this.latest), next = aggregate(pending);
    return !!previous && !!next && this.extendsPendingContent(previous, next);
  }

  private extendsPendingContent(previous: ChatGptMarkdownSegment, next: ChatGptMarkdownSegment): boolean {
    if (previous.sourceStart !== undefined && next.sourceStart !== undefined && previous.sourceStart !== next.sourceStart) return false;
    if (previous.html.includes("<table") && next.html.includes("<table")
      && this.extendsPendingTable(previous.html, next.html)) return true;
    // An unfinished underline/list marker can temporarily render a P as H1/H2
    // and back again. Normalize only those pending wrappers for comparison;
    // retain inline markup, links and literal content. Delivery keeps the actual
    // observed wrapper, and committed blocks never take this path.
    if (previous.tag !== next.tag && [previous.tag, next.tag].every(tag => tag && ["p", "h1", "h2"].includes(tag))) {
      const paragraphs = [previous, next].map(segment => {
        const root = createDocument().createElement("div");
        root.innerHTML = segment.html;
        const block = root.firstElementChild;
        if (root.childNodes.length !== 1 || !block || block.tagName.toLowerCase() !== segment.tag) return undefined;
        const paragraph = root.ownerDocument.createElement("p");
        while (block.firstChild) paragraph.appendChild(block.firstChild);
        return { ...segment, tag: "p", html: paragraph.outerHTML };
      });
      if (paragraphs[0] && paragraphs[1]) return this.extendsPendingContent(paragraphs[0], paragraphs[1]);
    }
    const known = chatGptHtmlToMarkdown(previous.html), observed = chatGptHtmlToMarkdown(next.html);
    if (!known) return false;
    const before = known.match(/^(`{3,})([^\n]*)\n([\s\S]*)\n\1$/);
    if (before) {
      // Generated closing fences are not a content prefix; code and language are.
      const after = observed.match(/^(`{3,})([^\n]*)\n([\s\S]*)\n\1$/);
      return !!after && !!before[3] && before[2] === after[2] && after[3]!.startsWith(before[3]!);
    }
    // Token spans can remount as formatted Markdown while the last block is still growing.
    // Require its entire Markdown prefix, allowing only serializer escapes on literal Markdown
    // punctuation to hydrate into syntax. Never drop characters or apply this to committed text.
    if (observed.startsWith(known)) return true;
    let hydrated = "", inlineFence = 0;
    for (let i = 0; i < known.length; i += 1) {
      const character = known[i]!;
      if (character === "\\" && !inlineFence && /[`*_\[\]#>!+.-]/.test(known[i + 1] ?? "")) {
        hydrated += known[++i];
      } else if (character === "`") {
        let length = 1;
        while (known[i + length] === "`") length += 1;
        if (!inlineFence) inlineFence = length;
        else if (inlineFence === length) inlineFence = 0;
        hydrated += "`".repeat(length);i += length - 1;
      } else hydrated += character;
    }
    return (hydrated !== known && observed.startsWith(hydrated))
      || this.extendsPendingInlineTail(previous.html, observed)
      || this.hydratesPendingInlineCode(known, next.html);
  }

  private extendsPendingTable(previousHtml: string, nextHtml: string): boolean {
    const rows = (html: string) => {
      const root = createDocument().createElement("div");root.innerHTML = html;
      const tables = root.querySelectorAll("table");
      if (tables.length !== 1) return undefined;
      const table = tables[0]!;
      // The finished renderer wraps a streaming TABLE in DIVs and a toolbar. Ignore
      // wrappers only when the same serializer proves that they add no answer content.
      if (chatGptHtmlToMarkdown(html) !== chatGptHtmlToMarkdown(table.outerHTML)) return undefined;
      return Array.from(table.querySelectorAll("tr")).map(row => Array.from(row.children).map(cell => ({
        tag: cell.tagName, html: `<div>${cell.innerHTML}</div>`, markdown: chatGptHtmlToMarkdown(cell.innerHTML),
      })));
    };
    const previous = rows(previousHtml), next = rows(nextHtml);
    if (!previous?.length || !next || next.length < previous.length) return false;
    let lastRow = -1, lastCell = -1;
    previous.forEach((row, r) => row.forEach((cell, c) => { if (cell.markdown) { lastRow = r;lastCell = c; } }));
    if (lastRow < 0) return false;
    for (const [r, row] of previous.entries()) {
      if (next[r]!.length !== row.length) return false;
      for (const [c, cell] of row.entries()) {
        const observed = next[r]![c]!;
        if (cell.tag !== observed.tag || !["TD", "TH"].includes(cell.tag)) return false;
        if (r > lastRow || (r === lastRow && c > lastCell)) continue;
        if (cell.markdown === observed.markdown) continue;
        if (r !== lastRow || c !== lastCell || !this.extendsPendingContent(
          { key: "table-tail", tag: "div", html: cell.html, text: cell.markdown, streamable: false },
          { key: "table-tail", tag: "div", html: observed.html, text: observed.markdown, streamable: false },
        )) return false;
      }
    }
    return true;
  }

  private hydratesPendingInlineCode(known: string, html: string): boolean {
    // Before the closing backtick arrives, token spans are ordinary text and
    // Turndown escapes their backslashes/punctuation. A hydrated CODE preserves
    // those characters literally. Recreate the raw spelling in a detached copy
    // and serialize it with the same rules; never unescape the actual code text.
    const delimiters = [...new Set([...known.matchAll(/(?:\\`)+/g)].map(match => "`".repeat(match[0].length / 2)))];
    if (!delimiters.length) return false;
    const root = createDocument().createElement("div");
    root.innerHTML = html;
    for (const code of Array.from(root.querySelectorAll('code, span[data-markdown-copy="inline-code"]'))) {
      if (code.closest("pre")) continue;
      const parent = code.parentNode!;
      const raw = root.ownerDocument.createTextNode("");
      parent.replaceChild(raw, code);
      for (const delimiter of delimiters) {
        raw.textContent = `${delimiter}${code.textContent ?? ""}${delimiter}`;
        if (chatGptHtmlToMarkdown(root.innerHTML).startsWith(known)) return true;
      }
      parent.replaceChild(code, raw);
    }
    return false;
  }

  private extendsPendingInlineTail(html: string, observed: string): boolean {
    // A streaming <strong>Par</strong> already serializes as **Par**. Remounting
    // it as <strong>Paragraph</strong> preserves the text, but not that synthetic
    // closing delimiter. Locate the last text boundary through the same serializer;
    // only generated inline-format closers may follow it. URLs, file-link targets,
    // literal punctuation and other content may never be discarded by this check.
    const root = createDocument().createElement("div");
    root.innerHTML = html;
    const walker = root.ownerDocument.createTreeWalker(root, 4); // SHOW_TEXT
    let lastText: Node | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) lastText = node;
    }
    if (!lastText) return false;
    let marker = "WEB2HARNESSPENDINGTEXTBOUNDARY";
    while (html.includes(marker)) marker += "X";
    lastText.textContent += marker;
    const marked = chatGptHtmlToMarkdown(root.innerHTML);
    const boundary = marked.indexOf(marker);
    if (boundary <= 0 || marked.indexOf(marker, boundary + marker.length) !== -1) return false;
    const suffix = marked.slice(boundary + marker.length);
    return /^[`*_]+$/.test(suffix.trim())
      && observed.startsWith(marked.slice(0, boundary));
  }

  needsCoverageRecovery(): boolean {
    return this.consistencyError?.diagnostic?.reason === "missing_pending_content"
      && !this.coveredBufferedSnapshot();
  }

  private coveredBufferedSnapshot(): ChatGptMarkdownBuffer | undefined {
    if (this.delivery !== "buffered" || this.emittedChars !== 0) return undefined;
    const known = this.projectPending();
    if (!known) return undefined;
    const candidate = new ChatGptMarkdownBuffer(this.transform, this.stabilityMs);
    let previousStart: number | undefined;
    for (const segment of this.observed) {
      if (segment.sourceStart !== undefined) {
        if (previousStart !== undefined && segment.sourceStart <= previousStart) return undefined;
        previousStart = segment.sourceStart;
      }
      candidate.commit(segment);
    }
    return candidate.markdown.startsWith(known) ? candidate : undefined;
  }

  finish(): { markdown: string; delta: string } {
    if (this.consistencyError) {
      // Only a private, un-emitted answer can be rebuilt. A complete same-answer snapshot must
      // retain the *entire* known Markdown projection (including the uncommitted tail), byte for
      // byte and in order. This is not substring/length matching: missing virtualized prefixes,
      // changed URLs, reordered content and missing tails cannot satisfy this coverage check.
      // A split/merged block can also look like a changed text/range or a missing pending
      // identity. Those local mismatches are recoverable only through the same full,
      // byte-exact coverage proof below; actual content changes still fail that proof.
      const candidate = this.coveredBufferedSnapshot();
      if (!candidate) throw this.consistencyError;
      this.markdown = candidate.markdown;
      this.lastGroup = candidate.lastGroup;
      this.committed.splice(0, this.committed.length, ...this.observed.map(segment => this.committedSegment(segment)));
      this.latest = [];
      this.consistencyError = undefined;
      this.rebuilt = true;
    }
    for (const segment of this.latest) {
      this.commit(segment);
      this.committed.push(this.committedSegment(segment));
    }
    this.candidates.clear();
    this.latest = [];
    const delta = this.markdown.slice(this.emittedChars);
    this.emittedChars = this.markdown.length;
    return { markdown: this.markdown, delta };
  }

  /** Payload-free state for diagnostics; buffered output is emitted only once at finish. */
  deliveryState() {
    return { delivery: this.delivery, emittedChars: this.emittedChars, committedSegments: this.committed.length,
      observedSegments: this.observed.length, rebuilt: this.rebuilt };
  }

  /** Private diagnostic artifact only: public answer projections, never normal telemetry. */
  failureEvidence() {
    if (!this.consistencyError) return undefined;
    return { version: 1, format: "chatgpt-public-markdown-buffer", ...this.deliveryState(),
      conflict: this.consistencyError.diagnostic, markdown: this.markdown, lastGroup: this.lastGroup,
      committed: structuredClone(this.committed), pending: structuredClone(this.latest),
      observed: structuredClone(this.observed) };
  }

  currentSnapshotIsConsistent(): boolean {
    return this.consistencyError === undefined;
  }

  private reconcile(
    segments: ChatGptMarkdownSegment[],
  ): ChatGptMarkdownSegment[] | ChatGptMarkdownConsistencyError {
    if (this.committed.length === 0 || segments.length === 0) return segments;

    const pending: ChatGptMarkdownSegment[] = [];
    const lastRangedCommitted = this.committed
      .filter(segment => segment.sourceEnd !== undefined)
      .at(-1);
    const lastCommittedEnd = lastRangedCommitted?.sourceEnd;
    let highestCommittedIndex = -1;
    const matchedCommitted = new Set<number>();
    let sawPending = false;
    let previousSourceStart: number | undefined;

    for (const [observedIndex, segment] of segments.entries()) {
      if (segment.sourceStart !== undefined) {
        if (previousSourceStart !== undefined && segment.sourceStart <= previousSourceStart) {
          return new ChatGptMarkdownConsistencyError(
            "ChatGPT final DOM exposed non-monotonic source ranges",
          );
        }
        previousSourceStart = segment.sourceStart;
      }
      const committedIndex = this.committedIndex(segment, highestCommittedIndex, matchedCommitted);
      if (committedIndex instanceof ChatGptMarkdownConsistencyError) return committedIndex;
      if (committedIndex !== undefined) {
        const committed = this.committed[committedIndex]!;
        if (sawPending || committedIndex <= highestCommittedIndex || committed.text !== segment.text) {
          return this.changedCommittedBlockError(
            sawPending || committedIndex <= highestCommittedIndex ? "block_order_changed" : "text_changed",
            segment,
            committed,
            observedIndex,
            committedIndex,
          );
        }
        highestCommittedIndex = committedIndex;
        matchedCommitted.add(committedIndex);
        // Link destinations are answer content even when textContent remains identical.
        // Cosmetic DOM/formatting hydration still does not invalidate a committed paragraph.
        if (JSON.stringify(committed.linkTargets ?? []) !== JSON.stringify(segment.linkTargets ?? [])) {
          return this.changedCommittedBlockError("link_target_changed", segment, committed, observedIndex, committedIndex);
        }
        continue;
      }

      if (segment.sourceStart !== undefined && lastCommittedEnd !== undefined) {
        if (segment.sourceStart <= lastCommittedEnd) {
          return this.changedCommittedBlockError(
            "source_range_overlap", segment, lastRangedCommitted!, observedIndex,
            this.committed.indexOf(lastRangedCommitted!),
          );
        }
        sawPending = true;
        pending.push(segment);
        continue;
      }

      const followsVisibleCommittedTail = highestCommittedIndex === this.committed.length - 1;
      // A known, undelivered paragraph also anchors new content after a virtualized
      // committed tail. Earlier committed blocks are still checked above for edits/reordering.
      if (!followsVisibleCommittedTail && !sawPending && !this.matchesLatestPending(segment)) {
        return new ChatGptMarkdownConsistencyError(
          "ChatGPT final DOM could not be aligned with the response buffer",
          { reason: "unanchored_snapshot", observedTextChars: segment.text.length,
            committedTextChars: this.markdown.length, observedTag: segment.tag,
            observedIndex, committedIndex: highestCommittedIndex,
            observedSegments: segments.length, committedSegments: this.committed.length },
        );
      }
      sawPending = true;
      pending.push(segment);
    }

    return pending;
  }

  private committedIndex(
    segment: ChatGptMarkdownSegment,
    afterIndex: number,
    matched: ReadonlySet<number>,
  ): number | ChatGptMarkdownConsistencyError | undefined {
    const exact = this.committed.findIndex(committed => (
      segment.sourceStart !== undefined && committed.sourceStart !== undefined
        ? segment.sourceStart === committed.sourceStart && segment.tag === committed.tag
        : segment.key === committed.key
    ));
    if (exact >= 0) return exact;

    if (segment.sourceStart !== undefined) return undefined;
    if (!segment.tag) return undefined;
    // Empty text is not an identity: separate rules and images can share it.
    // Their exact DOM keys/ranges above remain valid, but a new empty block must
    // not be mistaken for an earlier committed one by the text-only match.
    if (!segment.text.trim()) return undefined;
    const semanticMatches = this.committed
      .map((committed, index) => ({ committed, index }))
      .filter(({ committed }) => committed.tag === segment.tag && committed.text === segment.text);
    // Match each committed occurrence at most once, in response order. A new
    // repeated paragraph must not be rebound to an occurrence already consumed
    // by this snapshot. Counting from zero breaks when earlier blocks disappear.
    const remaining = semanticMatches.filter(match => match.index > afterIndex);
    if (remaining.length === 1) return remaining[0]!.index;
    if (remaining.length > 1) {
      if (afterIndex >= 0 && remaining[0]!.index === afterIndex + 1) return remaining[0]!.index;
      return new ChatGptMarkdownConsistencyError("ChatGPT final DOM has ambiguous repeated text in the response buffer");
    }
    // A known pending tail can survive removal of its committed prefix. Without
    // that evidence, an unseen earlier occurrence is a reorder, not new text.
    const earlier = semanticMatches.find(match => !matched.has(match.index));
    if (earlier && !this.matchesLatestPending(segment)) return earlier.index;
    return undefined;
  }

  private matchesLatestPending(segment: ChatGptMarkdownSegment): boolean {
    const exact = this.latest.filter(candidate => (
      segment.sourceStart !== undefined && candidate.sourceStart !== undefined
        ? segment.sourceStart === candidate.sourceStart && segment.tag === candidate.tag
        : segment.key === candidate.key
    ));
    if (exact.length === 1) return true;
    if (segment.sourceStart !== undefined) return false;
    if (!segment.tag) return false;
    if (!segment.text.trim()) return false;
    return this.latest.filter(candidate => (
      candidate.tag === segment.tag && candidate.text === segment.text
    )).length === 1;
  }

  private candidateId(segment: ChatGptMarkdownSegment): string {
    return segment.sourceStart !== undefined
      ? `source:${segment.sourceStart}:${segment.tag ?? ""}`
      : `key:${segment.key}`;
  }

  private committedSegment(segment: ChatGptMarkdownSegment): CommittedChatGptMarkdownSegment {
    return {
      key: segment.key,
      ...(segment.tag ? { tag: segment.tag } : {}),
      text: segment.text,
      ...(segment.linkTargets ? { linkTargets: [...segment.linkTargets] } : {}),
      ...(segment.sourceStart !== undefined ? { sourceStart: segment.sourceStart } : {}),
      ...(segment.sourceEnd !== undefined ? { sourceEnd: segment.sourceEnd } : {}),
    };
  }

  private changedCommittedBlockError(
    reason: NonNullable<ChatGptMarkdownConsistencyError["diagnostic"]>["reason"],
    observed: ChatGptMarkdownSegment,
    committed: CommittedChatGptMarkdownSegment,
    observedIndex: number,
    committedIndex: number,
  ): ChatGptMarkdownConsistencyError {
    return new ChatGptMarkdownConsistencyError(
      "ChatGPT changed a completed text block in the response buffer",
      {
        reason,
        observedStart: observed.sourceStart,
        observedEnd: observed.sourceEnd,
        committedStart: committed.sourceStart,
        committedEnd: committed.sourceEnd,
        observedTextChars: observed.text.length,
        committedTextChars: committed.text.length,
        observedTag: observed.tag,
        committedTag: committed.tag,
        observedIndex,
        committedIndex,
      },
    );
  }

  private commit(segment: ChatGptMarkdownSegment): string {
    const block = this.transform(chatGptHtmlToMarkdown(segment.html));
    if (!block) return "";
    const separator = this.markdown
      ? segment.group !== undefined && segment.group === this.lastGroup ? "\n" : "\n\n"
      : "";
    const delta = `${separator}${block}`;
    this.markdown += delta;
    this.lastGroup = segment.group;
    return delta;
  }
}
