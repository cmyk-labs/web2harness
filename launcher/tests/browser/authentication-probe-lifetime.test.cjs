const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { BrowserHost, IDLE_BROWSER_URL, TEMPORARY_CHAT_URL } = require("../../electron/browser/browser-host.cjs");

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const result = (authenticated = true, url = TEMPORARY_CHAT_URL) => ({
  url, composer: true, temporary: url === TEMPORARY_CHAT_URL,
  sessionAuthenticated: authenticated, readyState: "complete",
});

function clock(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const timers = new Set();
  const schedule = global.setTimeout;
  const cancel = global.clearTimeout;
  t.mock.method(global, "setTimeout", (callback, ms, ...args) => {
    const timer = schedule(() => { timers.delete(timer); callback(...args); }, ms);
    timers.add(timer);
    return timer;
  });
  t.mock.method(global, "clearTimeout", timer => { timers.delete(timer); cancel(timer); });
  return timers;
}

function contents(url = TEMPORARY_CHAT_URL) {
  return Object.assign(new EventEmitter(), {
    url, destroyed: false, loads: [], probes: 0,
    getURL() { return this.url; },
    isDestroyed() { return this.destroyed; },
    async executeJavaScript() { this.probes += 1; return result(true, this.url); },
    async loadURL(next) {
      this.loads.push(next);
      this.emit("did-start-navigation", { url: next, isMainFrame: true, isSameDocument: false });
      this.url = next;
    },
    close() { this.destroyed = true; this.emit("destroyed"); },
    stop() { this.emit("did-stop-loading"); },
    setBackgroundThrottling() {},
  });
}

function host(primary = contents(), popup = null) {
  return Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: primary }, authView: popup ? { webContents: popup } : null,
    state: { authenticated: false, url: primary.url }, changes: [], closed: [],
    manualOperation: null, turnTabs: new Map(),
    logger: { info() {}, error() {} },
    setState(patch) { this.changes.push(patch); this.state = { ...this.state, ...patch }; },
    snapshot() { return { ...this.state }; },
    closeAuthView(view) {
      if (!view) return;
      assert.equal(this.authView, view);
      this.authView = null;
      this.closed.push(view);
      view.webContents.close();
    },
    ready: async () => {}, activateHomeSurface() {},
  });
}

function cleaned(fixture, timers, ...surfaces) {
  assert.equal(fixture.authenticationProbe, null);
  assert.equal(fixture.authenticationProbeLifetime, null);
  assert.equal(timers.size, 0, "all host timers are cleared");
  for (const surface of surfaces) assert.deepEqual(surface.eventNames(), [], "all probe listeners are removed");
}

test("bounded recheck restores authentication after a same-document interruption without navigating", async t => {
  const timers = clock(t), page = contents("https://chatgpt.com/"), fixture = host(page), old = deferred();
  page.executeJavaScript = () => old.promise;
  const check = fixture.checkAuthentication();
  assert.equal(fixture.checkAuthentication(), check, "concurrent callers share the same check");
  await flush();
  page.emit("did-navigate-in-page", {}, page.url, true);
  page.executeJavaScript = async () => result(true, page.url);
  await flush();
  t.mock.timers.tick(300);
  assert.equal((await check).authenticationStatus, "authenticated");
  assert.deepEqual(page.loads, [], "a loaded conversation is inspected in place");
  old.resolve(result(false));
  await flush();
  assert.equal(fixture.state.authenticated, true);
  cleaned(fixture, timers, page);
});

test("renderer closure settles the recheck UI and allows a fresh retry", async t => {
  const timers = clock(t), page = contents(), fixture = host(page);
  page.executeJavaScript = () => new Promise(() => {});
  const check = fixture.checkAuthentication();
  await flush();
  page.close();
  assert.equal((await check).authenticationStatus, "error");
  assert.equal(fixture.authenticationCheck, null);
  cleaned(fixture, timers, page);
  const replacement = contents();
  fixture.view = { webContents: replacement };
  assert.equal((await fixture.checkAuthentication()).authenticationStatus, "authenticated");
  cleaned(fixture, timers, replacement);
});

test("work starting mid-recheck releases the pending UI without claiming sign-in", async t => {
  const timers = clock(t), page = contents(), fixture = host(page), pending = deferred();
  page.executeJavaScript = () => pending.promise;
  const check = fixture.checkAuthentication();
  await flush();
  Object.defineProperty(fixture, "activeTraceId", { value: "task-started" });
  pending.resolve(result(false));
  assert.equal((await check).authenticationStatus, "unknown");
  assert.equal(fixture.state.authenticated, false);
  cleaned(fixture, timers, page);
});

test("repeated navigation ends in a visible retryable error after three attempts", async t => {
  const timers = clock(t), page = contents(), fixture = host(page);
  let attempts = 0;
  page.executeJavaScript = async () => {
    attempts += 1;
    page.emit("did-navigate-in-page", {}, page.url, true);
    return result(true);
  };
  const check = fixture.checkAuthentication();
  for (let i = 0; i < 3; i += 1) { await flush(); t.mock.timers.tick(300); }
  const state = await check;
  assert.equal(attempts, 3);
  assert.equal(state.authenticated, false);
  assert.equal(state.authenticationStatus, "error");
  assert.match(state.authenticationMessage, /interrupted/);
  cleaned(fixture, timers, page);
});

test("rechecks respect active work and manual mode; cancellation clears queued retries", async t => {
  const timers = clock(t), page = contents(), fixture = host(page);
  Object.defineProperty(fixture, "activeTraceId", { value: "active-task", writable: true });
  await fixture.checkAuthentication();
  assert.equal(page.probes, 0);
  fixture.activeTraceId = null;
  fixture.interactionModeOverride = "manual";
  assert.throws(() => fixture.checkAuthentication(), /disabled in Zero Risk/);
  fixture.queueAuthenticationCheck();
  assert.equal(timers.size, 0);
  fixture.interactionModeOverride = "automatic";
  page.executeJavaScript = () => new Promise(() => {});
  const check = fixture.checkAuthentication();
  await flush();
  page.emit("did-navigate-in-page", {}, page.url, true);
  await flush();
  fixture.queueAuthenticationCheck();
  fixture.cancelAuthenticationCheck();
  await check;
  assert.equal(fixture.authenticationCheck, null);
  assert.equal(fixture.state.authenticationStatus, "unknown");
  cleaned(fixture, timers, page);
});

test("opening an already loaded browser rechecks its session", async () => {
  const page = contents("https://chatgpt.com/"), fixture = host(page);
  fixture.show = () => {};
  fixture.selectedTurnTab = () => null;
  assert.equal((await fixture.reveal()).authenticated, true);
  assert.equal(page.probes, 1);
  assert.deepEqual(page.loads, []);
});

test("a hanging renderer is bounded, shared callers settle, and a fresh probe can succeed", async t => {
  const timers = clock(t);
  const page = contents();
  const pending = deferred();
  page.executeJavaScript = () => pending.promise;
  const fixture = host(page);
  fixture.state.authenticated = true;
  const first = fixture.probeAuthentication();
  const second = fixture.probeAuthentication();
  await flush();
  assert.equal(timers.size, 1, "concurrent callers share one renderer deadline");
  t.mock.timers.tick(5_999);
  assert.ok(fixture.authenticationProbe);
  t.mock.timers.tick(1);
  for (const state of await Promise.all([first, second])) {
    assert.equal(state.authenticated, false);
    assert.equal(state.status, "error");
    assert.match(state.message, /timed out/);
  }
  cleaned(fixture, timers, page);
  page.executeJavaScript = async () => result(true);
  assert.equal((await fixture.probeAuthentication()).authenticated, true);
  const newer = fixture.snapshot();
  pending.resolve(result(false));
  await flush();
  assert.deepEqual(fixture.snapshot(), newer);
  cleaned(fixture, timers, page);
});

const interruptions = [
  ["main navigation", page => page.emit("did-start-navigation", {
    url: "https://chatgpt.com/", isMainFrame: true, isSameDocument: false,
  })],
  ["legacy navigation arguments", page => page.emit("did-start-navigation", {}, page.url, false, true)],
  ["same-document navigation", page => page.emit("did-start-navigation", {
    url: "https://chatgpt.com/c/new", isMainFrame: true, isSameDocument: true,
  })],
  ["in-page navigation", page => page.emit("did-navigate-in-page", {}, page.url, true)],
  ["renderer loss", page => page.emit("render-process-gone", {}, { reason: "crashed" })],
  ["destruction", page => page.close()],
];
for (const [name, interrupt] of interruptions) {
  test(`${name} promptly invalidates pending inspection without stale success or navigation`, async t => {
    const timers = clock(t);
    const page = contents("https://chatgpt.com/");
    const pending = deferred();
    page.executeJavaScript = () => pending.promise;
    const fixture = host(page);
    fixture.manualOperation = "ChatGPT login";
    fixture.state.authenticated = true;
    const operation = fixture.probeAuthentication();
    await flush();
    interrupt(page);
    assert.equal(fixture.authenticationProbe, null, "invalidation synchronously releases the cache");
    fixture.setState({ status: "loading", message: "new document", authenticated: false });
    assert.equal((await operation).authenticated, false);
    cleaned(fixture, timers, page);
    const newer = fixture.snapshot();
    pending.resolve(result(true, "https://chatgpt.com/"));
    await flush();
    assert.deepEqual(fixture.snapshot(), newer);
    assert.deepEqual(page.loads, [], "late authentication cannot navigate the new document");
  });
}

test("an invalidated probe's finalizer cannot clear its pending replacement", async t => {
  const timers = clock(t);
  const page = contents();
  const old = deferred();
  const fresh = deferred();
  page.executeJavaScript = () => old.promise;
  const fixture = host(page);
  const previous = fixture.probeAuthentication();
  await flush();
  interruptions[0][1](page);
  page.executeJavaScript = () => fresh.promise;
  const replacement = fixture.probeAuthentication();
  const cached = fixture.authenticationProbe;
  await previous;
  assert.equal(fixture.authenticationProbe, cached);
  assert.equal(timers.size, 1);
  old.reject(new Error("late renderer rejection"));
  await flush();
  assert.equal(fixture.authenticationProbe, cached);
  fresh.resolve(result(true));
  assert.equal((await replacement).authenticated, true);
  cleaned(fixture, timers, page);
});

test("subframe navigation does not invalidate the main document's endpoint proof", async t => {
  const timers = clock(t);
  const page = contents();
  const pending = deferred();
  page.executeJavaScript = () => pending.promise;
  const fixture = host(page);
  const operation = fixture.probeAuthentication();
  await flush();
  page.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  page.emit("did-navigate-in-page", {}, "about:blank", false);
  pending.resolve(result(true));
  assert.equal((await operation).authenticated, true);
  cleaned(fixture, timers, page);
});

for (const surface of ["primary", "popup"]) {
  test(`${surface} navigation invalidates a hanging popup check and its late redirect`, async t => {
    const timers = clock(t);
    const page = contents();
    page.executeJavaScript = async () => result(false);
    const popup = contents("https://chatgpt.com/auth/login");
    const pending = deferred();
    popup.executeJavaScript = () => pending.promise;
    const fixture = host(page, popup);
    const operation = fixture.probeAuthentication();
    await flush();
    interruptions[0][1](surface === "primary" ? page : popup);
    assert.equal((await operation).authenticated, false);
    pending.resolve(result(true, popup.url));
    await flush();
    assert.deepEqual(page.loads, []);
    assert.deepEqual(fixture.closed, []);
    assert.deepEqual(fixture.changes, []);
    cleaned(fixture, timers, page, popup);
  });
}

test("popup and primary replacement cannot let a timed-out old check overwrite new state", async t => {
  const timers = clock(t);
  const page = contents();
  page.executeJavaScript = () => new Promise(() => {});
  const popup = contents();
  const fixture = host(page, popup);
  const operation = fixture.probeAuthentication();
  await flush();
  fixture.view = { webContents: contents() };
  fixture.authView = { webContents: contents() };
  fixture.setState({ authenticated: true, message: "new surface" });
  const newer = fixture.snapshot();
  t.mock.timers.tick(6_000);
  assert.equal((await operation).authenticated, false);
  assert.deepEqual(fixture.snapshot(), newer);
  cleaned(fixture, timers, page, popup);
});

test("a hanging popup inspection has its own host deadline and cannot close a newer popup", async t => {
  const timers = clock(t);
  const page = contents();
  page.executeJavaScript = async () => result(false);
  const popup = contents();
  const pending = deferred();
  popup.executeJavaScript = () => pending.promise;
  const fixture = host(page, popup);
  const operation = fixture.probeAuthentication();
  await flush();
  t.mock.timers.tick(6_000);
  assert.equal((await operation).authenticated, false);
  cleaned(fixture, timers, page, popup);
  fixture.authView = { webContents: contents() };
  pending.resolve(result(true));
  await flush();
  assert.deepEqual(page.loads, []);
  assert.deepEqual(fixture.closed, []);
});

test("a late result is rejected even before the host timeout callback gets CPU time", async t => {
  const timers = clock(t);
  const page = contents();
  const pending = deferred();
  page.executeJavaScript = () => pending.promise;
  const fixture = host(page);
  const operation = fixture.probeAuthentication();
  await flush();
  t.mock.timers.setTime(Date.now() + 6_000);
  pending.resolve(result(true));
  assert.equal((await operation).authenticated, false);
  assert.equal(fixture.state.status, "error");
  cleaned(fixture, timers, page);
});

test("synchronous renderer failure also releases the probe's timers and listeners", async t => {
  const timers = clock(t);
  const page = contents();
  page.executeJavaScript = () => { throw new Error("fixture renderer unavailable"); };
  const fixture = host(page);
  await assert.rejects(fixture.probeAuthentication(), /fixture renderer unavailable/);
  cleaned(fixture, timers, page);
  page.executeJavaScript = async () => result(true);
  assert.equal((await fixture.probeAuthentication()).authenticated, true);
  cleaned(fixture, timers, page);
});

test("owned popup closure and login navigation still require fresh primary endpoint proof", async t => {
  const timers = clock(t);
  const page = contents("https://chatgpt.com/auth/login");
  page.executeJavaScript = async () => result(false, page.url);
  const popup = contents();
  const fixture = host(page, popup);
  const state = await fixture.probeAuthentication();
  assert.deepEqual(page.loads, [TEMPORARY_CHAT_URL]);
  assert.equal(fixture.closed.length, 1);
  assert.equal(state.authenticated, false, "popup authentication alone is not primary proof");
  assert.equal(state.status, "signed-out");
  cleaned(fixture, timers, page, popup);
});

for (const interrupt of [false, true]) {
  test(`login navigation is bounded and late load completion is inert (interrupted=${interrupt})`, async t => {
    const timers = clock(t);
    const page = contents("https://chatgpt.com/");
    const load = deferred();
    const start = page.loadURL;
    page.loadURL = url => { void start.call(page, url); return load.promise; };
    const fixture = host(page);
    fixture.manualOperation = "ChatGPT login";
    const operation = fixture.probeAuthentication();
    await flush();
    assert.equal(page.probes, 1);
    assert.deepEqual(page.loads, [TEMPORARY_CHAT_URL]);
    if (interrupt) interruptions[0][1](page);
    else t.mock.timers.tick(60_000);
    assert.equal((await operation).authenticated, false);
    const newer = fixture.snapshot();
    load.resolve();
    await flush();
    assert.equal(page.probes, 1, "late load completion must not inspect the replacement document");
    assert.deepEqual(fixture.snapshot(), newer);
    cleaned(fixture, timers, page);
  });
}

test("successful login navigation is allowed once and re-proves the temporary document", async t => {
  const timers = clock(t);
  const page = contents("https://chatgpt.com/");
  const fixture = host(page);
  fixture.manualOperation = "ChatGPT login";
  assert.equal((await fixture.probeAuthentication()).authenticated, true);
  assert.equal(page.probes, 2);
  assert.deepEqual(page.loads, [TEMPORARY_CHAT_URL]);
  cleaned(fixture, timers, page);
});

test("polling enforces a shorter caller deadline even for an already cached hanging probe", async t => {
  const timers = clock(t);
  const page = contents();
  const pending = deferred();
  page.executeJavaScript = () => pending.promise;
  const fixture = host(page);
  const cached = fixture.probeAuthentication();
  await flush();
  const wait = assert.rejects(fixture.waitForAuthenticated(100), /login was not completed before the timeout/);
  t.mock.timers.tick(100);
  await wait;
  assert.equal((await cached).authenticated, false);
  cleaned(fixture, timers, page);
  page.executeJavaScript = async () => result(true);
  assert.equal((await fixture.waitForAuthenticated(100)).authenticated, true);
  pending.resolve(result(false));
  await flush();
  assert.equal(fixture.state.authenticated, true);
  cleaned(fixture, timers, page);
});

test("polling sleep respects the remaining deadline and leaves no timers", async t => {
  const timers = clock(t);
  const fixture = host();
  fixture.view.webContents.executeJavaScript = async () => result(false);
  const wait = assert.rejects(fixture.waitForAuthenticated(100), /login was not completed before the timeout/);
  await flush();
  t.mock.timers.tick(100);
  await wait;
  cleaned(fixture, timers, fixture.view.webContents);
});

test("host destruction settles active inspection and removes its listeners", async t => {
  const timers = clock(t);
  const page = contents();
  page.executeJavaScript = () => new Promise(() => {});
  const fixture = host(page);
  fixture.window = new EventEmitter();
  fixture.shellZoomShortcutBindings = new Map();
  fixture.windowVisibilityListener = () => {};
  fixture.powerSaveBlockerId = null;
  const operation = fixture.probeAuthentication();
  await flush();
  fixture.destroy();
  assert.equal((await operation).authenticated, false);
  cleaned(fixture, timers, page);
});

test("a stalled home load releases connector verification without calling its helper", async t => {
  const timers = clock(t);
  const page = contents(IDLE_BROWSER_URL);
  const load = deferred();
  page.loadURL = () => load.promise;
  const fixture = host(page);
  let helpers = 0;
  fixture.verifyConnectorWithBrowserHelper = async () => { helpers += 1; };
  const operation = assert.rejects(fixture.verifyConnector("fixture"), /hard refresh did not finish/);
  await flush();
  assert.equal(fixture.manualOperation, "connector verification");
  t.mock.timers.tick(60_000);
  await operation;
  assert.equal(fixture.manualOperation, null);
  assert.equal(fixture.state.status, "error");
  assert.equal(helpers, 0);
  assert.equal(timers.size, 0);
  assert.deepEqual(page.eventNames(), []);
  load.resolve();
  await flush();
  assert.equal(helpers, 0);
});

test("home load completion events release a hanging loadURL before authentication is checked", async t => {
  const timers = clock(t);
  const page = contents(IDLE_BROWSER_URL);
  page.loadURL = url => {
    page.url = url;
    queueMicrotask(() => {
      page.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false });
      page.emit("did-stop-loading");
    });
    return new Promise(() => {});
  };
  const fixture = host(page);
  await fixture.refreshChatGptHomeDocument();
  assert.equal(fixture.state.authenticated, true);
  cleaned(fixture, timers, page);
});

test("connector verification releases its manual-operation lock when renderer inspection hangs", async t => {
  const timers = clock(t);
  const page = contents();
  page.reloadIgnoringCache = () => {
    page.emit("did-start-navigation", { url: page.url, isMainFrame: true, isSameDocument: false });
    page.emit("did-finish-load");
  };
  const pending = deferred();
  page.executeJavaScript = () => pending.promise;
  const fixture = host(page);
  let helpers = 0;
  fixture.verifyConnectorWithBrowserHelper = async () => { helpers += 1; return { verified: true }; };
  const operation = assert.rejects(fixture.verifyConnector("fixture"), /login was not completed before the timeout/);
  await flush();
  assert.equal(fixture.manualOperation, "connector verification");
  t.mock.timers.tick(60_000);
  await operation;
  assert.equal(fixture.manualOperation, null);
  assert.equal(helpers, 0);
  cleaned(fixture, timers, page);
  page.executeJavaScript = async () => result(true);
  assert.deepEqual(await fixture.verifyConnector("fixture"), { verified: true });
  assert.equal(fixture.manualOperation, null);
  assert.equal(helpers, 1);
  const newer = fixture.snapshot();
  pending.resolve(result(false));
  await flush();
  assert.deepEqual(fixture.snapshot(), newer);
  cleaned(fixture, timers, page);
});
