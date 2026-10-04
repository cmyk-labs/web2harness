const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SavedChatHistory } = require("../../electron/browser/saved-chat-history.cjs");
const { savedChatId, savedChatTitle } = require("../../shared/saved-chat.cjs");
const { BrowserHost } = require("../../electron/browser/browser-host.cjs");
const { BrowserControlServer } = require("../../electron/control-server.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w2h-saved-chat-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("w2h-saved-chat-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return path.join(root, "history.json");
}
const task = { taskKey: "a".repeat(64), taskName: "修复登录问题", kind: "dialogue" };
const at = new Date(2026, 9, 4, 21, 49).getTime();

test("saved chat URLs exclude temporary, foreign and non-conversation pages", () => {
  assert.equal(savedChatId("https://chatgpt.com/c/chat-01"), "chat-01");
  assert.equal(savedChatId("https://chatgpt.com/g/project/c/chat-01#end"), "chat-01");
  for (const url of ["https://example.com/c/chat-01", "https://chatgpt.com/", "https://chatgpt.com/c/chat-01?temporary-chat=true", "invalid"]) {
    assert.equal(savedChatId(url), undefined);
  }
});

test("title format always has creation time first and type/index last", () => {
  assert.equal(savedChatTitle(at, task.taskName, "dialogue", 1), "2026-10-04 21:49 · 修复登录问题 · 对话-01");
  assert.equal(savedChatTitle(at, task.taskName, "compaction", 12), "2026-10-04 21:49 · 修复登录问题 · 压缩-12");
});

test("names, creation time and independent counters survive reconnect and launcher restart", t => {
  const file = fixture(t);
  let ledger = new SavedChatHistory(file);
  const first = ledger.bind("chat-01", task, at, "b".repeat(64));
  assert.equal(first.index, 1);
  assert.deepEqual(ledger.bind("chat-01", task, at + 90_000, "b".repeat(64)), first);
  ledger.markNamed("chat-01");
  ledger = new SavedChatHistory(file);
  assert.equal(ledger.bind("chat-01", task, at, "b".repeat(64)).named, true);
  const compact = ledger.bind("summary-01", { ...task, taskName: "new follow-up text", kind: "compaction" }, at + 600_000);
  assert.equal(compact.index, 1);
  assert.match(compact.title, /修复登录问题 · 压缩-01$/);
  const second = ledger.bind("chat-02", { ...task, taskName: "compacted history" }, at + 720_000, "c".repeat(64));
  assert.equal(second.index, 2);
  assert.match(second.title, /修复登录问题 · 对话-02$/);
  assert.equal(ledger.bind("summary-02", { ...task, kind: "compaction" }, at).index, 2);
  assert.equal(ledger.bind("other-chat", { ...task, taskKey: "d".repeat(64) }, at).index, 1);
});

test("foreign ownership and corrupt ledgers never silently reset numbering", t => {
  const file = fixture(t);
  const ledger = new SavedChatHistory(file);
  ledger.bind("chat-01", task, at, "b".repeat(64));
  assert.throws(() => ledger.bind("chat-01", { ...task, taskKey: "c".repeat(64) }, at, "b".repeat(64)), /ownership/);
  assert.throws(() => ledger.bind("chat-01", task, at, "c".repeat(64)), /ownership/);
  fs.writeFileSync(file, "corrupt evidence");
  assert.throws(() => new SavedChatHistory(file));
  assert.equal(fs.readFileSync(file, "utf8"), "corrupt evidence");
});

function hostFixture(file) {
  const tab = {
    id: "tab", traceId: "trace_current", helperPid: 123, interactionMode: "automatic", status: "running",
    savedChat: task, chatCreatedAt: at, conversationKey: "b".repeat(64), surfaceId: "surface",
    bootstrapReady: true,
    view: { webContents: { isDestroyed: () => false, getURL: () => "https://chatgpt.com/c/chat-01", setBackgroundThrottling() {} } },
  };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    descriptorPath: file, getUseSavedChats: () => true, getBrowserInteractionMode: () => "automatic",
    turnTabs: new Map([[tab.id, tab]]), closedTurnOwners: new Map(), userCancelledTurnOwners: new Map(),
    logger: { info() {}, warn() {} }, manualOperation: null, syncViewVisibility() {}, writeDescriptor() {},
    snapshot: () => ({}), removeTurnTab(t) { this.turnTabs.delete(t.id); },
  });
  return { host, tab };
}

test("host binds only its live owner and stops incremental reuse after page navigation", async t => {
  const { host, tab } = hostFixture(fixture(t));
  assert.throws(() => host.bindSavedConversation(tab.traceId, 321, "chat-01"), /ownership/);
  assert.throws(() => host.bindSavedConversation(tab.traceId, 123, "different-chat"), /identity/);
  const update = host.bindSavedConversation(tab.traceId, 123, "chat-01");
  assert.match(update.conversationTitle, /对话-01$/);
  host.bindSavedConversation(tab.traceId, 123, "chat-01", true);
  // Successful naming is acknowledged once. Later manual renames are left untouched.
  assert.deepEqual(host.bindSavedConversation(tab.traceId, 123, "chat-01"), {});
  tab.status = "ready";
  const lease = await host.beginTurn("trace_next", false, 456, tab.conversationKey);
  assert.equal(lease.expectedConversationId, "chat-01");
  tab.status = "ready";
  tab.view.webContents.getURL = () => "https://chatgpt.com/";
  await assert.rejects(host.beginTurn("trace_later", false, 789, tab.conversationKey), /conversation changed/);
  assert.equal(host.turnTabs.size, 0);
});

test("retained tool rounds restore the hidden viewport cleared by the previous helper", async t => {
  const { host, tab } = hostFixture(fixture(t));
  let emulations = 0;
  Object.assign(tab, {
    status: "ready", rendererReady: true, deviceEmulationDirty: false,
    deviceEmulationViewport: { width: 1120, height: 720 },
  });
  Object.assign(tab.view, { setBounds() {}, setVisible() {} });
  Object.assign(tab.view.webContents, { enableDeviceEmulation() { emulations++; } });
  Object.assign(host, {
    visible: false, surfaceActive: false, boundsReady: true, authView: null,
    window: { getContentSize: () => [1120, 720], isVisible: () => false, isMinimized: () => false },
    view: { setBounds() {}, setVisible() {} },
    syncViewVisibility: BrowserHost.prototype.syncViewVisibility,
  });
  const lease = await host.beginTurn("trace_next", false, 456, tab.conversationKey);
  assert.equal(lease.reused, true);
  assert.equal(lease.surfaceId, tab.surfaceId);
  assert.equal(emulations, 1);
  assert.equal(tab.deviceEmulationDirty, false);
  assert.equal(host.turnTabs.size, 1);
});

test("saved conversation control validates metadata, authentication, owner and naming acknowledgement", async t => {
  const { host, tab } = hostFixture(fixture(t));
  const server = await new BrowserControlServer({
    logger: { info() {}, warn() {}, error() {} }, getPreferences: () => ({}), getBrowserHost: () => host,
  }).start();
  const { endpoint, token } = server.descriptor();
  const send = (body, auth = token, route = "conversation") => fetch(`${endpoint}/v1/turn/${route}`, {
    method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const owner = { traceId: tab.traceId, helperPid: tab.helperPid };
  const body = { ...owner, conversationId: "chat-01" };
  try {
    assert.equal((await send({ ...owner, savedChat: { ...task, taskKey: "invalid" } }, token, "start")).status, 400);
    assert.equal((await send(body, "wrong-token")).status, 401);
    assert.equal((await send({ ...body, helperPid: 456 })).status, 400);
    assert.equal((await send({ ...body, conversationId: "../other" })).status, 400);
    assert.equal((await send({ ...body, named: "true" })).status, 400);
    assert.equal(host.savedChatHistory, undefined);
    assert.match((await (await send(body)).json()).conversationTitle, /对话-01$/);
    assert.deepEqual(await (await send({ ...body, named: true })).json(), { ok: true });
    assert.deepEqual(await (await send(body)).json(), { ok: true });
    host.getBrowserInteractionMode = () => "manual";
    assert.equal((await send(body)).status, 409);
  } finally { await server.close(); }
});
