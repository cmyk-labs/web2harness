const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { WebContentsView } = require("electron");

// The shield is a separate native view, never part of the automated page DOM or target map.
// CDP mouse events also reach before-mouse-event, so blocking that event on task pages would
// break Playwright. Native keyboard events can be blocked before dispatch without blocking CDP.
class BrowserInputGuard {
  constructor(window, { language, logger }) {
    this.window = window;
    this.language = language;
    this.logger = logger;
    this.bindings = new Map();
    this.visible = false;
    this.disposed = false;
    this.view = new WebContentsView({ webPreferences: {
      partition: `web2harness-input-shield-${randomBytes(12).toString("hex")}`,
      sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false,
    } });
    this.view.setBackgroundColor("#00000000");
    this.view.setVisible(false);
    window.contentView.addChildView(this.view);
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", event => event.preventDefault());
    contents.on("context-menu", event => event.preventDefault());
    this.ready = contents.loadFile(path.join(__dirname, "browser-input-shield.html"))
      .then(() => { this.loaded = true; this.render(); });
    // Keep the native hit-test shield in place even if its explanatory renderer fails.
    this.ready.catch(error => logger.error("browser.input_notice_failed", { message: error.message }));
  }

  bind(contents, getPolicy) {
    if (!contents || contents.isDestroyed() || this.bindings.has(contents)) return;
    const handler = (event) => {
      if (!getPolicy().inputLocked) return;
      event.preventDefault();
      this.notify();
    };
    contents.on("before-input-event", handler);
    const contextMenu = event => { if (getPolicy().inputLocked) event.preventDefault(); };
    contents.on("context-menu", contextMenu);
    this.bindings.set(contents, { handler, contextMenu, getPolicy });
    contents.once("destroyed", () => this.bindings.delete(contents));
  }

  sync({ bounds, visible, policy, zoomFactor = 1 }) {
    if (this.disposed) return;
    for (const [contents, binding] of this.bindings) {
      if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(binding.getPolicy().inputLocked);
    }
    const nextVisible = visible && policy.inputLocked;
    const entering = nextVisible && !this.visible;
    this.visible = nextVisible;
    this.reason = policy.inputLockReason;
    const boundsKey = JSON.stringify(bounds);
    if (this.boundsKey !== boundsKey) {
      this.view.setBounds(bounds);
      this.boundsKey = boundsKey;
    }
    if (this.zoomFactor !== zoomFactor) {
      this.view.webContents.setZoomFactor(zoomFactor);
      this.zoomFactor = zoomFactor;
    }
    if (nextVisible) this.window.contentView.addChildView(this.view);
    this.view.setVisible(nextVisible);
    // Transfer a pre-existing human focus once, before automation starts. Never steal focus
    // during an automated click or menu interaction merely because state was published again.
    if (entering) this.focus();
    this.render();
  }

  focus() {
    if (this.visible && !this.disposed) this.view.webContents.focus();
  }

  render() {
    if (!this.loaded || this.disposed) return;
    const value = { reason: this.reason, language: this.language?.() === "zh-CN" ? "zh-CN" : "en" };
    const key = JSON.stringify(value);
    if (this.rendered === key) return;
    this.rendered = key;
    void this.view.webContents.executeJavaScript(`window.setInputNotice(${key})`)
      .catch(() => { this.rendered = null; });
  }

  notify() {
    if (!this.visible || !this.loaded || this.disposed) return;
    const now = Date.now();
    if (now - (this.lastNoticeAt || 0) < 800) return;
    this.lastNoticeAt = now;
    void this.view.webContents.executeJavaScript("window.flashInputNotice()")
      .catch(() => {});
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [contents, binding] of this.bindings) {
      if (contents.isDestroyed()) continue;
      contents.off("before-input-event", binding.handler);
      contents.off("context-menu", binding.contextMenu);
      contents.setIgnoreMenuShortcuts(false);
    }
    this.bindings.clear();
    try { this.window.contentView.removeChildView(this.view); } catch {}
    const contents = this.view.webContents;
    if (contents && !contents.isDestroyed()) contents.close();
  }
}

module.exports = { BrowserInputGuard };
