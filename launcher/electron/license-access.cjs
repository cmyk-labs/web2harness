// A renderer can be stale or call IPC directly. Only recovery, read-only shell
// operations and stopping existing work are exempt; new actions require a license.
const UNLICENSED_CHANNELS = new Set([
  "launcher:license-status", "launcher:license-import", "launcher:snapshot", "launcher:workspace-status",
  "launcher:queue-status", "launcher:queue-query", "launcher:queue-control",
  "launcher:window-state", "launcher:sidebar-state", "launcher:set-language",
  // Geometry does not activate the web view. Do not launch a verifier on every resize frame.
  "launcher:browser-bounds",
  "launcher:limits", "launcher:logs", "launcher:query-logs", "launcher:export-logs",
  "launcher:storage-usage", "launcher:clear-caches",
  "launcher:retry-startup", "launcher:open-external", "launcher:update-check", "launcher:update-install",
  "launcher:browser-hide", "launcher:browser-tab-close", "launcher:browser-tab-stop", "launcher:browser-logout",
  "launcher:cancel-turns", "launcher:uninstall-integration", "launcher:session-reminder-dismiss",
]);

function guardLicensedIpc(controller, channel, handler) {
  return async (...args) => {
    const hidingSurface = channel === "launcher:browser-surface-active" && args[1] === false;
    const closePreference = channel === "launcher:set-preference" && args[1] === "keepRunningOnClose";
    const restoringInputProtection = channel === "launcher:browser-input-override" && args[2] === false;
    if (!UNLICENSED_CHANNELS.has(channel) && !hidingSurface && !closePreference && !restoringInputProtection) await controller.assertActive();
    return handler(...args);
  };
}

module.exports = { guardLicensedIpc };
