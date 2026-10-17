import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../../src/adapters/chatgpt-web/browser/browser-worker";
import {
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  CHATGPT_EFFORT_MENU_SELECTOR,
  CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR,
  activateChatGptEffortMenu,
  closeChatGptEffortMenu,
  assertNewChatPage,
  chatGptNewChatUrl,
  detectChatGptAccountCapabilities,
  readChatGptEffortSnapshot,
} from "../../src/browser/session";

test("effort closing acknowledges its owner when Escape is ignored and never reopens a closed picker", async () => {
  for (const escapeWorks of [true, false]) {
    let expanded = true, escapes = 0, toggles = 0;
    const control: any = {
      getAttribute: async (name: string) => name === "aria-expanded" ? String(expanded)
        : name === "data-state" ? expanded ? "open" : "closed" : null,
      dispatchEvent: async (event: string) => { expect(event).toBe("pointerdown"); toggles++; expanded = !expanded; },
    };
    const page: any = { keyboard: { press: async (key: string) => {
      expect(key).toBe("Escape"); escapes++; if (escapeWorks) expanded = false;
    } } };
    await closeChatGptEffortMenu(page, control, { settleMs: 0 });
    expect(expanded).toBeFalse();
    expect(escapes).toBe(1);
    expect(toggles).toBe(escapeWorks ? 0 : 1);
    await closeChatGptEffortMenu(page, control, { settleMs: 0 });
    expect(escapes).toBe(1);
    expect(toggles).toBe(escapeWorks ? 0 : 1);
  }
});

test("effort closing rejects missing ownership and a picker that ignores both close actions", async () => {
  let actions = 0;
  const page: any = { keyboard: { press: async () => { actions++; } } };
  const control: any = { getAttribute: async () => null, dispatchEvent: async () => { actions++; } };
  await expect(closeChatGptEffortMenu(page, control, { settleMs: 0 })).rejects.toThrow("owner state");
  expect(actions).toBe(0);
  control.getAttribute = async (name: string) => name === "aria-expanded" ? "true" : "open";
  await expect(closeChatGptEffortMenu(page, control, { settleMs: 0 })).rejects.toThrow("did not close");
  expect(actions).toBe(2);
});

test("saved chats start empty and cannot reuse an arbitrary conversation or a Temporary Chat", async () => {
  expect(chatGptNewChatUrl()).toBe("https://chatgpt.com/?temporary-chat=true");
  expect(chatGptNewChatUrl(true)).toBe("https://chatgpt.com/");
  const prepare = (ChatGptBrowserWorker.prototype as any).prepareChatSurface;
  for (const saved of [false, true]) {
    let url = "https://chatgpt.com/c/previous-task";
    const navigations: string[] = [];
    const absent: any = { filter: () => absent, last: () => absent, isVisible: async () => false };
    const composer: any = { count: async () => 1, nth: () => composer, filter: () => composer,
      first: () => composer, isVisible: async () => true };
    const page: any = {
      url: () => url,
      goto: async (next: string) => { url = next; navigations.push(next); },
      locator: (selector: string) => selector === CHATGPT_COMPOSER_SELECTOR ? composer : absent,
      evaluate: async () => ({ documentComplete: true, surfaceBound: true, composers: 1, editable: true,
        userTurns: 0, assistantTurns: 0, stopButtons: 0, unknownEditors: 0, signIn: false, expired: false,
        verification: false, subscriptionFailure: false }),
    };
    expect(await prepare.call({ activeComposer: async () => composer }, page, undefined, saved)).toBe(composer);
    expect(navigations).toEqual([chatGptNewChatUrl(saved)]);
    await expect(assertNewChatPage(page, !saved)).rejects.toThrow("requested new");
    url = "https://chatgpt.com/c/previous-task";
    await expect(assertNewChatPage(page, saved)).rejects.toThrow("requested new");
  }
});

test("composer and effort selectors exclude unrelated editable fields and menu buttons", () => {
  const { createDocument } = require("@mixmark-io/domino") as { createDocument(html: string): Document };
  const document = createDocument(`<body><form>
    <div contenteditable="true" id="unrelated-editor"></div>
    <textarea placeholder="Search" id="search"></textarea>
    <button aria-haspopup="menu" id="attachments"></button>
    <div data-testid="prompt-textarea" id="composer-testid"></div>
    <div id="prompt-textarea"></div>
    <div contenteditable="true" data-lexical-editor="true" id="composer-lexical"></div>
    <button aria-haspopup="menu" data-tone="neutral" id="effort"></button>
    <button aria-haspopup="menu" data-testid="model-switcher-dropdown-button" id="model"></button>
  </form>
  <div contenteditable="true" data-composer-markdown role="textbox" id="unowned-power-editor"></div>
  <form data-chatgpt-composer>
    <div contenteditable="true" data-composer-markdown role="textbox" id="power-editor"></div>
    <button data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning" aria-haspopup="menu" id="power-effort"></button>
  </form></body>`);
  const matches = (selector: string) => Array.from(document.querySelectorAll(selector)).map(element => element.id);
  expect(matches(CHATGPT_COMPOSER_SELECTOR)).toEqual(["composer-testid", "prompt-textarea", "composer-lexical", "power-editor"]);
  expect(matches(CHATGPT_EFFORT_CONTROL_SELECTOR)).toEqual(["effort", "model", "power-effort"]);
});

test("effort activation binds the owned menu after the control opens", async () => {
  let opened = false;
  const ownedMenu = { isVisible: async () => opened };
  const surface = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => opened,
  };
  const control = {
    getAttribute: async (name: string) => {
      if (name === "aria-controls") return opened ? "radix-effort-menu" : null;
      if (name === "aria-expanded") return opened ? "true" : "false";
      if (name === "data-state") return opened ? "open" : "closed";
      return null;
    },
    click: async (options: unknown) => {
      expect(options).toEqual({ force: true, noWaitAfter: true, timeout: 1 });
      opened = true;
    },
  };
  const page = {
    locator: (selector: string) => {
      if (selector === '[id="radix-effort-menu"]') return ownedMenu;
      return surface;
    },
    keyboard: { press: async () => {} },
  };

  const activation = await activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 });
  expect(activation.method).toBe("click");
  expect(activation.menu).toBe(ownedMenu as never);
  expect(activation.sliderContainer).toBe(surface as never);
});

test.each(["aria-expanded", "data-state"])("effort activation does not bind a closing menu (%s)", async attribute => {
  let opened = false;
  let clicks = 0;
  // Escape closes the control immediately, but the outgoing menu remains visible
  // through its exit animation. Its stale range must not authorize a new selection.
  const surface = {
    filter() { return this; }, last() { return this; }, locator() { return this; },
    isVisible: async () => true,
  };
  const control = {
    getAttribute: async (name: string) => name === attribute
      ? attribute === "aria-expanded" ? String(opened) : opened ? "open" : "closed"
      : null,
    click: async () => { clicks++; opened = true; },
  };
  const page = { locator: () => surface, keyboard: { press: async () => {} } };
  const activation = await activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 });
  expect(activation.method).toBe("click");
  expect(clicks).toBe(1);
});

test("effort activation retries one ghost click with a primary pointerdown", async () => {
  let ghostOpen = false;
  let pointerOpened = false;
  const events: unknown[] = [];
  const ownedMenu = { isVisible: async () => pointerOpened };
  const surface = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => pointerOpened,
  };
  const control = {
    getAttribute: async (name: string) => {
      if (name === "aria-controls") return pointerOpened ? "radix-effort-menu" : null;
      if (name === "aria-expanded") return ghostOpen ? "true" : "false";
      if (name === "data-state") return ghostOpen ? "open" : "closed";
      return null;
    },
    click: async (options: unknown) => {
      events.push(["click", options]);
      ghostOpen = true;
    },
    dispatchEvent: async (name: string, detail: unknown) => {
      events.push([name, detail]);
      ghostOpen = true;
      pointerOpened = true;
    },
  };
  const page = {
    locator: (selector: string) => {
      if (selector === '[id="radix-effort-menu"]') return ownedMenu;
      return surface;
    },
    keyboard: {
      press: async (key: string) => {
        events.push(["keyboard", key]);
        ghostOpen = false;
      },
    },
  };

  const activation = await activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 });
  expect(activation.method).toBe("pointerdown");
  expect(activation.menu).toBe(ownedMenu as never);
  expect(activation.sliderContainer).toBe(surface as never);
  expect(events).toEqual([
    ["click", { force: true, noWaitAfter: true, timeout: 1 }],
    ["keyboard", "Escape"],
    ["pointerdown", { button: 0, buttons: 1, pointerType: "mouse", isPrimary: true }],
  ]);
});

test("a visible effort menu waits until its slider surface becomes visible", async () => {
  let opened = false, visibilityReads = 0;
  const menu = { isVisible: async () => opened };
  const surface = {
    filter() { return this; }, locator() { return this; },
    isVisible: async () => opened && ++visibilityReads >= 3,
  };
  const control = {
    getAttribute: async (name: string) => name === "aria-expanded" ? String(opened)
      : name === "aria-controls" ? "owned-menu" : null,
    click: async () => { opened = true; },
    dispatchEvent: async () => { throw new Error("A hydrating slider must not require a fallback click"); },
  };
  const page = { locator: (selector: string) => selector === '[id="owned-menu"]' ? menu : surface,
    keyboard: { press: async () => { opened = false; } } };
  const activation = await activateChatGptEffortMenu(page as never, control as never, { settleMs: 1_000 });
  expect(visibilityReads).toBe(3);
  expect(activation.method).toBe("click");
  expect(activation.sliderContainer).toBe(surface as never);
});

test("a visible model menu without a visible effort surface exhausts activation and fails closed", async () => {
  let opened = false, clicks = 0, pointers = 0;
  const menu = { isVisible: async () => opened };
  const surface = { filter() { return this; }, locator() { return this; }, isVisible: async () => false };
  const control = {
    getAttribute: async (name: string) => name === "aria-expanded" ? String(opened)
      : name === "aria-controls" ? "owned-menu" : null,
    click: async () => { clicks++; opened = true; },
    dispatchEvent: async () => { pointers++; opened = true; },
  };
  const page = { locator: (selector: string) => selector === '[id="owned-menu"]' ? menu : surface,
    keyboard: { press: async () => { opened = false; } } };
  await expect(activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 }))
    .rejects.toThrow("did not expose its owned menu or structural slider");
  expect(clicks).toBe(1); expect(pointers).toBe(1);
});

test("effort snapshot locator waits share the remaining inspection budget", async () => {
  const timeouts: number[] = [];
  const container = {
    evaluate: async (_read: unknown, arg: unknown, options: { timeout: number }) => {
      expect(arg).toBeUndefined();
      expect(options.timeout).toBeGreaterThan(0);
      timeouts.push(options.timeout);
      return { min: "0", max: "3", value: "3", locks: Array(timeouts.length === 1 ? 3 : 4).fill("false") };
    },
  };
  expect(await readChatGptEffortSnapshot(container as never, 1_000))
    .toEqual({ min: 0, max: 3, value: 3, available: [true, true, true, true] });
  expect(timeouts).toHaveLength(2);
  expect(timeouts[0]).toBeLessThanOrEqual(1_000);
  expect(timeouts[1]!).toBeLessThan(timeouts[0]!);
});

test("effort activation fails closed when neither event exposes a structural surface", async () => {
  const hiddenSurface = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => false,
  };
  const control = {
    getAttribute: async () => null,
    click: async () => {},
    dispatchEvent: async () => {},
  };
  const page = {
    locator: () => hiddenSurface,
    keyboard: { press: async () => {} },
  };

  await expect(activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 }))
    .rejects.toThrow("did not expose its owned menu or structural slider");
});

test("a complete authenticated composer with no effort selector is Luna-only", async () => {
  const effortButton = {
    filter() { return this; },
    last() { return this; },
    isVisible: async () => false,
  };
  const composerForm = {
    count: async () => 1,
    locator: () => effortButton,
  };
  const composer = {
    filter() { return this; },
    last() { return this; },
    count: async () => 1,
    isVisible: async () => true,
    locator: () => composerForm,
  };
  const page = {
    locator: () => composer,
    evaluate: async () => true,
  };

  await expect(detectChatGptAccountCapabilities(page as never, {
    selectorTimeoutMs: 100,
    stableAbsenceMs: 0,
  })).resolves.toEqual({ solAvailable: false, extraHighAvailable: false, proAvailable: false });
});

test("a transient effort control does not turn a Luna-only account into Sol", async () => {
  let visibilityReads = 0;
  const effortButton = {
    filter() { return this; },
    last() { return this; },
    isVisible: async () => {
      visibilityReads += 1;
      return visibilityReads === 1;
    },
  };
  const composerForm = {
    count: async () => 1,
    locator: () => effortButton,
  };
  const composers = {
    filter() { return this; },
    last() { return this; },
    count: async () => 1,
    locator: () => composerForm,
  };
  const page = {
    locator: () => composers,
    evaluate: async () => true,
  };

  await expect(detectChatGptAccountCapabilities(page as never, {
    selectorTimeoutMs: 100,
    stableAbsenceMs: 0,
  })).resolves.toEqual({ solAvailable: false, extraHighAvailable: false, proAvailable: false });
  expect(visibilityReads).toBe(2);
});

function reasoningPicker(options: { max?: string; locks?: Array<string | null>; delay?: number; missing?: boolean; loseSelectionOnClose?: boolean; power?: boolean; disabled?: string; staleAttributeMax?: string; maxAfterClose?: string; locksAfterClose?: Array<string | null> } = {}) {
  let value = 0;
  let opened = true;
  let closedOnce = false;
  const max = () => closedOnce ? options.maxAfterClose ?? options.max ?? "4" : options.max ?? "4";
  const keys: string[] = [];
  const hidden = {
    filter() { return this; }, last() { return this; }, getByText() { return this; },
    isVisible: async () => false,
    waitFor: ({ signal }: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  };
  const sliderControl = { press: async (key: string) => { keys.push(key); value += key === "ArrowRight" ? 1 : -1; } };
  const slider = {
    isVisible: async () => false, // Live DOM: aria-hidden=true, zero-width semantic span.
    filter: () => { throw new Error("Semantic input must not be visibility-filtered"); },
    waitFor: async ({ state }: { state: string }) => { expect(state).toBe("attached"); },
    getAttribute: async (name: string) => ({ "aria-valuemin": "0", "aria-valuemax": options.staleAttributeMax ?? max(), "aria-valuenow": String(value), "aria-hidden": "true" })[name] ?? null,
    locator: () => sliderControl,
  };
  const container = {
    filter() { return this; }, last() { return this; },
    locator: () => slider,
    evaluate: async (read: (element: Element) => unknown) => {
      const { createDocument } = require("@mixmark-io/domino") as { createDocument(html: string): Document };
      // Captured Plus DOM: the slider root and each tick have data-locked, but only
      // ticks have data-selected. Its fourth position is a locked Pro upsell.
      const locks = (closedOnce ? options.locksAfterClose : undefined) ?? options.locks ?? Array.from({ length: Number(max()) + 1 }, () => "false");
      const attribute = options.power ? "data-model-picker-power-slider" : "data-model-reasoning-effort-slider";
      const document = createDocument(`<div ${attribute}>
        <span data-locked="false" data-orientation="horizontal" aria-disabled="${options.disabled ?? "false"}"><span>${locks.map((lock, index) =>
          `<span data-selected="${index <= value}"${lock === null ? "" : ` data-locked="${lock}"`}></span>`).join("")}
        </span><span role="slider" aria-valuemin="0" aria-valuemax="${max()}" aria-valuenow="${value}"></span></span></div>`);
      return read(document.querySelector(`[${attribute}]`)!);
    },
    isVisible: async () => true,
    waitFor: async ({ state }: { state: string }) => {
      expect(state).toBe("visible");
      if (options.missing) throw new Error("effort container never hydrated");
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    },
  };
  const control = {
    first() { return this; }, filter() { return this; }, last() { return this; },
    count: async () => 1, waitFor: async () => {}, isVisible: async () => true,
    click: async () => { opened = true; },
    innerText: async () => opened ? "Thinking effort" : ["Instant", "Medium", "High", "Extra High", "Pro"][value]!,
    getAttribute: async (name: string) => name === "aria-expanded" ? String(opened) : null,
  };
  const composer = { filter() { return this; }, last() { return this; }, count: async () => 1, isEditable: async () => true, locator: () => ({ count: async () => 1, locator: () => control }) };
  const modelRows = { count: async () => 3, first() { return this; }, waitFor: async () => {}, nth: () => { throw new Error("Model rows are not effort choices"); } };
  const menu = { filter() { return this; }, last() { return this; }, isVisible: async () => true, locator: () => modelRows };
  const page = {
    url: () => "https://chatgpt.com/?temporary-chat=true",
    evaluate: async () => true,
    locator: (selector: string) => {
      if (selector === CHATGPT_COMPOSER_SELECTOR) return composer;
      if (selector === CHATGPT_EFFORT_MENU_SELECTOR) return menu;
      if (selector === CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR) return container;
      return hidden;
    },
    keyboard: { press: async () => {
      opened = false;
      closedOnce = true;
      if (options.loseSelectionOnClose) value = 0;
    } },
  };
  return { page, composer, control, keys, value: () => value };
}

test("a late model control within the inspection budget is not recorded as Luna-only", async () => {
  const fixture = reasoningPicker();
  let reads = 0;
  fixture.control.isVisible = async () => ++reads >= 3;
  await expect(detectChatGptAccountCapabilities(fixture.page as never, {
    selectorTimeoutMs: 1_000,
    stableAbsenceMs: 0,
  })).resolves.toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: true });
});

test("an effort-control observation failure cannot become a Luna-only detection", async () => {
  const fixture = reasoningPicker();
  fixture.control.isVisible = async () => { throw new Error("Ambiguous effort controls"); };
  await expect(detectChatGptAccountCapabilities(fixture.page as never, {
    selectorTimeoutMs: 100,
    stableAbsenceMs: 0,
  })).rejects.toThrow("Ambiguous effort controls");
});

test.each([0, 50])("capabilities wait for the visible container and read its hidden semantic input (delay=%s)", async delay => {
  const fixture = reasoningPicker({ delay });
  await expect(detectChatGptAccountCapabilities(fixture.page as never)).resolves.toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: true });
});

test("an absent effort slider cannot turn three model rows into a saved non-Pro capability", async () => {
  const fixture = reasoningPicker({ missing: true });
  await expect(detectChatGptAccountCapabilities(fixture.page as never)).rejects.toThrow("never hydrated");
});

test("the authoritative three-step range is non-Pro; a malformed range fails closed", async () => {
  await expect(detectChatGptAccountCapabilities(reasoningPicker({ max: "2" }).page as never)).resolves.toEqual({ solAvailable: true, extraHighAvailable: false, proAvailable: false });
  await expect(detectChatGptAccountCapabilities(reasoningPicker({ max: "bad" }).page as never)).rejects.toThrow("invalid ARIA range");
});

test("the four-step browser range keeps Extra High available when Pro is unavailable", async () => {
  await expect(detectChatGptAccountCapabilities(reasoningPicker({ max: "3" }).page as never))
    .resolves.toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: false });
});

test("capabilities read range and ticks together instead of combining different renders", async () => {
  const fixture = reasoningPicker({ max: "3", staleAttributeMax: "4" });
  await expect(detectChatGptAccountCapabilities(fixture.page as never))
    .resolves.toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: false });
});

test("effort confirmation tolerates disappearing Pro only while the requested effort remains selected and unlocked", async () => {
  for (const locked of [false, true]) {
    const fixture = reasoningPicker({ maxAfterClose: "3", locksAfterClose: ["false", "false", "false", String(locked)] });
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), { activeComposer: async () => fixture.composer }) as any;
    const result = worker.selectModelAndEffort(fixture.page, "gpt-5.6-sol", "xhigh", {
      localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
    });
    if (locked) await expect(result).rejects.toThrow();
    else expect((await result).selection.label).toBe("Extra High");
    expect(fixture.keys).toEqual(["ArrowRight", "ArrowRight", "ArrowRight"]);
  }
});

test("effort confirmation rejects a newly locked selection even when the range and value are unchanged", async () => {
  const fixture = reasoningPicker({ locksAfterClose: ["false", "false", "true", "true", "true"] });
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), { activeComposer: async () => fixture.composer }) as any;
  await expect(worker.selectModelAndEffort(fixture.page, "gpt-5.6-sol", "high", {
    localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
  })).rejects.toThrow();
});

test("capabilities exclude the observed locked Plus upsell and reject unknown lock state", async () => {
  await expect(detectChatGptAccountCapabilities(reasoningPicker({
    max: "3", locks: ["false", "false", "false", "true"],
  }).page as never)).resolves.toEqual({ solAvailable: true, extraHighAvailable: false, proAvailable: false });
  await expect(detectChatGptAccountCapabilities(reasoningPicker({
    locks: ["false", "false", "false", "false", "true"],
  }).page as never)).resolves.toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: false });
  for (const locks of [[], ["false", "false", "false", null], ["false", "false", "false", "unknown"]]) {
    await expect(detectChatGptAccountCapabilities(reasoningPicker({ max: "3", locks }).page as never))
      .rejects.toThrow("availability");
  }
});

test("power picker omission of lock attributes requires its enabled structural owner and complete ticks", async () => {
  await expect(detectChatGptAccountCapabilities(reasoningPicker({ power: true, locks: Array(5).fill(null) }).page as never))
    .resolves.toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: true });
  await expect(detectChatGptAccountCapabilities(reasoningPicker({ power: true, locks: [null, null, null, "true", "true"] }).page as never))
    .resolves.toEqual({ solAvailable: true, extraHighAvailable: false, proAvailable: false });
  for (const options of [
    { power: false }, { power: true, disabled: "true" }, { power: true, disabled: "unknown" },
    { power: true, max: "3" },
  ]) await expect(detectChatGptAccountCapabilities(reasoningPicker({ ...options, locks: Array(5).fill(null) }).page as never))
    .rejects.toThrow("availability");
});

test("stale saved capabilities cannot activate a locked effort; High remains selectable", async () => {
  for (const effort of ["xhigh", "high"] as const) {
    const fixture = reasoningPicker({ max: "3", locks: ["false", "false", "false", "true"] });
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
      activeComposer: async () => fixture.composer,
    }) as { selectModelAndEffort(...args: unknown[]): Promise<{ selection: { label: string } }> };
    const selection = worker.selectModelAndEffort(fixture.page, "gpt-5.6-sol", effort, {
      localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
    });
    if (effort === "xhigh") {
      await expect(selection).rejects.toMatchObject({ code: "chatgpt_effort_locked", retryable: false });
      expect(fixture.keys).toEqual([]);
    } else {
      expect((await selection).selection.label).toBe("High");
      expect(fixture.keys).toEqual(["ArrowRight", "ArrowRight"]);
    }
  }
});

test("Pro selection verifies the persisted hidden slider through its visible owner, never model rows", async () => {
  for (const loseSelectionOnClose of [false, true]) {
    const fixture = reasoningPicker({ delay: 50, loseSelectionOnClose });
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
      activeComposer: async () => fixture.composer,
    }) as { selectModelAndEffort(...args: unknown[]): Promise<{ selection: { label: string } }> };
    const selection = worker.selectModelAndEffort(fixture.page, "gpt-5.6-sol", "max", {
      localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
    });
    if (loseSelectionOnClose) await expect(selection).rejects.toMatchObject({ retryable: false });
    else expect((await selection).selection.label).toBe("Pro");
    expect(fixture.keys).toEqual(["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"]);
    expect(fixture.value()).toBe(loseSelectionOnClose ? 0 : 4);
  }
});
