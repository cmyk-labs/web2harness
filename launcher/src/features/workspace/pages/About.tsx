import { messageOf } from "../../../lib/errors";
import { Row, Section } from "../controls";
import { translate } from "../labels";
import { UpdateButton } from "../UpdateButton";
import type { WorkspaceProps } from "../types";
import { WorkspaceIcon } from "../WorkspaceIcon";
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
  const links = snapshot.urls;
  const open = (url: string) => {
    if (!url) return;
    void api.openExternal(url).catch((error) => setError(messageOf(error)));
  };
  const platform =
    { win32: "Windows", darwin: "macOS", linux: "Linux" }[snapshot.platform] ??
    snapshot.platform;

  return (
    <>
      <header className="about-header">
        <h1>{t("关于", "About")}</h1>
        <span className="about-version">Web2Harness · v{snapshot.version}</span>
      </header>
      <section
        className="about-statement"
        aria-label={t("项目介绍", "Project introduction")}
      >
        <p className="about-kicker">
          CHATGPT WEB <span aria-hidden="true">×</span> CODEX
        </p>
        <h2>
          {t("用 Web 模型推理。", "Reason with web models.")}
          <br />
          <span>{t("让 Codex 把事做完。", "Get it done in Codex.")}</span>
        </h2>
        <p className="about-description">
          {t(
            "你的 ChatGPT 订阅。你的 Codex 工作流。让可用的 Web 模型参与更多实际任务。",
            "Your ChatGPT plan. Your Codex workflow. Put your available web models to work.",
          )}
        </p>
      </section>
      <div className="about-capabilities">
        {[
          [
            "browser",
            t("连接 Web 模型", "Connect web models"),
            t(
              "在 Codex 原有模型之外，选择账号可用的 Web 模型与思考强度。",
              "Choose your account’s web models and reasoning levels alongside the original Codex models.",
            ),
          ],
          [
            "connection",
            t("延续工具与工作流", "Keep your workflow"),
            t(
              "通过原生工具或 MCP Bridge 执行任务，沿用 Codex 的沙箱与审批规则。",
              "Run tasks with native tools or MCP Bridge, keeping Codex sandbox and approval rules.",
            ),
          ],
          [
            "diagnostics",
            t("在一处管理连接", "Manage connections"),
            t(
              "登录、配置、检查连接与查看运行日志，都在桌面工作空间完成。",
              "Sign in, configure connections, run checks and inspect logs from one desktop workspace.",
            ),
          ],
        ].map(([icon, title, description]) => (
          <section key={icon}>
            <WorkspaceIcon name={icon} />
            <h3>{title}</h3>
            <p>{description}</p>
          </section>
        ))}
      </div>
      <OperatingDiagram t={t} />
      <Section title={t("资源与支持", "Resources & support")} />
      <div className="about-links">
        {[
          [
            t("使用文档", "Documentation"),
            language === "zh-CN" ? links.documentationZhCN : links.documentation,
          ],
          [t("GitHub 仓库", "GitHub repository"), links.github],
          [
            t("开源许可", "Open-source license"),
            links.license,
          ],
        ].map(([label, url]) => (
          <button
            type="button"
            key={label}
            disabled={!url}
            onClick={() => open(url)}
          >
            <span>{label}</span>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <footer className="about-footer">
        <span>
          {platform} · v{snapshot.version}
          {snapshot.profile === "development" ? " · DEV" : ""}
        </span>
        <span>MIT {t("许可证", "License")}</span>
      </footer>
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
    </>
  );
}
