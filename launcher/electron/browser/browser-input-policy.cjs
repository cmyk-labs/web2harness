// Input ownership outlives a single browser reply: local tools can still be running.
const HUMAN_OPERATIONS = new Set(["ChatGPT login", "ChatGPT passkey login"]);

function automaticTabBusy(tab) {
  return tab.interactionMode !== "manual" && (tab.status === "running"
    || tab.inputOwnerActive === true || tab.awaitingToolResults === true || tab.stopping === true);
}

function automaticOperation(host) {
  return !!host.manualOperation && !HUMAN_OPERATIONS.has(host.manualOperation);
}

function browserInputPolicy(host, tabId = host.selectedTabId) {
  const tabs = [...(host.turnTabs?.values() || [])];
  const tab = tabs.find(candidate => candidate.id === tabId);
  const busy = tabs.filter(automaticTabBusy);
  const operation = automaticOperation(host);
  const auth = host.authView && tabId === host.selectedTabId ? host.authView : null;
  let reason = auth ? "sign-in" : tab?.interactionMode === "manual" ? "manual" : "protected";
  if (!auth && tab && tab.interactionMode !== "manual") {
    reason = tab.failureReviewUntil ? "failed-answer" : tab.stopping ? "stopping" : tab.awaitingToolResults ? "waiting-tools"
      : automaticTabBusy(tab) ? "running" : "retained";
  } else if (!auth && !tab) {
    reason = busy.some(candidate => candidate.stopping) ? "stopping"
      : busy.some(candidate => candidate.status === "running" || candidate.inputOwnerActive) ? "running"
      : busy.length ? "waiting-tools" : operation ? "checking"
        : HUMAN_OPERATIONS.has(host.manualOperation) ? "sign-in" : "protected";
  }
  const failedReview = !auth && tab?.failureReviewUntil;
  const override = auth ? auth.inputOverride : failedReview ? false : tab ? tab.inputOverride : host.homeInputOverride;
  return {
    inputLocked: reason !== null && override !== true,
    inputOverrideActive: reason !== null && override === true,
    canOverrideInput: !failedReview,
    inputLockReason: reason,
    automationBusy: busy.length > 0 || operation,
    // Browser zoom changes every surface, including retained automatic conversations.
    zoomLocked: override !== true || operation || tabs.some(candidate => candidate.interactionMode !== "manual"),
  };
}

module.exports = { automaticTabBusy, automaticOperation, browserInputPolicy };
