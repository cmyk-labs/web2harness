import { useState } from "react";
import { Button } from "../../../components/Buttons";
import { Icon } from "../../../components/icons";
import { copyFor } from "../../../i18n";
import type { DoctorReport } from "../../../types";
import { OfficialLimits } from "../../limits/OfficialLimits";
import type { LimitsTracker } from "../../limits/useLimits";
import { PageIntro, Section } from "../controls";
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
                  <h3>{t("本地对话轮次", "Local conversation turns")}</h3>
                  <span className="badge">
                    {t("滚动 7 天 · 辅助统计", "ROLLING 7 DAYS · LOCAL")}
                  </span>
                </div>
                <div className="metric">
                  {usage && !tracker.readError && usage.models.length > 0
                    ? new Intl.NumberFormat(language).format(
                        usage.totalMessages,
                      )
                    : "—"}{" "}
                  <span
                    className="muted"
                    style={{ fontSize: 12, letterSpacing: 0 }}
                  >
                    {t("轮", "turns")}
                  </span>
                </div>
                <p>
                  {t(
                    "每次网页实际接受发送计 1 轮，含工具结果续发和压缩。仅统计本应用记录。",
                    "Each accepted Web send counts as one turn, including tool-result follow-ups and compaction. Only this application’s sends are counted.",
                  )}
                </p>
                <div className="note">
                  {manual
                    ? t(
                        "手动交互不读取浏览器用量。已有本地历史可保留。",
                        "Manual interaction does not inspect browser usage. Existing local history is retained.",
                      )
                    : t(
                        "默认自动记录，无需开启。首次发送后自动识别账户。",
                        "Always on automatically. The account is identified on the first send.",
                      )}
                  {usage?.incomplete && (
                    <p>
                      {t(
                        "最近 7 天存在漏记或无法归属模型的记录。重新检查账户不能补回遗漏。",
                        "The last seven days include missed sends or unidentified models. An account check cannot recover missing records.",
                      )}
                    </p>
                  )}
                </div>
                <div className="actions">
                  <Button
                    disabled={tracker.reading || tracker.settingUp}
                    onClick={tracker.refresh}
                  >
                    {t("刷新本地统计", "Refresh local counts")}
                  </Button>
                </div>
                <Section
                  title={t("按模型统计 · 本地滚动窗口", "Turns by model · local rolling windows")}
                  meta={
                    <span className="muted" style={{ fontSize: 11 }}>
                      {t("本地记录", "LOCAL RECORDS")}
                    </span>
                  }
                />
                <div className="panel usage-table-scroll">
                  <table className="usage-table">
                    <thead><tr>
                      <th>{t("模型", "Model")}</th>
                      <th>{t("最近 24 小时", "Last 24 hours")}</th>
                      <th>{t("最近 7 天", "Last 7 days")}</th>
                    </tr></thead>
                    <tbody>{usage?.models.map(item => <tr key={item.model}>
                      <td>{({
                        "gpt-6-pro": "GPT-6 Pro", "gpt-5.6-pro": "GPT-5.6 Sol Pro",
                        "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-5.6-luna": "GPT-5.6 Luna",
                        "pro-unknown": t("Pro · 型号未识别", "Pro · unidentified model"),
                        other: t("型号未识别／旧版其他模型", "Unidentified / legacy other models"),
                      } as Record<string, string>)[item.model] ?? item.model}</td>
                      <td>{item.last24Hours}</td><td>{item.last7Days}</td>
                    </tr>)}</tbody>
                  </table>
                  {!usage?.models.length && <p className="note">{t("暂无可用的本地统计。", "Local counts are unavailable.")}</p>}
                </div>
                <p className="muted">{t("仅作辅助统计，不代表官方额度周期。各模型合并思考强度；显示最近一次识别账户的记录。滚动窗口重叠，不能相加。", "Auxiliary counts, not official quota periods. Thinking levels are grouped by model family. Counts belong to the last identified account. Rolling windows overlap and cannot be added together.")}</p>
                {usage?.trackingSince != null && <p className="muted">
                  {t("此账户记录起始", "Account tracking since")} · {new Date(usage.trackingSince).toLocaleString(language)}
                </p>}
              </div>
              <OfficialLimits language={language} api={api} plan={usage?.plan ?? null} />
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
