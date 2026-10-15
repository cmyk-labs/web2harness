import { afterEach, expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { runInNewContext } from "node:vm";
import { rejects } from "node:assert/strict";
import { ChatGptBrowserWorker, insertPlainTextIntoComposer } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { prepareComposerForInput } from "../../../../src/adapters/chatgpt-web/browser/composer";

/**
 * The composer insert runs inside the page, where the caret state is whatever the last UI
 * interaction left behind. Effort selection closes a menu immediately before a staged part is
 * attached, so these fixtures model the focus and selection states that actually occur there.
 */
interface FakeSelection {
  rangeCount: number;
  isCollapsed: boolean;
  anchorNode: object | null;
  focusNode: object | null;
  removeAllRanges(): void;
  addRange(range: object): void;
}

const originals = { document: globalThis.document, window: globalThis.window };
afterEach(() => {
  (globalThis as Record<string, unknown>).document = originals.document;
  (globalThis as Record<string, unknown>).window = originals.window;
});

function harness(options: {
  focusable: boolean;
  caretInsideComposer: boolean;
  collapsed?: boolean;
  execCommandResult?: boolean;
  connected?: boolean;
  editable?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  textarea?: boolean;
  selectionUnavailable?: boolean;
  selectionRejected?: boolean;
  onFocus?: () => void;
}) {
  const inside = { name: "text-node-inside-composer" };
  let placements = 0;
  const composer = {
    tagName: options.textarea ? "TEXTAREA" : "DIV",
    isConnected: options.connected ?? true,
    isContentEditable: options.editable ?? true,
    readOnly: options.readOnly ?? false,
    matches: () => options.disabled ?? false,
    getAttribute: (name: string) => name === "aria-readonly" && options.readOnly ? "true" : null,
    get ownerDocument() { return fakeDocument; },
    value: "existing draft",
    selectionStart: options.collapsed === false ? 0 : 3,
    selectionEnd: 3,
    setSelectionRange(start: number, end: number) {
      placements += 1;
      if (options.selectionRejected) return;
      composer.selectionStart = start;
      composer.selectionEnd = end;
    },
    focus() {
      if (options.focusable) fakeDocument.activeElement = composer;
      options.onFocus?.();
    },
    contains: (node: object | null) => node === inside || node === composer,
  };
  const calls: Array<{ command: string; value: string }> = [];
  const selection: FakeSelection = {
    rangeCount: 1,
    isCollapsed: options.collapsed ?? true,
    anchorNode: options.caretInsideComposer ? inside : { name: "node-in-the-effort-menu" },
    focusNode: options.caretInsideComposer ? inside : { name: "node-in-the-effort-menu" },
    removeAllRanges() { selection.rangeCount = 0; selection.anchorNode = selection.focusNode = null; },
    addRange() {
      placements += 1;
      if (options.selectionRejected) return;
      selection.rangeCount = 1;
      selection.anchorNode = selection.focusNode = inside;
      selection.isCollapsed = true;
    },
  };
  const fakeDocument = {
    defaultView: { getSelection: () => options.selectionUnavailable ? null : selection },
    activeElement: null as unknown,
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    execCommand(command: string, _ui: boolean, value: string) {
      calls.push({ command, value });
      return options.execCommandResult ?? true;
    },
  };
  (globalThis as Record<string, unknown>).document = fakeDocument;
  (globalThis as Record<string, unknown>).window = { getSelection: () => selection };
  return { composer: composer as unknown as HTMLElement, editor: composer, calls, selection, fakeDocument, placements: () => placements };
}

test("places the caret itself when focus has not yet produced one in the composer", () => {
  // A focusable composer may be ready before the browser has placed a caret inside it.
  const { composer, calls, selection } = harness({ focusable: true, caretInsideComposer: false });

  expect(insertPlainTextIntoComposer(composer, "staged part")).toBeTrue();
  expect(calls).toEqual([{ command: "insertText", value: "staged part" }]);
  expect(selection.isCollapsed).toBeTrue();
});

test("leaves an existing caret inside the composer exactly where it is", () => {
  const { composer, calls, selection } = harness({ focusable: true, caretInsideComposer: true });
  const anchorBefore = selection.anchorNode;

  expect(insertPlainTextIntoComposer(composer, "second part")).toBeTrue();
  expect(selection.anchorNode).toBe(anchorBefore);
  expect(calls).toEqual([{ command: "insertText", value: "second part" }]);
});

test("refuses to insert when the composer cannot take focus at all", () => {
  // A covered or detached composer must still fail rather than have text typed somewhere else.
  const { composer, calls } = harness({ focusable: false, caretInsideComposer: false });

  expect(insertPlainTextIntoComposer(composer, "staged part")).toBeFalse();
  expect(calls).toEqual([]);
});

test("reports a genuinely rejected edit as a failure", () => {
  const { composer } = harness({
    focusable: true,
    caretInsideComposer: true,
    execCommandResult: false,
  });

  expect(insertPlainTextIntoComposer(composer, "staged part")).toBeFalse();
});

for (const state of ["missing", "foreign", "expanded", "foreign-focus"] as const) {
  test(`prepares a collapsed composer caret without inserting text (${state})`, () => {
    const fixture = harness({ focusable: true, caretInsideComposer: state === "expanded" || state === "foreign-focus", collapsed: state !== "expanded" });
    fixture.fakeDocument.activeElement = fixture.composer;
    if (state === "missing") fixture.selection.removeAllRanges();
    if (state === "foreign-focus") fixture.selection.focusNode = {};
    expect(prepareComposerForInput(fixture.composer)).toBeTrue();
    expect(fixture.selection.rangeCount).toBe(1);
    expect(fixture.selection.isCollapsed).toBeTrue();
    expect(fixture.composer.contains(fixture.selection.anchorNode as Node)).toBeTrue();
    expect(fixture.composer.contains(fixture.selection.focusNode as Node)).toBeTrue();
    expect(fixture.placements()).toBe(1);
    expect(fixture.calls).toEqual([]);
  });
}

for (const options of [
  { connected: false }, { editable: false }, { readOnly: true },
  { selectionUnavailable: true }, { selectionRejected: true },
  { textarea: true, connected: false }, { textarea: true, readOnly: true },
  { textarea: true, disabled: true }, { textarea: true, collapsed: false, selectionRejected: true },
]) test(`unavailable input fails closed for preparation and insertion ${JSON.stringify(options)}`, () => {
  const fixture = harness({ focusable: true, caretInsideComposer: false, ...options });
  fixture.fakeDocument.activeElement = fixture.composer;
  expect(prepareComposerForInput(fixture.composer)).toBeFalse();
  expect(insertPlainTextIntoComposer(fixture.composer, "must not be inserted")).toBeFalse();
  expect(fixture.calls).toEqual([]);
});

for (const change of ["detach", "readonly", "blur"] as const) test(`rechecks readiness after focus handlers ${change} the composer`, () => {
  const fixture = harness({ focusable: true, caretInsideComposer: false, onFocus: () => {
    if (change === "detach") fixture.editor.isConnected = false;
    else if (change === "readonly") fixture.editor.isContentEditable = false;
    else fixture.fakeDocument.activeElement = null;
  } });
  expect(insertPlainTextIntoComposer(fixture.composer, "unsafe")).toBeFalse();
  expect(fixture.calls).toEqual([]);
});

for (const textarea of [false, true]) test(`preserves an existing collapsed caret during preparation and insertion (textarea=${textarea})`, () => {
  const fixture = harness({ focusable: true, caretInsideComposer: true, textarea });
  const anchor = fixture.selection.anchorNode;
  expect(prepareComposerForInput(fixture.composer)).toBeTrue();
  expect(insertPlainTextIntoComposer(fixture.composer, "")).toBeTrue();
  expect(fixture.placements()).toBe(0);
  expect(fixture.selection.anchorNode).toBe(anchor);
  expect(fixture.editor.selectionStart).toBe(3);
  expect(fixture.calls).toEqual([{ command: "insertText", value: "" }]);
});

test("textarea caret uses native offsets without requiring a document selection", () => {
  const fixture = harness({ focusable: true, caretInsideComposer: false, textarea: true, collapsed: false, selectionUnavailable: true });
  expect(prepareComposerForInput(fixture.composer)).toBeTrue();
  expect(fixture.editor.selectionStart).toBe(fixture.editor.value.length);
  expect(fixture.editor.selectionEnd).toBe(fixture.editor.value.length);
  expect(fixture.placements()).toBe(1);
});

test("both evaluate entry points serialize with no module closure dependencies", () => {
  for (const entry of [prepareComposerForInput, insertPlainTextIntoComposer]) {
    const fixture = harness({ focusable: true, caretInsideComposer: false });
    const evaluate = runInNewContext(`(${entry.toString()})`);
    expect(evaluate(fixture.composer)).toBeTrue();
    expect(evaluate(fixture.composer, "serialized insert")).toBeTrue();
    expect(fixture.calls).toEqual([{ command: "insertText", value: "serialized insert" }]);
  }
});

// Each 65k multiline insertion can take over 20s on Windows Chromium. Give each
// independent DOM/draft case its own budget instead of timing all four together.
for (const modern of [false, true]) for (const hasStaleDraft of [false, true]) {
  test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(
    "a selected connector never appends a new request to an old draft (modern=" + modern + ", stale=" + hasStaleDraft + ")",
    async () => {
      const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
      try {
        const page = await browser.newPage();
        const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
          config: { appName: "Codex Native2" },
        });
        const prompt = "Task context\n".repeat(5_000) + "\nrequest_id: current";
        const pill = modern
          ? '<span app-mention-path="app://fixture" app-mention-display-name="Codex Native2" contenteditable="false">Codex Native2</span>'
          : '<span data-id="plugin:fixture" data-keyword="Codex Native2" contenteditable="false">Codex Native2</span>';
        const staleDraft = hasStaleDraft ? prompt.replace("current", "earlier") : "";
        await page.setContent(`<form><div id="prompt-textarea" contenteditable="true" style="min-height:40px"></div></form>
          <div id="mention-menu" hidden><div class="__menu-item" tabindex="0" data-highlighted><span>Codex Native2</span></div></div>`);
        await page.locator("#prompt-textarea").evaluate((element, { pill, staleDraft }) => {
          element.innerHTML = pill;
          element.appendChild(document.createTextNode(staleDraft ? " " + staleDraft : ""));
          const menu = document.getElementById("mention-menu")!;
          element.addEventListener("input", () => { menu.hidden = element.textContent !== "@codex"; });
          element.addEventListener("keydown", event => {
            if ((event as KeyboardEvent).key !== "Enter" || menu.hidden) return;
            event.preventDefault();
            element.innerHTML = pill;
            menu.hidden = true;
          });
        }, { pill, staleDraft });
        await worker.attachPrompt(page, prompt, true);
        expect(await worker.attachedPromptText(page)).toBe(prompt);
        expect(await worker.connectorIsSelected(page.locator("#prompt-textarea"))).toBeTrue();
      } finally { await browser.close(); }
    },
    45_000,
  );
}

for (const kind of ["plain", "whitespace", "textarea", "connector", "blocked-delete", "replacement-draft", "cancelled"] as const) {
  test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`verified native cleanup handles ${kind} without submitting`, async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
    try {
      const page = await browser.newPage();
      const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), { config: { appName: "Codex Native2" } });
      await page.setContent('<form><div id="prompt-textarea" contenteditable="true" style="min-height:40px"></div></form>');
      await page.evaluate(kind => {
        let editor = document.getElementById("prompt-textarea")!;
        if (kind === "textarea") {
          const textarea = document.createElement("textarea");
          textarea.id = editor.id;
          textarea.value = "previous request";
          editor.replaceWith(textarea);
          editor = textarea;
        } else editor.textContent = kind === "whitespace" ? " \u00a0\n" : "previous request";
        if (kind === "connector") editor.innerHTML = '<span contenteditable="false" app-mention-path="app://fixture" app-mention-display-name="Codex Native2">Codex Native2</span> old draft';
        if (kind === "blocked-delete") editor.addEventListener("keydown", event => {
          if ((event as KeyboardEvent).key === "Backspace") event.preventDefault();
        });
        if (kind === "replacement-draft") editor.addEventListener("input", () => {
          const replacement = editor.cloneNode(false) as HTMLElement;
          replacement.textContent = "restored stale draft";
          editor.replaceWith(replacement);
        }, { once: true });
        (window as any).__submissions = 0;
        document.querySelector("form")!.addEventListener("submit", event => {
          event.preventDefault(); (window as any).__submissions++;
        });
      }, kind);
      const controller = new AbortController();
      if (kind === "cancelled") controller.abort();
      const clear = worker.clearChatGptComposerState(page, controller.signal);
      if (kind === "cancelled") await rejects(clear, { name: "AbortError" });
      else if (kind === "blocked-delete" || kind === "replacement-draft") {
        await rejects(clear, { code: "prompt_attachment_integrity", retryable: false });
      } else await clear;
      const remaining = await page.locator("#prompt-textarea").evaluate(element => element instanceof HTMLTextAreaElement ? element.value : element.textContent);
      expect(remaining).toBe(kind === "replacement-draft" ? "restored stale draft"
        : kind === "blocked-delete" || kind === "cancelled" ? "previous request" : "");
      expect(await page.evaluate(() => (window as any).__submissions)).toBe(0);
      if (kind === "cancelled") {
        await worker.clearChatGptComposerState(page);
        expect(await worker.attachedPromptText(page)).toBe("");
      }
    } finally { await browser.close(); }
  }, 15_000);
}
