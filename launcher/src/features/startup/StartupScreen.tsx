import { useState } from "react";
import { EntryBrand } from "./EntryBrand";
import type { Language, StartupState } from "../../types";
import "./StartupScreen.css";

const STAGES: Record<string, [string, string]> = {
  "loading-shell": ["正在加载启动信息", "Loading startup information"],
  "checking-installation": ["正在检查本地安装", "Checking local installation"],
  "waiting-source": ["正在等待安装文件就绪", "Waiting for installation files"],
  "verifying-source": ["正在校验安装文件", "Verifying installation files"],
  "verifying-installed": ["正在检查已有运行环境", "Verifying existing runtime"],
  "copying-runtime": ["正在安装运行环境", "Installing the runtime"],
  "verifying-copy": ["正在校验安装结果", "Verifying the installed files"],
  "committing-runtime": ["正在完成安装", "Completing installation"],
  "initializing-browser": ["正在初始化浏览器", "Initializing the browser"],
};

const INSTALLATION_STAGES = new Set([
  "waiting-source",
  "verifying-source",
  "verifying-installed",
  "copying-runtime",
  "verifying-copy",
  "committing-runtime",
]);

interface StartupScreenProps {
  version?: string;
  state: StartupState;
  language: Language;
  devProfile?: boolean;
  retry?: () => Promise<unknown>;
  retryLabel?: string;
  exportLogs?: () => Promise<unknown>;
}

export function StartupScreen({
  version,
  state,
  language,
  devProfile,
  retry,
  retryLabel,
  exportLogs,
}: StartupScreenProps) {
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const chinese = language === "zh-CN";
  const t = (zh: string, en: string) => (chinese ? zh : en);
  const failed = state.status === "failed";
  const label = (STAGES[state.stage] ?? [
    "正在准备工作空间",
    "Preparing your workspace",
  ])[chinese ? 0 : 1];
  const measurable =
    Number.isFinite(state.completedFiles) &&
    Number.isFinite(state.totalFiles) &&
    state.totalFiles! > 0 &&
    state.completedFiles! >= 0 &&
    state.completedFiles! <= state.totalFiles!;
  const formatCount = (count: number) => count.toLocaleString(language);

  async function runAction(
    action: () => Promise<unknown>,
    successMessage?: string,
  ) {
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await action();
      if (result && successMessage) setActionMessage(successMessage);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="startup-screen entry-screen" aria-labelledby="startup-title">
      <header className="startup-titlebar draggable">
        {devProfile && <span>Web2Harness DEV</span>}
      </header>
      <div className="startup-content entry-content">
        <EntryBrand version={version} />
        <h1 id="startup-title" role={failed ? "alert" : undefined}>
          {failed
            ? t("无法启动工作空间", "Unable to start your workspace")
            : t("正在启动工作空间", "Starting your workspace")}
        </h1>
        {failed ? (
          <div className="startup-failure">
            <p>
              {t(
                "启动准备未能完成。请查看详情或导出诊断包后重试。",
                "Startup could not complete. Review the details or export diagnostics, then try again.",
              )}
            </p>
            <details className="startup-details">
              <summary>{t("查看详情", "View details")}</summary>
              <p>{label}</p>
              <pre>
                {state.message ||
                  t("未提供错误详情。", "No error details were provided.")}
              </pre>
            </details>
            <div className="startup-actions">
              {retry && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction(retry)}
                >
                  {retryLabel ?? t("重新启动", "Restart")}
                </button>
              )}
              {exportLogs && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      exportLogs,
                      t("诊断包已导出。", "Diagnostic bundle exported."),
                    )
                  }
                >
                  {t("导出诊断包", "Export diagnostics")}
                </button>
              )}
            </div>
            {actionMessage && <p role="status">{actionMessage}</p>}
            {actionError && (
              <p className="startup-action-error" role="alert">
                {actionError}
              </p>
            )}
          </div>
        ) : (
          <div className="startup-progress">
            <p id="startup-stage" role="status">
              {label}
            </p>
            {measurable ? (
              <progress
                aria-labelledby="startup-stage"
                aria-describedby="startup-progress-detail"
                value={state.completedFiles}
                max={state.totalFiles}
              />
            ) : (
              <div
                className="startup-activity"
                role="progressbar"
                aria-labelledby="startup-stage"
                aria-describedby="startup-progress-detail"
              >
                <span />
              </div>
            )}
            <p className="startup-progress-detail" id="startup-progress-detail">
              {measurable
                ? t(
                    `当前阶段 · ${formatCount(state.completedFiles!)} / ${formatCount(state.totalFiles!)} 个文件`,
                    `Current stage · ${formatCount(state.completedFiles!)} / ${formatCount(state.totalFiles!)} files`,
                  )
                : t(
                    "完成后将自动进入",
                    "Your workspace will open automatically",
                  )}
            </p>
            <p className="startup-hint">
              {INSTALLATION_STAGES.has(state.stage)
                ? t(
                    "正在准备运行环境，完成后将自动进入。",
                    "Preparing the runtime. Your workspace will open automatically.",
                  )
                : "\u00a0"}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
