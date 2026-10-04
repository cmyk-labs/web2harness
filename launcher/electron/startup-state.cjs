// Only shell functions may run while code is being installed or the browser initializes.
const SHELL_CHANNELS = new Set([
  "snapshot", "workspace-status", "set-language", "complete-onboarding", "open-social",
  "open-external", "set-preference", "sidebar-state", "autostart", "limits",
  "retry-startup", "logs", "export-logs", "window-state", "browser-bounds", "browser-surface-active",
]);

class StartupState {
  constructor(publish = () => {}) {
    this.publish = publish;
    this.value = { status: "preparing", stage: "checking-installation", elapsedMs: 0 };
  }
  snapshot() { return { ...this.value }; }
  update(progress) {
    this.value = { ...progress, status: "preparing" };
    this.publish(this.snapshot());
  }
  ready() {
    this.value = { status: "ready", stage: "ready", elapsedMs: 0 };
    this.publish(this.snapshot());
  }
  fail(error) {
    this.value = { ...this.value, status: "failed", message: error.message || String(error) };
    this.publish(this.snapshot());
  }
  assertAvailable(channel) {
    if (this.value.status === "ready" || SHELL_CHANNELS.has(channel.replace(/^launcher:/, ""))) return;
    throw new Error(this.value.status === "failed"
      ? "Workspace preparation failed; inspect the startup diagnostics."
      : "Workspace is still preparing; wait before using this operation.");
  }
}

module.exports = { StartupState };
