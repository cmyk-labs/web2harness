import { useState } from "react";
import { Button } from "../../../components/Buttons";
import { Icon } from "../../../components/icons";
import { copyFor } from "../../../i18n";
import type { DoctorReport } from "../../../types";
import type { LimitsTracker } from "../../limits/useLimits";
import { PageIntro, Row, Section } from "../controls";
import { Feedback } from "../Feedback";
import { translate } from "../labels";
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
              <div className="card">
                <div className="flex between">
                  <h3>{t("本地记录的消息", "Locally observed messages")}</h3>
                  <span className="badge">
                    {t("滚动 7 天", "ROLLING 7 DAYS")}
                  </span>
                </div>
                <div className="metric">
                  {usage && usage.trackingSince !== null
                    ? new Intl.NumberFormat(language).format(
                        usage.totalMessages,
                      )
                    : "—"}{" "}
                  <span
                    className="muted"
                    style={{ fontSize: 12, letterSpacing: 0 }}
                  >
                    {t("条消息", "messages")}
                  </span>
                </div>
                <p>
                  {t(
                    "仅统计本应用观察到的发送记录，不代表账户全部使用量。",
                    "Only sends observed by this application, not your account-wide usage.",
                  )}
                </p>
                <div className="note">
                  {manual
                    ? t(
                        "手动交互不读取浏览器用量。已有本地历史可保留。",
                        "Manual interaction does not inspect browser usage. Existing local history is retained.",
                      )
                    : usage?.enabled
                      ? t(
                          "本地用量记录已开启。",
                          "Local usage tracking is enabled.",
                        )
                      : t(
                          "用量记录尚未开启，检查账户后可确定是否支持。",
                          "Usage tracking is not enabled. Check your account to determine support.",
                        )}
                  {usage?.incomplete && (
                    <p>
                      {t(
                        "记录不完整，可能遗漏其他会话。",
                        "Records are incomplete and may omit other sessions.",
                      )}
                    </p>
                  )}
                </div>
                <div className="actions">
                  <Button
                    disabled={busy || manual || tracker.settingUp || !usage}
                    onClick={() =>
                      void run(async () => {
                        await tracker.setup();
                      })
                    }
                  >
                    {tracker.settingUp
                      ? t("检查中", "Checking")
                      : t("检查用量记录", "Check usage tracking")}
                  </Button>
                  <Button
                    disabled={tracker.reading || tracker.settingUp}
                    onClick={tracker.refresh}
                  >
                    {t("刷新", "Refresh")}
                  </Button>
                </div>
              </div>
              <div className="card">
                <h3>{t("官方剩余额度", "Official remaining quota")}</h3>
                <div className="metric">{t("未知", "Unknown")}</div>
                <p>
                  {t(
                    "当前没有可确认的官方剩余额度。",
                    "No confirmed official remaining quota is available.",
                  )}
                </p>
                <div className="note">
                  {t(
                    "本地消息数不等于账户配额，也不能据此计算还剩多少次。",
                    "Local message counts are not your account quota and cannot determine remaining usage.",
                  )}
                </div>
              </div>
            </div>
            <Section
              title={t("按统计窗口查看", "Observed usage windows")}
              meta={
                <span className="muted" style={{ fontSize: 11 }}>
                  {t("本地记录", "LOCAL RECORDS")}
                </span>
              }
            />
            <div className="panel">
              {usage?.windows.length ? (
                usage.windows.map((window) => (
                  <Row
                    key={window.id}
                    title={window.label}
                    description={`${window.model} · ${t("仅当前统计窗口；共享窗口不可与模型窗口相加", "Current window only; shared and model windows overlap")}`}
                  >
                    <strong>{window.used}</strong>
                  </Row>
                ))
              ) : (
                <div className="row">
                  <p>
                    {t("暂无可用统计窗口。", "No usage windows are available.")}
                  </p>
                </div>
              )}
              {!!usage?.unknownProMessages && (
                <div className="row">
                  <p>
                    {t(
                      "无法归属具体模型的 Pro 消息",
                      "Pro messages without an attributed model",
                    )}
                  </p>
                  <strong>{usage.unknownProMessages}</strong>
                </div>
              )}
            </div>
          </>
        )}
        {tab === "health" && (
          <>
            <div className="flex between wrap" style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 12 }}>
                {t(
                  "检查当前环境，完整保留未通过的检查项。",
                  "Check the current environment and retain every failed check.",
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
                  const event = record.event
                    .split(".")
                    .map((part) => part.replaceAll("_", " "))
                    .join(" · ");
                  const detail = Object.entries(record.detail ?? {})
                    .filter(
                      ([, value]) => value !== undefined && value !== null,
                    )
                    .slice(0, 3)
                    .map(
                      ([key, value]) =>
                        `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
                    )
                    .join(" · ");
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
                        aria-label={record.level}
                      />
                      <div>
                        <strong title={event}>{event}</strong>
                        <span title={detail}>{detail}</span>
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
