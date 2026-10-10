const fs = require("node:fs");
const path = require("node:path");

const RETENTION_DAYS = 7;
const MAX_RETAINED_BYTES = 100 * 1024 * 1024;
const ARCHIVE = /^launcher\.\d{13}-[a-f0-9-]+\.jsonl$/;
function logFiles(filePath) {
  const directory = path.dirname(filePath);
  let names;
  try { names = fs.readdirSync(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return names.filter(name => name === path.basename(filePath) || name === `${path.basename(filePath)}.1` || ARCHIVE.test(name))
    .map(name => path.join(directory, name));
}
function pruneLogs(filePath, now = Date.now()) {
  const root = fs.realpathSync(path.dirname(filePath));
  const archives = logFiles(filePath).filter(file => file !== filePath).flatMap(file => {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.dirname(fs.realpathSync(file)) === root
      ? [{ file, size: stat.size, at: stat.mtimeMs }] : [];
  }).sort((a, b) => b.at - a.at);
  let retained = fs.statSync(filePath, { throwIfNoEntry: false })?.size ?? 0;
  for (const archive of archives) {
    if (archive.at < now - RETENTION_DAYS * 86400000 || retained + archive.size > MAX_RETAINED_BYTES) fs.unlinkSync(archive.file);
    else retained += archive.size;
  }
}
module.exports = { logFiles, pruneLogs, RETENTION_DAYS, MAX_RETAINED_BYTES };
