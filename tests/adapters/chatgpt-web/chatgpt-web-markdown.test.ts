import { expect, test } from "bun:test";
import { ChatGptMarkdownBuffer, chatGptHtmlToMarkdown } from "../../../src/adapters/chatgpt-web/markdown";

test("turns observed inline file path formats into Markdown links", () => {
  const cases = [
    {
      path: "output/path-format-probe/alpha-notes.md",
      target: "output/path-format-probe/alpha-notes.md",
    },
    {
      path: "output/path-format-probe/beta-report.json",
      target: "output/path-format-probe/beta-report.json",
    },
    {
      path: "/Users/example/web2harness/src/path-format-probe/gamma-helper.ts",
      target: "/Users/example/web2harness/src/path-format-probe/gamma-helper.ts",
    },
    {
      path: "/Users/example/web2harness/output/path-format-probe/epsilon-report.pdf",
      target: "/Users/example/web2harness/output/path-format-probe/epsilon-report.pdf",
    },
    {
      path: String.raw`C:\Users\Dev\Documents\Codex\path-format-probe\zeta-result.pdf`,
      target: "C:/Users/Dev/Documents/Codex/path-format-probe/zeta-result.pdf",
    },
    {
      path: String.raw`C:\Codex_Project_Unity\_Editor\file.cs`,
      target: "C:/Codex_Project_Unity/_Editor/file.cs",
    },
    {
      path: String.raw`C:\Codex_Project_Unity\_file.cs`,
      target: "C:/Codex_Project_Unity/_file.cs",
    },
    {
      path: String.raw`\\server\share_name\_Editor\file.cs`,
      target: "//server/share_name/_Editor/file.cs",
    },
    {
      path: "src/_private_/file_name.ts",
      target: "src/_private_/file_name.ts",
    },
    {
      path: "src/adapters/chatgpt-web/markdown.ts:47:3",
      target: "src/adapters/chatgpt-web/markdown.ts:47:3",
    },
  ];

  for (const { path, target } of cases) {
    const markdown = chatGptHtmlToMarkdown(`<p>Created <code>${path}</code>.</p>`);
    expect(markdown).toContain(`](<${target}>)`);
    expect(Bun.markdown.html(markdown))
      .toBe(`<p>Created <a href="${target}">${path}</a>.</p>\n`);
  }
});

test("preserves inline code that is not an unambiguous file path", () => {
  const html = [
    "<p>",
    "Run <code>bun test tests/example.test.ts</code>, inspect <code>FileChangeItem</code>, ",
    "and retain <code>turn/diff/updated</code>, <code>https://example.com/report.pdf</code>, ",
    "and <code>src/path without-extension</code>, <code>src/.</code>, and <code>src/..</code>.",
    "</p>",
    "<pre><code>src/example.ts</code></pre>",
  ].join("");

  expect(chatGptHtmlToMarkdown(html)).toBe([
    "Run `bun test tests/example.test.ts`, inspect `FileChangeItem`, and retain `turn/diff/updated`, `https://example.com/report.pdf`, and `src/path without-extension`, `src/.`, and `src/..`.",
    "",
    "```",
    "src/example.ts",
    "```",
  ].join("\n"));
});

test("does not nest a generated file link inside an existing link", () => {
  expect(chatGptHtmlToMarkdown(
    '<p>Open <a href="https://example.com/source"><code>src/example.ts</code></a>.</p>',
  )).toBe("Open [`src/example.ts`](https://example.com/source).");
});

test("converts Obsidian aliases and headings but preserves code examples and embeds", () => {
  const html = [
    "<p>Open [[Notes/weekly-review|review]] and [[Projects/sample#Status]].</p>",
    "<p>Keep <code>[[wiki/example]]</code> and ![[image.png]] literal.</p>",
    "<pre><code>\`\`\`not a closing fence\n[[wiki/fenced]]</code></pre>",
  ].join("");

  expect(chatGptHtmlToMarkdown(html)).toBe([
    "Open [review](<Notes/weekly-review.md>) and [Projects/sample#Status](<Projects/sample.md#Status>).",
    "",
    "Keep `[[wiki/example]]` and ![[image.png]] literal.",
    "",
    "````",
    "```not a closing fence",
    "[[wiki/fenced]]",
    "````",
  ].join("\n"));
});

test("preserves standalone Codex plan markers in paragraphs and list continuations", () => {
  expect(chatGptHtmlToMarkdown([
    "<p>&lt;proposed_plan&gt;</p>",
    "<h2>Plan</h2>",
    "<ul><li><p>Keep snake_case.</p><p>&lt;/proposed_plan&gt;</p></li></ul>",
  ].join(""))).toBe([
    "<proposed_plan>", "", "## Plan", "", "- Keep snake\\_case.", "  ", "  </proposed_plan>",
  ].join("\n"));
  expect(chatGptHtmlToMarkdown("<p>&lt;proposed_plan&gt;<br>Step<br>&lt;/proposed_plan&gt;</p>"))
    .toBe("<proposed_plan>  \nStep  \n</proposed_plan>");
});

test("preserving plan markers does not rewrite mentions or literal code", () => {
  expect(chatGptHtmlToMarkdown([
    "<p>Mention &lt;proposed_plan&gt; and &lt;/proposed_plan&gt; inline.</p>",
    "<p><code>&lt;proposed_plan&gt;</code> <code>&lt;/proposed_plan&gt;</code></p>",
    "<pre><code>&lt;proposed\\_plan&gt;\n&lt;/proposed\\_plan&gt;</code></pre>",
  ].join(""))).toBe([
    "Mention <proposed\\_plan> and </proposed\\_plan> inline.", "",
    "`<proposed_plan>` `</proposed_plan>`", "",
    "```", "<proposed\\_plan>", "</proposed\\_plan>", "```",
  ].join("\n"));
});

test("buffered replies recover an equivalent final wrapper without emitting partial or duplicate text", () => {
  const parts = ["Alpha.", "Beta.", "Gamma."].map((text, i) => ({
    key: `old:${i}`, tag: "p", html: `<p>${text}</p>`, text, streamable: i < 2,
  }));
  const merged = [{ key: "new", tag: "div", html: `<div>${parts.map(p => p.html).join("")}</div>`,
    text: "Alpha.\nBeta.\nGamma.", streamable: false }];
  const privateBuffer = new ChatGptMarkdownBuffer(undefined, 0, "buffered");
  expect(privateBuffer.observe(parts, 0)).toBe("");
  expect(privateBuffer.observe(merged, 1)).toBe("");
  expect(privateBuffer.currentSnapshotIsConsistent()).toBeFalse();
  expect(privateBuffer.finish()).toEqual({ markdown: "Alpha.\n\nBeta.\n\nGamma.", delta: "Alpha.\n\nBeta.\n\nGamma." });
  expect(privateBuffer.finish().delta).toBe("");
  expect(privateBuffer.deliveryState().rebuilt).toBeTrue();
  const liveBuffer = new ChatGptMarkdownBuffer(undefined, 0);
  expect(liveBuffer.observe(parts, 0)).toBe("Alpha.\n\nBeta.");
  liveBuffer.observe(merged, 1);
  expect(() => liveBuffer.finish()).toThrow("could not be aligned");
});

test("buffered recovery rejects lost prefixes, pending tails, changed links, reorder and duplicate output", () => {
  const parts = [
    { key: "a", tag: "p", html: '<p><a href="https://example.com/a">Alpha</a></p>', text: "Alpha", linkTargets: ["https://example.com/a"], streamable: true },
    { key: "b", tag: "p", html: "<p>Beta.</p>", text: "Beta.", streamable: true },
    { key: "c", tag: "p", html: "<p>Gamma.</p>", text: "Gamma.", streamable: false },
  ];
  const html = parts.map(p => p.html).join("");
  for (const changed of [
    parts.slice(1).map(p => p.html).join(""),
    parts.slice(0, 2).map(p => p.html).join(""),
    html.replace("example.com/a", "example.com/b"),
    parts.toReversed().map(p => p.html).join(""),
    parts[0]!.html + html,
  ]) {
    const buffer = new ChatGptMarkdownBuffer(undefined, 0, "buffered");
    expect(buffer.observe(parts, 0)).toBe("");
    buffer.observe([{ key: "new", tag: "div", html: `<div>${changed}</div>`, text: "remounted", streamable: false }], 1);
    expect(() => buffer.finish()).toThrow("could not be aligned");
    expect(buffer.deliveryState().emittedChars).toBe(0);
  }
});

test("missing pending blocks never become a successful truncated answer in either delivery mode", () => {
  const block = (key: string, text: string, streamable = false) => ({ key, tag: "p", text, html: `<p>${text}</p>`, streamable });
  const a = block("a", "First", true), b = block("b", "Pending"), c = block("c", "Last");
  for (const delivery of ["append", "buffered"] as const) {
    for (const missing of [[a], [], [a, c], [a, block("b", ""), c]]) {
      const buffer = new ChatGptMarkdownBuffer(undefined, 0, delivery);
      buffer.observe([a, b, c], 0);
      buffer.observe(missing, 1);
      expect(buffer.needsCoverageRecovery()).toBeTrue();
      expect(() => buffer.finish()).toThrow("missing previously observed pending content");
      buffer.observe(missing, 2);
      expect(() => buffer.finish()).toThrow();
      buffer.observe([a, block("b", "Rewritten pending"), block("c", "Last expanded")], 3);
      expect(buffer.needsCoverageRecovery()).toBeFalse();
      expect(buffer.finish().markdown).toBe("First\n\nRewritten pending\n\nLast expanded");
      expect(buffer.finish().delta).toBe("");
    }
  }
});

test("uncommitted answers can grow, rewrite and replace equivalent wrappers without losing coverage", () => {
  const block = (key: string, text: string) => ({ key, tag: "p", text, html: `<p>${text}</p>`, streamable: false });
  const buffer = new ChatGptMarkdownBuffer(undefined, 0, "buffered");
  buffer.observe([block("a", "Draft"), block("b", "Tail")], 0);
  buffer.observe([block("a", "New draft"), block("b", "Expanded tail")], 1);
  const html = "<div><p>New draft</p><p>Expanded tail</p></div>";
  buffer.observe([{ key: "merged", tag: "div", text: "New draftExpanded tail", html, streamable: false }], 2);
  expect(buffer.finish().markdown).toBe("New draft\n\nExpanded tail");
});

test("a fully pending answer cannot disappear, and committed prefix virtualization still preserves its tail", () => {
  const b = { key: "b", tag: "p", text: "Pending", html: "<p>Pending</p>", streamable: false };
  const buffer = new ChatGptMarkdownBuffer(undefined, 0, "buffered");
  buffer.observe([b], 0); buffer.observe([], 1);
  expect(() => buffer.finish()).toThrow("missing previously observed pending content");
  buffer.observe([b], 2);
  expect(buffer.finish().markdown).toBe("Pending");
});

test("buffered output keeps a virtualized prefix using its verified ledger and still rejects actual edits", () => {
  const segment = (key: string, text: string, streamable: boolean) => ({ key, tag: "p", text, html: `<p>${text}</p>`, streamable });
  const buffer = new ChatGptMarkdownBuffer(undefined, 0, "buffered");
  buffer.observe([segment("a", "Alpha", true), segment("b", "Beta", false)], 0);
  buffer.observe([segment("b", "Beta", false)], 1);
  expect(buffer.finish()).toEqual({ markdown: "Alpha\n\nBeta", delta: "Alpha\n\nBeta" });
  const changed = new ChatGptMarkdownBuffer(undefined, 0, "buffered");
  changed.observe([segment("a", "Alpha", true), segment("b", "Beta", false)], 0);
  changed.observe([segment("a", "Changed", true), segment("b", "Beta", false)], 1);
  expect(() => changed.finish()).toThrow("changed a completed text block");
});

test("pending token spans remount into inline Markdown without losing required blocks", () => {
  const segment = (key: string, html: string, text: string) => ({ key, tag: "p", html, text, streamable: false });
  const first = segment("first", '<p><span>Read </span><code>input.txt</code><span>.</span></p>', 'Read input.txt.');
  const tail = segment("tail", '<p>Output `ASSERT_CO</p>', 'Output `ASSERT_CO');
  const finalFirst = segment("remounted-first", '<p>Read <code>input.txt</code>.</p>', 'Read input.txt.');
  const finalTail = segment("remounted-tail", '<p>Output <span data-markdown-copy="inline-code">ASSERT_COVERAGE</span>.</p>', 'Output ASSERT_COVERAGE.');
  for (const delivery of ["append", "buffered"] as const) {
    const buffer = new ChatGptMarkdownBuffer(undefined, 750, delivery);
    buffer.observe([first, tail], 0);buffer.observe([finalFirst, finalTail], 500);
    expect(buffer.finish().markdown).toBe('Read `input.txt`.\n\nOutput `ASSERT_COVERAGE`.');
    for (const changed of [[finalFirst], [finalFirst, segment("other", '<p>Output <code>DIFFERENT</code>.</p>', 'Output DIFFERENT.')]]) {
      const missing = new ChatGptMarkdownBuffer(undefined, 750, delivery);
      missing.observe([first, tail], 0);missing.observe(changed, 500);
      expect(() => missing.finish()).toThrow("missing previously observed pending content");
    }
    const literal = new ChatGptMarkdownBuffer(undefined, 750, delivery);
    literal.observe([segment("old", '<p>Literal <code>a\\_b</code></p>', 'Literal a\\_b')], 0);
    literal.observe([segment("new", '<p>Literal <code>a_b</code></p>', 'Literal a_b')], 500);
    expect(() => literal.finish()).toThrow("missing previously observed pending content");
  }
});

test("pending code remounts can grow without synthetic closing fences hiding missing content", () => {
  const code = (key: string, text: string, language = "json") => ({ key, tag: "div", text,
    html: `<div><pre><code class="language-${language}">${text}</code></pre></div>`, streamable: false });
  const tail = { key: "tail", tag: "p", text: "Required tail", html: "<p>Required tail</p>", streamable: false };
  for (const delivery of ["append", "buffered"] as const) {
    const buffer = new ChatGptMarkdownBuffer(undefined, 0, delivery);
    buffer.observe([code("a", '{"calls":[')], 0);
    buffer.observe([code("remounted", '{"calls":[]}')], 1);
    expect(buffer.finish().markdown).toBe('```json\n{"calls":[]}\n```');
    for (const changed of [[code("b", '{"calls":[]}')], [code("b", '{"other":[]}'), tail],
      [code("b", '{"calls":[]}', "text"), tail]]) {
      const missing = new ChatGptMarkdownBuffer(undefined, 0, delivery);
      missing.observe([code("a", '{"calls":['), tail], 0);
      missing.observe(changed, 1);
      expect(() => missing.finish()).toThrow("missing previously observed pending content");
    }
  }
});

test("remounted pending inline formatting can grow past serializer-generated closing delimiters", () => {
  const block = (key: string, html: string) => ({ key, tag: "p", html, text: html.replace(/<[^>]*>/g, ""), streamable: false });
  for (const tag of ["strong", "em", "code", 'span data-markdown-copy="inline-code"']) {
    const end = tag.split(" ")[0];
    for (const delivery of ["append", "buffered"] as const) {
      const b = new ChatGptMarkdownBuffer(undefined, 750, delivery);
      const before = block("stream", `<p>Result <${tag}>ASSERT_COM</${end}></p>`);
      const after = block("remount", `<p>Result <${tag}>ASSERT_COMPLETE</${end}>.</p>`);
      b.observe([before], 0);b.observe([after], 250);
      expect(b.finish().markdown).toBe(chatGptHtmlToMarkdown(after.html));
      for (const changed of [
        `<p>Result <${tag}>COMPLETE</${end}>.</p>`,
        '<p>Result</p>',
      ]) {
        const missing = new ChatGptMarkdownBuffer(undefined, 750, delivery);
        missing.observe([before], 0);missing.observe([block("remount", changed)], 250);
        expect(() => missing.finish()).toThrow("missing previously observed pending content");
      }
    }
  }
});

test("pending inline delimiter growth does not hide changed links, paths, code punctuation or missing blocks", () => {
  const block = (key: string, html: string) => ({ key, tag: "p", html, text: "fixture", streamable: false });
  for (const [before, after] of [
    ['<p><strong><a href="https://example.com/a">Read</a></strong></p>', '<p><strong><a href="https://example.com/b">Read more</a></strong></p>'],
    ['<p><strong><code>src/a.ts</code></strong></p>', '<p><strong><a href="https://example.com/b">src/a.ts</a></strong></p>'],
    ['<p><code>literal_*_</code></p>', '<p><code>literal_more</code></p>'],
    ['<p><strong>Required</strong></p><hr>', '<p><strong>Required content</strong></p>'],
  ]) {
    const b = new ChatGptMarkdownBuffer(undefined, 750, "buffered");
    b.observe([block("old", before!)], 0);b.observe([block("new", after!)], 250);
    expect(() => b.finish()).toThrow("missing previously observed pending content");
  }
  const b = new ChatGptMarkdownBuffer(undefined, 750, "buffered");
  b.observe([block("first", '<p>Must stay</p>'), block("last", '<p><strong>Par</strong></p>')], 0);
  b.observe([block("new", '<p><strong>Paragraph</strong></p>')], 250);
  expect(() => b.finish()).toThrow("missing previously observed pending content");
});

function katex(source: string, display = false): string {
  const escaped = source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const math = '<span class="katex"><span class="katex-mathml"><math><semantics>'
    + '<mrow><mi>ACCESSIBLE_COPY</mi><mo>\u2061</mo></mrow>'
    + `<annotation encoding="application/x-tex">${escaped}</annotation>`
    + '</semantics></math></span><span class="katex-html" aria-hidden="true">VISUAL_COPY\u200b</span></span>';
  return display ? `<span class="katex-display">${math}</span>` : math;
}

test("pending heading hydration preserves links, code, literal punctuation, block order and committed text", () => {
  const block = (key: string, tag: string, body: string, streamable = false) => ({
    key, tag, html: `<${tag}>${body}</${tag}>`, text: body.replace(/<[^>]*>/g, ''), streamable,
  });
  for (const [before, after] of [
    ['Required text', 'Different text'],
    ['Required text', 'Required'],
    ['<a href="https://example.com/a">Read</a>', '<a href="https://example.com/b">Read more</a>'],
    ['<code>literal_*_</code>', '<code>literal_more</code>'],
    ['Literal # label', 'Literal label'],
    ['First<br>Second', 'FirstSecond'],
  ]) {
    const b = new ChatGptMarkdownBuffer();
    b.observe([block('old', 'p', before!)], 0);
    b.observe([block('new', 'h2', after!)], 1);
    expect(() => b.finish()).toThrow('missing previously observed pending content');
  }
  const missing = new ChatGptMarkdownBuffer();
  missing.observe([block('first', 'p', 'First'), block('last', 'p', 'Tail')], 0);
  missing.observe([block('new', 'h2', 'First expanded')], 1);
  expect(() => missing.finish()).toThrow('missing previously observed pending content');
  const committed = new ChatGptMarkdownBuffer(undefined, 0);
  committed.observe([block('old', 'p', 'Already delivered', true), block('tail', 'p', 'Tail')], 0);
  committed.observe([block('new', 'h2', 'Already delivered but changed'), block('tail', 'p', 'Tail')], 1);
  expect(() => committed.finish()).toThrow();
});

test("unfinished inline code hydrates without treating serializer-escaped Windows paths as lost text", () => {
  const block = (key: string, html: string) => ({ key, tag: 'p', html, text: html.replace(/<[^>]*>/g, ''), streamable: false });
  const path = String.raw`C:\fixture\run_01\input`;
  for (const delimiter of ['`', '``']) {
    for (const code of ['code', 'span data-markdown-copy="inline-code"']) {
      const old = block('old', `<p>Workspace: <span>${delimiter}</span><span>${path}</span></p>`);
      const end = code.split(' ')[0];
      const next = block('new', `<p>Workspace: <${code}>${path}.txt</${end}>. Continue.</p>`);
      const b = new ChatGptMarkdownBuffer();b.observe([old], 0);b.observe([next], 1);
      expect(b.finish().markdown).toBe(chatGptHtmlToMarkdown(next.html));
      for (const changed of [path.replace('run_01', 'run01'), path.replace('\\run_01', '/run_01'), 'C:\\different']) {
        const missing = new ChatGptMarkdownBuffer();missing.observe([old], 0);
        missing.observe([block('new', `<p>Workspace: <${code}>${changed}.txt</${end}></p>`)], 1);
        expect(() => missing.finish()).toThrow('missing previously observed pending content');
      }
    }
  }
});


test("KaTeX inline and display formulas preserve exactly one original LaTeX expression", () => {
  const inline = String.raw`E = mc^2`;
  const display = String.raw`r_{\mathrm{eff}} = \exp\left(-\sum_i q_i \log q_i\right)`;
  expect(chatGptHtmlToMarkdown(`<p>Inline: ${katex(inline)}.</p>${katex(display, true)}`)).toBe(
    `Inline: \\(${inline}\\).\n\n\\[\n${display}\n\\]`,
  );
});

test("math source survives lists, links, nested braces, Unicode, and wiki-shaped expressions", () => {
  const source = String.raw`\operatorname{rank}\left(\frac{α_{i}}{1+β}\right) < 2 \quad [[x]]`;
  expect(chatGptHtmlToMarkdown(
    `<ul><li>Value ${katex(source)}; <a href="https://example.com">reference</a>.</li></ul>`
      + '<p>Open [[Notes/math|notes]].</p>' + katex(`${source}\n+ γ`, true),
  )).toBe(`- Value \\(${source}\\); [reference](https://example.com).\n\n`
    + `Open [notes](<Notes/math.md>).\n\n\\[\n${source}\n+ γ\n\\]`);
  const code = String.raw`\frac{a_b}{c} [[literal]]`;
  expect(chatGptHtmlToMarkdown(`<p><code>${code}</code></p><pre><code>${code}</code></pre>`))
    .toBe(`\`${code}\`\n\n\`\`\`\n${code}\n\`\`\``);
});

test("LaTeX comment newlines survive generic HTML whitespace normalization", () => {
  const source = "a % comment\n+ b";
  expect(chatGptHtmlToMarkdown(katex(source, true))).toBe(`\\[\n${source}\n\\]`);
});

test("unknown or ambiguous KaTeX source fails instead of inventing a formula", () => {
  const formula = katex("x");
  expect(() => chatGptHtmlToMarkdown(formula.replace(/<annotation[^>]*>.*?<\/annotation>/, "")))
    .toThrow("one unambiguous LaTeX source");
  expect(() => chatGptHtmlToMarkdown(formula.replace("</semantics>",
    '<annotation encoding="application/x-tex">y</annotation></semantics>')))
    .toThrow("one unambiguous LaTeX source");
});

test("streaming formulas once still rejects a rewrite of committed math", () => {
  const buffer = new ChatGptMarkdownBuffer(undefined, 0);
  const segment = (source: string) => ({
    key: "formula", tag: "p", text: `ACCESSIBLE_COPY${source}VISUAL_COPY`,
    html: `<p>${katex(source)}</p>`, streamable: true,
  });
  expect(buffer.observe([segment("x_1")], 0)).toBe(String.raw`\(x_1\)`);
  expect(buffer.observe([segment("x_1")], 1)).toBe("");
  buffer.observe([segment("x_2")], 2);
  expect(() => buffer.finish()).toThrow("changed a completed text block");
});

test("repeated report headings can first appear after an earlier copy was committed", () => {
  for (const { count, repeated, tag, text } of [
    { count: 93, repeated: [15, 20, 25, 29], tag: "p", text: "変更済み:" },
    { count: 199, repeated: [40, 83], tag: "h2", text: "Functions" },
  ]) {
    const buffer = new ChatGptMarkdownBuffer(undefined, 0);
    const report = Array.from({ length: count }, (_, index) => {
      const blockTag = repeated.includes(index) ? tag : "p";
      const value = repeated.includes(index) ? text : `Unique block ${index}`;
      return { key: `${index}:${blockTag}`, tag: blockTag, text: value,
        html: `<${blockTag}>${value}</${blockTag}>`, streamable: true };
    });
    for (let length = 2; length <= report.length; length += 1) {
      buffer.observe(report.slice(0, length).map((block, index) => ({
        ...block, streamable: index < length - 1,
      })), length);
      expect(buffer.currentSnapshotIsConsistent()).toBeTrue();
    }
    const expected = report.map(block => chatGptHtmlToMarkdown(block.html)).join("\n\n");
    expect(buffer.finish().markdown).toBe(expected);
    buffer.observe([report[0]!, report[0]!], count + 1);
    expect(() => buffer.finish()).toThrow("changed a completed text block");
  }
});

test("repeated empty Markdown blocks are appended without reusing an earlier block identity", () => {
    const buffer = new ChatGptMarkdownBuffer(markdown => markdown, 0);
    const initial = [
      { key: "0:p", tag: "p", html: "<p>First.</p>", text: "First.", streamable: true },
      { key: "1:hr", tag: "hr", html: "<hr>", text: "", streamable: true },
      { key: "2:p", tag: "p", html: "<p>Second.</p>", text: "Second.", streamable: false },
    ];
    expect(buffer.observe(initial)).toBe("First.\n\n* * *");
    const expanded = [
      ...initial.map(segment => ({ ...segment, streamable: true })),
      { key: "3:hr", tag: "hr", html: "<hr>", text: "", streamable: true },
      { key: "4:p", tag: "p", html: "<p>Third.</p>", text: "Third.", streamable: false },
    ];
    expect(buffer.observe(expanded)).toBe("\n\nSecond.\n\n* * *");
    expect(buffer.currentSnapshotIsConsistent()).toBeTrue();
    expect(buffer.observe(expanded)).toBe("");
    expect(buffer.finish().markdown).toBe("First.\n\n* * *\n\nSecond.\n\n* * *\n\nThird.");
    buffer.observe([expanded[3]!, expanded[1]!]);
    expect(() => buffer.finish()).toThrow("changed a completed text block");
  });

test("repeated paragraphs retain their order after committed blocks disappear", () => {
    const segment = (key: number, text: string, streamable = true) => ({
      key: `${key}:p`, tag: "p", html: `<p>${text}</p>`, text, streamable,
    });
    for (const snapshot of ["complete-snapshot", "missing-prefix", "missing-first-copy"]) {
      const buffer = new ChatGptMarkdownBuffer(markdown => markdown, 0);
      buffer.observe([segment(0, "First"), segment(1, "Same"), segment(2, "Middle", false)], 0);
      buffer.observe([segment(0, "First"), segment(1, "Same"), segment(2, "Middle"), segment(3, "Same", false)], 1);
      if (snapshot === "missing-prefix") buffer.observe([segment(20, "Middle"), segment(21, "Same", false)], 2);
      if (snapshot === "missing-first-copy") buffer.observe([segment(20, "First"), segment(21, "Middle"), segment(22, "Same", false)], 2);
      expect(buffer.finish()).toEqual({ markdown: "First\n\nSame\n\nMiddle\n\nSame", delta: "\n\nSame" });
    }
  });

test("an unchanged report with two None paragraphs does not rebind its pending tail", () => {
    const segment = (index: number, text: string, streamable = true) => ({
      key: `${index}:p`, tag: "p", html: `<p>${text}</p>`, text, streamable,
    });
    for (const none of ["None.", "なし。"]) {
      const buffer = new ChatGptMarkdownBuffer(markdown => markdown, 0);
      const report = [segment(7, "Unverified:"), segment(8, none),
        segment(9, "Remaining risk:"), segment(10, none, false)];
      expect(buffer.observe(report, 0)).toBe(`Unverified:\n\n${none}\n\nRemaining risk:`);
      expect(buffer.observe(report, 1)).toBe("");
      expect(buffer.finish()).toEqual({
        markdown: `Unverified:\n\n${none}\n\nRemaining risk:\n\n${none}`,
        delta: `\n\n${none}`,
      });
    }
  });

test("repeated text cannot hide reordering, changed links, or ambiguous remounted history", () => {
    const segment = (key: string, text: string, linkTargets: string[] = []) => ({
      key, tag: "p", html: `<p>${text}</p>`, text, streamable: true, linkTargets,
    });
    for (const mode of ["reorder", "links", "ambiguous"]) {
      const buffer = new ChatGptMarkdownBuffer(markdown => markdown, 0);
      const original = [segment("a", "Same"), segment("b", "Middle"), segment("c", "Same")];
      buffer.observe(original, 0);
      const changed = mode === "reorder" ? [original[1]!, original[0]!]
        : mode === "links" ? [original[0]!, original[1]!, segment("c", "Same", ["https://changed.example"])]
        : [segment("remounted", "Same")];
      buffer.observe(changed, 1);
      expect(buffer.currentSnapshotIsConsistent()).toBeFalse();
      expect(() => buffer.finish()).toThrow();
    }
  });

test("empty paragraph hydration remains pending without delivering its suffix out of order", () => {
  const buffer = new ChatGptMarkdownBuffer(undefined, 0);
  const block = (key: string, text: string, streamable = true) => ({
    key, tag: "p", html: "<p>" + text + "</p>", text, streamable,
  });
  const before = [block("a", "Before."), block("placeholder", ""), block("b", "Following."), block("c", "Done.", false)];
  expect(buffer.observe(before, 0)).toBe("Before.");
  expect(buffer.observe(before, 1)).toBe("");
  const hydrated = [before[0]!, block("placeholder", "Patched."), before[2]!, before[3]!];
  expect(buffer.observe(hydrated, 2)).toBe("\n\nPatched.\n\nFollowing.");
  expect(buffer.finish().markdown).toBe("Before.\n\nPatched.\n\nFollowing.\n\nDone.");
  buffer.observe([block("a", "Changed!"), ...hydrated.slice(1)], 3);
  expect(() => buffer.finish()).toThrow("changed a completed text block");
});
