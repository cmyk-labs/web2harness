import { expect, test } from "bun:test";
import { chromium, type Locator, type Page } from "playwright-core";
import { ChatGptBrowserObservationTimeoutError, ChatGptBrowserWorker, chatGptTurnIsComplete } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { readFileSync } from "node:fs";
import { ChatGptMarkdownBuffer } from "../../../../src/adapters/chatgpt-web/markdown";
import { readChatGptResponseDom, disposeChatGptResponseDom, type ChatGptResponseDomCache } from "../../../../src/adapters/chatgpt-web/browser/response-dom";
import { CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_ANSWER_ROOT_SELECTOR, readUnverifiedAnswerText } from "../../../../launcher/shared/chatgpt-answer-dom.cjs";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("DOM observers belong to their task and absent roots never reuse cached content", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<section id="owned"><div class="markdown"><p>Answer</p><img src="https://example.com/a.png" alt="A"></div></section>'
      + '<section id="other"><div class="markdown">Other</div></section>');
    const own: ChatGptResponseDomCache = {}, other: ChatGptResponseDomCache = {};
    const owned = page.locator("#owned");
    await readChatGptResponseDom(owned, own);
    await readChatGptResponseDom(page.locator("#other"), other);
    await page.locator("#owned img").evaluate(image => image.setAttribute("src", "https://example.com/b.png"));
    expect((await readChatGptResponseDom(owned, own)).fullHtml).toContain("/b.png");
    await owned.evaluate(element => element.remove());
    const absent = await readChatGptResponseDom(owned, own);
    expect(absent.contentState).toBe("absent");
    expect(absent.markdownSegments).toEqual([]);
    const count = () => page.evaluate(() => (globalThis as any).__WEB2HARNESS_RESPONSE_OBSERVERS__.states.size);
    expect(await count()).toBe(2);
    await disposeChatGptResponseDom(page, own);
    expect(await count()).toBe(1);
    expect((await readChatGptResponseDom(page.locator("#other"), other)).visibleText).toBe("Other");
    await disposeChatGptResponseDom(page, other);
    await readChatGptResponseDom(page.locator("#other")); // one-shot reads install no listener
    expect(await count()).toBe(0);
  } finally { await browser.close(); }
});

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("a buffered final report survives wrapper replacement and cached link/range updates stay observable", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    const paragraphs = Array.from({ length: 180 }, (_, i) => `<p>Report paragraph ${i}.</p>`).join("");
    await page.setContent(`<section id="turn"><div class="markdown">${paragraphs}</div><button data-testid="copy-turn-action-button">Copy</button></section>`);
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const root = page.locator("#turn"), cache = {};
    const buffer = new ChatGptMarkdownBuffer(undefined, "buffered");
    const initial = await worker.responseDomSnapshot(root, cache);
    expect(buffer.observe(initial.markdownSegments)).toBe("");
    // A complete final wrapper replacement is allowed before delivery; node keys do not freeze drafts.
    await page.locator(".markdown").evaluate((node, body) => { node.innerHTML = `<div role="group">${body}</div>`; }, paragraphs);
    const final = await worker.responseDomSnapshot(root, cache);
    expect(final.completionActionVisible).toBeTrue();
    expect(buffer.observe(final.markdownSegments)).toBe("");
    const answer = buffer.finish();
    expect(answer.delta).toBe(answer.markdown);
    expect(answer.markdown).toBe(Array.from({ length: 180 }, (_, i) => `Report paragraph ${i}.`).join("\n\n"));
    expect(buffer.deliveryState().emittedChars).toBe(answer.markdown.length);
    expect(buffer.finish().delta).toBe("");
    await page.locator(".markdown").evaluate(node => { node.innerHTML = '<p data-start="0" data-end="20"><a href="https://example.com/a">Link</a></p><p>End</p>'; });
    const linked = await worker.responseDomSnapshot(root, cache);
    expect(linked.markdownSegments[0].linkTargets).toEqual(["https://example.com/a"]);
    await page.locator("a").evaluate(node => node.setAttribute("href", "https://example.com/b"));
    const changedLink = await worker.responseDomSnapshot(root, cache);
    expect(changedLink.markdownSegments[0].linkTargets).toEqual(["https://example.com/b"]);
    await page.locator("p").first().evaluate(node => { node.setAttribute("data-start", "3"); node.setAttribute("data-end", "22"); });
    expect((await worker.responseDomSnapshot(root, cache)).markdownSegments[0]).toMatchObject({ sourceStart: 3, sourceEnd: 22 });
    await page.locator(".markdown").evaluate(node => { node.innerHTML = '<p>First</p><p>Pending tail</p>'; });
    const coverage = new ChatGptMarkdownBuffer(undefined, "buffered");
    coverage.observe((await worker.responseDomSnapshot(root, cache)).markdownSegments);
    await page.locator(".markdown p").last().evaluate(node => node.remove());
    coverage.observe((await worker.responseDomSnapshot(root, cache)).markdownSegments);
    expect(coverage.prepareFinal().markdown).toBe("First");
    await page.locator(".markdown").evaluate(node => node.insertAdjacentHTML('beforeend', '<p>Pending tail</p>'));
    coverage.observe((await worker.responseDomSnapshot(root, cache)).markdownSegments);
    expect(coverage.finish().markdown).toBe("First\n\nPending tail");
    const codeBuffer = new ChatGptMarkdownBuffer(undefined, "buffered");
    for (const [i, value] of [undefined, '{"calls":[', '{"calls":[]}'].entries()) {
      await page.locator('.markdown').evaluate((node, value) => {
        node.innerHTML = '<div><div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div>codex_tool_calls</div><button>Copy</button></div>'
          + (value === undefined ? '' : `<code>${value}</code>`) + '</div></div>';
      }, value);
      codeBuffer.observe((await worker.responseDomSnapshot(root, cache)).markdownSegments);
      expect(codeBuffer.deliveryState().emittedChars).toBe(0);
    }
    expect(codeBuffer.finish().markdown).toBe('```codex_tool_calls\n{"calls":[]}\n```');
    await page.locator('.markdown').evaluate(node => { node.innerHTML = '<p><span>Read </span><code>input.txt</code><span>.</span></p><p>Output `ASSERT_CO</p>'; });
    const formatting = new ChatGptMarkdownBuffer(undefined, "buffered");
    formatting.observe((await worker.responseDomSnapshot(root, cache)).markdownSegments);
    await page.locator('.markdown').evaluate(node => { node.innerHTML = '<p>Read <span data-markdown-copy="inline-code">input.txt</span>.</p><p>Output <span data-markdown-copy="inline-code">ASSERT_COVERAGE</span>.</p>'; });
    formatting.observe((await worker.responseDomSnapshot(root, cache)).markdownSegments);
    expect(formatting.finish().markdown).toBe('Read `input.txt`.\n\nOutput `ASSERT_COVERAGE`.');
    for (const html of [
      '<section data-testid="conversation-turn-1" data-turn="assistant"><div class="markdown">Unverified answer</div><button>Copy</button></section>',
      '<section data-turn-key="current"><div data-user-message-bubble>PRIVATE USER</div><div><i data-chatgpt-agent-turn-start></i><div data-markdown-text-style="assistant-message">Activity</div></div><div data-content-search-unit-key="answer"><i data-conversation-role="assistant"></i><div data-markdown-text-style="assistant-message">Unverified answer</div></div></section>',
    ]) {
      await page.setContent(html);
      expect(await page.evaluate(readUnverifiedAnswerText, { turnSelector: CHATGPT_ASSISTANT_TURN_SELECTOR,
        answerSelector: CHATGPT_ANSWER_ROOT_SELECTOR })).toBe("Unverified answer");
    }
  } finally { await browser.close(); }
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("a whole historical group remounted after Send cannot become the accepted answer", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    for (const acceptedPresent of [true, false]) {
      const page = await browser.newPage();
      const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
      await page.setContent('<main></main>');
      const baseline = await worker.captureSubmissionBaseline(page, "Current prompt");
      const current = '<div data-turn-key="current"><div data-user-message-bubble>Current prompt</div></div>';
      await page.locator('main').evaluate((node, html) => { node.innerHTML = html; }, current);
      expect(await worker.currentSubmissionEvidence(page, baseline)).toBe("user_turn");
      // The older whole shell was absent during the baseline, not merely empty.
      await page.locator('main').evaluate((node, html) => { node.innerHTML = html; },
        (acceptedPresent ? current : '') + '<div data-turn-key="older"><div data-user-message-bubble>Earlier prompt</div><div data-conversation-role="assistant"></div><div class="markdown">Earlier answer</div><div class="turn-action-controls"><button>Copy</button></div></div>');
      await expect(worker.waitForNewAssistantTurn(page, baseline, Date.now() + 2000)).rejects.toThrow("does not belong");
      await expect(worker.currentSubmissionAnswerText(page, baseline)).rejects.toThrow("does not belong");
      await expect(worker.reconcileAssistantTurnBinding(page, baseline, {
        identity: "group:assistant:older", locator: page.locator('[data-turn-key="older"]'), acceptedTurnIdentities: [],
      })).rejects.toThrow("does not belong");
      await page.close();
    }
  } finally { await browser.close(); }
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("activity tone and collapsed content invalidate the response cache", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(readFileSync(new URL("../../../fixtures/chatgpt-activity-summaries.html", import.meta.url), "utf8"));
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const cache = {};
    const turn = page.locator("#turn");
    const observe = () => worker.responseDomSnapshot(turn, cache);
    const first = await observe();
    expect(first.traceBlocks.filter((block: any) => block.kind === "status")).toHaveLength(10);
    expect((await observe()).traceBlocks).toEqual(first.traceBlocks);
    const summary = page.locator('[data-markdown-text-style="assistant-message"]')
      .filter({ has: page.getByText("status 1", { exact: true }) });
    await summary.evaluate(node => node.setAttribute("data-markdown-text-tone", "primary"));
    expect((await observe()).traceBlocks.find((block: any) => block.text === "status 1")?.kind).toBe("commentary");
    await summary.evaluate(node => node.setAttribute("data-markdown-text-tone", "tertiary"));
    expect((await observe()).traceBlocks.find((block: any) => block.text === "status 1")?.kind).toBe("status");
    await summary.evaluate(node => { node.parentElement!.hidden = true; });
    const collapsed = await observe();
    expect(collapsed.traceBlocks.some((block: any) => block.kind === "status" || block.kind === "commentary")).toBeFalse();
    expect(collapsed.visibleText).toBe("answer 1");
    await summary.evaluate(node => { node.parentElement!.hidden = false; });
    expect((await observe()).traceBlocks).toEqual(first.traceBlocks);
  } finally { await browser.close(); }
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("preserves the accepted user identity across Activity's temporary fallback group", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const prompt = "Read first.txt.\n\nReturn its contents.";
    // Captured on the installed launcher: the user group appears at Send, disappears
    // during Activity, then returns with the same ID and a rich-text user bubble.
    const user = '<div data-user-message-bubble><div data-search-result-target><p><span data-prompt-link-href="app://test">Codex Native</span> Read first.txt.<br>Return its contents.</p></div></div>';
    const answer = '<div data-content-search-unit-key="fallback-turn-0:2:assistant"><div data-conversation-role="assistant"></div><div data-markdown-text-style="assistant-message"><p>FIRST fixture-marker</p></div></div><div class="turn-action-controls"><button>Copy</button></div>';
    for (const scenario of ["same-user", "different-user", "competing-turn", "old-group-remains", "unfinished", "streaming"] as const) {
      const page = await browser.newPage();
      await page.setContent('<main></main>');
      const baseline = await worker.captureSubmissionBaseline(page, prompt);
      await page.locator("main").evaluate((node, html) => { node.innerHTML = html; }, `<div data-turn-key="submitted">${user}</div>`);
      expect(await worker.currentSubmissionEvidence(page, baseline)).toBe("user_turn");
      await page.locator("main").evaluate(node => { node.innerHTML = '<div data-turn-key="fallback-turn-0"><span hidden data-chatgpt-agent-turn-start></span></div>'; });
      const binding = await worker.waitForNewAssistantTurn(page, baseline, Date.now() + 2000);
      expect(binding.identity).toBe("group:assistant:fallback-turn-0");
      const key = scenario === "different-user" ? "unrelated" : "submitted";
      const renderedUser = scenario === "different-user"
        ? `<div data-user-message-bubble><div data-search-result-target style="white-space:pre-wrap">${prompt}</div></div>`
        : user;
      const response = scenario === "unfinished" ? '<span hidden data-chatgpt-agent-turn-start></span>'
        : scenario === "streaming" ? answer.replace('<div class="turn-action-controls"><button>Copy</button></div>', "") : answer;
      let replacement = `<div data-turn-key="${key}">${renderedUser}${response}</div>`;
      if (scenario === "competing-turn") replacement += `<div data-turn-key="other">${user}</div>`;
      if (scenario === "old-group-remains") replacement += '<div data-turn-key="fallback-turn-0"></div>';
      await page.locator("main").evaluate((node, html) => { node.innerHTML = html; }, replacement);
      const result = worker.reconcileAssistantTurnBinding(page, baseline, binding);
      if (["same-user", "unfinished", "streaming"].includes(scenario)) {
        expect((await result).identity).toBe("group:assistant:submitted");
      } else {
        await expect(result).rejects.toThrow("another user turn");
      }
      await page.close();
    }
  } finally { await browser.close(); }
}, 15_000);

// Execute the real observation/rebinding code against the reported renderer transition.
// No account, network requests, or model submissions are used.
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("an exchange rekeys only with the exact submitted prompt and no competing turn", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const worker = Object.create(ChatGptBrowserWorker.prototype) as {
      captureSubmissionBaseline(page: Page, submittedText?: string): Promise<unknown>;
      waitForNewAssistantTurn(page: Page, baseline: unknown, deadline: number): Promise<Binding>;
      reconcileAssistantTurnBinding(page: Page, baseline: unknown, binding: Binding): Promise<Binding>;
    };
    type Binding = { identity: string; locator: Locator; acceptedTurnIdentities: string[] };
    const prompt = "Explain one thing.\nKeep  two spaces.";
    const group = (key: string, text?: string, complete = false) => `<div data-turn-key="${key}">
      ${text === undefined ? "" : `<div data-user-message-bubble><div data-search-result-target style="white-space:pre-wrap">${text}</div><span aria-hidden="true">\u200b</span><button>Show more</button></div>`}
      <div data-content-search-unit-key="${key}:assistant"><div data-conversation-role="assistant"></div>
      <div data-markdown-text-style="assistant-message"><p>Answer.</p></div></div>
      ${complete ? '<div class="turn-action-controls"><button>Copy</button></div>' : ""}</div>`;
    for (const scenario of ["matching", "history", "foreign", "prefix-only", "changed-spaces", "changed-edges", "two-turns", "old-group-remains", "unfinished", "no-prompt", "same-key"] as const) {
      const page = await browser.newPage();
      const history = scenario === "history" ? group("earlier", prompt, true) : "";
      await page.setContent(`<main>${history}</main>`);
      const baseline = await worker.captureSubmissionBaseline(page, scenario === "no-prompt" ? undefined : prompt);
      await page.locator("main").evaluate((node, html) => { node.innerHTML = html; }, history + group("optimistic"));
      const binding = await worker.waitForNewAssistantTurn(page, baseline, Date.now() + 5000);
      expect(binding.identity).toBe("group:assistant:optimistic");
      const text = scenario === "foreign" ? "Different task."
        : scenario === "prefix-only" ? prompt + " Another request."
        : scenario === "changed-spaces" ? prompt.replace("  ", " ")
        : scenario === "changed-edges" ? " " + prompt : prompt;
      let html = history + group(scenario === "same-key" ? "optimistic" : "persisted", text, scenario !== "unfinished");
      if (scenario === "two-turns") html += group("foreign", prompt, true);
      if (scenario === "old-group-remains") html += '<div data-turn-key="optimistic"><div data-user-message-bubble>Earlier</div></div>';
      await page.locator("main").evaluate((node, next) => { node.innerHTML = next; }, html);
      const result = worker.reconcileAssistantTurnBinding(page, baseline, binding);
      if (scenario === "matching" || scenario === "history" || scenario === "same-key" || scenario === "unfinished") {
        const rebound = await result;
        expect(rebound.identity).toBe(`group:assistant:${scenario === "same-key" ? "optimistic" : "persisted"}`);
        expect(await rebound.locator.count()).toBe(1);
      } else {
        await expect(result).rejects.toThrow();
      }
      await page.close();
    }
  } finally { await browser.close(); }
}, 30_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("binds captured Activity before an answer exists and recognizes uploaded native-button tiles", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => new URL(request.url).pathname === "/backend-api/files/process_upload_stream"
    ? new Response(JSON.stringify({ event: "file.processing.completed", file_id: "fixture-file" }) + "\n", { headers: { "content-type": "application/x-ndjson" } })
    : new Response("<main></main>", { headers: { "content-type": "text/html" } }) });
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}`);
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    await page.setContent('<main></main>');
    const baseline = await worker.captureSubmissionBaseline(page, "Prompt");
    const html = readFileSync(new URL("../../../fixtures/chatgpt-power-activity.html", import.meta.url), "utf8");
    await page.locator("main").evaluate((node, content) => { node.innerHTML = content; }, html);
    const binding = await worker.waitForNewAssistantTurn(page, baseline, Date.now() + 2000);
    expect(binding.identity).toBe("group:assistant:activity");
    expect((await worker.responseDomSnapshot(binding.locator)).traceBlocks.some((block: { kind: string }) => block.kind === "commentary")).toBeTrue();
    for (const tile of ['button', 'div role="button"']) {
      await page.setContent(`<form data-chatgpt-composer><div data-composer-markdown contenteditable="true" role="textbox" style="height:40px">Prompt</div>
        <input type="file" multiple><${tile} class="composer-attachment-surface" aria-label="codex-input-image-1.png">File</${tile.split(' ')[0]}>
        <button type="submit">Send</button></form>`);
      await page.locator('input[type="file"]').evaluate(input => {
        input.addEventListener("change", () => void fetch("/backend-api/files/process_upload_stream", {
          method: "POST", body: JSON.stringify({ file_name: "codex-input-image-1.png", file_id: "fixture-file" }),
        }));
      });
      await worker.attachFiles(page, { images: [{ ref: "codex-input-image-1", imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }] });
      expect(await page.locator('input[type="file"]').evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe("codex-input-image-1.png");
    }
  } finally { await browser.close(); server.stop(true); }
}, 15_000);

// P5 incident: the reply finished while the observation transport was unavailable.
// Keep the actual DOM scanning, identity binding, and completion projection; inject only
// the observation timeout and the owned-page reconnect (no account or network needed).
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("same-page recovery adopts a reply completed during the gap without adopting old or competing replies", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const answer = (key: string) => `<div data-turn-key="${key}">
      <div data-user-message-bubble><div data-search-result-target>Current prompt</div></div>
      <div data-content-search-unit-key="${key}:assistant"><div data-conversation-role="assistant"></div>
      <div data-markdown-text-style="assistant-message"><p>Completed ${key}.</p></div></div>
      <div class="turn-action-controls"><button>Copy</button></div></div>`;
    for (const scenario of ["completed", "history-only", "competing", "cancelled", "bound-completed"] as const) {
      const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
      const original = await browser.newPage();
      const rebound = await browser.newPage();
      // Virtualization retains the historical identity while removing its contents.
      await original.setContent('<main><div data-turn-key="history"></div></main>');
      const baseline = await worker.captureSubmissionBaseline(original, "Current prompt");
      await original.locator("main").evaluate(node => {
        node.insertAdjacentHTML("beforeend", '<div data-turn-key="current"><div data-user-message-bubble>Current prompt</div></div>');
      });
      expect(await worker.currentSubmissionEvidence(original, baseline)).toBe("user_turn");
      expect(baseline.acceptedUserIdentity).toBe("group:user:current");
      let binding: any;
      if (scenario === "bound-completed") {
        await original.locator('[data-turn-key="current"]').evaluate(node => {
          node.insertAdjacentHTML("beforeend", '<span hidden data-chatgpt-agent-turn-start></span>');
        });
        binding = await worker.waitForNewAssistantTurn(original, baseline, Date.now() + 2000);
      }
      await rebound.setContent(`<main>${answer("history")}${scenario === "history-only" ? "" : answer("current")}${scenario === "competing" ? answer("foreign") : ""}</main>`);
      const recoveredBaseline = worker.reboundSubmissionBaseline(rebound, baseline);
      expect(recoveredBaseline.initialTurnIdentities).toBe(baseline.initialTurnIdentities);
      expect(recoveredBaseline.acceptedUserIdentity).toBe(baseline.acceptedUserIdentity);
      expect(recoveredBaseline.submittedText).toBe(baseline.submittedText);
      expect(recoveredBaseline.domCache).not.toBe(baseline.domCache);
      expect(recoveredBaseline.domCache).toEqual({});
      const abort = new AbortController();
      let recoveries = 0;
      if (scenario === "bound-completed") {
        binding = await worker.reconcileAssistantTurnBinding(rebound, recoveredBaseline, {
          ...binding, locator: rebound.locator('[data-turn-key="current"]'),
        });
      } else {
        const scan = worker.submissionDomState.bind(worker);
        worker.submissionDomState = async (page: Page, ...args: unknown[]) => {
          if (page === original) throw new ChatGptBrowserObservationTimeoutError(1);
          return scan(page, ...args);
        };
        const result = worker.waitForNewAssistantTurn(original, baseline, Date.now() + 3000, abort.signal,
          undefined, 0, undefined, async (attempt: number, cause: Error, previous: unknown) => {
            recoveries++;
            expect(attempt).toBe(1);
            expect(cause).toBeInstanceOf(ChatGptBrowserObservationTimeoutError);
            expect(previous).toBe(baseline);
            if (scenario === "cancelled") abort.abort();
            return { page: rebound, baseline: recoveredBaseline };
          });
        if (scenario === "history-only") await expect(result).rejects.toThrow("did not expose its assistant turn");
        else if (scenario === "competing") await expect(result).rejects.toThrow("2 new conversation turns");
        else if (scenario === "cancelled") await expect(result).rejects.toThrow("aborted");
        else binding = await result;
        expect(recoveries).toBe(1);
      }
      if (binding) {
        expect(binding.identity).toBe("group:assistant:current");
        const snapshot = await worker.responseDomSnapshot(binding.locator, {});
        expect(snapshot.visibleText).toBe("Completed current.");
        expect(chatGptTurnIsComplete({
          responsePresent: snapshot.responsePresent, running: false,
          normalCompletion: true, completionRevision: 1,
        })).toBeTrue();
      }
      await original.close();
      await rebound.close();
    }
  } finally { await browser.close(); }
}, 30_000);

// Adapted from miuuyy/codex-chatgpt-web f137c2f (MIT); exact-text path only.
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("collapsed plugin messages rebind only after their complete text is verified", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    worker.config = { appName: "Clew review" };
    const prompt = "Verify the entire message.\n\n" + "alpha  beta\n".repeat(1_000) + "END_MARKER";
    // Structure captured in the DEV launcher on 2026-10-15. The user content is
    // removed from the DOM when collapsed; the plugin and blank-line spans are real.
    const render = (value: string) => '<div data-markdown-text-tone="user-message" class="rich-text-user-turn">'
      + value.split("\n\n").map((paragraph, i) => (i ? '<span data-markdown-copy="blank-lines">\n</span>' : "")
        + '<p>' + (i ? "" : '<a href="/plugins/fixture"><span data-prompt-link-href="app://fixture">Clew review</span></a>  ')
        + paragraph.split("\n").map(line => `<span>${line}</span>`).join("<br>") + '</p>').join("") + '</div>';
    for (const scenario of ["complete", "different-tail", "changed-spaces", "wrong-plugin", "still-truncated", "competing-turn"] as const) {
      const page = await browser.newPage();
      await page.setContent('<main></main>');
      const baseline = await worker.captureSubmissionBaseline(page, prompt);
      await page.locator('main').evaluate(e => { e.innerHTML = '<div data-turn-key="optimistic"><span hidden data-chatgpt-agent-turn-start></span></div>'; });
      const binding = await worker.waitForNewAssistantTurn(page, baseline, Date.now() + 2_000);
      const collapsed = render(prompt.slice(0, 10_000));
      await page.locator('main').evaluate((e, html) => { e.innerHTML = html; }, `<div data-turn-key="persisted">
        <div data-user-message-bubble><div data-search-result-target>${collapsed}</div>
        <button type="button" aria-expanded="false" data-thread-find-skip="true" data-markdown-copy="exclude">Показать ещё</button></div>
        <div data-conversation-role="assistant"></div><div data-markdown-text-style="assistant-message">Complete answer</div></div>`);
      let expanded = render(scenario === "different-tail" ? prompt.replace("END_MARKER", "OTHER_TASK")
        : scenario === "changed-spaces" ? prompt.replace("alpha  beta", "alpha beta")
        : scenario === "still-truncated" ? prompt.slice(0, 10_000) : prompt);
      if (scenario === "wrong-plugin") expanded = expanded.replace("Clew review", "Other plugin");
      await page.locator('button').evaluate((button, { html, competing }) => {
        button.addEventListener('click', () => {
          button.setAttribute('aria-expanded', 'true');
          button.parentElement!.querySelector('[data-search-result-target]')!.innerHTML = html;
          if (competing) document.querySelector('main')!.insertAdjacentHTML('beforeend', '<div data-turn-key="other"><div data-user-message-bubble>Another task</div></div>');
        });
      }, { html: expanded, competing: scenario === "competing-turn" });
      const result = await worker.reconcileAssistantTurnBinding(page, baseline, binding)
        .then((value: unknown) => ({ value }), (error: Error) => ({ error }));
      if (scenario === "complete") expect(result.value).toMatchObject({ identity: "group:assistant:persisted" });
      else expect(result.error).toBeInstanceOf(Error);
      await page.close();
    }
  } finally { await browser.close(); }
}, 20_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("plain user code blocks preserve the full submitted code and whitespace", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const prompt = 'Literal header\n\n```json\n{"value":"a  b"}\n```\n\n\tEnd.';
    // Captured plain user-message renderer: only fenced code becomes an HTML block.
    await page.setContent('<div id="group"><div data-user-message-bubble><div data-search-result-target>'
      + 'Literal header\n\n<pre data-markdown-copy="code-block"><code data-markdown-copy-content="true" data-language="json">{"value":"a  b"}</code></pre>\n\n\tEnd.</div></div></div>');
    expect(await worker.userMessageMatchesSubmission(page.locator('#group'), prompt)).toBeTrue();
    expect(await worker.userMessageMatchesSubmission(page.locator('#group'), prompt.replace('a  b', 'a b'))).toBeFalse();
  } finally { await browser.close(); }
});
