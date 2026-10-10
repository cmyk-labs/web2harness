import { Button } from "../../components/Buttons";
import { translate } from "../workspace/labels";
import type { LimitsTracker } from "./useLimits";

export function LocalUsage({ language, tracker, manual }: { language: "en" | "zh-CN"; tracker: LimitsTracker; manual: boolean }) {
  const t = translate(language), usage = tracker.snapshot;
  const labels: Record<string, string> = { "gpt-6-pro": "GPT-6 Pro", "gpt-5.6-pro": "GPT-5.6 Sol Pro", "gpt-6-sol": "GPT-6", "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-5.6-luna": "GPT-5.6 Luna", "pro-unknown": t("Pro（型号未知）", "Pro (unknown model)"), other: t("其他模型", "Other models") };
  const order = ["gpt-5.6-sol", "gpt-5.6-pro", "gpt-6-sol", "gpt-6-pro", "gpt-5.6-luna", "pro-unknown", "other"];
  const models = [...(usage?.models ?? [])].sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model));
  // As in the ledger's shared windows, unknown Pro records belong to the Pro total.
  const pro = models.filter(row => ["gpt-5.6-pro", "gpt-6-pro", "pro-unknown"].includes(row.model));
  const count = (value: number) => usage && !tracker.readError ? new Intl.NumberFormat(language).format(value) : "-";
  const date = usage?.lastRecordedAt == null ? "-" : new Date(usage.lastRecordedAt).toLocaleString(language);
  return <><div className="card local-usage" aria-describedby="local-usage-notes">
    <div className="usage-heading"><h3>{t("本地使用次数", "Local usage")}</h3></div>
    <div className="usage-toolbar local-usage-toolbar">
      <div className="usage-total"><span className="usage-total-label">{t("近 7 天总计", "Last 7 days total")}</span><span className="usage-total-count"><strong className="usage-total-value">{count(usage?.totalMessages ?? 0)}</strong> {t("次", "sends")}</span></div>
      <Button disabled={tracker.reading || tracker.settingUp} onClick={tracker.refresh}>{t("刷新", "Refresh")}</Button>
    </div>
    <div className="usage-table-scroll"><table className="usage-table"><thead><tr><th>{t("模型", "Model")}</th><th>{t("近 24 小时", "Last 24 hours")}</th><th>{t("近 7 天", "Last 7 days")}</th></tr></thead>
      <tbody>{models.map(row => <tr key={row.model}><td>{labels[row.model] ?? row.model}</td><td>{count(row.last24Hours)}</td><td>{count(row.last7Days)}</td></tr>)}</tbody>
      <tfoot><tr className="usage-shared"><td>{t("Pro 合计", "Pro total")}</td><td>{count(pro.reduce((sum, row) => sum + row.last24Hours, 0))}</td><td>{count(pro.reduce((sum, row) => sum + row.last7Days, 0))}</td></tr></tfoot>
    </table></div>
  </div>
    <div className="usage-footnote local-usage-notes" id="local-usage-notes">
      <p>{t("最近记录", "Last recorded")} · {date}</p>
      <p>{t("仅统计本应用 · 仅供参考", "This app only · For reference only")}</p>
      {manual && <p>{t("手动模式 · 自动记录已暂停", "Manual mode · automatic recording paused")}</p>}
      {(usage?.pendingMessages ?? 0) > 0 && <p>{t("接受状态待确认", "Acceptance unconfirmed")} · {usage!.pendingMessages}</p>}
      {(usage?.pendingReceipts ?? 0) > 0 && <p>{t("已接受，等待补记", "Accepted, awaiting ledger write")} · {usage!.pendingReceipts}</p>}
      {(usage?.deliveryErrors ?? 0) > 0 && <p>{t("回执读取异常", "Receipt read error")} · {usage!.deliveryErrors}</p>}
      {usage?.incomplete && <p>{t("记录可能不完整", "Records may be incomplete")}</p>}
    </div>
  </>;
}
