import type {
  BrowserState,
  LauncherSnapshot,
  OperationState,
  WorkspaceStatus,
} from "../../types";

export function workspaceBusy(
  browser: BrowserState | null,
  operation: OperationState | null,
) {
  return (
    operation?.status === "running" ||
    browser?.status === "running" ||
    browser?.status === "testing" ||
    !!browser?.tabs.some(
      (tab) =>
        tab.status === "running" ||
        ["awaiting-user", "sent"].includes(tab.manualState ?? ""),
    )
  );
}

export function workspaceReady(
  status: WorkspaceStatus | null,
  snapshot: LauncherSnapshot,
  browser: BrowserState | null,
) {
  return (
    snapshot.startup.status === "ready" &&
    !!status?.configured &&
    status.runtimeStatus === "ready" &&
    (status.interactionMode === "manual" ||
      (browser?.authenticated === true &&
        browser.status !== "error" &&
        snapshot.state.codexCatalogVerified === true)) &&
    (status.mode !== "mcp-bridge" || snapshot.state.mcpSetupComplete === true)
  );
}

export type StatusTone = "success" | "error" | "neutral";

export function runtimeFailed(status: WorkspaceStatus | null) {
  return ["error", "failed", "degraded"].includes(status?.runtimeStatus ?? "");
}

export function workspaceTone(
  status: WorkspaceStatus | null,
  snapshot: LauncherSnapshot,
  browser: BrowserState | null,
  operation: OperationState | null,
): StatusTone {
  if (
    snapshot.startup.status === "failed" ||
    runtimeFailed(status) ||
    (snapshot.state.browserInteractionMode !== "manual" &&
      browser?.status === "error")
  )
    return "error";
  if (workspaceBusy(browser, operation)) return "neutral";
  return workspaceReady(status, snapshot, browser) ? "success" : "neutral";
}
