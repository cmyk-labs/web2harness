const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runtimeBundlePaths } = require("./runtime/runtime-command.cjs");

// Package smoke verifies the real unactivated screen and installed binary. It
// never bypasses activation, starts a browser, or grants Web/MCP capabilities.
async function verifyUnactivatedPackage({ app, window, licenseController, prepareRuntime }) {
  if (!app.isPackaged) throw new Error("Package smoke requires a packaged application");
  const status = await licenseController.status();
  if (status.state !== "missing") throw new Error(`Expected unactivated package, received ${status.state}`);
  const deadline = Date.now() + 15_000;
  let visible = false;
  while (Date.now() < deadline) {
    visible = await window.webContents.executeJavaScript("Boolean(document.querySelector('.license-activation'))");
    if (visible) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!visible) throw new Error("Packaged activation screen did not render");
  const root = await prepareRuntime();
  if (!root) throw new Error("Durable runtime was not installed");
  const runtime = runtimeBundlePaths(root);
  const result = spawnSync(runtime.executable, [runtime.entrypoint, "--version"], {
    cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.stdout.trim() !== app.getVersion()) throw new Error("Installed runtime is not executable");
  const marker = process.env.WEB2HARNESS_SMOKE_FILE;
  if (!marker || !path.isAbsolute(marker)) throw new Error("Package smoke requires an absolute marker path");
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${JSON.stringify({ ok: true, version: app.getVersion(), platform: process.platform,
    packaged: true, runtimeVerified: true, activationRequired: true })}\n`);
}

module.exports = { verifyUnactivatedPackage };
