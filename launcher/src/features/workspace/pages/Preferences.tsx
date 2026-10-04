import { useState } from "react";
import { copyFor } from "../../../i18n";
import type { LauncherState } from "../../../types";
import { PageIntro, Row, Section, Segment, Toggle } from "../controls";
import { Feedback } from "../Feedback";
import { translate } from "../labels";
import { workspaceBusy } from "../status";
import type { WorkspaceProps } from "../types";
import { useFeedback } from "../useFeedback";

export function Preferences(p: WorkspaceProps) {
  const { api, snapshot, updateState, setError, refresh, browser, operation } =
    p;
  const t = translate(snapshot.state.language ?? "en"),
    copy = copyFor(snapshot.state.language ?? "en");
  const [working, setWorking] = useState(false),
    [message, setMessage, dismissMessage] = useFeedback();
  const busy =
      snapshot.startup.status !== "ready" ||
      working ||
      workspaceBusy(browser, operation),
    manual = snapshot.state.browserInteractionMode === "manual",
    configured = snapshot.state.coreSetupComplete === true;
  const run = async (action: () => Promise<LauncherState | void>) => {
    if (busy) return;
    setWorking(true);
    setError(null);
    setMessage("");
    try {
      const state = await action();
      if (state) updateState(state);
      await refresh();
      setMessage(t("偏好已更新", "Preferences updated"));
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
            value={!snapshot.state.experimentalFreshConversationPerTurn}
            disabled={busy || manual || !configured}
            options={[
              { value: true, label: t("继续已有聊天", "Reuse conversation") },
              { value: false, label: t("每轮新建", "New each turn") },
            ]}
            onChange={(value) =>
              void run(() => api.setFreshConversationPerTurn(!value))
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
            value={snapshot.state.useSavedChats}
            disabled={busy || !configured}
            options={[
              { value: false, label: t("临时聊天", "Temporary") },
              { value: true, label: t("保存到历史", "Save to history") },
            ]}
            onChange={(value) => void run(() => api.setUseSavedChats(value))}
          />
        </Row>
      </div>
      <Section title={t("窗口与启动", "Window & startup")} />
      <div className="panel">
        <Row
          title={t("关闭窗口后继续运行", "Keep running after closing")}
          description={
            snapshot.profile === "development"
              ? copy.devKeepRunningBody
              : t(
                  "关闭窗口后保留后台服务。",
                  "Keep the background service running when the window closes.",
                )
          }
        >
          {toggle(
            "keepRunningOnClose",
            t("关闭窗口后继续运行", "Keep running after closing"),
          )}
        </Row>
        <Row
          title={t("任务开始时显示浏览器", "Show browser when a task starts")}
          description={t(
            "方便查看浏览器中的当前操作。",
            "Follow the current browser activity.",
          )}
        >
          {toggle(
            "showBrowserDuringTurns",
            t("任务开始时显示浏览器", "Show browser when a task starts"),
          )}
        </Row>
        <Row
          title={t("登录系统时启动", "Launch at sign-in")}
          description={
            snapshot.profile === "development"
              ? t(
                  "DEV 环境通过仓库命令启动，此选项不可用。",
                  "DEV starts explicitly from the repository; this option is unavailable.",
                )
              : t(
                  "启动后保持上次的工具模式。",
                  "Keep the previously selected tool mode.",
                )
          }
        >
          <Toggle
            label={t("登录系统时启动", "Launch at sign-in")}
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
          {t("实验功能", "Experimental features")} · {t("按需启用", "Optional")}
        </summary>
        <Row
          title={copy.contextFiles}
          description={
            manual ? copy.manualContextFilesUnavailable : copy.contextFilesBody
          }
        >
          <Toggle
            label={copy.contextFiles}
            value={snapshot.state.experimentalContextFiles}
            disabled={busy || manual || !configured}
            onChange={(value) => void run(() => api.setContextFiles(value))}
          />
        </Row>
        {snapshot.state.experimentalContextFiles && (
          <div className="context-budget">
            <Row
              title={copy.contextBudget}
              description={copy.contextBudgetBody}
            >
              <Segment
                label={copy.contextBudget}
                value={snapshot.state.experimentalContextTripleBudget}
                disabled={busy || manual || !configured}
                options={[
                  { value: false, label: copy.contextBudgetStandard },
                  { value: true, label: copy.contextBudgetTriple },
                ]}
                onChange={(value) =>
                  void run(() => api.setContextTripleBudget(value))
                }
              />
            </Row>
          </div>
        )}
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
            value={snapshot.state.experimentalSkillAttachments}
            disabled={busy || manual || !configured}
            onChange={(value) => void run(() => api.setSkillAttachments(value))}
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
