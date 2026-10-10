import { messageOf } from "../../../lib/errors";
import { Row } from "../controls";
import { translate } from "../labels";
import { UpdateButton } from "../UpdateButton";
import type { WorkspaceProps } from "../types";
import { EntryBrand } from "../../startup/EntryBrand";
import { OperatingDiagram } from "./OperatingDiagram";
import "./about.css";

export function About({
  api,
  snapshot,
  browser,
  operation,
  setError,
}: WorkspaceProps) {
  const language = snapshot.state.language ?? "en";
  const t = translate(language);
  const platform =
    { win32: "Windows", darwin: "macOS", linux: "Linux" }[snapshot.platform] ??
    snapshot.platform;

  return (
    <>
      <header className="about-header surface-header">
        <h1>{t("关于", "About")}</h1>
      </header>
      <section className="about-product" aria-label={t("产品信息", "Product information")}>
        <EntryBrand version={snapshot.version} devProfile={snapshot.profile === "development"} />
        <p>{t("将 ChatGPT 网页版模型接入 Codex，统一管理连接、工具与运行状态。", "Connect ChatGPT web models to Codex and manage connections, tools and runtime status.")}</p>
        <dl className="about-metadata">
          <div><dt>{t("运行平台", "Platform")}</dt><dd>{platform}</dd></div>
        </dl>
      </section>
      <Row title={t("检查更新", "Check for updates")} description={
        snapshot.update.lastCheckedAt
          ? `${t("上次检查：", "Last checked: ")}${new Date(snapshot.update.lastCheckedAt).toLocaleString(language)}`
          : t("启动时及每 6 小时自动检查，也可手动检查。", "Checked at startup and every 6 hours, or manually.")
      }>
        <button type="button" className="btn" disabled={["disabled", "checking", "downloading", "installing"].includes(snapshot.update.status)}
          onClick={() => { void api.checkUpdate().catch(error => setError(messageOf(error))); }}>
          {snapshot.update.status === "checking" ? t("正在检查…", "Checking…") : t("检查更新", "Check for updates")}
        </button>
      </Row>
      <p role="status" className="about-update-status">{
        snapshot.update.status === "disabled" ? t("开发模式或当前安装方式不支持应用内更新。", "In-app updates are unavailable in development or for this installation.")
          : snapshot.update.status === "up-to-date" ? t("已是最新稳定版本。", "You have the latest stable version.")
          : snapshot.update.status === "error" ? `${t("检查失败，可重试：", "Check failed; retry: ")}${snapshot.update.message}`
          : snapshot.update.status === "idle" ? t("尚未检查更新。", "Updates have not been checked yet.") : ""
      }</p>
      {["available", "downloading", "installing"].includes(
        snapshot.update.status,
      ) && (
        <Row
          title={t("可用更新", "Available update")}
          description={
            "version" in snapshot.update ? snapshot.update.version : undefined
          }
        >
          <UpdateButton api={api} snapshot={snapshot} browser={browser} operation={operation} setError={setError} />
        </Row>
      )}
      <details className="about-details">
        <summary>{t("工作原理", "How it works")}</summary>
        <OperatingDiagram t={t} />
      </details>
    </>
  );
}
