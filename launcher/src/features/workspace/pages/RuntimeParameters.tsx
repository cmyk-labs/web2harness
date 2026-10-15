import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Buttons";
import { useLicense } from "../../licensing/LicenseContext";
import type { RequestSchedulingSettings, RequestQueueStatus } from "../../../types";
import { PageIntro, Row, Section } from "../controls";
import { translate } from "../labels";
import type { WorkspaceProps } from "../types";
import "./queue.css";
import { usePageNavigationGuard } from "../../shell/PageNavigationGuard";

const defaults: RequestSchedulingSettings = { maxConcurrent: 4, queueTimeoutMinutes: 15, minSendIntervalSeconds: 3 };
const draftKey = "web2harness.runtimeParametersDraft.v1";
function loadDraft(settings: RequestSchedulingSettings, revision: number) {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    if (saved && Number.isSafeInteger(saved.revision) && saved.baseline && saved.draft
      && [saved.baseline, saved.draft].every(item => [1, 2, 3, 4, 5].includes(item.maxConcurrent)
        && [5, 10, 15, 30, 60].includes(item.queueTimeoutMinutes)
        && (item.minSendIntervalSeconds === null || typeof item.minSendIntervalSeconds === "number"))) {
      return { ...saved, draft: { ...saved.draft, minSendIntervalSeconds: saved.draft.minSendIntervalSeconds ?? NaN } } as {
        baseline: RequestSchedulingSettings; draft: RequestSchedulingSettings; revision: number;
      };
    }
  } catch { /* Storage may be unavailable; in-memory navigation protection still applies. */ }
  return { baseline: settings, draft: settings, revision };
}
export function RuntimeParameters({ api, snapshot, updateState }: WorkspaceProps) {
  const t = translate(snapshot.state.language ?? "en");
  const { active: licensed } = useLicense();
  const [initial] = useState(() => loadDraft(snapshot.state.requestScheduling ?? defaults, snapshot.state.requestSchedulingRevision));
  const [draft, setDraft] = useState(initial.draft);
  const [baseline, setBaseline] = useState({ settings: initial.baseline, revision: initial.revision });
  const [status, setStatus] = useState<RequestQueueStatus | null>(null);
  const [feedback, setFeedback] = useState("");
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
      setDraft(snapshot.state.requestScheduling);
      setBaseline({ settings: snapshot.state.requestScheduling, revision: snapshot.state.requestSchedulingRevision });
    }
  }, [changed, working, baseline.revision, snapshot.state.requestScheduling, snapshot.state.requestSchedulingRevision]);
  const valid = Number.isInteger(draft.minSendIntervalSeconds) && draft.minSendIntervalSeconds >= 1 && draft.minSendIntervalSeconds <= 60;
  async function save() {
    if (!licensed || saving.current || !changed || !valid) return false;
    saving.current = true;
    setWorking(true); setFeedback(""); setFailed(false);
    try {
      const result = await api.saveQueueSettings(draft, baseline.revision);
      updateState(result.state);
      setBaseline({ settings: result.state.requestScheduling, revision: result.persistedRevision });
      setDraft(result.state.requestScheduling);
      setFailed(result.applyState === "apply-failed");
      setFeedback(result.applyState === "applied" ? t("已保存并生效", "Saved and applied")
        : result.applyState === "pending-start" ? t("已保存，服务启动后生效", "Saved; applies when the service starts")
        : t("设置已保存，但运行时应用未完成。请检查运行状态，重启服务后生效。", "Settings saved, but runtime application did not complete. Check runtime status; settings apply after the service restarts."));
      // Show a failed-apply result on this page before allowing another navigation.
      return result.applyState !== "apply-failed";
    } catch (error) { setFeedback(String(error)); setFailed(true); return false; }
    finally { saving.current = false; setWorking(false); }
  }
  usePageNavigationGuard({ dirty: changed, canSave: licensed && valid && changed, busy: working, save,
    discard: () => {
      setDraft(snapshot.state.requestScheduling ?? defaults);
      setBaseline({ settings: snapshot.state.requestScheduling ?? defaults, revision: snapshot.state.requestSchedulingRevision });
      try { localStorage.removeItem(draftKey); } catch { /* best effort */ }
    } });
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
      <div className="queue-settings-footer">
        <p className="muted">{t("修改不打断已有任务；排队超时仅用于新入队请求。", "Changes do not interrupt running tasks. Queue timeout applies to new requests.")}</p>
        <div className="queue-actions"><Button type="submit" disabled={!licensed || working || !changed || !valid}>{working ? t("保存中…", "Saving…") : t("保存设置", "Save settings")}</Button>
          <Button type="button" disabled={!licensed || working} onClick={() => { setDraft({ ...defaults }); setFeedback(t("已恢复默认值，保存后生效", "Defaults restored; save to apply")); setFailed(false); }}>{t("恢复默认值", "Restore defaults")}</Button></div>
        <div className={`queue-feedback${failed ? " error" : ""}`} role={failed ? "alert" : "status"}>{feedback || (status?.status === "stopped" ? t("服务未启动", "Service not running") : "\u00a0")}</div>
      </div>
    </form>
  </>;
}
