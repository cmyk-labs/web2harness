import { useRef, useState } from "react";
import { Button } from "../../../components/Buttons";
import { copyFor, localizeRuntimeMessage } from "../../../i18n";
import { messageOf } from "../../../lib/errors";
import { PageIntro, Row, Section } from "../controls";
import { Feedback } from "../Feedback";
import { interactionName, modeName, translate } from "../labels";
import { workspaceBusy, workspaceReady, workspaceTone } from "../status";
import type { WorkspaceProps } from "../types";
import { useFeedback } from "../useFeedback";

export function RuntimeControls({
  api,
  snapshot,
  status,
  statusError,
  browser,
  operation,
  refresh,
  updateState,
  setError,
}: WorkspaceProps) {
  const language = snapshot.state.language ?? "en";
  const t = translate(language);
  const copy = copyFor(language);
  const [working, setWorking] = useState<"cancel" | "remove" | null>(null);
  const pending = useRef(false);
  const [notice, showNotice, dismissNotice] = useFeedback();
  const operationRunning = operation?.status === "running";
  const controlsDisabled = snapshot.startup.status !== "ready" || !!working || operationRunning;
  const removalDisabled = controlsDisabled || workspaceBusy(browser, operation);
  const ready = workspaceReady(status, snapshot, browser);
  const tone = workspaceTone(status, snapshot, browser, operation);
  const connectionText = statusError
    ? t("状态不可用", "Status unavailable")
    : !status
      ? t("正在读取", "Loading status")
      : !status.configured
        ? t("尚未配置", "Not configured")
        : tone === "error"
          ? t("运行异常", "Needs attention")
          : ready
            ? t("已就绪", "Ready")
            : t("需要检查", "Needs attention");
  const activityText = operationRunning
    ? t("操作进行中", "Operation in progress")
    : !browser || browser.status === "error"
      ? t("状态未知", "Status unknown")
      : workspaceBusy(browser, null)
        ? t("任务处理中", "Processing tasks")
        : t("未观察到活动任务", "No observed active tasks");

  async function run(
    action: "cancel" | "remove",
    execute: () => Promise<string | null>,
  ) {
    if (pending.current || (action === "remove" ? removalDisabled : controlsDisabled)) return;
    pending.current = true;
    setWorking(action);
    setError(null);
    showNotice("");
    try {
      const message = await execute();
      await refresh();
      if (message) showNotice(message);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      pending.current = false;
      setWorking(null);
    }
  }

  return (
    <>
      <PageIntro
        title={t("运行控制", "Runtime controls")}
        subtitle={t(
          "查看当前运行状态，取消活动任务或解除 Codex 接入。",
          "Review the current state, cancel active tasks or remove the Codex integration.",
        )}
      />
      <Section title={t("当前状态", "Current state")} />
      <div className="cards runtime-control-status" aria-label={t("运行状态", "Runtime status")}>
        {[
          {
            label: t("当前模式", "Active mode"),
            value: status ? modeName(status.mode, t) : t("尚未确认", "Not confirmed"),
            description: interactionName(snapshot.state.browserInteractionMode, t),
          },
          {
            label: t("连接状态", "Connection status"),
            value: connectionText,
            description: t("当前生效配置的就绪状态", "Readiness of the active configuration"),
          },
          {
            label: t("活动状态", "Activity"),
            value: activityText,
            description: t("当前浏览器与应用操作", "Current browser and app operations"),
          },
        ].map((item) => (
          <div className="card" key={item.label}>
            <span className="muted">{item.label}</span>
            <div className="value">{item.value}</div>
            <p>{item.description}</p>
          </div>
        ))}
      </div>
      {operationRunning && (
        <div className="note" role="status">
          {localizeRuntimeMessage(copy, operation.message, undefined, language)}
        </div>
      )}
      <Section title={t("任务控制", "Task control")} />
      <div className="panel">
        <Row
          title={copy.cancelTurns}
          description={t(
            "中止 Web2Harness 正在处理的请求及对应网页任务。取消后仍保留当前集成配置。",
            "Stop requests handled by Web2Harness and their browser turns. Keep the current integration configuration.",
          )}
        >
          <Button
            disabled={controlsDisabled}
            onClick={() => void run("cancel", async () => {
              await api.cancelTurns();
              return copy.turnsCancelled;
            })}
          >
            {working === "cancel" ? t("正在取消…", "Cancelling…") : copy.cancelTurns}
          </Button>
        </Row>
      </div>
      <Section title={t("集成管理", "Integration management")} />
      <div className="panel">
        {snapshot.profile === "development" ? (
          <div className="row">
            <p>{t(
              "DEV 环境通过独立配置管理，此处不提供移除 Codex 集成操作。",
              "DEV uses a separate configuration. Integration removal is unavailable here.",
            )}</p>
          </div>
        ) : (
          <Row
            title={copy.uninstallIntegration}
            description={t(
              "解除 Web2Harness 接入并恢复此前的 Codex 模型路由。继续使用 Web 模型前，需要重新应用连接配置。",
              "Disconnect Web2Harness and restore the previous Codex model route. Apply connection settings again before using Web models.",
            )}
          >
            <Button
              disabled={removalDisabled}
              onClick={() => void run("remove", async () => {
                const result = await api.uninstallIntegration();
                if (result.cancelled) return null;
                updateState(result.state);
                return copy.integrationRemoved;
              })}
            >
              {working === "remove" ? t("正在处理…", "Processing…") : copy.uninstallIntegration}
            </Button>
          </Row>
        )}
      </div>
      {notice && (
        <Feedback key={notice.id} notice={notice} dismiss={dismissNotice} t={t} />
      )}
    </>
  );
}
