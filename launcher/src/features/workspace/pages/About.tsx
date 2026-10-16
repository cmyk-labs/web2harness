import { messageOf } from "../../../lib/errors";
import { Row } from "../controls";
import { translate } from "../labels";
import { UpdateButton } from "../UpdateButton";
import type { WorkspaceProps } from "../types";
import { EntryBrand } from "../../startup/EntryBrand";
import { OperatingDiagram } from "./OperatingDiagram";
import "./about.css";
import { useLicense } from "../../licensing/LicenseContext";

export function About({
  api,
  snapshot,
  browser,
  operation,
  setError,
}: WorkspaceProps) {
  const language = snapshot.state.language ?? "en";
  const { active: licensed } = useLicense();
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
        <p>{t(
          "在 Codex 中使用 ChatGPT 网页版模型，包括账号有权使用的 Pro，支持原生工具调用、任务上下文、流式响应和图片输入。可选实验性三倍上下文预算。使用网页模型时，将遵循 ChatGPT 的网页端限制，且不会消耗 Codex 的配额。默认采用原生工具模式，无需 MCP 连接器或隧道。",
          "Use ChatGPT web models, including Pro when available to your account, in Codex with native tool calls, task context, streaming, and image inputs. Optional experimental 3× context budget. Web-model requests follow ChatGPT's web limits without consuming Codex quota. Native Tools is the default; no MCP connector or tunnel required.",
        )}</p>
        <dl className="about-metadata">
          <div><dt>{t("运行平台", "Platform")}</dt><dd>{platform}</dd></div>
        </dl>
      </section>
      <Row title={t("检查更新", "Check for updates")} description={
        snapshot.update.lastCheckedAt
          ? `${t("上次检查：", "Last checked: ")}${new Date(snapshot.update.lastCheckedAt).toLocaleString(language)}`
          : t("启动时及每 6 小时自动检查，也可手动检查。", "Checked at startup and every 6 hours, or manually.")
      }>
        <button type="button" className="btn" disabled={!licensed || ["disabled", "checking", "downloading", "installing"].includes(snapshot.update.status)}
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
