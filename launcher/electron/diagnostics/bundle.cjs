const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { logFiles, RETENTION_DAYS, MAX_RETAINED_BYTES } = require("./log-files.cjs");
const { cleanText, safeDetail, safeRecord } = require("./redaction.cjs");
const { zipFiles } = require("./zip.cjs");

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 100000;
function rangeFor(input = {}, now = Date.now()) {
  if (!input || typeof input !== "object" || ![undefined, "all", "24h", "custom"].includes(input.range)) throw new Error("Invalid diagnostic time range");
  const timeZone = input.timeZone ?? "UTC";
  if (typeof timeZone !== "string" || timeZone.length > 100) throw new Error("Invalid time zone");
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { throw new Error("Invalid time zone"); }
  const mode = input.range ?? "all";
  if (mode === "custom" && [input.start, input.end].some(value => typeof value !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value))) throw new Error("Custom times require an explicit time zone");
  const start = mode === "custom" ? Date.parse(input.start) : mode === "24h" ? now - 86400000 : null;
  const end = mode === "custom" ? Date.parse(input.end) : mode === "24h" ? now : null;
  if (mode === "custom" && (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)) throw new Error("Start must be before end");
  return { mode, start, end, timeZone };
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function collectDiagnostics({ logsDirectory, coreHome }, input = {}, now = Date.now(), hooks = {}) {
  const range = rangeFor(input, now), records = [], sources = [];
  let remaining = MAX_RETAINED_BYTES, clipped = false, earliest = null, latest = null, recordCount = 0;
  function add(raw, undated = false) {
    const at = Date.parse(raw.at);
    if (!Number.isFinite(at)) return false;
    earliest = earliest === null ? at : Math.min(earliest, at);
    latest = latest === null ? at : Math.max(latest, at);
    if (range.mode !== "all" && (undated || at < range.start || at >= range.end)) return true;
    if (recordCount >= MAX_RECORDS) { clipped = true; return true; }
    recordCount++;
    const record = safeRecord(raw);
    if (hooks.record) hooks.record(record);
    else records.push(record);
    return true;
  }
  function read(root, file, label, kind, sourceEvent) {
    hooks.check?.();
    const entry = { file: label, status: "collected", invalidRecords: 0, undatedRecords: 0, truncated: false };
    sources.push(entry);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !inside(fs.realpathSync(root), fs.realpathSync(file))) throw new Error("Unsafe diagnostic source");
      const amount = Math.min(stat.size, MAX_FILE_BYTES, remaining);
      entry.truncated = amount < stat.size;
      if (!amount && stat.size) { entry.status = "size-limit"; return; }
      remaining -= amount;
      if (hooks.source?.({ file, kind, stat, amount, entry }) === false) return;
      const fd = fs.openSync(file, "r");
      const data = Buffer.alloc(amount);
      let length;
      try { length = fs.readSync(fd, data, 0, amount, Math.max(0, stat.size - amount)); } finally { fs.closeSync(fd); }
      let content = data.subarray(0, length).toString("utf8");
      if (kind !== "checkpoint" && amount < stat.size) content = content.slice(content.indexOf("\n") + 1);
      if (kind === "checkpoint") {
        const value = JSON.parse(content);
        if (!add({ at: value.capturedAt, level: value.error ? "error" : "info", event: "browser.checkpoint", detail: {
          traceId: value.traceId, checkpoint: value.checkpoint, error: value.error, state: value.state, captureErrors: value.captureErrors,
        } })) entry.invalidRecords++;
      } else if (kind === "jsonl") {
        for (const line of content.split(/\r?\n/)) {
          if (!line.trim()) continue;
          let record;
          try { record = JSON.parse(line); } catch { entry.invalidRecords++; continue; }
          if (!record || typeof record.event !== "string" || !["debug", "info", "warning", "error"].includes(record.level) || !add(record)) entry.invalidRecords++;
        }
      } else {
        let current = null;
        const flush = () => {
          if (!current) return;
          add({ at: current.at, level: sourceEvent === "update.worker" && !/error|fail|exception|timeout/i.test(current.text) ? "info" : "error", event: sourceEvent, detail: { message: current.text, ...(current.undated ? { timeBasis: "file-mtime" } : {}) } }, current.undated);
        };
        for (const line of content.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const match = line.match(/^(\d{4}-\d\d-\d\dT[0-9:.]+Z)\s+(.*)$/);
          if (match || !current) {
            flush();
            current = { at: match?.[1] ?? stat.mtime.toISOString(), text: match?.[2] ?? line, undated: !match };
            if (!match) entry.undatedRecords++;
          } else current.text = (current.text + "\n" + line).slice(0, 16384);
        }
        flush();
      }
    } catch (error) {
      if (error.code === "HISTORY_SUPERSEDED" || error.code === "HISTORY_CACHE_FAILED") throw error;
      entry.status = error.code === "ENOENT" ? "absent" : "failed";
      if (entry.status === "failed") entry.error = cleanText(error.message);
    } finally { hooks.complete?.(file, entry); }
  }
  try {
    const files = logFiles(path.join(logsDirectory, "launcher.jsonl"));
    if (!files.length) sources.push({ file: "launcher.jsonl", status: "absent" });
    // Current and newest files first when the safety bound is reached.
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const file of files) read(logsDirectory, file, path.basename(file), "jsonl");
  } catch (error) { if (error.code?.startsWith("HISTORY_")) throw error; sources.push({ file: "launcher-logs", status: "failed", error: cleanText(error.message) }); }
  for (const [name, event] of [["update-worker.log", "update.worker"], ["process-stream-errors.log", "launcher.process_stream_error"], ["launcher-fatal.log", "launcher.fatal"]]) {
    read(logsDirectory, path.join(logsDirectory, name), name, "text", event);
  }
  const browserRoot = path.join(coreHome, "diagnostics", "browser-turns");
  try {
    if (!inside(fs.realpathSync(coreHome), fs.realpathSync(browserRoot))) throw new Error("Browser diagnostics are outside this profile");
    const dirs = fs.readdirSync(browserRoot, { withFileTypes: true }).filter(item => item.isDirectory() && !item.isSymbolicLink() && /^[A-Za-z0-9_-]{6,160}$/.test(item.name));
    for (const dir of dirs.slice(0, 100)) {
      const folder = path.join(browserRoot, dir.name);
      try {
        if (!inside(fs.realpathSync(browserRoot), fs.realpathSync(folder))) throw new Error("Unsafe diagnostic directory");
        const checkpoints = fs.readdirSync(folder).filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name));
        if (checkpoints.length > 200) { clipped = true; sources.push({ file: `browser/${dir.name}`, status: "size-limit" }); }
        for (const file of checkpoints.slice(0, 200)) {
          read(browserRoot, path.join(folder, file), `browser/${dir.name}/${file}`, "checkpoint");
        }
      } catch (error) { if (error.code?.startsWith("HISTORY_")) throw error; sources.push({ file: `browser/${dir.name}`, status: "failed", error: cleanText(error.message) }); }
    }
    if (dirs.length > 100) clipped = true;
  } catch (error) { if (error.code?.startsWith("HISTORY_")) throw error; sources.push({ file: "browser-checkpoints", status: error.code === "ENOENT" ? "absent" : "failed" }); }
  records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { records, sources, range, available: { start: earliest === null ? null : new Date(earliest).toISOString(), end: latest === null ? null : new Date(latest).toISOString() },
    partial: clipped || sources.some(source => source.status === "failed" || source.status === "size-limit" || source.truncated || source.invalidRecords > 0 || (range.mode !== "all" && source.undatedRecords > 0)) };
}
function queryLogs(options, query = {}) {
  const collection = collectDiagnostics(options);
  const level = ["debug", "info", "warning", "error"].includes(query.level) ? query.level : "all";
  const search = typeof query.search === "string" ? query.search.slice(0, 200).toLowerCase() : "";
  const before = query.before ? Date.parse(query.before) : Infinity;
  if (Number.isNaN(before)) throw new Error("Invalid log snapshot time");
  const correlation = query.correlation;
  if (correlation && (!["traceId", "requestId"].includes(correlation.field) || typeof correlation.value !== "string" || correlation.value.length > 200)) throw new Error("Invalid correlation filter");
  const list = collection.records.filter(record => Date.parse(record.at) <= before && (level === "all" || record.level === level)
    && (!query.source || query.source === "all" || record.source === query.source)
    && (!correlation || record.detail[correlation.field] === correlation.value)
    && (!search || JSON.stringify(record).toLowerCase().includes(search))).reverse();
  const offset = Number.isInteger(query.offset) ? Math.max(0, Math.min(query.offset, MAX_RECORDS)) : 0;
  return { records: list.slice(offset, offset + 100), total: list.length, available: collection.available, partial: collection.partial };
}
function validateDestination(destination, roots) {
  const resolved = path.resolve(destination);
  const realParent = fs.realpathSync(path.dirname(resolved));
  for (const root of roots) {
    const absolute = path.resolve(root);
    const realRoot = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
    if (inside(absolute, resolved) || inside(realRoot, path.join(realParent, path.basename(resolved)))) throw new Error("Choose a destination outside application data");
  }
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new Error("Unsafe export destination");
  return resolved;
}
function exportBundle(options, input, destination, snapshot = {}, now = Date.now()) {
  const target = validateDestination(destination, [options.logsDirectory, options.coreHome, options.userData ?? options.logsDirectory]);
  const collection = collectDiagnostics(options, input, now);
  if (snapshot.collectorErrors?.length || snapshot.logging?.writeFailure) collection.partial = true;
  const generatedAt = new Date(now).toISOString();
  const manifest = { schemaVersion: 1, generatedAt, requestedRange: collection.range, availableRange: collection.available,
    recordCount: collection.records.length, partial: collection.partial, retention: { days: RETENTION_DAYS, maxLauncherBytes: MAX_RETAINED_BYTES },
    sources: collection.sources, files: [], exclusions: ["credentials", "conversation bodies", "tool input/output", "screenshots", "browser profile"],
    notes: ["Timestamps are UTC; requested time zone is recorded above. End time is exclusive.", "Absent sources may be unused; failed/truncated sources are marked. Undated text is included only for all-time export.", "Snapshot is collected at export time, not at the time of the incident."] };
  const errors = collection.records.filter(record => record.level === "error" || record.level === "warning");
  const summary = ["Web2Harness diagnostics / 诊断摘要", `Collected / 采集时间: ${generatedAt}`, `Time zone / 时区: ${collection.range.timeZone}`,
    `Records / 记录数: ${collection.records.length}`, `Partial / 采集不完整: ${collection.partial}`, "",
    "Recent errors and warnings / 最近错误与警告（最多50条）", ...errors.slice(-50).map(record => `${record.at} [${record.source}/${record.level}] ${record.event}\n${JSON.stringify(record.detail)}`), "", "See manifest.json for source coverage; timeline.jsonl contains all selected records. / 采集范围见清单，所选记录见时间线。"].join("\n");
  const files = { "summary.txt": summary, "timeline.jsonl": collection.records.map(record => JSON.stringify(record)).join("\n") + "\n",
    "snapshot.json": JSON.stringify({ collectedAt: generatedAt, ...safeDetail(snapshot) }, null, 2) };
  for (const [name, content] of Object.entries(files)) manifest.files.push({ name, bytes: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") });
  files["manifest.json"] = JSON.stringify(manifest, null, 2);
  const temp = `${target}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, zipFiles(files), { flag: "wx", mode: 0o600 }); fs.renameSync(temp, target); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  return { path: target, partial: collection.partial, recordCount: collection.records.length };
}
module.exports = { collectDiagnostics, queryLogs, exportBundle, rangeFor, safeDetail };
