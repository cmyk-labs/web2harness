// Native presentation fixture: no runtime, credentials, service, or production profile.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { fitWindowLayout } = require("../../electron/window-layout.cjs");
const { DEFAULT_WINDOW_STATE, MIN_WINDOW_BOUNDS } = require("../../electron/window-state.cjs");
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
  window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
