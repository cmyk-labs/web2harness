// Foreground requests must not depend on Chromium painting a hidden window.
function createWindowVisibility({ log = () => {} } = {}) {
  let current = null;
  let pending = null;
  function show(reason = "open") {
    pending = reason;
    const window = current?.window;
    if (!window || window.isDestroyed()) return;
    current.initialHandled = true;
    pending = null;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    log("launcher.window_opened", { reason, visible: window.isVisible() });
  }
  function attach(window, { startHidden = false, beforeFirstShow = () => {} } = {}) {
    const state = { window, initialHandled: false };
    current = state;
    let positioned = false;
    const position = () => {
      if (!positioned) { positioned = true; beforeFirstShow(); }
    };
    const ready = (event) => {
      if (current !== state || window.isDestroyed()) return;
      log("launcher.window_ready", { event, visible: window.isVisible(), startHidden });
      if (state.initialHandled) return;
      state.initialHandled = true;
      position();
      if (pending || !startHidden) show(pending || event);
    };
    window.once("ready-to-show", () => ready("ready-to-show"));
    window.webContents.once("did-finish-load", () => ready("did-finish-load"));
    window.webContents.once("dom-ready", () => log("launcher.window_dom_ready", {}));
    window.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame) log("launcher.window_load_failed", { code });
    });
    for (const event of ["show", "hide", "minimize", "restore"]) {
      window.on(event, () => log("launcher.window_visibility", { event }));
    }
    window.once("closed", () => { if (current === state) current = null; });
    if (pending) { position(); show(pending); }
  }
  return { attach, show };
}

module.exports = { createWindowVisibility };
