import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Buttons";
import { useLicense } from "../../licensing/LicenseContext";
import type { LauncherState, RequestSchedulingSettings, RequestQueueStatus } from "../../../types";
import type { RuntimeParameters as ExecutionParameters } from "../../../../shared/runtime-parameters.cjs";
import parameterOptions from "../../../../shared/runtime-parameter-options.json";
import { PageIntro, Row, Section } from "../controls";
import { translate } from "../labels";
import type { WorkspaceProps } from "../types";
import "./queue.css";
import { usePageNavigationGuard } from "../../shell/PageNavigationGuard";

type Draft = RequestSchedulingSettings & { runtimeParameters: ExecutionParameters };
const defaults: Draft = { maxConcurrent: 4, queueTimeoutMinutes: 15, minSendIntervalSeconds: 3, runtimeParameters: parameterOptions.defaults };
function stateDraft(state: LauncherState): Draft {
  return { ...(state.requestScheduling ?? defaults), runtimeParameters: state.runtimeParameters ?? parameterOptions.defaults };
}
function validParameters(value: ExecutionParameters) {
  return Object.entries(parameterOptions.choices).every(([key, choices]) => choices.includes(value[key as keyof ExecutionParameters]));
}
const draftKey = "web2harness.runtimeParametersDraft.v1";
function loadDraft(settings: Draft, revision: number) {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    if (saved && Number.isSafeInteger(saved.revision) && saved.baseline && saved.draft
      && [saved.baseline, saved.draft].every(item => [1, 2, 3, 4, 5].includes(item.maxConcurrent)
        && [5, 10, 15, 30, 60].includes(item.queueTimeoutMinutes)
        && (item.minSendIntervalSeconds === null || typeof item.minSendIntervalSeconds === "number")
        && validParameters(item.runtimeParameters ?? parameterOptions.defaults))) {
      return { ...saved,
        baseline: { ...saved.baseline, runtimeParameters: saved.baseline.runtimeParameters ?? settings.runtimeParameters },
        draft: { ...saved.draft, runtimeParameters: saved.draft.runtimeParameters ?? settings.runtimeParameters, minSendIntervalSeconds: saved.draft.minSendIntervalSeconds ?? NaN } } as {
        baseline: Draft; draft: Draft; revision: number;
      };
    }
  } catch { /* Storage may be unavailable; in-memory navigation protection still applies. */ }
  return { baseline: settings, draft: settings, revision };
}
export function RuntimeParameters({ api, snapshot, updateState }: WorkspaceProps) {
  const t = translate(snapshot.state.language ?? "en");
  const { active: licensed } = useLicense();
  const [initial] = useState(() => loadDraft(stateDraft(snapshot.state), snapshot.state.requestSchedulingRevision));
  const [draft, setDraft] = useState(initial.draft);
  const [baseline, setBaseline] = useState({ settings: initial.baseline, revision: initial.revision });
  const [status, setStatus] = useState<RequestQueueStatus | null>(null);
  const [feedback, setFeedback] = useState<string | { zh: string; en: string }>("");
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    let disposed = false;
    api.queueStatus().then(value => { if (!disposed) setStatus(value); }).catch(error => {
      if (!disposed) { setFeedback(String(error)); setFailed(true); }
    });
    return () => { disposed = true; };
  }, [api]);
  const changed = JSON.stringify(draft) !== JSON.stringify(baseline.settings);
  useEffect(() => {
    try {
      if (changed) localStorage.setItem(draftKey, JSON.stringify({ draft, baseline: baseline.settings, revision: baseline.revision }));
      else localStorage.removeItem(draftKey);
    } catch { /* Do not block editing when storage is unavailable. */ }
  }, [draft, baseline, changed]);
  useEffect(() => {
    if (!changed && !working && baseline.revision !== snapshot.state.requestSchedulingRevision) {
      setDraft(stateDraft(snapshot.state));
      setBaseline({ settings: stateDraft(snapshot.state), revision: snapshot.state.requestSchedulingRevision });
    }
  }, [changed, working, baseline.revision, snapshot.state]);
  const valid = Number.isInteger(draft.minSendIntervalSeconds) && draft.minSendIntervalSeconds >= 1 && draft.minSendIntervalSeconds <= 60 && validParameters(draft.runtimeParameters);
  async function save() {
    if (!licensed || saving.current || !changed || !valid) return false;
    saving.current = true;
    setWorking(true); setFeedback(""); setFailed(false);
    try {
      const { runtimeParameters, ...scheduling } = draft;
      const result = await api.saveQueueSettings(scheduling, baseline.revision, runtimeParameters);
      updateState(result.state);
      setBaseline({ settings: stateDraft(result.state), revision: result.persistedRevision });
      setDraft(stateDraft(result.state));
      setFailed(result.applyState === "apply-failed");
      setFeedback(result.applyState === "applied" ? { zh: "已保存并生效", en: "Saved and applied" }
        : result.applyState === "pending-start" ? { zh: "已保存，服务启动后生效", en: "Saved; applies when the service starts" }
        : { zh: "设置已保存，但运行时应用未完成。请检查运行状态，重启服务后生效。", en: "Settings saved, but runtime application did not complete. Check runtime status; settings apply after the service restarts." });
      // Show a failed-apply result on this page before allowing another navigation.
      return result.applyState !== "apply-failed";
    } catch (error) { setFeedback(String(error)); setFailed(true); return false; }
    finally { saving.current = false; setWorking(false); }
  }
  usePageNavigationGuard({ dirty: changed, canSave: licensed && valid && changed, busy: working, save,
    discard: () => {
      setDraft(stateDraft(snapshot.state));
      setBaseline({ settings: stateDraft(snapshot.state), revision: snapshot.state.requestSchedulingRevision });
      try { localStorage.removeItem(draftKey); } catch { /* best effort */ }
    } });
  const parameter = (key: keyof ExecutionParameters, title: string, description: string, unit: string) => (
    <Row key={key} title={title} description={description}>
      <select aria-label={title} disabled={!licensed || working} value={draft.runtimeParameters[key]}
        onChange={event => setDraft({ ...draft, runtimeParameters: { ...draft.runtimeParameters, [key]: Number(event.target.value) } })}>
        {parameterOptions.choices[key].map(value => <option key={value} value={value}>{key === "maxRetries" && value === 0 ? t("不重试", "No retries") : `${value} ${unit}`}</option>)}
      </select>
    </Row>
  );
  return <>
    <PageIntro title={t("运行参数", "Runtime parameters")} subtitle={t("设置所有会话共享的运行参数。", "Configure runtime parameters shared by all sessions.")} />
    <Section title={t("请求调度", "Request scheduling")} />
    <form className="panel queue-settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Row title={t("Web 同时执行数", "Concurrent Web turns")} description={t("所有会话共享，超出后排队。", "Shared by all sessions. Additional requests wait in the queue.")}>
        <select aria-label={t("Web 同时执行数", "Concurrent Web turns")} disabled={!licensed || working} value={draft.maxConcurrent} onChange={event => setDraft({ ...draft, maxConcurrent: Number(event.target.value) })}>
          {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Row>
      <Row title={t("排队超时", "Queue timeout")} description={t("超过期限仍未开始的请求将结束。", "Requests expire if they have not started by this deadline.")}>
        <select aria-label={t("排队超时", "Queue timeout")} disabled={!licensed || working} value={draft.queueTimeoutMinutes} onChange={event => setDraft({ ...draft, queueTimeoutMinutes: Number(event.target.value) })}>
          {[5, 10, 15, 30, 60].map(value => <option key={value} value={value}>{value} {t("分钟", "minutes")}</option>)}
        </select>
      </Row>
      <Row title={t("最小发送间隔", "Minimum send interval")} description={t("自动发送的最短间隔；手动点击不受此项限制。", "Minimum interval between automatic sends; manual clicks are not controlled.")}>
        <div className="queue-number"><input type="number" min={1} max={60} step={1} aria-label={t("最小发送间隔", "Minimum send interval")} disabled={!licensed || working} value={Number.isNaN(draft.minSendIntervalSeconds) ? "" : draft.minSendIntervalSeconds} onChange={event => setDraft({ ...draft, minSendIntervalSeconds: event.target.valueAsNumber })} /><span>{t("秒", "seconds")}</span></div>
      </Row>
      <Section title={t("标签页自动回收", "Automatic tab cleanup")} />
      {parameter("retainedTabTarget", t("标签页保留数量", "Tab retention target"), t("达到目标后，新任务优先回收旧的空闲标签；执行中或等待工具结果的页面受保护，实际数量可能超过目标。", "New tasks reclaim older idle tabs at this target. Running tabs and tabs awaiting tool results are protected, so the actual count may be higher."), t("个", "tabs"))}
      {parameter("idleTabMinutes", t("空闲标签保留时间", "Idle tab retention"), t("已完成且没有等待工具结果的标签，按最后任务活动计时；仅查看页面不会延长保留时间。", "Applies to completed tabs without pending tool results, measured from task activity. Viewing a tab does not extend its retention."), t("分钟", "minutes"))}
      <Section title={t("执行等待", "Execution waiting")} />
      {parameter("stallMinutes", t("网页无进展超时", "Web inactivity timeout"), t("持续没有收到运行进展时结束等待；不是整个任务的时长上限。", "Ends the wait when no runtime progress arrives. This does not limit total task duration."), t("分钟", "minutes"))}
      {snapshot.state.browserInteractionMode !== "manual" && parameter("attachmentMinutes", t("附件上传与处理等待时间", "Attachment processing timeout"), t("等待本轮附件上传并处理完成；明确失败时立即停止发送。", "Waits for this round's attachments to upload and finish processing. A confirmed failure stops submission immediately."), t("分钟", "minutes"))}
      <details className="runtime-advanced"><summary>{t("高级设置", "Advanced settings")}</summary>
        {parameter("maxRetries", t("失败重试次数", "Failure retry limit"), t("首次尝试之外的重试上限，仅适用于明确允许重试的网页失败。", "Maximum retries after the first attempt, only for explicitly retryable Web failures."), t("次", "retries"))}
      </details>
      {snapshot.state.browserInteractionMode === "manual" && <>
        <Section title={t("手动提交等待", "Manual submission waiting")} />
        {parameter("manualSubmitSeconds", t("普通请求提交等待", "Manual request submission timeout"), t("等待粘贴、发送并确认已提交。", "Waits for you to paste, send and confirm submission."), t("秒", "seconds"))}
        {parameter("manualCompactionSubmitSeconds", t("压缩请求提交等待", "Manual compaction submission timeout"), t("压缩请求需要人工提交时的等待时间。", "Time allowed to manually submit a compaction request."), t("秒", "seconds"))}
      </>}
      <div className="queue-settings-footer">
        <p className="muted">{t("修改不打断已有任务。执行等待用于新请求，保留时间用于下一次进入空闲的标签；排队超时仅用于新入队请求。", "Changes do not interrupt running tasks. Execution waits apply to new requests, retention to newly idle tabs, and queue timeout to newly queued requests.")}</p>
        <div className="queue-actions"><Button type="submit" disabled={!licensed || working || !changed || !valid}>{working ? t("保存中…", "Saving…") : t("保存设置", "Save settings")}</Button>
          <Button type="button" disabled={!licensed || working} onClick={() => { setDraft({ ...defaults }); setFeedback({ zh: "已恢复默认值，保存后生效", en: "Defaults restored; save to apply" }); setFailed(false); }}>{t("恢复默认值", "Restore defaults")}</Button></div>
        <div className={`queue-feedback${failed ? " error" : ""}`} role={failed ? "alert" : "status"}>{(typeof feedback === "string" ? feedback : t(feedback.zh, feedback.en)) || (status?.status === "stopped" ? t("服务未启动", "Service not running") : "\u00a0")}</div>
      </div>
    </form>
  </>;
}
