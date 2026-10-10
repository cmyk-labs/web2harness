import { BrandMark } from "../../components/BrandMark";
import type {
  BrowserState,
  Language,
  LauncherSnapshot,
  OperationState,
  WorkspaceStatus,
} from "../../types";
import { interactionName, modeName, pageName, translate } from "./labels";
import { workspaceBusy, workspaceReady, workspaceTone } from "./status";
import type { WorkspacePage } from "./types";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { UpdateButton } from "./UpdateButton";
import type { WorkspaceProps } from "./types";

export function WorkspaceSidebar({
  page,
  navigate,
  snapshot,
  status,
  browser,
  operation,
  onLanguageChange,
  changingLanguage,
  api,
  setError,
}: {
  page: WorkspacePage;
  navigate: (page: WorkspacePage) => void;
  snapshot: LauncherSnapshot;
  status: WorkspaceStatus | null;
  browser: BrowserState | null;
  operation: OperationState | null;
  onLanguageChange: (language: Language) => void;
  changingLanguage: boolean;
  api: WorkspaceProps["api"];
  setError: WorkspaceProps["setError"];
}) {
  const t = translate(snapshot.state.language ?? "en");
  const busy = workspaceBusy(browser, operation);
  const ready = workspaceReady(status, snapshot, browser);
  const tone = workspaceTone(status, snapshot, browser, operation);
  const statusText =
    snapshot.startup.status === "failed"
      ? t("准备失败", "Preparation failed")
      : snapshot.startup.status !== "ready"
        ? t("正在准备", "Preparing")
        : tone === "error"
          ? t("运行异常", "Error")
          : busy
            ? t("任务进行中", "Task running")
            : ready
              ? t("已就绪", "Ready")
              : t("需要检查", "Needs attention");
  const modeText = modeName(status?.mode ?? null, t);
  const statusDetail = `${statusText} · ${modeText} · ${interactionName(snapshot.state.browserInteractionMode, t)}`;
  return (
    <div className="sidebar-content">
      <div className="sidebar-brand-row">
        <div className="sidebar-brand-identity">
          <BrandMark />
          <strong>Web2Harness</strong>
          <span className="brand-version">v{snapshot.version}</span>
          {snapshot.profile === "development" && (
            <span className="dev-profile-badge">DEV</span>
          )}
        </div>
      </div>
      <nav className="sidebar-nav" aria-label={t("主导航", "Main navigation")}>
        {(
          [
            {
              label: t("工作区", "Workspace"),
              pages: ["overview", "browser", "runtime-controls"],
            },
            {
              label: t("设置", "Settings"),
              pages: ["connection", "preferences"],
            },
            { label: t("应用", "Application"), pages: ["license", "diagnostics", "about"] },
          ] as { label: string; pages: WorkspacePage[] }[]
        ).map((group) => (
          <section
            className="sidebar-group"
            key={group.label}
            aria-label={group.label}
          >
            <h2>{group.label}</h2>
            <div>
              {group.pages.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`sidebar-item ${page === p ? "is-active" : ""}`}
                  aria-current={page === p ? "page" : undefined}
                  onClick={() => navigate(p)}
                >
                  <WorkspaceIcon name={p} />
                  <span>{pageName(p, t)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </nav>
      <UpdateButton api={api} snapshot={snapshot} browser={browser} operation={operation} setError={setError} sidebar />
      <div className="sidebar-footer">
        <div
          className="side-status"
          role="status"
          tabIndex={0}
          title={statusDetail}
          aria-label={statusDetail}
        >
          <span aria-hidden="true" className={`status-dot status-${tone}`} />
          <span className="side-status-text">
            {statusText} · {modeText}
          </span>
        </div>
        <button
          type="button"
          className="language-toggle"
          disabled={changingLanguage}
          aria-label={t("切换为英文", "Switch to Chinese")}
          title={t("切换为英文", "Switch to Chinese")}
          onClick={() =>
            onLanguageChange(
              snapshot.state.language === "zh-CN" ? "en" : "zh-CN",
            )
          }
        >
          {snapshot.state.language === "zh-CN" ? "中" : "EN"}
        </button>
      </div>
    </div>
  );
}
