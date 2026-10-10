import { Button } from "../../../components/Buttons";
import { Row, Section } from "../controls";
import { interactionName, modeName, translate } from "../labels";
import {
  runtimeFailed,
  workspaceBusy,
  workspaceReady,
  workspaceTone,
} from "../status";
import type { WorkspaceProps } from "../types";
import { WorkspaceIcon } from "../WorkspaceIcon";

export function Overview(p: WorkspaceProps) {
  const { snapshot, status, browser, operation, navigate } = p;
  const t = translate(snapshot.state.language ?? "en");
  const busy = workspaceBusy(browser, operation),
    ready = workspaceReady(status, snapshot, browser);
  const manual = snapshot.state.browserInteractionMode === "manual";
  const awaitingCatalog =
    !!status?.configured && !manual && !snapshot.state.codexCatalogVerified;
  const awaitingConnector =
    status?.mode === "mcp-bridge" && !snapshot.state.mcpSetupComplete;
  const tone = workspaceTone(status, snapshot, browser, operation);
  const statusText =
    snapshot.startup.status === "failed"
      ? t("准备失败", "Preparation failed")
      : snapshot.startup.status !== "ready"
        ? t("正在准备", "Preparing")
        : tone === "error"
          ? t("运行异常", "Needs attention")
          : busy
            ? t("任务进行中", "Task in progress")
            : ready
              ? t("已就绪", "Ready")
              : t("待完成配置", "Setup incomplete");
  return (
    <>
      <div className="overview-intro surface-header">
        <h1 className="overview-lead">
          {t("工作空间概览", "Workspace overview")}
        </h1>
        <p className="overview-description">
          {t(
            "查看 ChatGPT、Codex 与运行服务的连接状态。",
            "Review the connection status of ChatGPT, Codex and the runtime.",
          )}
        </p>
      </div>
      <Section title={t("连接状态", "Connection status")} />
      <div className="overview-status cards">
        {[
          {
            icon: "browser",
            label: "ChatGPT",
            value: manual
              ? t("手动管理", "Managed manually")
              : browser?.status === "error"
                ? t("连接异常", "Connection error")
                : browser?.authenticated
                  ? t("已登录", "Signed in")
                  : t("等待登录", "Sign-in required"),
            tone: manual
              ? "neutral"
              : browser?.status === "error"
                ? "error"
                : browser?.authenticated
                  ? "success"
                  : "neutral",
            description: manual
              ? t("账号状态由你确认", "You confirm the account status")
              : t("独立浏览器会话", "Separate browser session"),
          },
          {
            icon: "connection",
            label: "Codex",
            value: snapshot.state.codexCatalogVerified
              ? t("已接入", "Connected")
              : snapshot.state.coreSetupComplete
                ? t("等待目录刷新", "Awaiting catalog refresh")
                : t("尚未接入", "Not connected"),
            tone: snapshot.state.codexCatalogVerified ? "success" : "neutral",
            description: t(
              "在 Codex 中选择 Web 模型",
              "Choose Web models in Codex",
            ),
          },
          {
            icon: "terminal",
            label: t("运行服务", "Runtime"),
            value: runtimeFailed(status)
              ? t("运行异常", "Runtime error")
              : status?.runtimeStatus === "ready"
                ? t("运行正常", "Healthy")
                : status?.configured
                  ? t("需要检查", "Needs attention")
                  : t("等待配置", "Setup required"),
            tone: runtimeFailed(status)
              ? "error"
              : status?.runtimeStatus === "ready"
                ? "success"
                : "neutral",
            description: t(
              "当前配置对应的运行服务",
              "Runtime for the active configuration",
            ),
          },
        ].map((item) => (
          <div className="card" key={item.icon}>
            <div className="flex between">
              <span className="muted">{item.label}</span>
              <WorkspaceIcon name={item.icon} />
            </div>
            <div className={`value status-${item.tone}`}>{item.value}</div>
            <p>{item.description}</p>
          </div>
        ))}
      </div>
      {snapshot.startup.status === "ready" && (!ready || busy) && (
        <section className={`overview-notice status-${tone}`} role="status">
          <div>
            <h2>
              {tone === "error"
                ? t("检查连接与运行服务", "Check the connection and runtime")
                : busy
                  ? t("任务正在运行", "A task is running")
                  : awaitingCatalog
                    ? t(
                        "下一步：刷新 Codex 模型目录",
                        "Next: refresh the Codex model catalog",
                      )
                    : awaitingConnector
                      ? t(
                          "下一步：完成 MCP 连接检查",
                          "Next: complete MCP connection checks",
                        )
                      : t(
                          "下一步：完成连接配置",
                          "Next: finish connection setup",
                        )}
            </h2>
            <p>
              {tone === "error"
                ? t(
                    "查看检查结果和运行日志，定位需要处理的项目。",
                    "Review health checks and logs to find what needs attention.",
                  )
                : busy
                  ? t(
                      "当前配置继续生效，任务结束后可调整连接。",
                      "Your current configuration stays active. Change connections after the task finishes.",
                    )
                  : awaitingCatalog
                    ? t(
                        "在对应的 Codex 环境刷新模型目录，或重启该 Codex 客户端。",
                        "Refresh the model catalog in the matching Codex environment, or restart that Codex client.",
                      )
                    : awaitingConnector
                      ? manual
                        ? t(
                            "先确认网页中的连接器绑定，再检查本地运行环境。",
                            "Confirm the connector binding in the browser, then check the local runtime.",
                          )
                        : t(
                            "应用配置后，将对应隧道绑定到连接器并验证。",
                            "After applying configuration, bind its tunnel to the connector and verify it.",
                          )
                      : t(
                          "登录 ChatGPT，检查连接，然后应用配置。",
                          "Sign in to ChatGPT, check the connection, then apply configuration.",
                        )}
            </p>
          </div>
          {!busy && (
            <Button
              onClick={() =>
                navigate(tone === "error" ? "diagnostics" : "connection")
              }
            >
              {tone === "error"
                ? t("查看诊断", "View diagnostics")
                : t("查看配置", "View setup")}
            </Button>
          )}
        </section>
      )}
      <Section
        title={t("当前生效配置", "Active configuration")}
        meta={
          <Button onClick={() => navigate("connection")}>
            {t("管理连接", "Manage connection")}
          </Button>
        }
      />
      <div className="configuration-summary panel">
        <Row
          title={`${modeName(status?.mode ?? null, t)} · ${interactionName(snapshot.state.browserInteractionMode, t)}`}
        >
          <span className={`badge status-${tone}`}>{statusText}</span>
        </Row>
      </div>
      <section className="usage-guide" aria-labelledby="usage-steps-title">
      <h2 id="usage-steps-title">{t("使用步骤", "Usage steps")}</h2>
      <ol className="usage-flow" aria-label={t("使用步骤", "Usage steps")}>
        {[
          [
            t("打开 Codex", "Open Codex"),
            t(
              "使用你熟悉的客户端或命令行。",
              "Use your usual app or command line.",
            ),
          ],
          [
            t("选择 Web 模型", "Choose Web models"),
            t("模型名称以 (Web) 标识。", "Look for (Web) in the model name."),
          ],
          [
            t("照常开始任务", "Start your task"),
            t(
              "在这里查看连接和运行状态。",
              "Check connection and runtime status here.",
            ),
          ],
        ].map(([title, description], i) => (
          <li key={title}>
            <div className="flow-heading">
              <span className="flow-number" aria-hidden="true">
                0{i + 1}
              </span>
              <h3>{title}</h3>
            </div>
            <p>{description}</p>
            {i < 2 && (
              <svg
                className="flow-connector"
                viewBox="0 0 24 12"
                aria-hidden="true"
              >
                <path d="M1 6h20m-4-4 4 4-4 4" />
              </svg>
            )}
          </li>
        ))}
      </ol>
      </section>
    </>
  );
}
