import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { chromium, type Page } from "playwright-core";
import { armCompletionAnnouncement, hasFreshCompletionAnnouncement, disposeCompletionAnnouncement } from "../../../../src/adapters/chatgpt-web/browser/completion-announcement";

const status = (text: string) => `<span role="status" aria-live="polite" aria-atomic="true">${text}</span>`;

/** Execute the production evaluate callbacks in an isolated DOM, without a browser.
 * Mutations are delivered explicitly so removal and reinsertion can span observer batches. */
function fixture(html = "") {
  const { createWindow } = require("@mixmark-io/domino");
  const window = createWindow(html);
  const observers: Array<{ active: boolean; callback: () => void }> = [];
  const context = createContext({
    window,
    document: {
      querySelectorAll: (selector: string) => window.document.querySelectorAll(selector),
      body: {
        // Domino lacks Element :scope support. Preserve the production selector's
        // direct-body-child semantics with the equivalent document query.
        querySelectorAll: (selector: string) => {
          if (!selector.startsWith(":scope > ")) throw new Error("Expected a direct-body-child selector");
          return window.document.querySelectorAll(selector.replace(/^:scope/, "body"));
        },
      },
    },
    MutationObserver: class {
      private state: { active: boolean; callback: () => void };
      constructor(callback: () => void) {
        this.state = { active: false, callback };
        observers.push(this.state);
      }
      observe() { this.state.active = true; }
      disconnect() { this.state.active = false; }
    },
  });
  const page = {
    evaluate: async (callback: Function, argument: unknown) => (
      runInContext(`(${callback.toString()})`, context)(argument)
    ),
  } as unknown as Page;
  return {
    page,
    mutate(action: (document: Document) => void) {
      action(window.document);
      observers.filter(observer => observer.active).forEach(observer => observer.callback());
    },
    activeObservers: () => observers.filter(observer => observer.active).length,
  };
}

test.each(["回答已完成", "Answer complete", "Response complete"])("initial empty announcement can complete: %s", async label => {
  const f = fixture(status(""));
  const key = await armCompletionAnnouncement(f.page);
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.querySelector("span")!.textContent = label; });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
});

test("first announcement can be inserted into an initially absent region", async () => {
  const f = fixture();
  const key = await armCompletionAnnouncement(f.page);
  f.mutate(document => { document.body.innerHTML = status("Answer complete"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
});

test.each(["replace", "remove-reinsert", "clear-refill", "translated-replacement"])("stale completion stays stale across %s", async scenario => {
  const f = fixture(status("回答已完成"));
  const key = await armCompletionAnnouncement(f.page);
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  if (scenario === "remove-reinsert") {
    f.mutate(document => { document.querySelector("span")!.remove(); });
  } else if (scenario === "clear-refill") {
    f.mutate(document => { document.querySelector("span")!.textContent = "   "; });
  }
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => {
    document.body.innerHTML = status(scenario === "translated-replacement" ? "Answer complete" : "回答已完成");
  });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.body.appendChild(document.createElement("main")); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
});

test("Working revokes fresh completion and the next completion is fresh across replacements", async () => {
  const f = fixture(status("Working"));
  const key = await armCompletionAnnouncement(f.page);
  f.mutate(document => { document.body.innerHTML = status("Answer complete"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
  f.mutate(document => { document.body.innerHTML = status("Working"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.body.innerHTML = ""; });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.body.innerHTML = status("Response complete"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
});

test("nested quoted statuses cannot establish or reset document completion", async () => {
  const f = fixture(status("Answer complete") + "<main></main>");
  const key = await armCompletionAnnouncement(f.page);
  f.mutate(document => { document.querySelector("main")!.innerHTML = status("Working"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.querySelector("main")!.innerHTML = status("Answer complete"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.body.innerHTML = status("Working") + "<main></main>"; });
  f.mutate(document => { document.querySelector("body > span")!.textContent = "Answer complete"; });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
  f.mutate(document => { document.querySelector("main")!.innerHTML = status("Working"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
});

test.each([
  ["Working", "Answer complete"],
  ["Answer complete", "Working"],
  ["Answer complete", "Answer complete"],
])("multiple nonempty announcements fail closed: %s / %s", async (first, second) => {
  const f = fixture(status("Working"));
  const key = await armCompletionAnnouncement(f.page);
  f.mutate(document => { document.body.innerHTML = status("Answer complete"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
  f.mutate(document => { document.body.innerHTML = status(first) + status(second); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.body.innerHTML = ""; });
  f.mutate(document => { document.body.innerHTML = status("Answer complete"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  f.mutate(document => { document.body.innerHTML = status("Working"); });
  f.mutate(document => { document.body.innerHTML = status("Answer complete"); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
});

test("ambiguity at arming cannot complete just by removing the other status", async () => {
  const f = fixture(status("Working") + status("Answer complete"));
  const key = await armCompletionAnnouncement(f.page);
  f.mutate(document => { document.querySelector("body > span")!.remove(); });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
});

test("empty sibling live regions do not hide a legitimate nonempty transition", async () => {
  const f = fixture(status("") + status(" "));
  const key = await armCompletionAnnouncement(f.page);
  f.mutate(document => { document.querySelector("span")!.textContent = "Answer complete"; });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
});

test("rearming resets freshness and obsolete keys cannot read or dispose the new observer", async () => {
  const f = fixture(status(""));
  const key = await armCompletionAnnouncement(f.page);
  f.mutate(document => { document.querySelector("span")!.textContent = "Answer complete"; });
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeTrue();
  const next = await armCompletionAnnouncement(f.page);
  expect(f.activeObservers()).toBe(1);
  expect(await hasFreshCompletionAnnouncement(f.page, next)).toBeFalse();
  expect(await hasFreshCompletionAnnouncement(f.page, key)).toBeFalse();
  await disposeCompletionAnnouncement(f.page, key);
  expect(f.activeObservers()).toBe(1);
  f.mutate(document => { document.querySelector("span")!.textContent = "Working"; });
  f.mutate(document => { document.querySelector("span")!.textContent = "Answer complete"; });
  expect(await hasFreshCompletionAnnouncement(f.page, next)).toBeTrue();
  await disposeCompletionAnnouncement(f.page, next);
  expect(f.activeObservers()).toBe(0);
  expect(await hasFreshCompletionAnnouncement(f.page, next)).toBeFalse();
});

/** Real MutationObserver coverage is opt-in and uses only an isolated, offline page.
 * Each awaited DOM mutation and subsequent probe crosses a native delivery checkpoint. */
async function withChromiumPage(check: (page: Page) => Promise<void>): Promise<void> {
  const executablePath = process.env.CHATGPT_DOM_TEST_BROWSER;
  if (!executablePath) throw new Error("CHATGPT_DOM_TEST_BROWSER must select the fixture browser");
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => route.abort());
    await check(await context.newPage());
  } finally {
    await browser.close();
  }
}

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("Chromium: stale completion survives clone replacement and removal/reinsertion without becoming fresh", async () => {
  await withChromiumPage(async page => {
    await page.setContent(status("回答已完成") + "<main></main>");
    const key = await armCompletionAnnouncement(page);
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("main").evaluate((node, html) => { node.innerHTML = html; }, status("Answer complete"));
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("body > span").evaluate(node => { node.replaceWith(node.cloneNode(true)); });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();

    // Separate browser tasks deliver the empty intermediate state before reinsertion.
    const detached = await page.locator("body > span").evaluateHandle(node => {
      node.remove();
      return node;
    });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.evaluate(node => { document.body.appendChild(node); }, detached);
    await detached.dispose();
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await disposeCompletionAnnouncement(page, key);
  });
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("Chromium: Working revokes completion, later completion is fresh, and multiple statuses fail closed", async () => {
  await withChromiumPage(async page => {
    await page.setContent(status("Working"));
    const key = await armCompletionAnnouncement(page);
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("body > span").evaluate(node => { node.textContent = "Answer complete"; });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeTrue();
    // Mutate the text node itself to exercise native characterData delivery as well.
    await page.locator("body > span").evaluate(node => { node.firstChild!.nodeValue = "Working"; });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("body > span").evaluate(node => { node.firstChild!.nodeValue = "Response complete"; });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeTrue();

    const next = await armCompletionAnnouncement(page);
    expect(await hasFreshCompletionAnnouncement(page, next)).toBeFalse();
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.evaluate(html => { document.body.insertAdjacentHTML("beforeend", html); }, status("Answer complete"));
    // The original browser regression treated this second completed node as fresh.
    // Multiple nonempty regions now fail closed, including after one is removed.
    expect(await hasFreshCompletionAnnouncement(page, next)).toBeFalse();
    await page.locator("body > span").first().evaluate(node => { node.remove(); });
    expect(await hasFreshCompletionAnnouncement(page, next)).toBeFalse();
    await page.locator("body > span").evaluate(node => { node.textContent = "Working"; });
    await page.locator("body > span").evaluate(node => { node.textContent = "Answer complete"; });
    expect(await hasFreshCompletionAnnouncement(page, next)).toBeTrue();
    await disposeCompletionAnnouncement(page, next);
    expect(await hasFreshCompletionAnnouncement(page, next)).toBeFalse();
  });
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("Chromium: initial empty region accepts completion but quoted nested status does not", async () => {
  await withChromiumPage(async page => {
    await page.setContent(status("") + "<main></main>");
    const key = await armCompletionAnnouncement(page);
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("main").evaluate((node, html) => { node.innerHTML = html; }, status("Answer complete"));
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("body > span").evaluate(node => { node.textContent = "Answer complete"; });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeTrue();
    await disposeCompletionAnnouncement(page, key);
  });
}, 15_000);

for (const [name, stopHtml] of [
  ["legacy", '<button data-testid="stop-button">Stop</button>'],
  ["power English", '<form data-chatgpt-composer><button type="button" aria-label="Stop">Stop</button></form>'],
  ["power Chinese", '<form data-chatgpt-composer><button type="button" aria-label="停止">Stop</button></form>'],
]) {
  test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`Chromium: captured old completion -> Stop + empty -> same completion (${name})`, async () => {
    await withChromiumPage(async page => {
      for (const announcedWhileGenerating of [false, true]) {
        await page.setContent(status("回答已完成"));
        const key = await armCompletionAnnouncement(page);
        expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
        // Metadata trace: the old completion is replaced by an empty region while
        // the new generation's Stop is visible. No Working announcement occurs.
        await page.evaluate(html => {
          document.body.insertAdjacentHTML("beforeend", html);
          document.querySelector("body > span")!.textContent = "";
        }, stopHtml!);
        expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
        expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
        if (announcedWhileGenerating) {
          await page.locator("body > span").evaluate(node => { node.textContent = "回答已完成"; });
          expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
          await page.locator("button").evaluate(node => { node.remove(); });
        } else {
          await page.evaluate(() => {
            document.querySelector("button")!.remove();
            document.querySelector("body > span")!.textContent = "回答已完成";
          });
        }
        expect(await hasFreshCompletionAnnouncement(page, key)).toBeTrue();
        await disposeCompletionAnnouncement(page, key);
      }
    });
  }, 15_000);
}

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("Chromium: status can clear in an earlier batch than Stop appears", async () => {
  await withChromiumPage(async page => {
    await page.setContent(status("Answer complete"));
    const key = await armCompletionAnnouncement(page);
    await page.locator("body > span").evaluate(node => { node.textContent = ""; });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", '<form data-chatgpt-composer><button type="button" aria-label="Stop">Stop</button></form>');
    });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("body > span").evaluate(node => { node.textContent = "Answer complete"; });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("button").evaluate(node => { node.remove(); });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeTrue();
  });
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("Chromium: a new generation revokes freshness and cannot reuse an uncleared old completion", async () => {
  await withChromiumPage(async page => {
    await page.setContent(status(""));
    const key = await armCompletionAnnouncement(page);
    await page.locator("body > span").evaluate(node => { node.textContent = "Answer complete"; });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeTrue();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", '<form data-chatgpt-composer><button type="button" aria-label="Stop">Stop</button></form>');
    });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("button").evaluate(node => { node.remove(); });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
    await page.locator("body > span").evaluate(node => { node.replaceWith(node.cloneNode(true)); });
    expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
  });
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("Chromium: transitions entirely lost within an observer batch cannot establish an epoch or clear", async () => {
  await withChromiumPage(async page => {
    for (const observeStopFirst of [false, true]) {
      await page.setContent(status("Answer complete"));
      const key = await armCompletionAnnouncement(page);
      if (observeStopFirst) {
        await page.evaluate(() => { document.body.insertAdjacentHTML("beforeend", '<button data-testid="stop-button">Stop</button>'); });
        expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
      }
      // These writes occur in one task: the native observer sees only the final DOM.
      // A visible Stop alone is insufficient if its announcement's clear was missed.
      await page.evaluate(stopAlreadyObserved => {
        if (!stopAlreadyObserved) document.body.insertAdjacentHTML("beforeend", '<button data-testid="stop-button">Stop</button>');
        const announcement = document.querySelector("body > span")!;
        announcement.textContent = "";
        announcement.textContent = "Answer complete";
        document.querySelector("button")!.remove();
      }, observeStopFirst);
      expect(await hasFreshCompletionAnnouncement(page, key)).toBeFalse();
      await disposeCompletionAnnouncement(page, key);
    }
  });
}, 15_000);
