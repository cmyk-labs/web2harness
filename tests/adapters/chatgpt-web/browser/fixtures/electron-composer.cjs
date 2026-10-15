// Isolated input experiment: no application startup, authentication, or external pages.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const fixtureHome = process.env.WEB2HARNESS_COMPOSER_FIXTURE_HOME;
if (!fixtureHome) throw new Error('An owned fixture home is required');
const owner = JSON.parse(fs.readFileSync(path.join(fixtureHome, 'owner.json'), 'utf8'));
if (owner.purpose !== 'electron-composer-input' || !owner.token || !owner.repositoryRoot) {
  throw new Error('Invalid fixture ownership record');
}
app.setName('Web2Harness Composer Fixture');
app.setPath('userData', path.join(fixtureHome, 'user-data'));
app.setPath('sessionData', path.join(fixtureHome, 'session-data'));
let fixtureWindow;
const tabs = new Map();
let blockedRequests = 0;
globalThis.__composerFixtureReady = (async () => {
  await app.whenReady();
  const isolatedSession = session.fromPartition('composer-fixture-' + owner.token);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = /^(https?|wss?):/.test(details.url);
    if (blocked) blockedRequests += 1;
    callback({ cancel: blocked });
  });
  fixtureWindow = new BrowserWindow({
    width: 1000, height: 800, show: false,
    webPreferences: { session: isolatedSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await fixtureWindow.loadURL('data:text/html,<title>composer-fixture-shell</title>');
  // Exercise the actual view-placement implementation without constructing a live BrowserHost.
  const { BrowserHost } = require(path.join(owner.repositoryRoot, 'launcher/electron/browser/browser-host.cjs'));
  const host = Object.create(BrowserHost.prototype);
  host.window = fixtureWindow;
  host.bounds = { x: 0, y: 0, width: 867, height: 634 };
  host.boundsReady = true;
  for (const id of ['parent', 'child-1', 'child-2']) {
    const view = new WebContentsView({
      webPreferences: {
        session: isolatedSession, sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false,
      },
    });
    fixtureWindow.contentView.addChildView(view);
    const tab = { id, view, status: 'running', interactionMode: 'automatic', rendererReady: false,
      deviceEmulationDirty: true, nativeEvents: [] };
    tabs.set(id, tab);
    view.webContents.on('before-input-event', (event, input) => {
      if (tab.nativeEvents.length >= 80) return;
      const sample = { type: input.type, character: typeof input.key === 'string' && input.key.length === 1,
        defaultPrevented: false };
      tab.nativeEvents.push(sample);
      queueMicrotask(() => { sample.defaultPrevented = event.defaultPrevented === true; });
    });
    host.presentTurnView(tab, id === 'parent');
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>composer-fixture-' + id
      + '</title></head><body><form onsubmit="return false"><div id="prompt-textarea" role="textbox" '
      + 'contenteditable="true" aria-multiline="true" style="min-height:80px"><p><br></p></div></form></body></html>';
    await view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    tab.rendererReady = true;
    host.presentTurnView(tab, id === 'parent');
  }
  globalThis.__composerFixture = {
    layout({ selected, ready = [], focus }) {
      if (!tabs.has(selected) || (focus && !tabs.has(focus)) || ready.some(id => !tabs.has(id))) {
        throw new Error('Unknown fixture view');
      }
      for (const tab of tabs.values()) {
        const status = ready.includes(tab.id) ? 'ready' : 'running';
        if (tab.status === 'ready' && status === 'running') tab.deviceEmulationDirty = true;
        tab.status = status;
        host.presentTurnView(tab, selected === tab.id);
      }
      if (focus) tabs.get(focus).view.webContents.focus();
    },
    resetNativeEvents() { for (const tab of tabs.values()) tab.nativeEvents.length = 0; },
    snapshot() {
      return { blockedRequests, windowVisible: fixtureWindow.isVisible(),
        views: [...tabs.values()].map(tab => ({ id: tab.id, status: tab.status,
          focused: tab.view.webContents.isFocused(), events: tab.nativeEvents.slice() })) };
    },
  };
  return { processId: process.pid, ids: [...tabs.keys()], purpose: owner.purpose, token: owner.token };
})();
app.on('window-all-closed', () => app.quit());

