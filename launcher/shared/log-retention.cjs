// Standalone so the updater can copy this exact policy beside its detached worker.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_RETAINED_BYTES = 100 * 1024 * 1024;
const RETENTION_DAYS = 7;
const ACTIVE = ["launcher.jsonl", "launcher-fatal.log", "process-stream-errors.log", "update-worker.log",
  "daemon.stdout.log", "daemon.stderr.log", "tunnel.stdout.log", "tunnel.stderr.log"];
const ARCHIVE = /^(?:launcher|launcher-fatal|process-stream-errors|update-worker|(?:daemon|tunnel)\.(?:stdout|stderr))\.\d{13}-[a-f0-9-]+\.(?:jsonl|log)$/;

function plain(file) {
  let current = path.resolve(file);
  for (;;) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error("Refusing redirected log path");
    if (current === path.parse(current).root) break;
    current = path.dirname(current);
  }
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error("Refusing non-private log file");
  return stat;
}
function archivePath(file, now) {
  const extension = path.extname(file);
  return `${file.slice(0, -extension.length)}.${now}-${randomUUID()}${extension}`;
}
function managedLogFiles(file) {
  const directory = path.dirname(file), name = path.basename(file);
  const stem = name.slice(0, -path.extname(name).length);
  try {
    return fs.readdirSync(directory).filter(candidate => candidate === name
      || (candidate.startsWith(stem + ".") && ARCHIVE.test(candidate))).map(candidate => path.join(directory, candidate));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
function pruneLogDirectory(directory, now = Date.now()) {
  if (!fs.existsSync(directory)) return;
  const entries = fs.readdirSync(directory).filter(name => ACTIVE.includes(name) || name === "launcher.jsonl.1" || ARCHIVE.test(name));
  let retained = 0;
  const archives = [];
  for (const name of entries) {
    const file = path.join(directory, name), stat = plain(file);
    if (!stat) continue;
    if (ACTIVE.includes(name)) retained += stat.size;
    else archives.push({ file, size: stat.size, at: stat.mtimeMs });
  }
  for (const archive of archives.sort((a, b) => b.at - a.at)) {
    if (archive.at < now - RETENTION_DAYS * 86400000 || retained + archive.size > MAX_RETAINED_BYTES) fs.unlinkSync(archive.file);
    else retained += archive.size;
  }
}
function appendBoundedLog(file, text) {
  if (!ACTIVE.includes(path.basename(file))) throw new Error("Unknown managed log");
  const stat = plain(file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const data = Buffer.from(text);
  const line = data.length > 64 * 1024 ? data.subarray(data.length - 64 * 1024) : data;
  if (stat && stat.size + line.length > MAX_LOG_BYTES) fs.renameSync(file, archivePath(file, Date.now()));
  fs.appendFileSync(file, line, { mode: 0o600 });
  pruneLogDirectory(path.dirname(file));
}

// launchd holds stdout/stderr descriptors open: retain a bounded tail and truncate
// the same inode, instead of renaming a file the service would keep writing forever.
function maintainLogDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  for (const name of ACTIVE.filter(name => name !== "launcher.jsonl")) {
    const file = path.join(directory, name), stat = plain(file);
    if (!stat || stat.size < MAX_LOG_BYTES) continue;
    const descriptor = fs.openSync(file, "r+");
    try {
      const tail = Buffer.alloc(MAX_LOG_BYTES);
      const read = fs.readSync(descriptor, tail, 0, tail.length, Math.max(0, stat.size - tail.length));
      fs.writeFileSync(archivePath(file, Date.now()), tail.subarray(0, read), { flag: "wx", mode: 0o600 });
      fs.ftruncateSync(descriptor, 0);
    } finally { fs.closeSync(descriptor); }
  }
  pruneLogDirectory(directory);
}
function startLogMaintenance(directories, onError = () => {}) {
  const maintain = () => {
    for (const directory of directories) {
      try { maintainLogDirectory(directory); } catch (error) { onError(error); }
    }
  };
  maintain();
  const timer = setInterval(maintain, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { MAX_LOG_BYTES, MAX_RETAINED_BYTES, RETENTION_DAYS, appendBoundedLog,
  pruneLogDirectory, maintainLogDirectory, startLogMaintenance, managedLogFiles };
