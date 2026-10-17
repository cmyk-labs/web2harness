const fs = require("node:fs");
const path = require("node:path");

const { RETENTION_DAYS, MAX_RETAINED_BYTES, pruneLogDirectory } = require("../../shared/log-retention.cjs");
const ARCHIVE = /^launcher\.\d{13}-[a-f0-9-]+\.jsonl$/;
function logFiles(filePath) {
  const directory = path.dirname(filePath);
  let names;
  try { names = fs.readdirSync(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return names.filter(name => name === path.basename(filePath) || name === `${path.basename(filePath)}.1` || ARCHIVE.test(name))
    .map(name => path.join(directory, name));
}
function pruneLogs(filePath, now = Date.now()) {
  pruneLogDirectory(path.dirname(filePath), now);
}
module.exports = { logFiles, pruneLogs, RETENTION_DAYS, MAX_RETAINED_BYTES };
