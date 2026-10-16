const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserHost } = require("../../electron/browser/browser-host.cjs");
const { browserInputPolicy } = require("../../electron/browser/browser-input-policy.cjs");
const { requestBrowserInputOverride } = require("../../electron/browser/browser-input-override.cjs");

test("the real launcher passes its language into BrowserHost and refreshes notices on changes", () => {
  const source = require("node:fs").readFileSync(require.resolve("../../electron/main.cjs"), "utf8");
  const construction = source.slice(source.indexOf("browserHost = new BrowserHost({"), source.indexOf("const updaterRuntimeRoot"));
  assert.match(construction, /getLanguage: \(\) => stateStore\.read\(\)\.language/);
  const setter = source.slice(source.indexOf('handle("launcher:set-language"'), source.indexOf('handle("launcher:complete-onboarding"'));
  assert.match(setter, /browserHost\?\.syncInputProtection\(\)/);
});

function host(tabs = []) {
  return Object.assign(Object.create(BrowserHost.prototype), {
    turnTabs: new Map(tabs.map(tab => [tab.id, tab])), selectedTabId: "home", manualOperation: null,
    state: {}, logger: { info() {} }, view: {}, closedTurnOwners: new Map(), userCancelledTurnOwners: new Map(),
    syncViewVisibility() {}, syncPowerSaveBlocker() {}, snapshot() { return browserInputPolicy(this); },
    publishState() {}, writeDescriptor() {}, ready: async () => {}, activateHomeSurface() {},
    syncInputProtection() {},
  });
}
const tab = (id, status, extra = {}) => ({ id, status, traceId: `trace_${id}`, helperPid: 12,
  interactionMode: "automatic", ...extra });

test("home is locked throughout tools/continuation but cached conversations only lock their own pages", () => {
  const first = tab("first", "running");
  const h = host([first]);
  assert.equal(browserInputPolicy(h).inputLockReason, "running");
  first.status = "ready"; first.awaitingToolResults = true;
  assert.equal(browserInputPolicy(h).inputLockReason, "waiting-tools");
  assert.equal(h.tabSnapshot(first).closable, false);
  assert.equal(h.tabSnapshot(first).canStop, false);
  assert.equal(h.currentOperation(), "automatic task awaiting completion");
  assert.equal(h.currentOperation({ includeTasks: false }), null, "explicit app shutdown can still cancel pending tasks");
  first.awaitingToolResults = false;
  assert.equal(browserInputPolicy(h).automationBusy, false);
  assert.equal(h.currentOperation(), null);
  assert.equal(browserInputPolicy(h).inputLocked, false);
  assert.equal(browserInputPolicy(h, first.id).inputLockReason, "retained");
  assert.equal(browserInputPolicy(h).zoomLocked, true);
  h.turnTabs.clear();
  assert.equal(browserInputPolicy(h).zoomLocked, false);
});

test("another automatic owner keeps home protected when one concurrent turn ends", () => {
  const a = tab("a", "ready"), b = tab("b", "running");
  const h = host([a,b]);
  h.turnTabs.delete(a.id);
  assert.equal(browserInputPolicy(h).inputLocked, true);
  b.status = "error"; b.inputOwnerActive = true;
  assert.equal(browserInputPolicy(h).inputLocked, true, "a presentation error is not owner settlement");
});

test("manual interaction and sign-in remain human-operated; automatic checks are protected", () => {
  const h = host([tab("manual", "running", {interactionMode:"manual"})]);
  h.selectedTabId = "manual";
  assert.equal(browserInputPolicy(h).inputLocked, false);
  h.selectedTabId = "home";
  for (const name of ["ChatGPT login", "ChatGPT passkey login"]) {
    h.manualOperation = name;
    assert.equal(browserInputPolicy(h).inputLocked, false);
  }
  for (const name of ["browser smoke test", "connector verification", "session inspection", "session refresh"]) {
    h.manualOperation = name;
    assert.equal(browserInputPolicy(h).inputLockReason, "checking");
  }
});

test("direct navigation, zoom, close and session operations cannot bypass a waiting owner", async () => {
  const h = host([tab("waiting", "ready", {awaitingToolResults:true})]);
  assert.throws(() => h.navigate("reload"), /view-only/);
  assert.throws(() => h.zoom("in"), /zoom is locked/);
  await assert.rejects(h.closeTab("waiting"), /Stop the task explicitly/);
  await assert.rejects(h.stopTab("waiting"), /Stop the task in Codex/);
  await assert.rejects(h.withManualOperation("ChatGPT logout", async () => assert.fail("operation must not run")), /pending tool results/);
  assert.equal(h.turnTabs.size, 1);
});

test("cancel remains locked until acknowledgment; failed cancellation retains its page and allows retry", async () => {
  const t = tab("cancel", "running");
  const h = host([t]);
  let reject;
  h.cancelTurn = () => new Promise((_, no) => { reject = no; });
  const pending = h.stopTab(t.id);
  assert.equal(browserInputPolicy(h, t.id).inputLockReason, "stopping");
  assert.equal(h.tabSnapshot(t).canStop, false);
  await assert.rejects(h.beginTurn(t.traceId, false, 12), error => error.code === "turn_cancelled");
  reject(new Error("control unavailable"));
  await assert.rejects(pending, /control unavailable/);
  assert.equal(t.stopping, false);
  assert.equal(browserInputPolicy(h, t.id).inputLocked, true);
  assert.equal(h.tabSnapshot(t).canStop, true);
});

test("stale end signal cannot unlock a newer page owner", async () => {
  const t = tab("owned", "running", {helperPid:222,inputOwnerActive:true});
  const h = host([t]);
  await assert.rejects(h.endTurn(t.traceId,111,"completed",false,"",true), /ownership mismatch/);
  assert.equal(t.inputOwnerActive,true);
  assert.equal(browserInputPolicy(h,t.id).inputLocked,true);
});

test("a retained page protects its shared account until explicitly released", async () => {
  const h = host([tab("saved", "ready")]);
  for (const name of ["ChatGPT logout", "ChatGPT login", "ChatGPT passkey login"]) {
    await assert.rejects(h.withManualOperation(name, async () => assert.fail("account must not change")), /Close retained/);
  }
});

test("retained end synchronizes native protection even without a renderer subscriber", async () => {
  const t = tab("retained", "running", { conversationKey:"a".repeat(64), inputOwnerActive:true,
    view:{webContents:{isDestroyed:()=>false,setBackgroundThrottling(){}}} });
  const h = host([t]); delete h.publishState;
  const observed=[];h.syncInputProtection=()=>observed.push(browserInputPolicy(h,t.id).inputLockReason);
  await h.endTurn(t.traceId,t.helperPid,"completed",false,"",true,false,true);
  assert.deepEqual(observed,["waiting-tools"]);
});

test("explicit override affects only the selected page, preserves ownership and can be restored", () => {
  const a = tab("a", "running"), b = tab("b", "running");
  const h = host([a,b]); h.selectedTabId = a.id;
  h.setInputOverride(a.id, true, h.inputOverrideContext(a.id));
  assert.equal(browserInputPolicy(h).inputLocked, false);
  assert.equal(browserInputPolicy(h).inputOverrideActive, true);
  assert.equal(browserInputPolicy(h).automationBusy, true);
  assert.equal(h.tabSnapshot(a).closable, false);
  assert.equal(browserInputPolicy(h, b.id).inputLocked, true);
  assert.equal(browserInputPolicy(h, "home").inputLocked, true);
  assert.equal(browserInputPolicy(h).zoomLocked, true);
  h.setInputOverride(a.id, false, h.inputOverrideContext(a.id));
  assert.equal(browserInputPolicy(h).inputLocked, true);
});

test("override dialog follows the selected language, cancels safely and rechecks ownership", async () => {
  const a = tab("a", "running"), h = host([a]);h.selectedTabId = a.id;
  for (const [language, cancel, allow] of [["zh-CN", "保持只读", "取消只读"], ["en", "Keep view-only", "Exit view-only"]]) {
    await requestBrowserInputOverride({host:h,language,tabId:a.id,allowed:true,dialog:{async showMessageBox(_, options) {
      assert.deepEqual(options.buttons,[cancel,allow]);assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);
      return {response:0};
    }}});
    assert.equal(browserInputPolicy(h).inputLocked,true);
  }
  await requestBrowserInputOverride({host:h,language:"zh-CN",tabId:a.id,allowed:true,dialog:{async showMessageBox(){return {response:1};}}});
  assert.equal(browserInputPolicy(h).inputOverrideActive,true);
  await requestBrowserInputOverride({host:h,tabId:a.id,allowed:false,dialog:{showMessageBox(){assert.fail("restoring is immediate");}}});
  await assert.rejects(requestBrowserInputOverride({host:h,tabId:a.id,allowed:true,dialog:{async showMessageBox(){
    h.resetInputOverride(a);return {response:1};
  }}}), /changed/);
  assert.equal(browserInputPolicy(h).inputLocked,true);
  await assert.rejects(requestBrowserInputOverride({host:h,tabId:a.id,allowed:true,dialog:{async showMessageBox(){
    h.selectedTabId="home";return {response:1};
  }}}), /changed/);
});

test("new automation ownership clears overrides and guard errors follow language changes", () => {
  const a=tab("a","ready"),h=host([a]);h.selectedTabId=a.id;
  h.setInputOverride(a.id,true,h.inputOverrideContext(a.id));h.homeInputOverride=true;
  h.resetInputOverride(a);
  assert.equal(browserInputPolicy(h).inputLocked,true);
  assert.equal(h.homeInputOverride,false);
  h.getLanguage=()=>"zh-CN";
  assert.throws(()=>h.navigate("reload"), /仅供查看/);
  assert.throws(()=>h.zoom("in"), /缩放/);
  h.getLanguage=()=>"en";
  assert.throws(()=>h.navigate("reload"), /view-only/);
});
