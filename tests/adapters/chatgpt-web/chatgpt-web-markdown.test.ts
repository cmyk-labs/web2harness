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
