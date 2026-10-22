import { useLicense } from "../../licensing/LicenseContext";
import { useState } from "react";
import { copyFor } from "../../../i18n";
import type { LauncherState } from "../../../types";
import { PageIntro, Row, Section, Segment, Toggle } from "../controls";
import { Feedback } from "../Feedback";
import { translate } from "../labels";
import { workspaceBusy } from "../status";
import type { WorkspaceProps } from "../types";
import { useFeedback } from "../useFeedback";
import { settingsForEditing } from "../settings";
import { PendingSettings } from "../PendingSettings";

export function Preferences(p: WorkspaceProps) {
  const { api, snapshot, updateState, setError, refresh, browser, operation } =
    p;
  const { active: licensed } = useLicense();
  const settings = settingsForEditing(snapshot.state);
  const t = translate(snapshot.state.language ?? "en"),
    copy = copyFor(snapshot.state.language ?? "en");
  const [working, setWorking] = useState(false),
    [message, setMessage, dismissMessage] = useFeedback();
  const busy =
      working,
    manual = snapshot.state.browserInteractionMode === "manual",
    runtimeBusy = licensed && snapshot.startup.status === "ready" && snapshot.state.coreSetupComplete === true
      && !Object.keys(snapshot.state.pendingSettings ?? {}).length && workspaceBusy(browser, operation);
  const run = async (action: () => Promise<LauncherState | void>, runtime = false) => {
    if (busy) return;
    setWorking(true);
    setError(null);
    setMessage("");
    try {
      const state = await action();
      if (state) updateState(state);
      await refresh();
      setMessage(runtime && state && Object.keys(state.pendingSettings ?? {}).length
        ? t("偏好已保存，待应用。", "Preferences saved; waiting to be applied.") : t("偏好已更新", "Preferences updated"));
    } catch (error) {
      setError(String(error));
    } finally {
      setWorking(false);
    }
  };
  const toggle = (
    key: "keepRunningOnClose" | "showBrowserDuringTurns",
    label: string,
  ) => (
    <Toggle
      label={label}
      value={snapshot.state[key]}
      disabled={busy || (key === "showBrowserDuringTurns" && manual)}
      onChange={(value) => void run(() => api.setPreference(key, value))}
    />
  );
  return (
    <>
      <PageIntro
        title={t("偏好设置", "Preferences")}
        subtitle={t(
          "让聊天和窗口，按你习惯的方式工作。",
          "Make conversations and the window work your way.",
        )}
      />
      <PendingSettings p={p} disabled={working} />
      <Section title={t("聊天行为", "Conversation behavior")} />
      <div className="panel">
        <Row
          title={t("会话复用", "Conversation reuse")}
          description={
            manual
              ? copy.manualFreshConversationUnavailable
              : t(
                  "继续已有聊天可减少重复发送上下文；每轮新建可能更慢。",
                  "Reusing a conversation reduces repeated context. Starting a new one each turn may be slower.",
                )
          }
        >
          <Segment
            label={t("会话复用", "Conversation reuse")}
            value={!settings.experimentalFreshConversationPerTurn}
            disabled={busy || manual || runtimeBusy}
            options={[
              { value: true, label: t("继续已有聊天", "Reuse conversation") },
              { value: false, label: t("每轮新建", "New each turn") },
            ]}
            onChange={(value) =>
              void run(() => api.setFreshConversationPerTurn(!value), true)
            }
          />
        </Row>
        <Row
          title={t("聊天记录", "Chat history")}
          description={t(
            "临时聊天不保留在历史中；保存到历史可能应用 ChatGPT 的记忆和自定义指令。",
            "Temporary chats stay out of history. Saved chats may use ChatGPT memory and custom instructions.",
          )}
        >
          <Segment
            label={t("聊天记录", "Chat history")}
            value={settings.useSavedChats}
            disabled={busy || runtimeBusy}
            options={[
              { value: false, label: t("临时聊天", "Temporary") },
              { value: true, label: t("保存到历史", "Save to history") },
            ]}
            onChange={(value) => void run(() => api.setUseSavedChats(value), true)}
          />
        </Row>
      </div>
      <Section title={t("窗口与启动", "Window & startup")} />
      <div className="panel">
        <Row
          title={t("关闭窗口后在后台运行", "Keep running in the background after closing")}
          description={
            snapshot.profile === "development"
              ? copy.devKeepRunningBody
              : t(
                  "有系统托盘时，关闭窗口后程序继续在后台运行；关闭此选项则退出程序。",
                  "When a system tray is available, closing the window keeps the app running in the background. Turn this off to quit when closing.",
                )
          }
        >
          {toggle(
            "keepRunningOnClose",
            t("关闭窗口后在后台运行", "Keep running in the background after closing"),
          )}
        </Row>
        <Row
          title={t("自动任务开始时显示内置浏览器", "Show the built-in browser when an automatic task starts")}
          description={t(
            "自动任务开始时显示内置 ChatGPT 页面；关闭只取消自动显示，任务仍会执行。手动模式始终显示。",
            "Show the built-in ChatGPT page for automatic tasks. Turning this off only stops automatic display. Manual tasks always show it.",
          )}
        >
          {toggle(
            "showBrowserDuringTurns",
            t("自动任务开始时显示内置浏览器", "Show the built-in browser when an automatic task starts"),
          )}
        </Row>
        <Row
          title={t("开机启动（登录后）", "Start automatically at sign-in")}
          description={
            snapshot.profile === "development"
              ? t(
                  "DEV 环境通过仓库命令启动，此选项不可用。",
                  "DEV starts explicitly from the repository; this option is unavailable.",
                )
              : t(
                  "登录电脑账户后，在后台启动 Web2Harness；执行任务仍需要有效授权。",
                  "Start Web2Harness in the background when you sign in to your computer. Tasks still require a valid license.",
                )
          }
        >
          <Toggle
            label={t("开机启动（登录后）", "Start automatically at sign-in")}
            value={snapshot.state.autoStart}
            disabled={busy || snapshot.profile === "development"}
            onChange={(value) =>
              void run(async () => {
                const result = await api.setAutostart(value);
                if (!result.supported)
                  throw new Error(
                    t(
                      "当前平台不支持开机启动",
                      "Autostart is unavailable on this platform",
                    ),
                  );
                return result.state;
              })
            }
          />
        </Row>
      </div>
      <details>
        <summary>
          {t("实验功能", "Experimental features")} · {t("按需调整", "Optional settings")}
        </summary>
        <Row
          title={copy.contextFiles}
          description={
            manual ? copy.manualContextFilesUnavailable : copy.contextFilesBody
          }
        >
          <Toggle
            label={copy.contextFiles}
            value={settings.experimentalContextFiles}
            disabled={busy || manual || runtimeBusy}
            onChange={(value) => void run(() => api.setContextFiles(value), true)}
          />
        </Row>
        <p className="muted">{t("上下文窗口和标准／三倍预算请在“运行参数”中设置。", "Configure context windows and standard/triple budgets in Runtime parameters.")}</p>
        <Row
          title={copy.skillAttachments}
          description={
            manual
              ? copy.manualSkillAttachmentsUnavailable
              : copy.skillAttachmentsBody
          }
        >
          <Toggle
            label={copy.skillAttachments}
            value={settings.experimentalSkillAttachments}
            disabled={busy || manual || runtimeBusy}
            onChange={(value) => void run(() => api.setSkillAttachments(value), true)}
          />
        </Row>
      </details>
      {message && (
        <Feedback
          key={message.id}
          notice={message}
          dismiss={dismissMessage}
          t={t}
        />
      )}
    </>
  );
}
