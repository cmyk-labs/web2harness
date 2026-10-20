// Native presentation fixture: no runtime, credentials, service, or production profile.
const { app, BrowserWindow, WebContentsView } = require("electron");
const path = require("node:path");
const { fitWindowLayout } = require("../../electron/window-layout.cjs");
const { DEFAULT_WINDOW_STATE, MIN_WINDOW_BOUNDS } = require("../../electron/window-state.cjs");
const { BrowserHost } = require("../../electron/browser/browser-host.cjs");
process.on("uncaughtException", error => { console.error(error.message); app.exit(1); });
const profile = path.resolve(process.env.WEB2HARNESS_WINDOW_FIXTURE_PROFILE || "missing");
if (!path.basename(profile).startsWith("window-session-profile-")) throw new Error("Expected an owned fixture profile");
app.setPath("userData", profile);
app.setName("Web2Harness window fixture");
app.whenReady().then(() => {
  const window = new BrowserWindow({ ...DEFAULT_WINDOW_STATE.bounds,
    minWidth: MIN_WINDOW_BOUNDS.width, minHeight: MIN_WINDOW_BOUNDS.height,
    show: false, title: "Web2Harness window fixture", titleBarStyle: "hidden",
    titleBarOverlay: { color: "#1b1f24", symbolColor: "#b9c0c9", height: 46 },
    backgroundColor: "#1b1f24", webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  window.setMenuBarVisibility(false);
  window.fitContentLayout = () => fitWindowLayout(window);
  window.on("resize", window.fitContentLayout);
  window.webContents.on("did-finish-load", window.fitContentLayout);
  window.fitContentLayout();
  // Exercise the real CSS-to-native bounds conversion with a local child view.
  // All account/runtime IPC remains mocked by the presentation fixture.
  let pane;
  let active = false;
  global.windowSessionFixture = {
    async openPane() {
      const view = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
      window.contentView.addChildView(view);
      view.setVisible(false);
      pane = Object.assign(Object.create(BrowserHost.prototype), {
        window, view, boundsReady: false, authView: null,
        syncViewVisibility() {
          if (this.boundsReady) view.setBounds(this.bounds);
          view.setVisible(active && this.boundsReady);
        },
      });
      await view.webContents.loadURL("data:text/html," + encodeURIComponent(
        '<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#eef4f8}</style>' +
        '<button onclick="this.dataset.clicks=Number(this.dataset.clicks||0)+1">Layout click target</button>'
      ) + "#window-layout-pane");
    },
    setBounds(bounds) { pane?.setBounds(bounds, window.webContents.getZoomFactor()); },
    setActive(value) { active = value; pane?.syncViewVisibility(); },
    state() { return { bounds: pane.view.getBounds(), zoom: window.webContents.getZoomFactor(), content: window.getContentSize() }; },
  };
  window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
