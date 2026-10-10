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
import { Logs } from "./Logs";
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
            <div className="usage-layout"><div className="usagegrid">
              <LocalUsage language={language} tracker={tracker} manual={manual} />
              <OfficialLimits language={language} />
            </div></div>
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
        {tab === "logs" && <Logs api={api} language={language} recent={logs} savedPageSize={snapshot.state.logPageSize} updateState={p.updateState} />}
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
