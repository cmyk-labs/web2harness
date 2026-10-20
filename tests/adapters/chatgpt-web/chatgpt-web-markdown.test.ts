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

function katex(source: string, display = false): string {
  const escaped = source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const math = '<span class="katex"><span class="katex-mathml"><math><semantics>'
    + '<mrow><mi>ACCESSIBLE_COPY</mi><mo>\u2061</mo></mrow>'
    + `<annotation encoding="application/x-tex">${escaped}</annotation>`
    + '</semantics></math></span><span class="katex-html" aria-hidden="true">VISUAL_COPY\u200b</span></span>';
  return display ? `<span class="katex-display">${math}</span>` : math;
}

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


const block = (text: string, streamable = false) => ({ key: text, text, html: `<p>${text}</p>`, streamable });

test("a buffered final snapshot may replace, reorder or remove un-emitted drafts", () => {
  const buffer = new ChatGptMarkdownBuffer(undefined, "buffered");
  expect(buffer.observe([block("Draft"), block('<a href="https://old.example/">link</a>')])).toBe("");
  expect(buffer.observe([block('<a href="https://new.example/">link</a>'), block("Final")])).toBe("");
  const final = { markdown: "[link](https://new.example/)\n\nFinal", delta: "[link](https://new.example/)\n\nFinal" };
  expect(buffer.prepareFinal()).toEqual(final);
  expect(buffer.prepareFinal()).toEqual(final);
  expect(buffer.finish()).toEqual(final);
  expect(buffer.finish().delta).toBe("");
});

test("merge, split and remount of complete final wrappers do not require draft prefix equality", () => {
  const buffer = new ChatGptMarkdownBuffer(undefined, "buffered");
  buffer.observe([block("obsolete")]);
  buffer.observe([{ ...block("AlphaBeta"), html: "<div><p>Alpha</p><p>Beta</p></div>" }]);
  expect(buffer.finish().markdown).toBe("Alpha\n\nBeta");
});

test("append preserves actual output and rejects changed emitted links or reordering", () => {
  for (const changed of [[block("B", true), block("A")], [block('<a href="https://new.example/">A</a>', true), block("B")]]) {
    const buffer = new ChatGptMarkdownBuffer();
    const first = block('<a href="https://old.example/">A</a>', true);
    expect(buffer.observe([first, block("B")])).toBe("[A](https://old.example/)");
    expect(() => buffer.observe(changed)).toThrow("already emitted");
    expect(buffer.failureEvidence()?.conflict?.reason).toBe("emitted_content_changed");
  }
});

test("pending formatted text can change freely while an emitted prefix remains exact", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const first = block("First", true);
  expect(buffer.observe([first, block("**Part")])).toBe("First");
  expect(buffer.observe([first, { ...block("Complete"), html: "<p><strong>Completely revised</strong></p>" }])).toBe("");
  expect(buffer.finish()).toEqual({ markdown: "First\n\n**Completely revised**", delta: "\n\n**Completely revised**" });
});

test("no historical block ledger can manufacture a missing final snapshot", () => {
  const buffer = new ChatGptMarkdownBuffer(undefined, "buffered");
  buffer.observe([block("Old complete-looking draft", true)]);
  buffer.observe([]);
  expect(buffer.prepareFinal()).toEqual({ markdown: "", delta: "" });
  // Completeness/empty-final decisions belong to the bound source and worker, not draft age.
});

test("literal code, formulas and repeated blocks survive final serialization once", () => {
  const buffer = new ChatGptMarkdownBuffer(undefined, "buffered");
  const code = String.raw`C:\work\a_b.ts \\ **literal**`;
  buffer.observe([block("Same"), { ...block(code), html: `<pre><code class="language-ts">${code}</code></pre>` },
    { ...block("math"), html: katex("x_1 + y", true) }, block("Same")]);
  const final = buffer.finish();
  expect(final.markdown).toContain(`\`\`\`ts\n${code}\n\`\`\``);
  expect(final.markdown.match(/Same/g)).toHaveLength(2);
  expect(final.markdown).toContain("\\[\nx_1 + y\n\\]");
  expect(buffer.finish().delta).toBe("");
});

test("semantic images retain their reference and unknown renderers cannot disappear silently", () => {
  expect(chatGptHtmlToMarkdown('<p>Figure</p><img src="https://example.com/plot.png" alt="plot">')).toContain("![plot](https://example.com/plot.png)");
  expect(chatGptHtmlToMarkdown('<p>Text<svg aria-hidden="true"><path></path></svg></p>')).toBe("Text");
  for (const html of ['<svg role="img"><title>Chart</title></svg>', '<canvas></canvas>', '<img src="blob:private">']) {
    expect(() => chatGptHtmlToMarkdown(html)).toThrow();
  }
});
