import { useEffect, useState } from "react";
import {
  availableChatGptWebModelRoutes,
  chatGptWebRouteEfforts,
} from "../../../../src/models/chatgpt-web-models";
import { copyFor, localizeRuntimeMessage } from "../../i18n";
import type { BrowserInteractionMode, DoctorReport } from "../../types";
import { translate } from "./labels";
import { workspaceBusy } from "./status";
import type { WorkspaceProps } from "./types";
import { useFeedback } from "./useFeedback";

/** Owns connection drafts and commit actions; selecting a draft never applies it. */
export function useConnectionSetup(p: WorkspaceProps) {
  const {
    api,
    snapshot,
    status,
    browser,
    operation,
    updateState,
    refresh,
    setError,
    activateBrowser,
  } = p;
  const language = snapshot.state.language ?? "en",
    t = translate(language),
    copy = copyFor(language);
  const [draft, setDraft] = useState<"native-tools" | "mcp-bridge">(
    status?.mode === "mcp-bridge" ? "mcp-bridge" : "native-tools",
  );
  const [interaction, setInteraction] = useState(
    snapshot.state.browserInteractionMode,
  );
  const [dirty, setDirty] = useState(false),
    [working, setWorking] = useState(false);
  const [notice, setNotice, dismissNotice] = useFeedback();
  const [tunnel, setTunnel] = useState(""),
    [runtimeKey, setRuntimeKey] = useState(""),
    [replace, setReplace] = useState(false);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [failure, setFailure] = useState<{
    step: string;
    message: string;
  } | null>(null);
  const busy =
      snapshot.startup.status !== "ready" ||
      working ||
      workspaceBusy(browser, operation),
    manual = interaction === "manual";
  const saved = status?.credentials[interaction] === true;
  const currentMode = status?.mode ?? null;
  const modePending =
    draft !== currentMode ||
    interaction !== snapshot.state.browserInteractionMode;
  const pending =
    modePending || replace || tunnel.length > 0 || runtimeKey.length > 0;
  const applied =
    !!status?.configured &&
    snapshot.state.coreSetupComplete === true &&
    !modePending;
  const needsCatalogRefresh =
    snapshot.state.codexRestartRequired === true &&
    snapshot.state.codexCatalogVerified !== true;
  const effortLabel = (
    effort: "low" | "medium" | "high" | "xhigh" | "max" | "ultra",
  ) =>
    ({
      low: t("低", "Low"),
      medium: t("中", "Medium"),
      high: t("高", "High"),
      xhigh: t("极高", "Extra High"),
      max: "Max",
      ultra: "Ultra",
    })[effort] ?? effort;
  const models = status?.capabilities
    ? availableChatGptWebModelRoutes(status.capabilities).map((route) => {
        const label = (effort: Parameters<typeof effortLabel>[0]) =>
          route.interactionMode === "manual"
            ? t("固定", "Fixed")
            : route.backendModel === "gpt-5.6-luna"
              ? effort === "low"
                ? t("普通", "Ordinary")
                : "Think"
              : effort === "low"
                ? t("低（即时）", "Low (Instant)")
                : effort === "max"
                  ? t("Max（Pro，固定）", "Max (Pro, fixed)")
                  : effortLabel(effort);
        return {
          id: route.slug,
          name: route.displayName,
          efforts: chatGptWebRouteEfforts(route, status.capabilities!)
            .map(label)
            .join(" / "),
          defaultEffort: label(route.codexEffort),
        };
      })
    : [];
  useEffect(() => {
    if (!dirty) {
      setDraft(status?.mode === "mcp-bridge" ? "mcp-bridge" : "native-tools");
      setInteraction(
        status?.mode === "mcp-bridge"
          ? snapshot.state.browserInteractionMode
          : "automatic",
      );
    }
  }, [status?.mode, snapshot.state.browserInteractionMode, dirty]);
  const run = async (step: string, action: () => Promise<void>) => {
    if (busy) return;
    setWorking(true);
    setNotice("");
    setError(null);
    setFailure(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      setFailure({
        step,
        message: localizeRuntimeMessage(
          copy,
          error instanceof Error ? error.message : String(error),
          undefined,
          language,
        ),
      });
      await refresh().catch(() => {});
    } finally {
      setWorking(false);
    }
  };
  const clearDraftDetails = () => {
    setTunnel("");
    setRuntimeKey("");
    setReplace(false);
    setReport(null);
    setFailure(null);
  };
  const discard = () => {
    setDirty(false);
    setDraft(currentMode === "mcp-bridge" ? "mcp-bridge" : "native-tools");
    setInteraction(
      currentMode === "mcp-bridge"
        ? snapshot.state.browserInteractionMode
        : "automatic",
    );
    clearDraftDetails();
  };
  const chooseMode = (value: "native-tools" | "mcp-bridge") => {
    if (busy || value === draft) return;
    setDraft(value);
    if (value === "native-tools") setInteraction("automatic");
    setDirty(true);
    clearDraftDetails();
  };
  const chooseInteraction = (value: BrowserInteractionMode) => {
    if (busy || value === interaction) return;
    setInteraction(value);
    setDirty(true);
    clearDraftDetails();
  };
  const apply = () =>
    run("apply", async () => {
      if (draft === "mcp-bridge")
        await api.setupMcp({
          interactionMode: interaction,
          ...(saved && !replace
            ? { replace: false }
            : {
                tunnelId: tunnel,
                runtimeKey: runtimeKey.trim(),
                replace: true,
              }),
        });
      else if (
        !status?.configured ||
        (status.mode === "native-tools" &&
          snapshot.state.browserInteractionMode === "automatic")
      )
        await api.setupCore();
      else {
        const result = await api.setToolMode("native-tools", "automatic");
        if (result.credentialsRequired)
          throw new Error(
            t("请先配置连接凭据", "Configure connection credentials first"),
          );
        updateState(result.state);
      }
      updateState((await api.snapshot()).state);
      setDirty(false);
      clearDraftDetails();
      setNotice(
        draft === "mcp-bridge"
          ? t(
              "配置已应用。接下来完成连接器绑定与检查。",
              "Configuration applied. Continue with connector binding and checks.",
            )
          : t(
              "配置已应用。请在 Codex 刷新模型目录。",
              "Configuration applied. Refresh the model catalog in Codex.",
            ),
      );
    });
  const verify = () =>
    run("verify", async () => {
      const result = await api.verifyMcp();
      setReport(result);
      updateState((await api.snapshot()).state);
    });
  const credentialsValid =
    (saved && !replace) ||
    (/^tunnel_[a-f0-9]{32}$/.test(tunnel) &&
      runtimeKey.trim().length >= 20 &&
      !/[\r\n]/.test(runtimeKey));
  const canApply =
    !!status &&
    !busy &&
    (draft === "mcp-bridge"
      ? credentialsValid &&
        (manual ||
          snapshot.state.browserInteractionMode === "manual" ||
          snapshot.state.codexCatalogVerified === true)
      : snapshot.state.coreSetupComplete ||
        (!!browser?.authenticated && snapshot.smokePassed));

  return {
    api,
    snapshot,
    browser,
    updateState,
    refresh,
    activateBrowser,
    language,
    t,
    copy,
    draft,
    interaction,
    setDirty,
    working,
    notice,
    setNotice,
    dismissNotice,
    tunnel,
    setTunnel,
    runtimeKey,
    setRuntimeKey,
    replace,
    setReplace,
    report,
    setReport,
    failure,
    setFailure,
    busy,
    manual,
    saved,
    currentMode,
    pending,
    applied,
    needsCatalogRefresh,
    models,
    run,
    discard,
    chooseMode,
    chooseInteraction,
    apply,
    verify,
    credentialsValid,
    canApply,
  };
}
