import { useEffect, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import {
  IconButton,
  PrimaryButton,
  SecondaryButton,
} from "../../components/Buttons";
import { Icon } from "../../components/icons";
import { StateDot } from "../../components/StateDot";
import type { Copy } from "../../i18n";
import { api } from "../../ipc";
import { messageOf } from "../../lib/errors";
import type {
  BrowserInteractionMode,
  BrowserState,
  OperationState,
} from "../../types";
import { ManualTurnGuide } from "./ManualTurnGuide";
import {
  browserTabTitleFromTitle,
  browserTabTone,
  formatBrowserAddress,
} from "./presentation";

export function BrowserSurface({
  browser,
  browserSlotRef,
  copy,
  interactionMode,
  operation,
  platform,
  setError,
}: {
  browser: BrowserState | null;
  browserSlotRef: (node: HTMLDivElement | null) => void;
  copy: Copy;
  interactionMode: BrowserInteractionMode;
  operation: OperationState | null;
  platform: string;
  setError: (error: string | null) => void;
}) {
  const [passkeyContinuationRequested, setPasskeyContinuationRequested] =
    useState(false);
  const visible = browser?.visible === true;
  const manualInteraction = interactionMode === "manual";
  const passkeyAvailable =
    !manualInteraction &&
    platform === "darwin" &&
    browser?.authenticated !== true;
  const selectedManualTab = browser?.tabs.find(
    (tab) => tab.active && tab.interactionMode === "manual",
  );
  const navigationLocked =
    browser?.status === "running" || browser?.status === "testing";
  const passkeyWaiting =
    passkeyAvailable &&
    operation?.name === "passkey-login" &&
    operation.status === "running" &&
    browser?.authenticated !== true;
  useEffect(() => {
    if (!passkeyWaiting) setPasskeyContinuationRequested(false);
  }, [passkeyWaiting]);
  const navigate = async (action: "back" | "forward" | "reload") => {
    try {
      await api!.navigateBrowser(action);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const zoom = async (action: "in" | "out" | "reset") => {
    try {
      await api!.zoomBrowser(action);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const toggle = async () => {
    try {
      if (visible) await api!.hideBrowser();
      else await api!.showBrowser();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const selectTab = async (tabId: string) => {
    try {
      await api!.selectBrowserTab(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const closeTab = async (tabId: string) => {
    try {
      await api!.closeBrowserTab(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const openPasskeyLogin = () => {
    if (operation?.status === "running") return;
    setError(null);
    void api!.openPasskeyLogin().catch((cause) => setError(messageOf(cause)));
  };
  const continuePasskeyLogin = async () => {
    if (!passkeyWaiting || passkeyContinuationRequested) return;
    setPasskeyContinuationRequested(true);
    setError(null);
    try {
      await api!.continuePasskeyLogin();
    } catch (cause) {
      setPasskeyContinuationRequested(false);
      setError(messageOf(cause));
    }
  };
  const copyManualPrompt = async (tabId: string) => {
    try {
      await api!.copyManualPrompt(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const confirmManualSent = async (tabId: string) => {
    try {
      await api!.confirmManualSent(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  return (
    <section className="browser-surface">
      <div className="browser-tab-strip" title={copy.browserTabLimit}>
        {(browser?.tabs ?? []).map((tab) => (
          <div
            className={`browser-tab${tab.active ? " is-active" : ""}`}
            key={tab.id}
            onClick={() => void selectTab(tab.id)}
            role="tab"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
              event.preventDefault();
              void selectTab(tab.id);
            }}
            aria-selected={tab.active}
          >
            <BrandMark small />
            <span
              title={tab.traceId ? `${tab.title} · ${tab.traceId}` : tab.title}
            >
              {browserTabTitleFromTitle(tab.title, copy)}
            </span>
            {tab.loading ? (
              <i className="tab-spinner" />
            ) : (
              <StateDot state={browserTabTone(tab.status)} />
            )}
            {tab.closable ? (
              <button
                aria-label={copy.hideTab}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
                title={copy.hideTab}
                type="button"
              >
                <Icon name="close" />
              </button>
            ) : null}
          </div>
        ))}
        <div className="browser-tab-drag draggable" />
      </div>
      <div className="browser-toolbar">
        <div className="browser-history">
          <IconButton
            disabled={navigationLocked || !browser?.canGoBack}
            icon="back"
            label={copy.back}
            onClick={() => void navigate("back")}
          />
          <IconButton
            disabled={navigationLocked || !browser?.canGoForward}
            icon="forward"
            label={copy.forward}
            onClick={() => void navigate("forward")}
          />
          <IconButton
            disabled={navigationLocked || !visible}
            icon="reload"
            label={copy.reload}
            onClick={() => void navigate("reload")}
          />
        </div>
        <div
          className="browser-address"
          title={browser?.url || copy.browserAddress}
        >
          <Icon name="globe" />
          <span>{formatBrowserAddress(browser?.url, copy)}</span>
        </div>
        <div className="browser-zoom-controls">
          <IconButton
            icon="minus"
            label={copy.zoomOut}
            onClick={() => void zoom("out")}
          />
          <button
            aria-label={copy.zoomReset}
            className="browser-zoom-reset"
            onClick={() => void zoom("reset")}
            title={copy.zoomReset}
            type="button"
          >
            {Math.round((browser?.zoomFactor ?? 1) * 100)}%
          </button>
          <IconButton
            icon="plus"
            label={copy.zoomIn}
            onClick={() => void zoom("in")}
          />
        </div>
        {passkeyAvailable ? (
          <button
            className="toolbar-text-button"
            disabled={passkeyWaiting && passkeyContinuationRequested}
            onClick={() =>
              void (passkeyWaiting
                ? continuePasskeyLogin()
                : openPasskeyLogin())
            }
            type="button"
          >
            {passkeyWaiting
              ? passkeyContinuationRequested
                ? copy.passkeyImporting
                : copy.passkeyContinue
              : copy.passkeySignIn}
          </button>
        ) : null}
        <button
          className="toolbar-text-button"
          onClick={() => void toggle()}
          type="button"
        >
          {visible ? copy.hideBrowser : copy.openChatgpt}
        </button>
        {browser?.loading ? <i className="browser-loading-line" /> : null}
      </div>
      {selectedManualTab &&
      ["awaiting-user", "sent"].includes(
        selectedManualTab.manualState ?? "",
      ) ? (
        <ManualTurnGuide
          copy={copy}
          onCancel={() => void closeTab(selectedManualTab.id)}
          onCopy={() => void copyManualPrompt(selectedManualTab.id)}
          onSent={() => void confirmManualSent(selectedManualTab.id)}
          tab={selectedManualTab}
        />
      ) : null}
      <div className="browser-viewport" ref={browserSlotRef}>
        {!visible ? (
          <div className="browser-empty">
            <BrandMark />
            <h1>
              {manualInteraction
                ? copy.browserReady
                : browser?.authenticated
                  ? copy.noActiveTask
                  : copy.stepAccount}
            </h1>
            <p>
              {manualInteraction
                ? copy.stepAccountBody
                : browser?.authenticated
                  ? copy.noActiveTaskBody
                  : passkeyWaiting
                    ? copy.passkeyContinueBody
                    : copy.stepAccountBody}
            </p>
            <div className="browser-empty-actions">
              <PrimaryButton
                disabled={passkeyWaiting}
                onClick={() => void toggle()}
              >
                {manualInteraction || browser?.authenticated
                  ? copy.openChatgpt
                  : copy.signIn}
              </PrimaryButton>
              {passkeyAvailable ? (
                <SecondaryButton
                  disabled={passkeyWaiting && passkeyContinuationRequested}
                  onClick={
                    passkeyWaiting ? continuePasskeyLogin : openPasskeyLogin
                  }
                >
                  {passkeyWaiting
                    ? passkeyContinuationRequested
                      ? copy.passkeyImporting
                      : copy.passkeyContinue
                    : copy.passkeySignIn}
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="browser-underlay" aria-hidden="true">
            <span>{copy.loading}</span>
          </div>
        )}
      </div>
    </section>
  );
}
