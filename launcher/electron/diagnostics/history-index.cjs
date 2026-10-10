const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { collectDiagnostics } = require("./bundle.cjs");
const { defaultPageSize, pageSizes } = require("../../shared/log-pagination.json");

const PAGE_BYTES = 512 * 1024;
const MAX_RECORDS = 100000;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_CURRENT_BYTES = 128 * 1024 * 1024;
const SNAPSHOT_TTL = 5 * 60 * 1000;
const MAX_SNAPSHOTS = 4;
const expiredPage = () => ({ records: [], total: 0, available: { start: null, end: null }, partial: false, expired: true });
function filterFor(query) {
  const before = query.before ? Date.parse(query.before) : Infinity;
  if (Number.isNaN(before)) throw new Error("Invalid log snapshot time");
  const correlation = query.correlation;
  if (correlation && (!["traceId", "requestId"].includes(correlation.field) || typeof correlation.value !== "string" || correlation.value.length > 200)) throw new Error("Invalid correlation filter");
  return { level: ["debug", "info", "warning", "error"].includes(query.level) ? query.level : "all",
    source: typeof query.source === "string" ? query.source.slice(0, 100) : "all",
    search: typeof query.search === "string" ? query.search.slice(0, 200).toLowerCase() : "", correlation, before };
}
function filterKey(filter) { const { before, ...rest } = filter; return JSON.stringify(rest); }

/** The cache contains only sanitized JSON. Record bodies stay on disk; memory holds positions. */
function createHistoryIndex(options, cacheDirectory) {
  const directory = fs.realpathSync(cacheDirectory);
  const current = new Map(), files = new Set(), snapshots = new Map();
  let revision = 0, ordered = [], available = { start: null, end: null }, partial = false;
  let metrics = { sourceBytesRead: 0, cacheBytesRead: 0, indexedFiles: 0, indexedRecords: 0, searches: 0, pageReads: 0 };
  function removeFile(file) {
    if (path.dirname(file.path) !== directory || !/^[a-f0-9-]{36}\.jsonl$/.test(path.basename(file.path))) throw new Error("Unsafe history cache path");
    fs.rmSync(file.path, { force: true }); files.delete(file);
  }
  function prune(now) {
    for (const [id, snapshot] of snapshots) if (now - snapshot.usedAt > SNAPSHOT_TTL) snapshots.delete(id);
    while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
    const sweep = () => {
      const referenced = new Set([...current.values(), ...[...snapshots.values()].flatMap(s => [...s.files])]);
      for (const file of files) if (!referenced.has(file)) removeFile(file);
    };
    sweep();
    while (snapshots.size && [...files].reduce((sum, file) => sum + file.bytes, 0) > MAX_CACHE_BYTES) {
      snapshots.delete(snapshots.keys().next().value); sweep();
    }
  }
  function refresh(check, now) {
    const next = new Map(), created = new Set();
    let building = null, fd = null, rows = 0, bytes = 0, limited = false;
    let collected;
    try { collected = collectDiagnostics(options, {}, now, {
      check,
      source({ file, kind, stat, amount, entry }) {
        if (rows >= MAX_RECORDS || bytes >= MAX_CURRENT_BYTES) { limited = true; entry.status = "size-limit"; return false; }
        const fingerprint = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${amount}`;
        const cached = current.get(file);
        if (cached?.fingerprint === fingerprint && !cached.limited && rows + cached.entries.length <= MAX_RECORDS && bytes + cached.bytes <= MAX_CURRENT_BYTES) {
          Object.assign(entry, cached.status); next.set(file, cached); rows += cached.entries.length; bytes += cached.bytes; return false;
        }
        building = { path: path.join(directory, `${randomUUID()}.jsonl`), source: file, fingerprint, entries: [], bytes: 0, status: entry, limited: false };
        try { fd = fs.openSync(building.path, "wx", 0o600); } catch (error) { error.code = "HISTORY_CACHE_FAILED"; building = null; throw error; }
        files.add(building); created.add(building);
        metrics.sourceBytesRead += amount; metrics.indexedFiles++;
        return true;
      },
      record(record) {
        if (rows % 128 === 0) check();
        const data = Buffer.from(JSON.stringify(record) + "\n");
        if (rows >= MAX_RECORDS || bytes + data.length > MAX_CURRENT_BYTES) { limited = true; building.limited = true; return; }
        try {
          let written = 0;
          while (written < data.length) {
            const amount = fs.writeSync(fd, data, written, data.length - written);
            if (!amount) throw new Error("Incomplete history cache write");
            written += amount;
          }
        } catch (error) { error.code = "HISTORY_CACHE_FAILED"; throw error; }
        building.entries.push({ file: building, offset: building.bytes, length: data.length, at: Date.parse(record.at),
          level: record.level, source: record.source, traceId: record.detail.traceId, requestId: record.detail.requestId });
        building.bytes += data.length; bytes += data.length; rows++; metrics.indexedRecords++;
      },
      complete(file, status) {
        if (!building || building.source !== file) return;
        fs.closeSync(fd); fd = null;
        building.status = { ...status };
        if (status.status === "failed") { rows -= building.entries.length; bytes -= building.bytes; removeFile(building); created.delete(building); }
        else next.set(file, building);
        building = null;
      },
    }); check(); } catch (error) {
      if (fd !== null) fs.closeSync(fd);
      for (const file of created) removeFile(file);
      throw error;
    }
    const changed = current.size !== next.size || [...next].some(([name, file]) => current.get(name) !== file);
    current.clear(); for (const [name, file] of next) current.set(name, file);
    partial = collected.partial || limited;
    if (changed) {
      revision++;
      ordered = [...current.values()].flatMap(file => file.entries).sort((a, b) => b.at - a.at || b.offset - a.offset);
      available = { start: ordered.length ? new Date(ordered.at(-1).at).toISOString() : null, end: ordered.length ? new Date(ordered[0].at).toISOString() : null };
    }
    if (ordered.length > MAX_RECORDS) partial = true;
    prune(now);
  }
  function readRecord(entry, fd) {
    const data = Buffer.alloc(entry.length);
    if (fs.readSync(fd, data, 0, data.length, entry.offset) !== data.length) throw new Error("History cache record is incomplete");
    metrics.cacheBytesRead += data.length;
    return JSON.parse(data.toString("utf8"));
  }
  function search(filter, check) {
    metrics.searches++;
    const candidates = ordered.slice(0, MAX_RECORDS).filter(entry => entry.at <= filter.before
      && (filter.level === "all" || entry.level === filter.level)
      && (!filter.source || filter.source === "all" || entry.source === filter.source)
      && (!filter.correlation || entry[filter.correlation.field] === filter.correlation.value));
    if (!filter.search) return candidates;
    // Scan one bounded cache file at a time, not one filesystem call per matching row.
    const grouped = new Map(), matched = new Set();
    for (const entry of candidates) { if (!grouped.has(entry.file)) grouped.set(entry.file, []); grouped.get(entry.file).push(entry); }
    for (const [file, entries] of grouped) {
      check();
      const content = fs.readFileSync(file.path); metrics.cacheBytesRead += content.length;
      for (let i = 0; i < entries.length; i++) {
        if (i % 128 === 0) check();
        const entry = entries[i];
        if (content.toString("utf8", entry.offset, entry.offset + entry.length - 1).toLowerCase().includes(filter.search)) matched.add(entry);
      }
    }
    return candidates.filter(entry => matched.has(entry));
  }
  function page(snapshot, offset, check, now) {
    snapshot.usedAt = now;
    snapshots.delete(snapshot.id); snapshots.set(snapshot.id, snapshot);
    const records = [], descriptors = new Map(); let bytes = 0, next = offset;
    try {
      while (next < snapshot.matches.length && records.length < snapshot.pageSize) {
        check();
        const entry = snapshot.matches[next];
        if (records.length && bytes + entry.length > PAGE_BYTES) break;
        if (!descriptors.has(entry.file)) descriptors.set(entry.file, fs.openSync(entry.file.path, "r"));
        records.push(readRecord(entry, descriptors.get(entry.file))); bytes += entry.length; next++;
      }
    } finally { for (const fd of descriptors.values()) fs.closeSync(fd); }
    metrics.pageReads++;
    if (next < snapshot.matches.length && !snapshot.starts.includes(next)) snapshot.starts.push(next);
    const position = snapshot.starts.indexOf(offset);
    return { records, total: snapshot.matches.length, available: snapshot.available, partial: snapshot.partial, offset, pageSize: snapshot.pageSize,
      cursor: `${snapshot.id}.${offset}`, nextCursor: next < snapshot.matches.length ? `${snapshot.id}.${next}` : null,
      previousCursor: position > 0 ? `${snapshot.id}.${snapshot.starts[position - 1]}` : null, pageBytes: bytes };
  }
  return {
    query(query = {}, { cancelled = () => false, now = Date.now() } = {}) {
      const check = () => { if (cancelled()) { const error = new Error("History query superseded"); error.code = "HISTORY_SUPERSEDED"; throw error; } };
      const pageSize = query.pageSize === undefined ? defaultPageSize : query.pageSize;
      if (!pageSizes.includes(pageSize)) throw new Error("Unsupported log page size");
      check(); prune(now);
      const filter = filterFor(query), key = filterKey(filter);
      if (query.cursor) {
        const match = typeof query.cursor === "string" && query.cursor.match(/^([a-f0-9-]{36})\.(\d{1,6})$/);
        const snapshot = match && snapshots.get(match[1]), offset = match ? Number(match[2]) : -1;
        if (!snapshot || snapshot.key !== key || snapshot.pageSize !== pageSize || !snapshot.starts.includes(offset)) return expiredPage();
        return page(snapshot, offset, check, now);
      }
      refresh(check, now); check();
      const compatible = [...snapshots.values()].filter(s => s.key === key && s.revision === revision && s.partial === partial);
      let snapshot = compatible.find(s => s.before === filter.before && s.pageSize === pageSize);
      if (!snapshot) {
        // A different page size needs new boundaries, not another keyword scan.
        const reusable = compatible.find(s => s.before >= filter.before);
        const matches = reusable ? (reusable.before === filter.before ? reusable.matches : reusable.matches.filter(entry => entry.at <= filter.before)) : search(filter, check); check();
        snapshot = { id: randomUUID(), key, before: filter.before, revision, matches, files: new Set(matches.map(e => e.file)), available, partial, pageSize, starts: [0], usedAt: now };
        snapshots.set(snapshot.id, snapshot); prune(now);
      }
      return page(snapshot, 0, check, now);
    },
    metrics: () => ({ ...metrics, cachedFiles: files.size, cachedBytes: [...files].reduce((sum, file) => sum + file.bytes, 0), indexedRows: ordered.length, snapshots: snapshots.size }),
    close() { current.clear(); snapshots.clear(); for (const file of files) removeFile(file); },
  };
}
module.exports = { createHistoryIndex, PAGE_BYTES };
