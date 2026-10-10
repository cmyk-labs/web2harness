const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcherRoot = path.resolve(__dirname, "../..");

test("shared videos are reachable through the isolated development asset server", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: path.join(launcherRoot, "vite.config.ts"),
    root: launcherRoot,
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const source = await fetch(`${base}/src/features/workspace/pages/Connection.tsx`).then(response => response.text());
    const urls = new Set([...source.matchAll(/(["'`])([^"'`]*mcp-(?:create-tunnel|connect-connector)\.mp4)\1/g)].map(match => match[2]));
    assert.equal(urls.size, 2, "both configured guide videos must be present");
    for (const url of urls) {
      const response = await fetch(new URL(url, base));
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get("content-type"), /video\/mp4/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(launcherRoot, "..", "assets", "demos", path.basename(url))));
    }
  } finally {
    await server.close();
  }
});
const readRenderer = name => fs.readFileSync(path.join(launcherRoot, "src", name), "utf8");
const appSource = [
  "App.tsx", "features/shell/LauncherShell.tsx", "features/shell/TitleBar.tsx",
  "features/browser/BrowserSurface.tsx", "features/browser/ManualTurnGuide.tsx",
  "features/browser/SessionRefreshReminder.tsx", "features/browser/presentation.ts",
  "features/startup/Onboarding.tsx", "components/ErrorToast.tsx",
].map(readRenderer).join("\n");
const workspaceSource = [
  "features/workspace/WorkspaceContent.tsx", "features/workspace/WorkspaceSidebar.tsx",
  "features/workspace/labels.ts", "features/workspace/status.ts",
  "features/workspace/useConnectionSetup.ts", "features/workspace/Report.tsx",
  "features/workspace/pages/Overview.tsx", "features/workspace/pages/Connection.tsx",
  "features/workspace/pages/Preferences.tsx", "features/workspace/pages/Diagnostics.tsx", "features/workspace/pages/Logs.tsx",
  "features/workspace/pages/RuntimeControls.tsx",
].map(readRenderer).join("\n");
const stylesSource = fs.readFileSync(path.join(launcherRoot, "src", "styles.css"), "utf8");
const electronMain = fs.readFileSync(path.join(launcherRoot, "electron", "main.cjs"), "utf8");
const browserHostSource = fs.readFileSync(path.join(launcherRoot, "electron", "browser", "browser-host.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(launcherRoot, "electron", "preload.cjs"), "utf8");

test("embedded ChatGPT is measured only after its animated surface mounts", () => {
  assert.match(appSource, /const \[browserSlot, setBrowserSlot\] = useState<HTMLDivElement \| null>\(null\)/);
  assert.match(appSource, /setBrowserSurfaceActive\(browserSurfaceActive\)\s*\.then\(\(\) => \{/);
  assert.match(appSource, /observer\.observe\(browserSlot\)/);
  assert.match(appSource, /ref=\{browserSlotRef\}/);
});

test("native clicks reach browser tabs instead of the window drag region", () => {
  assert.match(appSource, /draggable=\{surface !== "browser"\}/);
  assert.match(appSource, /className=\{`app-titlebar\$\{draggable \? " draggable" : ""\}`\}/);
  assert.match(stylesSource, /\.browser-tab\s*\{[^}]*-webkit-app-region:\s*no-drag;/s);
  assert.match(appSource, /className="browser-tab-drag draggable"/);
});

test("renderer zoom scales the shell without moving or zooming the native ChatGPT surface", () => {
  assert.match(
    electronMain,
    /browserHost\?\.setBounds\(validateBounds\(bounds\), event\.sender\.getZoomFactor\(\)\)/,
  );
  assert.match(browserHostSource, /this\.bindShellZoomShortcuts\(this\.window\.webContents\)/);
  assert.match(browserHostSource, /contents\.setZoomLevel\(next\)/);
  assert.match(appSource, /api!\.zoomBrowser\(action\)/);
});

test("closing the launcher follows the persisted background-runtime preference", () => {
  assert.match(
    electronMain,
    /if \(stateStore\.read\(\)\.keepRunningOnClose && tray\) window\.hide\(\);\s*else void requestQuit\(\);/,
  );
  assert.match(workspaceSource, /toggle\(\s*["']keepRunningOnClose["']/);
  assert.match(workspaceSource, /api\.setPreference\(key,\s*value\)/);
});

test("a foreground launch request survives hidden startup until the launcher window is ready", () => {
  const showMainWindow = electronMain.slice(
    electronMain.indexOf("function showMainWindow()"),
    electronMain.indexOf("async function openWebUrl"),
  );
  assert.match(
    showMainWindow,
    /mainWindowShowRequested = true;[\s\S]*?!mainWindowReadyToShow[\s\S]*?mainWindowShowRequested = false;/,
  );

  const readyHandler = electronMain.slice(
    electronMain.indexOf('window.once("ready-to-show"'),
    electronMain.indexOf("trackWindowState(window", electronMain.indexOf('window.once("ready-to-show"')),
  );
  assert.match(
    readyHandler,
    /mainWindowReadyToShow = true;[\s\S]*?if \(mainWindowShowRequested\) showMainWindow\(\);/,
  );

  const secondInstance = electronMain.indexOf('app.on("second-instance", () => showMainWindow())');
  const runtimeMaterialization = electronMain.indexOf("runtimePreparation = prepareRuntimeInBackground", secondInstance);
  assert.ok(secondInstance >= 0, "the second-instance foreground request must be registered");
  assert.ok(
    runtimeMaterialization > secondInstance,
    "the foreground request must be registered before packaged-runtime startup can block window creation",
  );
});

test("normal shutdown persists the ChatGPT session before closing browser views", () => {
  assert.match(
    electronMain,
    /runtimeSupervisor\?\.shutdown\(\{ cancelActiveTurns: true, force: true \}\)/,
  );
  const persist = electronMain.indexOf("await browserHost?.persistSession()");
  const destroy = electronMain.indexOf("browserHost?.destroy()", persist);
  assert.ok(persist >= 0, "shutdown must persist the ChatGPT session");
  assert.ok(destroy > persist, "browser views must close only after session persistence completes");
});

test("setup preserves session-check failures and never installs without verified authentication", async () => {
  const vm = require("node:vm");
  const source = electronMain.slice(
    electronMain.indexOf('handle("launcher:setup-core",'),
    electronMain.indexOf('handle("launcher:setup-mcp",'),
  );
  for (const dev of [false, true]) {
    let setup;
    let installs = 0;
    let browser = { authenticated: false, status: "error", message: "ChatGPT session verification failed (HTTP 503)." };
    const state = { browserInteractionMode: "automatic", coreSetupComplete: false };
    const run = async () => { installs++; return { mode: "browser-only", stdout: "" }; };
    vm.runInNewContext(source, {
      handle: (_name, handler) => { setup = handler; }, IS_DEV_PROFILE: dev,
      stateStore: { read: () => state, update() {} },
      browserHost: { probeAuthentication: async () => browser, returnToIdle: async () => {} },
      runtimeHost: { setupCore: run, setupDevCore: run, runtimeConfigSnapshot: () => ({ config: {} }) },
      smokePassedThisSession: true, send() {}, startCatalogVerificationMonitor() {}, logger: {},
    });
    await assert.rejects(setup, error => error.message === browser.message);
    assert.equal(installs, 0);
    browser = { authenticated: false, status: "signed-out", message: "Sign in to ChatGPT" };
    await assert.rejects(setup, /Sign in to/);
    assert.equal(installs, 0);
    browser = { authenticated: true, status: "ready", message: "ChatGPT is ready" };
    assert.equal((await setup()).ok, true);
    assert.equal(installs, 1);
  }
});

test("startup failure stays visible on another launch and Retry exits the failed instance", async () => {
  const vm = require("node:vm");
  const source = electronMain.slice(electronMain.indexOf("function showMainWindow()"), electronMain.indexOf("async function openWebUrl"))
    + electronMain.slice(electronMain.indexOf("void start().catch("));
  const events = [];
  let visible = false;
  let answer;
  const dialogOpened = new Promise(resolve => {
    answer = { opened: resolve };
  });
  const window = { isDestroyed: () => false, isMinimized: () => false,
    show: () => { visible = true; }, focus() {}, };
  const sandbox = {
    mainWindow: window, mainWindowReadyToShow: false, mainWindowShowRequested: false,
    startupFailed: false, quitting: false, rendererLoaded: false, startupLogger: null, startup: { fail() {}, snapshot: () => ({ stage: "initializing-browser" }) },
    browserHost: { destroy: () => events.push("destroy") },
    browserControl: { close: async () => events.push("control closed") },
    start: async () => { throw new Error("Browser idle document did not commit within 10000ms"); },
    app: { getPath: () => "/unused", whenReady: async () => {},
      relaunch: options => events.push(["relaunch", options.args]), exit: code => events.push(["exit", code]) },
    fs: { appendFileSync() {} }, path,
    createStateStore: () => ({ read: () => ({ language: "zh-CN" }) }),
    nativeCopyFor: language => {
      assert.equal(language, "zh-CN");
      return { startupTitle: "启动错误", startupDetail: "重新启动", startupCleanupFailed: "清理失败", retry: "重试", quit: "退出" };
    },
    launchEnvironment: { WEB2HARNESS_HOME: undefined, CODEX_HOME: "original-codex-home" },
    process: { argv: ["launcher", "--hidden"], env: { WEB2HARNESS_HOME: "dev-home", CODEX_HOME: "dev-codex-home" } },
    dialog: {
      showErrorBox: () => { answer.opened(); },
      showMessageBox: (owner, options) => {
        assert.equal(options.title, "启动错误");
        assert.deepEqual(Array.from(options.buttons), ["重试", "退出"]);
        events.push(["dialog", owner === window, options.message]);
        answer.opened();
        return new Promise(resolve => { answer.resolve = resolve; });
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  await dialogOpened;
  assert.equal(visible, true, "the failed startup must expose its error owner without renderer readiness");
  assert.deepEqual(events.slice(0, 2), ["destroy", "control closed"]);
  visible = false;
  sandbox.showMainWindow();
  assert.equal(visible, true, "a second launch must restore the existing startup error window");
  assert.equal(events.some(event => Array.isArray(event) && event[0] === "exit"), false);
  answer.resolve({ response: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.at(-2)[0], "relaunch");
  assert.deepEqual(Array.from(events.at(-2)[1]), []);
  assert.deepEqual(events.at(-1), ["exit", 1]);
  assert.deepEqual(sandbox.process.env, { CODEX_HOME: "original-codex-home" });
});

test("hidden startup stays reachable when tray creation fails after the startup screen painted", () => {
  const vm = require("node:vm");
  const begin = electronMain.indexOf("  if (startHidden && !trayAvailable) {");
  const source = electronMain.slice(begin, electronMain.indexOf("  await loadRenderer(mainWindow);", begin));
  for (const ready of [false, true]) {
    let shown = 0, listener;
    vm.runInNewContext(source, {
      startHidden: true, trayAvailable: false, mainWindowReadyToShow: ready,
      showMainWindow() { shown++; },
      mainWindow: { once(event, callback) { assert.equal(event, 'ready-to-show'); listener = callback; } },
    });
    if (!ready) { assert.equal(shown, 0); listener(); }
    assert.equal(shown, 1);
  }
});

test("the shell paints before runtime preparation, while helpers wait for verification", () => {
  const start = electronMain.indexOf("async function start()");
  const runtimeValidation = electronMain.indexOf("installedRuntimeRoot = await runtimePreparation", start);
  const cdpPortAllocation = electronMain.indexOf("cdpPort = await findFreePort();", start);
  const windowCreation = electronMain.indexOf("mainWindow = createWindow({", start);
  const controlServerStart = electronMain.indexOf("browserControl = await new BrowserControlServer({", start);
  const browserReady = electronMain.indexOf("await browserHost.ready();", start);

  const startupPaint = electronMain.indexOf("await loadRenderer(mainWindow)", start);
  assert.ok(cdpPortAllocation > start && windowCreation > cdpPortAllocation);
  assert.ok(startupPaint > windowCreation && runtimeValidation > startupPaint, "the static shell must paint before runtime work");
  for (const [surface, position] of [
    ["browser control server", controlServerStart],
    ["embedded browser", browserReady],
  ]) {
    assert.ok(position > runtimeValidation, `${surface} must start only after runtime verification`);
  }
  const renderer = electronMain.indexOf("await loadRenderer(mainWindow)", start);
  assert.ok(renderer < browserReady, "renderer loading must not wait for embedded browser readiness");
  assert.match(electronMain, /path\.join\(installedRuntimeRoot, "app", "browser-helper\.cjs"\)/);
});

test("DEV launcher exposes its profile and recognizes its MCP Bridge runtime", () => {
  assert.match(electronMain, /profile:\s*LAUNCHER_PROFILE\.kind/);
  assert.match(electronMain, /if \(IS_DEV_PROFILE\) \{[\s\S]*?config\?\.mode === "mcp-bridge"[\s\S]*?runtimeSupervisor\.startIfConfigured\(\)[\s\S]*?\} else void \(async \(\) => \{/);
  assert.match(electronMain, /await runtimeSupervisor\?\.shutdown\(\{ cancelActiveTurns: true, force: true \}\)/);
  assert.match(electronMain, /packaged:\s*app\.isPackaged && !IS_DEV_PROFILE/);
  assert.doesNotMatch(electronMain, /IS_DEV_PROFILE && !stateStore\.read\(\)\.onboardingComplete/);
  assert.match(electronMain, /await licenseController\.waitForActivation\(\)/);
  assert.match(appSource, /snapshot\.profile\s*===\s*["']development["']/);
  assert.match(appSource, /data-profile=\{snapshot\.profile\}/);
  assert.match(workspaceSource, /manualContextFilesUnavailable[\s\S]*?copy\.contextFilesBody/);
  assert.match(workspaceSource, /api\.setContextFiles\(value\)/);
  assert.match(electronMain, /\["launcher:context-files", "setContextFiles"\]/);
  assert.match(electronMain, /runtimeHost\[method\]\(enabled === true\)/);
  assert.doesNotMatch(electronMain, /IS_DEV_PROFILE && key === "experimentalContextFiles"/);
});

test("macOS passkey sign-in is additive to the unchanged embedded login action", () => {
  assert.match(workspaceSource, /activateBrowser\(true\)/);
  assert.match(appSource, /<BrowserSurface[\s\S]*?operation=\{operation\}[\s\S]*?platform=\{snapshot\.platform\}/);
  assert.match(appSource, /const passkeyAvailable =\s*!manualInteraction[\s\S]*?platform === "darwin"[\s\S]*?browser\?\.authenticated !== true/);
  assert.match(appSource, /\{passkeyAvailable \? \([\s\S]*?className="toolbar-text-button"[\s\S]*?copy\.passkeySignIn/);
  assert.match(appSource, /className="browser-empty-actions"[\s\S]*?copy\.passkeySignIn/);
  assert.match(appSource, /passkeyWaiting \? continuePasskeyLogin : openPasskeyLogin/);
  assert.match(preloadSource, /openPasskeyLogin:[\s\S]*?launcher:browser-passkey-login/);
  assert.match(preloadSource, /continuePasskeyLogin:[\s\S]*?launcher:browser-passkey-login-continue/);
  assert.match(electronMain, /launcher:browser-passkey-login[\s\S]*?browserHost\.openPasskeyLogin\(\)/);
  assert.match(electronMain, /loginWithPasskey: \(\) => runtimeHost\.capturePasskeyLogin\(\)/);
  assert.match(browserHostSource, /await this\.waitForAuthenticated\(60_000\)[\s\S]*?runSessionInspection\(false\)/);
});

test("Context file transport is opt-in under experiments, without a startup modal", () => {
  assert.doesNotMatch(appSource, /BiggerContextRecommendation/);
  assert.match(workspaceSource, /<details>\s*<summary>[\s\S]*?Experimental features/);
  assert.match(workspaceSource, /api\.setContextFiles\(value\)/);
});

test("Zero Risk setup commits state after the runtime transaction and preserves manual inspection boundaries", () => {
  const modeSwitchHandler = electronMain.slice(
    electronMain.indexOf('handle("launcher:browser-interaction-mode"'),
    electronMain.indexOf('handle("launcher:set-preference"'),
  );
  const modeTransaction = modeSwitchHandler.indexOf("await browserHost.withInteractionModeChange(");
  const runtimeModeCommit = modeSwitchHandler.indexOf("runtimeHost.setBrowserInteractionMode(mode, afterRuntimeReady)");
  const stateModeCommit = modeSwitchHandler.indexOf("const state = stateStore.update({");
  assert.ok(modeTransaction >= 0 && modeTransaction < runtimeModeCommit);
  assert.ok(runtimeModeCommit < stateModeCommit);

  const mcpSetupHandler = electronMain.slice(
    electronMain.indexOf('handle("launcher:setup-mcp"'),
    electronMain.indexOf('handle("launcher:set-mcp-step"'),
  );
  const runtimeMcpCommit = mcpSetupHandler.indexOf("const runSetup = afterRuntimeReady => setup({");
  const mcpTransaction = mcpSetupHandler.indexOf("await browserHost.withInteractionModeChange(interactionMode, runSetup)");
  const stateMcpCommit = mcpSetupHandler.indexOf("const state = stateStore.update({");
  assert.ok(runtimeMcpCommit >= 0 && runtimeMcpCommit < mcpTransaction);
  assert.ok(mcpTransaction < stateMcpCommit);
  assert.match(browserHostSource, /bindManualTurnContents\(tab\)/);
  const manualBinding = browserHostSource.slice(
    browserHostSource.indexOf("bindManualTurnContents(tab)"),
    browserHostSource.indexOf("bindWebContents()"),
  );
  assert.doesNotMatch(manualBinding, /executeJavaScript|insertCSS|querySelector|runBrowserHelperOperation|enableDeviceEmulation/);
  assert.match(browserHostSource, /requireAutomaticBrowserInspection\(this, "ChatGPT authentication probe"\)/);
  assert.match(browserHostSource, /requireAutomaticBrowserInspection\(this, "ChatGPT session and capability inspection"\)/);
  assert.match(browserHostSource, /browserInteractionModeFor\(this\) === "manual"\) return;[\s\S]*?applyViewportCss\(\)/);
  assert.match(
    browserHostSource,
    /page-title-updated[\s\S]*?browserInteractionModeFor\(this\) === "manual"\) return;/,
  );
  assert.doesNotMatch(modeSwitchHandler, /const pending = stateStore\.update|catch \(error\)/);
  assert.match(electronMain, /browserInteractionMode === "manual"[\s\S]*?Local Zero Risk runtime is healthy/);

});

test("MCP automatic setup keeps the catalog gate", () => {
  assert.match(workspaceSource, /snapshot\.state\.codexCatalogVerified\s*===\s*true/);
  assert.match(workspaceSource, /Prepare the Codex model catalog and refresh it in Codex first\./);
});

test("MCP mode changes are drafts and runtime operations lock submission", () => {
  assert.match(workspaceSource, /working\s*\|\|\s*workspaceBusy\(browser,\s*operation\)/);
  assert.match(workspaceSource, /if\s*\(busy\)\s*return/);
  assert.match(workspaceSource, /const chooseMode[\s\S]*?setDraft\(value\);[\s\S]*?setDirty\(true\)/);
  assert.match(workspaceSource, /disabled=\{!canApply\}/);
});

test("failed doctor reports retain every failed check", () => {
  assert.match(workspaceSource, /report\.checks\.map\(/);
  assert.doesNotMatch(workspaceSource, /report\.checks\.slice/);
});

test("launcher shares only privacy-safe exported diagnostics", () => {
  assert.match(workspaceSource, /api\.exportLogs\(input\)/);
  assert.match(preloadSource, /exportLogs:[\s\S]*?launcher:export-logs/);
  assert.match(electronMain, /launcher:export-logs[\s\S]*?showSaveDialog[\s\S]*?runDiagnostics\("export"/);
  assert.doesNotMatch(preloadSource, /launcher:open-logs/);
  assert.doesNotMatch(electronMain, /launcher:open-logs/);
});

test("MCP verification failures stay inside the structured setup report", () => {
  assert.match(appSource, /next\.operation\.name !== "mcp-verification"/);
  assert.match(appSource, /next\.name !== "mcp-verification"/);
  assert.match(electronMain, /Finish the active Codex task before verifying the ChatGPT connector/);
  assert.match(electronMain, /report\.checks\.filter\(\(check\) => check\.id !== "connector"\)/);
  assert.match(electronMain, /mcp\.verification_requested/);
  assert.match(electronMain, /launcherFocused:\s*mainWindow\?\.isFocused\(\) === true/);
  assert.match(electronMain, /rendererFocused:\s*event\.sender\.isFocused\(\)/);
});

test("MCP verification proves runtime health before checking the connector", () => {
  const start = electronMain.indexOf('handle("launcher:mcp-verify"');
  const end = electronMain.indexOf('handle("launcher:doctor"', start);
  const handler = electronMain.slice(start, end);

  assert.ok(start >= 0 && end > start, "MCP verification handler must remain registered");
  assert.match(
    handler,
    /Checking local runtime[\s\S]*?await runtimeHost\.doctor\(\)[\s\S]*?if \(!report\.ok\)[\s\S]*?return report;[\s\S]*?Checking ChatGPT connector[\s\S]*?await browserHost\.verifyConnector/,
  );
  assert.match(handler, /publishOperation\(\{ name: operationName, status: "completed"/);
  assert.match(workspaceSource, /localizeRuntimeMessage\(\s*copy,\s*operation\.message,\s*undefined,\s*language,?\s*\)/);
});

test("saved ChatGPT authentication is refreshed before setup is presented", () => {
  assert.match(electronMain, /browserHost\.refreshAuthentication\(\)/);
  const productionStartup = electronMain.indexOf("} else void (async () => {");
  const refreshBarrier = electronMain.indexOf("await startupAuthenticationRefresh", productionStartup);
  const upgrade = electronMain.indexOf("runtimeHost.upgradeManagedRuntime()", productionStartup);
  const runtimeStart = electronMain.indexOf("runtimeSupervisor.startIfConfigured()", upgrade);
  const routeConnect = electronMain.indexOf("runtimeHost.connectBridgeRoute()", runtimeStart);
  assert.ok(refreshBarrier > productionStartup, "production startup must wait for saved-session refresh");
  assert.ok(upgrade > refreshBarrier, "runtime upgrade must not inspect the browser before refresh settles");
  assert.ok(runtimeStart > upgrade, "configured runtime must start after any upgrade");
  assert.ok(routeConnect > runtimeStart, "Codex route must connect only after the runtime is healthy");
  assert.match(workspaceSource, /browser\?\.authenticated/);
});

test("completed model setup remains a repeatable capability probe", () => {
  assert.match(workspaceSource, /snapshot\.smokePassed\s*\?\s*t\(["']重新检查["'],\s*["']Check again["']\)/);
  assert.match(workspaceSource, /api\.smokeTest\(\)/);
  assert.match(
    electronMain,
    /!setupState\.coreSetupComplete[\s\S]*?smokePassedThisSession[\s\S]*?smokePassedForCurrentVersion\(setupState\)/,
  );
});

test("catalog verification reports a failed request instead of requesting another restart, then recovers", async () => {
  const vm = require("node:vm");
  const start = electronMain.indexOf("function startCatalogVerificationMonitor(");
  const end = electronMain.indexOf("\nfunction ", start + 1);
  const source = electronMain.slice(start, end);
  const state = { coreSetupComplete: true, codexCatalogVerified: false, codexRestartRequired: true, language: "en" };
  const operations = [];
  const events = [];
  let tick;
  let payload = { pid: 10, successful_model_catalog_requests: 0, model_catalog_requests: 0, last_model_catalog_result: null };
  vm.runInNewContext(source + "\nstartCatalogVerificationMonitor({ logger, stateStore });", {
    catalogVerificationInFlight: false, catalogVerificationTimer: null, lastOperation: null,
    stopCatalogVerificationMonitor() {},
    runtimeSupervisor: { readConfig: () => ({}), proxyHealthPayload: async () => payload },
    stateStore: { read: () => state, update: patch => Object.assign(state, patch) },
    setInterval: callback => { tick = callback; return { unref() {} }; },
    logger: { info: (...args) => events.push(args), warn: (...args) => events.push(args), debug() {} },
    send() {}, publishOperation: op => operations.push(op),
    nativeCopyFor: () => ({ catalogFailure: "Catalog failed (HTTP {status}; {reason})." }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(operations.length, 0);
  assert.equal(state.codexRestartRequired, true);
  payload = { ...payload, model_catalog_requests: 1, last_model_catalog_result: {
    request: 1, at: "2026-09-16T10:00:00Z", status: 502, failure: { stage: "transport", code: "UnsupportedProxyProtocol" },
  } };
  await tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.codexCatalogVerified, false);
  assert.equal(state.codexRestartRequired, false);
  assert.equal(operations[0]?.status, "failed");
  assert.match(operations[0].message, /502.*UnsupportedProxyProtocol/);
  await tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(operations.length, 1, "polling must not repeat the same failure");
  payload = { ...payload, successful_model_catalog_requests: 1, last_successful_model_catalog_request_at: "2026-09-16T10:01:00Z" };
  await tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.codexCatalogVerified, true);
  assert.equal(state.codexRestartRequired, false);
  assert.ok(events.some(([event]) => event === "codex.model_catalog_verified"));
});

test("fresh-conversation IPC commits only after setup succeeds and refuses active browser work", async () => {
  const vm = require("node:vm");
  for (const savedChats of [false, true]) {
    const property = savedChats ? "useSavedChats" : "experimentalFreshConversationPerTurn";
    const method = savedChats ? "setUseSavedChats" : "setFreshConversationPerTurn";
    const channel = savedChats ? "launcher:use-saved-chats" : "launcher:fresh-conversation-per-turn";
    const nextChannel = savedChats ? "launcher:zero-risk-pro" : "launcher:use-saved-chats";
    const source = electronMain.slice(
      electronMain.indexOf(`handle("${channel}",`),
      electronMain.indexOf(`handle("${nextChannel}",`),
    );
    const state = { experimentalFreshConversationPerTurn: false, useSavedChats: false };
    const config = { experimentalFreshConversationPerTurn: false, useSavedChats: false };
    const events = [];
    let handler, finishSetup, setupFailure, calls = 0;
    const browserHost = { activeTraceId: "running-turn", currentOperation: () => null, turnTabs: new Map() };
    const syncSource = electronMain.slice(electronMain.indexOf("function syncFreshConversationPreference("), electronMain.indexOf("function registerIpc("));
    vm.runInNewContext(syncSource + source, {
      handle: (_channel, callback) => { handler = callback; }, browserHost,
      releaseRetainedConversation: require("../../electron/runtime/retained-turn-release.cjs").releaseRetainedConversation,
      runtimeHost: { currentOperation: () => null, runtimeConfigSnapshot: () => ({ config }), [method]: async enabled => {
        calls++;
        if (setupFailure) throw setupFailure;
        await new Promise(resolve => { finishSetup = resolve; });
        config[property] = enabled;
        return { enabled };
      } },
      stateStore: { read: () => ({ ...state }), update: patch => Object.assign(state, patch) },
      send: (channel, value) => events.push({ channel, value: { ...value } }),
    });
    await assert.rejects(() => handler(null, true), /Finish or cancel active ChatGPT turns/);
    browserHost.activeTraceId = null;
    browserHost.currentOperation = () => "browser-smoke";
    await assert.rejects(() => handler(null, true), /Finish or cancel active ChatGPT turns/);
    assert.equal(calls, 0);
    browserHost.currentOperation = () => null;
    let api;
    vm.runInNewContext(preloadSource, { require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (actualChannel, enabled) => {
        assert.equal(actualChannel, channel);
        return handler(null, enabled);
      } },
    }) });
    const changing = api[method](true);
    assert.equal(state[property], false);
    assert.equal(events.length, 0);
    finishSetup();
    assert.equal((await changing)[property], true);
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "launcher:state-changed");
    setupFailure = new Error("synthetic setup rollback");
    await assert.rejects(() => api[method](false), /synthetic setup rollback/);
    assert.equal(state[property], true);
    assert.equal(events.length, 1);
  }
});

test("fresh-conversation snapshot uses runtime configuration and mode switching preserves the preference", async () => {
  const vm = require("node:vm");
  const handlers = new Map();
  const state = { browserInteractionMode: "automatic", experimentalFreshConversationPerTurn: false };
  let config = { browserInteractionMode: "automatic", experimentalFreshConversationPerTurn: true };
  const runtimeHost = {
    currentOperation: () => null,
    runtimeConfigSnapshot: () => ({ config }), browserConnectorName: () => "Codex Native2",
    setupConnectorName: () => "Codex Native2", mcpCredentialsConfigured: () => true,
    setBrowserInteractionMode: async mode => { config.browserInteractionMode = mode; return { configured: true }; },
  };
  const sandbox = {
    startupFailed: false, startup: { snapshot: () => ({ status: "ready" }) },
    handle: (name, handler) => handlers.set(name, handler), runtimeHost,
    releaseRetainedConversation: require("../../electron/runtime/retained-turn-release.cjs").releaseRetainedConversation,
    stateStore: { read: () => ({ ...state }), update: patch => Object.assign(state, patch) },
    browserHost: { ready: async () => {}, activeTraceId: null, turnTabs: new Map(), currentOperation: () => null, snapshot: () => ({}),
      withInteractionModeChange: async (_mode, action) => action() },
    validateBrowserInteractionMode: mode => mode, IS_DEV_PROFILE: false, send() {}, startCatalogVerificationMonitor() {},
    LAUNCHER_PROFILE: { kind: "production", codexHome: "/fixture/codex" }, CORE_HOME: "/fixture/core",
    launcherUserData: "/fixture/launcher", logger: { recent: () => [] },
    GITHUB_URL: "", projectLinks: require("../../electron/project-links.cjs").projectLinks,
    CONNECTORS_URL: "", TUNNELS_URL: "", KEYS_URL: "",
    process: { platform: "darwin" }, app: { isPackaged: false, getVersion: () => "test" },
    smokePassedThisSession: false, smokePassedForCurrentVersion: () => false, lastOperation: null, updateController: null,
  };
  vm.runInNewContext(electronMain.slice(electronMain.indexOf("function syncFreshConversationPreference("), electronMain.indexOf("function registerIpc(")) +
    electronMain.slice(electronMain.indexOf('handle("launcher:snapshot",'),
    electronMain.indexOf('handle("launcher:set-language",')) +
    electronMain.slice(electronMain.indexOf('handle("launcher:browser-interaction-mode",'),
    electronMain.indexOf('handle("launcher:set-preference",')), sandbox);
  const snapshot = handlers.get("launcher:snapshot");
  assert.equal((await snapshot()).state.experimentalFreshConversationPerTurn, true);
  assert.equal(state.experimentalFreshConversationPerTurn, true, "snapshot synchronizes a CLI configuration change");
  const changeMode = handlers.get("launcher:browser-interaction-mode");
  for (const mode of ["manual", "automatic"]) {
    const changed = await changeMode(null, mode);
    assert.equal(changed.state.experimentalFreshConversationPerTurn, true);
    assert.equal((await snapshot()).state.experimentalFreshConversationPerTurn, true);
  }
  config = {};
  assert.equal((await snapshot()).state.experimentalFreshConversationPerTurn, false);
});

test("conversation reuse persists the inverse setting and stays disabled in manual mode", async () => {
  const ts = require("typescript"), vm = require("node:vm");
  const preferences = ts.createSourceFile("Preferences.tsx", readRenderer("features/workspace/pages/Preferences.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const source = preferences.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Preferences").getText(preferences).replace(/^export\s+/, "");
  const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,jsxFactory:"element",jsxFragmentFactory:"Fragment"}}).outputText;
  const visit = tree => Array.isArray(tree) ? tree.flatMap(visit) : tree && typeof tree === "object" ? [tree,...visit(tree.children ?? [])] : [];
  for (const language of ["en","zh-CN"]) for (const manual of [false,true]) for (const configured of [false,true]) {
    let invoked, saved;
    const sandbox = {element:(type,props,...children)=>({type,props:props??{},children}),Fragment:'Fragment',useState:value=>[value,()=>{}],useFeedback:()=>[null,()=>{},()=>{}],translate:language=>(zh,en)=>language==='en'?en:zh,copyFor:()=>({}),workspaceBusy:()=>false};
    for(const name of ['PageIntro','Section','Row','Segment','Toggle','Button'])sandbox[name]=name;
    vm.runInNewContext(code+'\nrender=Preferences;',sandbox);
    const tree=sandbox.render({api:{setFreshConversationPerTurn:async value=>{invoked=value;return {experimentalFreshConversationPerTurn:value}}},snapshot:{startup:{status:"ready"},state:{language,browserInteractionMode:manual?'manual':'automatic',coreSetupComplete:configured,experimentalFreshConversationPerTurn:false},urls:{},update:{}},updateState:state=>saved=state,setError:error=>{if(error)throw Error(error)},refresh:async()=>{}});
    const control=visit(tree).find(node=>node.type==='Segment' && node.props.label===(language==='en'?'Conversation reuse':'会话复用'));
    assert.ok(control);assert.equal(control.props.value,true);assert.equal(control.props.disabled,manual||!configured);
    if(!control.props.disabled){control.props.onChange(false);await new Promise(resolve=>setImmediate(resolve));assert.equal(invoked,true);assert.equal(saved.experimentalFreshConversationPerTurn,true);}
  }
});

test("tool-mode IPC redirects missing credentials and only commits state after successful setup", async () => {
  const handlers = new Map();
  let state = { browserInteractionMode: "automatic", mcpRuntimeInstalled: false };
  let credentials = false, active = false, fail = false, switched = 0;
  const sandbox = {
    handle: (name, fn) => handlers.set(name, fn),
    stateStore: { read: () => state, update: patch => state = { ...state, ...patch } },
    browserHost: { get activeTraceId() { return active ? "active" : null; }, currentOperation: () => null,
      returnToIdle: async () => {} },
    runtimeHost: { currentOperation: () => null, mcpCredentialsConfigured: () => credentials,
      runtimeConfigSnapshot: () => ({ config: { browserInteractionMode: "automatic" } }),
      setToolMode: async () => { switched++; if (fail) throw Error("fixture setup failed"); return { changed: true }; } },
    send() {}, startCatalogVerificationMonitor() {}, logger: { warn() {} },
  };
  require("node:vm").runInNewContext(electronMain.slice(electronMain.indexOf('handle("launcher:tool-mode",'),
    electronMain.indexOf('handle("launcher:browser-interaction-mode",')), sandbox);
  const change = handlers.get("launcher:tool-mode");
  assert.equal((await change(null, "mcp-bridge")).credentialsRequired, true);
  assert.equal(switched, 0);
  active = true;
  await assert.rejects(change(null, "native-tools"), /Finish the current task/);
  active = false; credentials = true; fail = true;
  await assert.rejects(change(null, "mcp-bridge"), /fixture setup failed/);
  assert.equal(state.mcpRuntimeInstalled, false);
  fail = false;
  await change(null, "mcp-bridge");
  assert.equal(state.mcpRuntimeInstalled, true);
  assert.equal(state.codexRestartRequired, true);
  await change(null, "native-tools");
  assert.equal(state.mcpRuntimeInstalled, false);
  assert.equal(state.mcpGuideStep, 0);
  await assert.rejects(change(null, "unexpected"), /Tool mode/);
});
