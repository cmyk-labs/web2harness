// Real Electron APIs with disposable data and a local fixture site. No account or service.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { createWindowVisibility } = require("../../electron/window-visibility.cjs");
const { createStorageManager } = require("../../electron/storage-management.cjs");
const root = path.resolve(process.env.WEB2HARNESS_STORAGE_FIXTURE || "missing");
if (!path.basename(root).startsWith("storage-window-fixture-")) throw new Error("Expected a task-owned fixture root");
fs.mkdirSync(root, { recursive: true });
app.setPath("userData", path.join(root, "profile"));
app.setName("Web2Harness storage fixture");
const checks = [];
let server;
app.whenReady().then(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" });
    res.end("<!doctype html><title>Storage fixture</title><h1>Isolated window and cache check</h1>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const controller = createWindowVisibility();
  const window = new BrowserWindow({ show: false, paintWhenInitiallyHidden: false, width: 600, height: 360,
    webPreferences: { sandbox: true, contextIsolation: true, partition: "persist:storage-fixture" } });
  controller.attach(window);
  await window.loadURL(origin);
  assert.equal(window.isVisible(), true);
  checks.push("real window opens after load without relying on ready-to-show");
  window.hide(); controller.show("tray-click"); assert.equal(window.isVisible(), true);
  checks.push("explicit tray open restores the real hidden window");
  const browserSession = window.webContents.session;
  await browserSession.cookies.set({ url: origin, name: "fixture-sign-in", value: "preserve", expirationDate: Date.now() / 1000 + 3600 });
  await window.webContents.executeJavaScript(`localStorage.setItem('fixture', 'preserve'); new Promise((resolve, reject) => {
    const request = indexedDB.open('fixture', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onerror = () => reject(request.error.message);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('values', 'readwrite');
      tx.objectStore('values').put('preserve', 'auth'); tx.oncomplete = () => { db.close(); resolve(true); }; };
  })`);
  browserSession.flushStorageData(); await browserSession.cookies.flushStore();
  const manager = createStorageManager({ coreHome: path.join(root, "core"), logsDirectory: path.join(root, "logs"),
    sessions: () => [session.defaultSession, browserSession] });
  const before = await manager.measure();
  const after = await manager.clearCaches();
  assert.equal((await browserSession.cookies.get({ url: origin, name: "fixture-sign-in" }))[0].value, "preserve");
  assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('fixture')"), "preserve");
  assert.equal(await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const open = indexedDB.open('fixture', 1); open.onerror = () => reject('open failed');
    open.onsuccess = () => { const db = open.result; const request = db.transaction('values').objectStore('values').get('auth');
      request.onsuccess = () => { resolve(request.result); db.close(); }; };
  })`), "preserve");
  checks.push("real Electron HTTP and code cleanup preserves cookies, Local Storage and IndexedDB");
  const hidden = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const hiddenController = createWindowVisibility(); hiddenController.attach(hidden, { startHidden: true });
  await hidden.loadURL("about:blank"); assert.equal(hidden.isVisible(), false);
  hiddenController.show("second-instance"); assert.equal(hidden.isVisible(), true);
  checks.push("real hidden autostart stays hidden until explicit activation");
  fs.writeFileSync(path.join(root, "results.json"), JSON.stringify({ checks, before, after }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
  window.destroy(); hidden.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error.stack); server?.close(); app.exit(1); });
setTimeout(() => { console.error("Fixture timed out"); app.exit(1); }, 30_000).unref();
