import { useState } from "react";
import { Button } from "../../../components/Buttons";
import { Icon } from "../../../components/icons";
import { copyFor } from "../../../i18n";
import type { DoctorReport } from "../../../types";
import { LocalUsage } from "../../limits/LocalUsage";
import { OfficialLimits } from "../../limits/OfficialLimits";
import type { LimitsTracker } from "../../limits/useLimits";
import { PageIntro, Section } from "../controls";
import { Feedback } from "../Feedback";
import { translate } from "../labels";
import { presentLog } from "../log-presentation";
import { Report } from "../Report";
import { workspaceBusy } from "../status";
import type { WorkspaceProps } from "../types";
import { useFeedback } from "../useFeedback";

export function Diagnostics(p: WorkspaceProps & { tracker: LimitsTracker }) {
  const {
    api,
    snapshot,
    tracker,
    logs,
    setError,
    refresh,
    browser,
    operation,
  } = p;
  const language = snapshot.state.language ?? "en",
    t = translate(language),
    copy = copyFor(language);
  const [tab, setTab] = useState("usage"),
    [report, setReport] = useState<DoctorReport | null>(null),
    [working, setWorking] = useState(false),
    [notice, setNotice, dismissNotice] = useFeedback();
  const busy =
      snapshot.startup.status !== "ready" ||
      working ||
      workspaceBusy(browser, operation),
    manual = snapshot.state.browserInteractionMode === "manual",
    usage = tracker.snapshot;
  const run = async (action: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    setError(null);
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <PageIntro
        title={t("用量与诊断", "Usage & Diagnostics")}
        subtitle={t(
          "了解使用情况，也知道问题出在哪里。",
          "Understand usage and find what needs attention.",
        )}
      />
      <div
        className="tabs"
        role="tablist"
        aria-label={t("诊断视图", "Diagnostic views")}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const current = buttons.findIndex((button) => button.id === `tab-${tab}`);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (current + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next].focus();
          buttons[next].click();
        }}
      >
        {[
          ["usage", t("用量", "Usage")],
          ["health", t("健康检查", "Health checks")],
          ["logs", t("运行日志", "Logs")],
        ].map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            aria-controls="diagnostic-panel"
            id={`tab-${id}`}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="diagnostic-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "usage" && (
          <>
            {tracker.readError && (
              <div className="note warn" role="alert">
                {tracker.readError}
              </div>
            )}
            {(tracker.setupError || usage?.error) && (
              <div className="note warn" role="alert">
                {tracker.setupError || usage?.error}
              </div>
            )}
            <div className="usagegrid">
              <LocalUsage language={language} tracker={tracker} manual={manual} />
              <OfficialLimits language={language} />
            </div>
          </>
        )}
        {tab === "health" && (
          <>
            <div className="flex between wrap" style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 12 }}>
                {t(
                  "检查当前模式所需的配置和服务，技术详情保留原始诊断信息。",
                  "Check the configuration and services required by this mode. Technical details retain the original diagnostics.",
                )}
              </p>
              <Button
                primary
                disabled={busy}
                onClick={() =>
                  void run(async () => setReport(await api.doctor()))
                }
              >
                {copy.runDoctor}
              </Button>
            </div>
            {report ? (
              <Report report={report} language={language} />
            ) : (
              <div className="note">
                {t(
                  "尚未运行健康检查。",
                  "Health checks have not been run yet.",
                )}
              </div>
            )}
          </>
        )}
        {tab === "logs" && (
          <>
            <div className="flex between wrap" style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12 }}>
                {t(
                  "最近的运行事件。导出时使用隐私安全日志。",
                  "Recent runtime events. Exports use privacy-safe diagnostics.",
                )}
              </p>
              <Button
                disabled={working}
                onClick={() =>
                  void run(async () => {
                    const file = await api.exportLogs();
                    if (file)
                      setNotice(t("日志已导出", "Diagnostics exported"));
                  })
                }
              >
                {copy.exportSafeLog}
              </Button>
            </div>
            <div className="activity-table">
              {logs.length ? (
                [...logs].reverse().map((record, i) => {
                  const presentation = presentLog(record, language);
                  const date = new Date(record.at),
                    time = Number.isNaN(date.getTime())
                      ? record.at
                      : date.toLocaleTimeString(language, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        });
                  return (
                    <div className="activity-row" key={`${record.at}-${i}`}>
                      <i
                        className={`activity-dot ${record.level === "error" ? "is-error" : ""}`}
                        aria-label={presentation.status}
                      />
                      <div>
                        <strong>{presentation.title} · {presentation.status}</strong>
                        <details>
                          <summary>{t("技术详情", "Technical details")}</summary>
                          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{presentation.event}{"\n"}{presentation.detail}</pre>
                        </details>
                      </div>
                      <time dateTime={record.at}>{time}</time>
                    </div>
                  );
                })
              ) : (
                <div className="surface-empty">
                  <Icon name="logs" />
                  {copy.noLogs}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {notice && (
        <Feedback
          key={notice.id}
          notice={notice}
          dismiss={dismissNotice}
          t={t}
        />
      )}
    </>
  );
}
