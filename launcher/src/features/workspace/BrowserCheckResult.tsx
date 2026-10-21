import { Button } from "../../components/Buttons";
import type { BrowserCheck, BrowserCheckStatus } from "../../types";
import type { Translate } from "./types";

export function BrowserCheckResult({ check, t, onQueue }: { check?: BrowserCheck; t: Translate; onQueue: () => void }) {
  if (!check || check.status === "not_run") return null;
  const labels: Record<BrowserCheckStatus, [string, string]> = {
    not_run: ["未执行", "Not run"], running: ["检查中", "Checking"], passed: ["通过", "Passed"],
    blocked: ["被阻断", "Blocked"], failed: ["失败", "Failed"], cancelled: ["已取消", "Cancelled"],
  };
  const label = (status: BrowserCheckStatus) => t(...labels[status]);
  return <div className="browser-check-result note" role="status">
    <div>{t("连接与页面", "Connection and page")}: {label(check.connection)}</div>
    <div>{t("发送验证", "Send verification")}: {check.dispatch === "blocked"
      ? t("未完成：队列已暂停，请核对后恢复派发。", "Incomplete: dispatch is paused. Review the queue before resuming.")
      : label(check.dispatch)}</div>
    {check.finishedAt && <div className="muted">{t("检查时间", "Checked at")}: {new Date(check.finishedAt).toLocaleString()}</div>}
    {check.status === "failed" && <div className="status-error">{check.error?.message}</div>}
    {check.error?.cleanupMessage && <div className="status-error">{check.error.cleanupMessage}</div>}
    {check.error?.diagnosticRef && <div className="muted">{t("诊断编号", "Diagnostic reference")}: {check.error.diagnosticRef}</div>}
    {check.status === "blocked" && <Button onClick={onQueue}>{t("查看队列并恢复", "Review queue and resume")}</Button>}
  </div>;
}
