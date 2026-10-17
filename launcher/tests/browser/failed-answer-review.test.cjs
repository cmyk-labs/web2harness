const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserHost } = require("../../electron/browser/browser-host.cjs");
const { browserInputPolicy } = require("../../electron/browser/browser-input-policy.cjs");
const { BrowserControlServer } = require("../../electron/control-server.cjs");

function fixture() {
  const copied = [], events = [];
  let closed = false;
  const tab = { id: "failed", traceId: "trace-failed", helperPid: process.pid, ordinal: 1,
    interactionMode: "automatic", status: "running", inputOwnerActive: true, inputOverride: true,
    conversationKey: "old-key", connectorIdentity: "old-connector", connectorBound: true,
    view: { webContents: { isDestroyed: () => closed, close: () => { closed = true; },
      setBackgroundThrottling() {}, executeJavaScript: async () => "Unverified answer\nSecond paragraph" } } };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    turnTabs: new Map([[tab.id, tab]]), selectedTabId: tab.id, state: {},
    closedTurnOwners: new Map(), userCancelledTurnOwners: new Map(),
    clipboard: { writeText: value => copied.push(value) }, getLanguage: () => "zh-CN",
    logger: { info: (event, detail) => events.push({ event, detail }) },
    window: { contentView: { removeChildView() {} } }, view: {},
    syncInputProtection() {}, syncPowerSaveBlocker() {}, syncViewVisibility() {},
    publishState() {}, writeDescriptor() {}, snapshot() { return { tabs: [...this.turnTabs.values()].map(t => this.tabSnapshot(t)) }; },
  });
  const end = (status = "failed", code = "browser_stream_inconsistent", pid = tab.helperPid) =>
    host.endTurn(tab.traceId, pid, status, false, "failure", true, true, true, code);
  return { host, tab, copied, events, end, closed: () => closed };
}

test("failed extraction releases execution ownership, stays read-only, and cannot be resumed", async () => {
  const { host, tab, end, closed } = fixture();
  await assert.rejects(end("failed", "browser_stream_inconsistent", 123456), /ownership mismatch/);
  await end();
  assert.equal(closed(), false);
  assert.equal(tab.status, "error");
  assert.equal(tab.inputOwnerActive, false);
  assert.equal(tab.awaitingToolResults, false);
  assert.equal(tab.conversationKey, undefined);
  assert.equal(tab.connectorIdentity, undefined);
  assert.equal(tab.connectorBound, false);
  assert.deepEqual(browserInputPolicy(host), { inputLocked: true, inputOverrideActive: false,
    canOverrideInput: false, inputLockReason: "failed-answer", automationBusy: false, zoomLocked: true });
  assert.equal(browserInputPolicy(host, "home").inputLocked, true);
  assert.equal(host.tabSnapshot(tab).closable, true);
  assert.equal(host.tabSnapshot(tab).canStop, false);
  assert.equal(host.allocateTurnTabOrdinal(), 2);
  const deadline = tab.failureReviewUntil;
  await end(); assert.equal(tab.failureReviewUntil, deadline, "duplicate end cannot extend retention");
  await assert.rejects(end("completed"), /terminal status/);
  await assert.rejects(host.beginTurn(tab.traceId, tab.helperPid, "old-key", "old-connector"), /cannot resume/);
  await host.closeTab(tab.id);
  assert.equal(closed(), true); assert.equal(host.turnTabs.size, 0);
});

test("failed pages copy only on explicit request and fail closed across page removal", async () => {
  const { host, tab, copied, events, end } = fixture();
  await end(); assert.equal(copied.length, 0);
  await host.copyFailedAnswer(tab.id);
  assert.deepEqual(copied, ["Unverified answer\nSecond paragraph"]);
  assert.ok(!JSON.stringify(events).includes("Unverified answer"));
  host.selectedTabId = "home";
  await assert.rejects(host.copyFailedAnswer(tab.id), /不可用/);
  host.selectedTabId = tab.id;
  tab.view.webContents.executeJavaScript = async () => { host.removeTurnTab(tab, false); return "Do not copy stale page"; };
  await assert.rejects(host.copyFailedAnswer(tab.id), /不可用/);
  assert.equal(copied.length, 1);
});

test("expiry and capacity reclaim failed pages without touching active or waiting-tool owners", async () => {
  for (const mode of ["expiry", "capacity"]) {
    const { host, tab, closed, end } = fixture(); await end();
    const waiting = { id: "waiting", status: "ready", awaitingToolResults: true, lastHeartbeatAt: Date.now() };
    host.turnTabs.set(waiting.id, waiting);
    if (mode === "expiry") {
      host.lastTurnSweepAt = tab.failureReviewUntil;
      await host.reapExpiredTurnTabs(tab.failureReviewUntil + 1);
    } else assert.equal(host.evictOldestReclaimableTurnTab(), true);
    assert.equal(closed(), true);
    assert.deepEqual([...host.turnTabs.keys()], [waiting.id]);
  }
});

test("other errors, aborts, user cancellations and stopping pages keep terminal cleanup", async () => {
  for (const mode of ["other", "abort", "cancel", "stopping"]) {
    const { host, tab, end, closed } = fixture();
    if (mode === "cancel") host.userCancelledTurnOwners.set(tab.traceId, tab.helperPid);
    if (mode === "stopping") tab.stopping = true;
    await end(mode === "abort" ? "aborted" : "failed", mode === "other" ? "unrelated" : "browser_stream_inconsistent");
    assert.equal(closed(), true); assert.equal(host.turnTabs.size, 0);
  }
});

test("control protocol accepts only the explicit extraction failure on failed automatic turn end", async () => {
  const { host, tab } = fixture();
  const server = await new BrowserControlServer({ assertLicensed: async () => {},
    logger: { info() {}, warn() {}, error() {} }, getPreferences: () => ({}), getBrowserHost: () => host }).start();
  const { endpoint, token } = server.descriptor();
  const send = (patch, route = "end") => fetch(`${endpoint}/v1/turn/${route}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ traceId: tab.traceId, helperPid: tab.helperPid, status: "failed", failureCode: "browser_stream_inconsistent", ...patch }),
  });
  try {
    for (const patch of [{ failureCode: true }, { failureCode: "other" }, { status: "completed" }]) {
      const response = await send(patch); assert.equal(response.ok, false); await response.text();
    }
    const heartbeat = await send({}, "heartbeat"); assert.equal(heartbeat.ok, false); await heartbeat.text();
    const response = await send({}); assert.equal(response.status, 200); await response.text();
    assert.ok(tab.failureReviewUntil);
  } finally { await server.close(); }
});
