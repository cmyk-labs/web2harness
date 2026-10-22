import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Buttons";
import { useLicense } from "../licensing/LicenseContext";
import type { LauncherApi, QueuePage, QueueQuery, RequestQueueStatus } from "../../types";
import type { Translate, WorkspaceProps } from "./types";
import { openRequestLogs } from "./diagnostic-navigation";
import { Section } from "./controls";
import { translate } from "./labels";
import "./pages/queue.css";

export function useQueueStatus(api: LauncherApi) {
  const [status, setStatus] = useState<RequestQueueStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false, pending = false;
    const read = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { const value = await api.queueStatus(); if (!disposed) { setStatus(value); setError(""); } }
      catch (error) { if (!disposed) setError(String(error)); }
      finally { pending = false; }
    };
    void read(); const timer = setInterval(() => void read(), 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [api]);
  return { status, error };
}
function summary(status: RequestQueueStatus | null, error: string, t: Translate) {
  if (error) return t("状态读取失败", "Unable to read status");
  if (!status) return t("正在读取…", "Loading…");
  if (!status.scheduler) return t("服务未启动", "Service not running");
  const queue = status.scheduler;
  return `${t("执行", "Running")} ${queue.active} / ${queue.settings.maxConcurrent} · ${t("排队", "Queued")} ${queue.waiting}${queue.pausedReason ? ` · ${t("派发已暂停", "Dispatch paused")}` : ""}`;
}
export function QueueOverview({ api, snapshot, navigate }: WorkspaceProps) {
  const { status, error } = useQueueStatus(api);
  const t = translate(snapshot.state.language ?? "en");
  return <div className="panel queue-overview"><div><strong>{t("任务队列", "Task queue")}</strong><div className="muted" role="status">{summary(status, error, t)}</div></div><Button onClick={() => navigate("runtime-controls")}>{t("查看队列", "View queue")}</Button></div>;
}
const labels: Record<string, [string, string]> = {
  queued: ["排队中", "Queued"], preparing: ["准备中", "Preparing"], running: ["执行中", "Running"],
  "waiting-user": ["等待用户", "Waiting for user"], "waiting-tools": ["等待工具", "Waiting for tools"],
  stopping: ["停止中", "Stopping"], succeeded: ["网页完成", "Web completed"], failed: ["失败", "Failed"],
  cancelled: ["已取消", "Cancelled"], "timed-out": ["排队超时", "Queue timeout"],
};
const deliveryLabels: Record<string, [string, string]> = {
  validation_failed: ["原生回复校验失败", "Native reply validation failed"],
  response_written: ["响应已写出", "Response written"],
  write_failed: ["响应写出失败", "Response write failed"],
  delivery_failed: ["原生回复交付失败", "Native reply delivery failed"],
};
const sessionLabel = (id: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;
const sendLabels: Record<string, [string, string]> = {
  preflight: ["发送前检查", "Checking before send"], waiting_permit: ["内容已准备，等待发送许可", "Ready, waiting to send"],
  sending: ["正在尝试发送", "Attempting to send"], awaiting_ack: ["正在确认网页是否接受", "Checking acceptance"],
  reconciling: ["正在核验原请求的发送结果", "Reconciling the original send"],
  unknown: ["发送结果未知", "Send outcome unknown"], "not-sent": ["未发送", "Not sent"],
};
const duration = (value: number | null) => value === null ? "-" : `${Math.floor(value / 60000)}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}`;
const remoteLabels: Record<string, [string, string]> = {
  rate_limit: ["远端限流", "Remote rate limit"], authentication: ["远端认证失败", "Remote authentication failed"],
  permission: ["远端权限不足", "Remote permission denied"], quota: ["远端额度耗尽", "Remote allowance exhausted"],
  unavailable: ["远端服务不可用", "Remote service unavailable"], other: ["远端连接错误", "Remote connection error"],
};
export function McpHistory({ api, t }: { api: LauncherApi; t: Translate }) {
  const { status, error } = useQueueStatus(api);
  const entries = status?.scheduler?.mcpStatus ?? [];
  return <details className="panel queue-mcp-status"><summary>{t("MCP 调用历史", "MCP call history")}</summary>
    {error && <span role="alert">{t("无法读取历史记录", "Unable to read history")}</span>}
    {!entries.length && <span>{t("MCP 远端尚无调用验证记录", "No MCP remote call verification recorded")}</span>}
    {entries.map(entry => <div key={entry.scope}>
      <strong>{entry.connectorName}</strong>
      <span>{t("最近远端接收验证", "Last verified remote receipt")}: {entry.lastVerifiedAt ? new Date(entry.lastVerifiedAt).toLocaleString() : t("尚未验证", "Not verified")}</span>
      {entry.lastFailure && <span>{(entry.lastVerifiedAt ?? 0) > (entry.lastFailureAt ?? 0) ? t("历史失败（之后已验证接收）", "Past failure (receipt verified since)") : t("最近失败", "Last failure")}: {t(...remoteLabels[entry.lastFailure.kind])} · HTTP {entry.lastFailure.status} · {new Date(entry.lastFailureAt!).toLocaleString()}</span>}
      {(entry.cooldownUntil ?? 0) > Date.now() && <span>{t("该隧道冷却中，剩余", "Tunnel cooling down, remaining")} {Math.ceil((entry.cooldownUntil! - Date.now()) / 1000)}s</span>}
    </div>)}
    <span className="muted">{t("接收验证仅证明远端已收到调用，不代表工具执行完成。", "A verified receipt confirms delivery, not completed tool execution.")}</span>
  </details>;
}
function McpStatus({ status, t, onDetails }: { status: RequestQueueStatus | null; t: Translate; onDetails: () => void }) {
  const entry = status?.currentMcpScope && status.scheduler?.mcpStatus?.find(item => item.scope === status.currentMcpScope);
  if (!entry) return null;
  const cooling = (entry.cooldownUntil ?? 0) > Date.now();
  const failed = entry.lastFailure && (entry.lastFailureAt ?? 0) > (entry.lastVerifiedAt ?? 0);
  if (!cooling && !failed) return null;
  return <div className="queue-feedback queue-mcp-status" role="status">
    <span>{entry.connectorName} · {cooling ? `${t("冷却等待", "Cooldown")} ${Math.ceil((entry.cooldownUntil! - Date.now()) / 1000)}s` : t(...remoteLabels[entry.lastFailure!.kind])}</span>
    <Button onClick={onDetails}>{t("查看诊断", "View diagnostics")}</Button>
  </div>;
}

export function RequestQueue({ api, snapshot, navigate }: WorkspaceProps) {
  const t = translate(snapshot.state.language ?? "en");
  const { active: licensed } = useLicense();
  const { status, error } = useQueueStatus(api);
  const [query, setQuery] = useState<QueueQuery>({ state: "active", limit: 50, offset: 0 });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<(QueuePage & { snapshotId: string }) | null>(null);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [working, setWorking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [confirmWaiting, setConfirmWaiting] = useState(false);
  const snapshotId = useRef<string | undefined>(undefined);
  const available = status?.status === "ready";
  const [confirmRecovery, setConfirmRecovery] = useState<string | null>(null);
  const needsRecovery = status?.scheduler?.pauseReasons.some(reason => reason !== "user");
  useEffect(() => {
    let disposed = false, pending = false;
    const read = async () => {
      if (!available || pending || document.hidden) return;
      pending = true;
      try {
        const value = await api.queryQueue({ ...query, ...((query.offset ?? 0) > 0 && snapshotId.current ? { snapshotId: snapshotId.current } : {}) });
        if (!disposed) {
          // The first page is live; later pages keep a stable membership snapshot.
          if (!query.offset && query.groupId && !value.groups.includes(query.groupId)) {
            snapshotId.current = undefined;
            setQuery(current => ({ ...current, groupId: undefined, offset: 0 }));
            return;
          }
          snapshotId.current = value.snapshotId; setPage(value); setLoadError("");
        }
      } catch (error) { if (!disposed) setLoadError(String(error)); }
      finally { pending = false; }
    };
    void read(); const timer = setInterval(() => void read(), 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [api, available, query, refresh]);
  function changeQuery(patch: QueueQuery, fresh = true) {
    if (fresh) { snapshotId.current = undefined; setPage(null); }
    setQuery(current => ({ ...current, ...patch, ...("state" in patch || "search" in patch ? { groupId: undefined } : {}), ...(fresh ? { offset: 0 } : {}) }));
  }
  async function control(action: "pause" | "resume" | "recover" | "cancel" | "cancel-waiting", id?: string) {
    if (working || !available || (["resume", "recover"].includes(action) && !licensed)) return;
    const recoveryToken = confirmRecovery ?? undefined;
    setWorking(true); setNotice(""); setConfirmWaiting(false); setConfirmRecovery(null);
    try { await api.controlQueue(action, id, recoveryToken); setNotice(t("操作已受理", "Action accepted")); setRefresh(value => value + 1); }
    catch (error) { setNotice(String(error)); }
    finally { setWorking(false); }
  }
  return <>
    <Section title={t("任务队列", "Task queue")} />
    <div className="panel request-queue">
      <div className="queue-toolbar"><span role="status">{summary(status, error, t)}</span><div className="queue-actions">
        <Button disabled={!available || working || (!licensed && status?.scheduler?.pauseReasons.includes("user"))} onClick={() => void control(status?.scheduler?.pauseReasons.includes("user") ? "resume" : "pause")}>{status?.scheduler?.pauseReasons.includes("user") ? t("恢复派发", "Resume dispatch") : t("暂停派发", "Pause dispatch")}</Button>
        <Button disabled={!available || working || !status?.scheduler?.waiting} onClick={() => setConfirmWaiting(true)}>{t("取消全部等待", "Cancel waiting")}</Button>
        <Button onClick={() => navigate("runtime-parameters")}>{t("运行参数", "Runtime parameters")}</Button>
      </div></div>
      <McpStatus status={status} t={t} onDetails={() => navigate("diagnostics")} />
      {needsRecovery && <div className="queue-feedback" role="alert">{status?.scheduler?.pausedReason === "send_outcome_unknown"
        ? t("发送结果未知，队列已暂停。请先核对阻断任务。", "Send outcome unknown. Dispatch is paused; inspect the blocking task first.")
        : `${t("异常暂停", "Dispatch suspended")}: ${status?.scheduler?.pausedReason}`}
        {status?.scheduler?.pauseSources?.map(source => <div key={source.reason}>
          <span>{source.reason}{source.at !== undefined ? ` · ${new Date(source.at).toLocaleString()}` : ""}
            {source.sendProgress && sendLabels[source.sendProgress] ? ` · ${t(...sendLabels[source.sendProgress])}` : ""}</span>
          <Button onClick={() => { openRequestLogs(source.requestId); navigate("diagnostics"); }}>{t("阻断任务日志", "Blocking task logs")} · {source.requestId.slice(0, 12)}</Button>
        </div>)}
        <Button disabled={!licensed || working || !!status?.scheduler?.active || !status?.scheduler?.recoveryToken} onClick={() => setConfirmRecovery(status?.scheduler?.recoveryToken ?? null)}>{t("确认恢复", "Confirm recovery")}</Button></div>}
      {confirmRecovery && <div className="queue-feedback queue-actions"><span>{t("请确认账号限流已解除、网页已停止。恢复不重发旧请求；手动暂停需另行恢复。", "Confirm the account is available and browser work has stopped. Old requests are never resent; a manual pause must be resumed separately.")}</span><Button disabled={working || confirmRecovery !== status?.scheduler?.recoveryToken} onClick={() => void control("recover")}>{t("恢复派发", "Resume dispatch")}</Button><Button onClick={() => setConfirmRecovery(null)}>{t("返回", "Back")}</Button>
        {confirmRecovery !== status?.scheduler?.recoveryToken && <span role="alert">{t("暂停状态已变化，请返回重新核对。", "Pause state changed. Go back and review it again.")}</span>}</div>}
      <form className="queue-filters" onSubmit={event => { event.preventDefault(); changeQuery({ search }); }}>
        <label>{t("状态", "State")}<select aria-label={t("状态", "State")} value={query.state} onChange={event => changeQuery({ state: event.target.value as QueueQuery["state"] })}>{[["active", t("活动任务", "Active")], ["queued", t("排队中", "Queued")], ["running", t("执行中", "Running")], ["ended", t("已结束", "Finished")], ["failed", t("失败", "Failed")], ["cancelled", t("已取消", "Cancelled")], ["timed-out", t("超时", "Timed out")]].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label>{t("会话", "Session")}<select aria-label={t("会话", "Session")} disabled={!available || !page?.groups.length} value={page?.groups.includes(query.groupId ?? "") ? query.groupId : ""} onChange={event => changeQuery({ groupId: event.target.value || undefined })}><option value="">{t("全部", "All")}</option>{page?.groups.map(group => <option key={group} value={group} title={group}>{sessionLabel(group)}</option>)}</select></label>
        <label>{t("搜索", "Search")}<input value={search} onChange={event => setSearch(event.target.value)} maxLength={256} placeholder={t("任务、会话或模型", "Task, session or model")} /></label>
        <Button type="submit">{t("查询", "Search")}</Button><Button type="button" onClick={() => { snapshotId.current = undefined; changeQuery({ search }); setRefresh(value => value + 1); }}>{t("刷新", "Refresh")}</Button>
      </form>
      <div className="queue-feedback" role="status">{confirmWaiting ? <div className="queue-actions"><span>{t("取消全部排队任务？正在执行的任务不受影响。", "Cancel all waiting tasks? Running tasks will continue.")}</span><Button onClick={() => void control("cancel-waiting")}>{t("确认取消", "Confirm")}</Button><Button onClick={() => setConfirmWaiting(false)}>{t("返回", "Back")}</Button></div> : error || loadError || notice}</div>
      <div className="queue-table-scroll"><table className="queue-table"><thead><tr>{[t("状态", "State"), t("会话／任务", "Session / task"), t("模型", "Model"), t("等待时长", "Wait"), t("执行时长", "Run"), t("操作", "Action")].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {available && !loadError && page?.items.map(item => <tr key={item.id}><td>{t(...labels[item.state])}
          {item.state === "succeeded" && item.mode === "native-tools" && <small title={t("写出仅表示响应回调已返回，不代表 Codex 已接收或执行工具。", "Written means the response callback returned; it does not confirm Codex receipt or tool execution.")}>
            {item.nativeDelivery && deliveryLabels[item.nativeDelivery.deliveryState]
              ? t(...deliveryLabels[item.nativeDelivery.deliveryState]) : t("交付未确认", "Delivery unconfirmed")}
          </small>}
          {(item.state === "preparing" || item.sendProgress === "unknown" || item.sendProgress === "not-sent") && item.sendProgress && sendLabels[item.sendProgress]
            && <small>{t(...sendLabels[item.sendProgress])}</small>}
          {item.sendFailureScope === "task" && <small title={t("发送结果仍未知；只隔离当前任务，页面清理完成前仍占用名额。不会自动重发。", "The send outcome remains unknown. Only this task is isolated; its slot remains occupied until page cleanup completes. No automatic resend.")}>
            {t("当前任务隔离", "Task isolated")}
          </small>}
          {item.state === "failed" && item.sendAttemptedAt === undefined && (item.reason === "send_outcome_unknown" || item.reason?.startsWith("queue_blocked_"))
            && <small>{t("未发送：队列已暂停", "Not sent: dispatch paused")}</small>}
          {item.retryAttempt !== undefined && <small className="muted">{t("恢复尝试", "Recovery attempt")} {item.retryAttempt}</small>}{(item.cooldownUntil ?? 0) > Date.now() && <small>{t("冷却等待", "Cooldown")} {Math.ceil((item.cooldownUntil! - Date.now()) / 1000)}s</small>}</td><td title={item.groupId}>{sessionLabel(item.groupId)}<small className="muted" title={item.id}>{item.id.slice(0, 12)}{item.reason ? ` · ${item.reason}` : ""}</small></td><td>{item.model}<small className="muted">{item.effort || "-"}</small></td><td>{duration(item.waitMs)}</td><td>{duration(item.runMs)}</td><td><Button onClick={() => { openRequestLogs(item.id); navigate("diagnostics"); }}>{t("日志", "Logs")}</Button>{["queued", "preparing", "running", "waiting-user", "waiting-tools"].includes(item.state) ? <Button disabled={working} onClick={() => void control("cancel", item.id)}>{item.state === "queued" ? t("取消", "Cancel") : t("停止", "Stop")}</Button> : "-"}</td></tr>)}
        {(!available || !page || loadError || page.items.length === 0) && <tr><td colSpan={6}>{error || loadError ? t("无法读取任务，请刷新重试。", "Unable to read tasks. Refresh to retry.") : !available ? summary(status, error, t) : !page ? t("正在读取…", "Loading…") : query.search || query.groupId ? t("没有符合筛选条件的任务", "No tasks match these filters") : t("暂无任务", "No tasks")}</td></tr>}
      </tbody></table></div>
      <div className="queue-pagination"><label>{t("每页", "Per page")} <select aria-label={t("每页", "Per page")} value={query.limit} onChange={event => changeQuery({ limit: Number(event.target.value) as 25 | 50 | 100 })}>{[25, 50, 100].map(value => <option key={value}>{value}</option>)}</select></label><span>{page ? `${page.offset + (page.items.length ? 1 : 0)}–${page.offset + page.items.length} / ${page.total}` : "-"}</span><Button disabled={!page || page.offset === 0} onClick={() => changeQuery({ offset: Math.max(0, (query.offset ?? 0) - (query.limit ?? 50)) }, false)}>{t("上一页", "Previous")}</Button><Button disabled={!page || page.offset + page.limit >= page.total} onClick={() => changeQuery({ offset: (query.offset ?? 0) + (query.limit ?? 50) }, false)}>{t("下一页", "Next")}</Button></div>
    </div>
  </>;
}
