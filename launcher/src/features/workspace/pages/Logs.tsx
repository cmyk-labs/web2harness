import { memo, useEffect, useRef, useState } from "react";
import type { DiagnosticRange, Language, LauncherApi, LauncherState, LogPage, LogQuery, LogRecord } from "../../../types";
import { defaultPageSize, pageSizes } from "../../../../shared/log-pagination.json";
import { jsonLogParts } from "../log-presentation";
import { translate } from "../labels";
import "./logs.css";

const sources = ["launcher", "runtime", "browser", "codex", "connection", "update"];
const JsonLog = memo(function JsonLog({ record, formatted, search }: { record: LogRecord; formatted: boolean; search: string }) {
  return <code>{jsonLogParts(record, formatted, search).map((part, index) => part.match
    ? <mark key={index} className={`json-${part.kind}`}>{part.text}</mark>
    : <span key={index} className={`json-${part.kind}`}>{part.text}</span>)}</code>;
});
function recordId(record: LogRecord, index: number) { return record.id ?? record.eventId ?? `${record.at}-${index}`; }
function localMinute(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export function Logs({ api, language, recent, savedPageSize, updateState }: {
  api: LauncherApi; language: Language; recent: LogRecord[]; savedPageSize: number; updateState: (state: LauncherState) => void;
}) {
  const t = translate(language);
  const [level, setLevel] = useState("all"), [source, setSource] = useState("all"), [search, setSearch] = useState("");
  const [page, setPage] = useState<LogPage | null>(null), [cursor, setCursor] = useState<string | undefined>();
  const offset = page?.offset ?? 0;
  const [before, setBefore] = useState<string | undefined>(), [revision, setRevision] = useState(0);
  const [correlation, setCorrelation] = useState<LogQuery["correlation"]>();
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null), [notice, setNotice] = useState<"" | "complete" | "partial">("");
  const [copied, setCopied] = useState(false);
  const [formatted, setFormatted] = useState(false), [wrap, setWrap] = useState(true);
  const [pageSize, setPageSize] = useState(() => pageSizes.includes(savedPageSize) ? savedPageSize : defaultPageSize);
  const [savingPageSize, setSavingPageSize] = useState(false), [pageSizeError, setPageSizeError] = useState("");
  const selected = page?.records.find((record, index) => recordId(record, offset + index) === selectedId);
  const relatedField = typeof selected?.detail.traceId === "string" && selected.detail.traceId.length > 0 ? "traceId"
    : typeof selected?.detail.requestId === "string" && selected.detail.requestId.length > 0 ? "requestId" : null;
  const [exportOpen, setExportOpen] = useState(false), [exporting, setExporting] = useState(false);
  const [range, setRange] = useState<DiagnosticRange["range"]>("all");
  const [start, setStart] = useState(() => localMinute(new Date(Date.now() - 86400000)));
  const [end, setEnd] = useState(() => localMinute(new Date()));
  const [exportError, setExportError] = useState("");
  const scroll = useRef<HTMLDivElement>(null), exportButton = useRef<HTMLButtonElement>(null);
  const latestEvent = useRef(""), queryInFlight = useRef(false);
  latestEvent.current = `${recent.at(-1)?.at}:${recent.at(-1)?.event}`;
  const newRecords = before && recent.some(record => record.at > before);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatTime = (value: string | null) => value ? new Date(value).toLocaleString(language, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false }) : "-";
  useEffect(() => { setCopied(false); }, [selectedId, formatted]);
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); } }, [copied]);
  useEffect(() => {
    if (before) return;
    let observed = latestEvent.current;
    const timer = setInterval(() => {
      if (!queryInFlight.current && observed !== latestEvent.current) { observed = latestEvent.current; setRevision(value => value + 1); }
    }, 3000);
    return () => clearInterval(timer);
  }, [before]);
  useEffect(() => {
    let active = true;
    queryInFlight.current = true; setLoading(true);
    const timer = setTimeout(() => {
      void api.queryLogs({ level, source, search, cursor, before, correlation, pageSize }).then(result => {
        if (active && !result.superseded) { setPage(result); setError(""); }
      }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) { queryInFlight.current = false; setLoading(false); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [api, level, source, search, cursor, before, revision, correlation, pageSize]);
  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setCursor(undefined); setSelectedId(null); setNotice(""); };
  const pause = () => { if (!before && !queryInFlight.current) { setBefore(new Date().toISOString()); setCursor(page?.cursor); } };
  const resume = () => { setBefore(undefined); setCursor(undefined); setSelectedId(null); setRevision(value => value + 1); scroll.current?.scrollTo({ top: 0 }); };
  const nextPage = (value: string | null | undefined) => { if (!value) return; setBefore(current => current ?? new Date().toISOString()); setCursor(value); setSelectedId(null); scroll.current?.scrollTo({ top: 0 }); };
  async function changePageSize(value: number) {
    if (savingPageSize || value === pageSize || !pageSizes.includes(value)) return;
    setSavingPageSize(true); setPageSizeError("");
    try {
      const state = await api.setPreference("logPageSize", value);
      updateState(state); setPageSize(state.logPageSize); setCursor(undefined); setSelectedId(null);
      scroll.current?.scrollTo({ top: 0 });
    } catch (reason) { setPageSizeError(String(reason)); }
    finally { setSavingPageSize(false); }
  }
  async function saveExport() {
    setExportError(""); setNotice("");
    const input: DiagnosticRange = { range, timeZone };
    if (range === "custom") {
      const from = new Date(start), to = new Date(end);
      if (!start || !end || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
        setExportError(t("开始时间必须早于结束时间。", "Start must be before end.")); return;
      }
      input.start = from.toISOString(); input.end = to.toISOString();
    }
    setExporting(true);
    try {
      const result = await api.exportLogs(input);
      if (result) {
        setNotice(result.partial ? "partial" : "complete");
        setExportOpen(false); exportButton.current?.focus();
      }
    } catch (reason) { setExportError(String(reason)); }
    finally { setExporting(false); }
  }
  async function copySelected() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(JSON.stringify(selected, null, formatted ? 2 : undefined)); setCopied(true); }
    catch (reason) { setError(String(reason)); }
  }
  return <div className="log-viewer">
    <div className="log-toolbar">
      <label>{t("级别", "Level")}<select value={level} onChange={event => changeFilter(setLevel, event.target.value)}>
        <option value="all">{t("全部", "All levels")}</option><option value="error">error</option>
        <option value="warning">warning</option><option value="info">info</option><option value="debug">debug</option>
      </select></label>
      <label>{t("来源", "Source")}<select value={source} onChange={event => changeFilter(setSource, event.target.value)}>
        <option value="all">{t("全部来源", "All sources")}</option>{sources.map(key => <option key={key} value={key}>{key}</option>)}
      </select></label>
      <label className="log-search">{t("搜索", "Search")}<input type="search" value={search} maxLength={200} placeholder={t("搜索全部保留日志", "Search all retained logs")} onChange={event => changeFilter(setSearch, event.target.value)} /></label>
    </div>
    {correlation && <div className="log-correlation"><code>{correlation.field}: {correlation.value}</code><button className="btn" onClick={() => { setCorrelation(undefined); setCursor(undefined); setSelectedId(null); }}>{t("清除关联筛选", "Clear correlation")}</button></div>}
    {notice && <p role="status">{notice === "partial" ? t("诊断包已导出，部分记录缺失或被截断，详见包内清单。", "Bundle exported with missing or truncated records; see its manifest.") : t("诊断包已导出。", "Diagnostic bundle exported.")}</p>}
    {error && <div className="note warn" role="alert">{error} <button className="btn" onClick={() => setRevision(value => value + 1)}>{t("重试", "Retry")}</button></div>}
    <div className="log-view-options">
      <div className="log-format-options">
        <label><input type="checkbox" checked={formatted} onChange={event => setFormatted(event.target.checked)} />{t("格式化", "Format JSON")}</label>
        <label><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} />{t("自动换行", "Word wrap")}</label>
        <label className="log-page-size" title={t("长日志可能提前分页。", "Long records may fill a page before this limit.")}>{t("每页最多", "Per page")}<select value={pageSize} disabled={savingPageSize} onChange={event => void changePageSize(Number(event.target.value))}>
          {pageSizes.map(size => <option key={size} value={size}>{t(`${size} 条`, String(size))}</option>)}
        </select></label>
      </div>
      <div className="log-selection-actions">
        <button className="btn" onClick={before ? resume : pause}><span className="log-button-label"><span className="log-button-placeholder" aria-hidden="true">{t("暂停更新", "Pause updates")}</span><span>{before ? t("显示最新", "Show latest") : t("暂停更新", "Pause updates")}</span></span></button>
        <button className="btn" disabled={!selected} aria-label={t("复制选中日志", "Copy selected log")} onClick={() => void copySelected()}><span className="log-button-label"><span className="log-button-placeholder" aria-hidden="true">{t("复制选中日志", "Copy selected log")}</span><span aria-live="polite">{copied ? t("已复制", "Copied") : t("复制选中日志", "Copy selected log")}</span></span></button>
        <button className="btn" disabled={!selected || !relatedField} title={t("选中日志后，按请求编号筛选同一轮的相关记录。", "Select a log to filter related records from the same turn by request ID.")} onClick={() => {
          if (!selected || !relatedField) return;
          setCorrelation({ field: relatedField, value: String(selected.detail[relatedField]) });
          setLevel("all"); setSource("all"); setSearch(""); setCursor(undefined); setSelectedId(null); setBefore(current => current ?? new Date().toISOString());
        }}>{t("关联日志", "Related logs")}</button>
        <button className="btn" ref={exportButton} disabled={exporting} aria-expanded={exportOpen} aria-controls="diagnostic-export" onClick={() => { setExportOpen(value => !value); setExportError(""); setNotice(""); }}>{t("导出诊断包", "Export diagnostics")}</button>
      </div>
    </div>
    {pageSizeError && <div className="note warn" role="alert">{pageSizeError}</div>}
    {exportOpen && <section className="log-export" id="diagnostic-export" aria-label={t("导出诊断包", "Export diagnostics")}>
      <div className="log-export-fields">
        <label>{t("时间范围", "Time range")}<select value={range} disabled={exporting} onChange={event => setRange(event.target.value as DiagnosticRange["range"])}>
          <option value="all">{t("全部保留日志", "All retained logs")}</option><option value="24h">{t("最近 24 小时", "Last 24 hours")}</option><option value="custom">{t("自定义时间", "Custom range")}</option>
        </select></label>
        {range === "custom" && <>
          <label>{t("开始时间", "Start time")}<input type="datetime-local" step="60" value={start} disabled={exporting} onChange={event => setStart(event.target.value)} /></label>
          <label>{t("结束时间（不含）", "End time (exclusive)")}<input type="datetime-local" step="60" value={end} disabled={exporting} onChange={event => setEnd(event.target.value)} /></label>
        </>}
      </div>
      <p>{t("可导出范围", "Available range")}：{formatTime(page?.available.start ?? null)} — {formatTime(page?.available.end ?? null)} · {timeZone}</p>
      <p>{t("导出包含所选时段的全部相关日志，已脱敏，不受上方筛选影响。", "Includes all related retained logs in the selected period, redacted and independent of the filters above.")}</p>
      <div className="log-actions"><button className="btn primary" disabled={exporting} onClick={() => void saveExport()}>{exporting ? t("正在打包…", "Preparing…") : t("保存 ZIP", "Save ZIP")}</button>
        <button className="btn" disabled={exporting} onClick={() => { setExportOpen(false); exportButton.current?.focus(); }}>{t("取消", "Cancel")}</button></div>
      {exportError && <p className="log-error" role="alert">{exportError}</p>}
    </section>}
    <div className={`log-json-scroll${wrap ? " is-wrapped" : ""}`} ref={scroll} role="list" aria-label={t("JSON 运行日志", "JSON runtime logs")} aria-busy={loading} onWheel={pause} onTouchStart={pause} onKeyDown={event => { if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) pause(); }}>
      {page?.records.map((record, index) => {
        const id = recordId(record, offset + index);
        return <div role="listitem" key={id} className={`log-json-record is-${record.level}${selectedId === id ? " is-selected" : ""}`}>
          <pre tabIndex={0} aria-label={`${t("日志记录", "Log record")} ${offset + index + 1}: ${record.event}`} onFocus={() => { pause(); setSelectedId(id); }} onClick={() => { pause(); setSelectedId(id); }}>
            <JsonLog record={record} formatted={formatted} search={search} />
          </pre>
        </div>;
      })}
      {page?.expired ? <p className="log-empty">{t("当前浏览快照已过期。", "This browsing snapshot has expired.")} <button className="btn" onClick={resume}>{t("重新加载", "Reload")}</button></p>
        : page?.records.length === 0 && <p className="log-empty">{t("没有符合条件的记录。", "No matching records.")}</p>}
    </div>
    <div className="log-pagination"><span>{t("匹配记录", "Matching records")} · {page ? `${Math.min(offset + 1, page.total)}–${Math.min(offset + page.records.length, page.total)} / ${page.total}` : "-"}</span>
      <button className="btn" disabled={loading || savingPageSize || !page?.previousCursor} onClick={() => nextPage(page?.previousCursor)}>{t("上一页", "Previous")}</button>
      <button className="btn" disabled={loading || savingPageSize || !page?.nextCursor} onClick={() => nextPage(page?.nextCursor)}>{t("下一页", "Next")}</button></div>
    <div className="log-list-status" aria-live="polite"><span>{before ? t("已暂停更新", "Updates paused") : t("实时更新", "Live updates")}{newRecords ? t(" · 有新记录", " · New records available") : ""}{loading ? t(" · 读取中…", " · Loading…") : ""} · {t("最新记录在前", "Newest first")}</span>
      <span>{t("保留范围", "Retained range")} · {formatTime(page?.available.start ?? null)} — {formatTime(page?.available.end ?? null)} · {timeZone}</span>
      {page?.partial && <span>{t("部分记录无法读取，导出清单包含详情。", "Some records are unavailable; details are included in the export manifest.")}</span>}
    </div>
  </div>;
}
