// A renderer can be stale or call IPC directly. Only recovery, read-only shell
// operations, local settings persistence and stopping work are exempt. Settings
// handlers independently require a current license before applying runtime changes.
const UNLICENSED_CHANNELS = new Set([
  "launcher:license-status", "launcher:license-import", "launcher:snapshot", "launcher:workspace-status",
  "launcher:queue-status", "launcher:queue-query", "launcher:queue-control",
  "launcher:window-state", "launcher:sidebar-state", "launcher:set-language",
  "launcher:autostart", "launcher:queue-settings", "launcher:context-files", "launcher:context-triple-budget",
  "launcher:context-budget", "launcher:skill-attachments", "launcher:fresh-conversation-per-turn", "launcher:use-saved-chats",
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
    const closePreference = channel === "launcher:set-preference"
      && ["keepRunningOnClose", "showBrowserDuringTurns", "logPageSize"].includes(args[1]);
    const restoringInputProtection = channel === "launcher:browser-input-override" && args[2] === false;
    if (!UNLICENSED_CHANNELS.has(channel) && !hidingSurface && !closePreference && !restoringInputProtection) await controller.assertActive();
    return handler(...args);
  };
}

module.exports = { guardLicensedIpc };
