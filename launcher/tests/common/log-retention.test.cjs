const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { appendBoundedLog, maintainLogDirectory, pruneLogDirectory, managedLogFiles, MAX_LOG_BYTES } = require("../../shared/log-retention.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "w2h-log-retention-"));
  t.after(() => { assert.match(path.basename(root), /^w2h-log-retention-/); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test("all helper logs rotate, and expired archives are removed while unknown files survive", t => {
  const root = fixture(t);
  for (const name of ["launcher-fatal.log", "process-stream-errors.log", "update-worker.log"]) {
    const file = path.join(root, name); fs.writeFileSync(file, Buffer.alloc(MAX_LOG_BYTES));
    appendBoundedLog(file, "new error\n");
    assert.equal(managedLogFiles(file).length, 2);
    assert.equal(fs.readFileSync(file, "utf8"), "new error\n");
  }
  const other = path.join(root, "keep.txt"); fs.writeFileSync(other, "keep");
  pruneLogDirectory(root, Date.now() + 8 * 86400000);
  assert.equal(fs.readdirSync(root).length, 4); assert.equal(fs.readFileSync(other, "utf8"), "keep");
});
test("launchd log rotation retains a bounded tail and preserves the open inode", t => {
  const root = fixture(t), file = path.join(root, "tunnel.stdout.log");
  fs.writeFileSync(file, Buffer.alloc(MAX_LOG_BYTES + 100, 65));
  const writer = fs.openSync(file, "a"), inode = fs.statSync(file).ino;
  try {
    maintainLogDirectory(root);
    fs.writeSync(writer, "after rotation\n");
    assert.equal(fs.statSync(file).ino, inode);
    assert.equal(fs.readFileSync(file, "utf8"), "after rotation\n");
    const archive = managedLogFiles(file).find(candidate => candidate !== file);
    assert.equal(fs.statSync(archive).size, MAX_LOG_BYTES);
  } finally { fs.closeSync(writer); }
});
test("oversized helper messages are bounded and hard-linked destinations are refused", t => {
  const root = fixture(t), file = path.join(root, "launcher-fatal.log");
  appendBoundedLog(file, "e".repeat(MAX_LOG_BYTES * 2));
  assert.ok(fs.statSync(file).size <= 64 * 1024);
  const link = path.join(root, "process-stream-errors.log"); fs.linkSync(file, link);
  assert.throws(() => appendBoundedLog(link, "write"), /non-private/);
});

test("the directory byte budget and diagnostic export include helper archives", t => {
  const root = fixture(t), older = path.join(root, `launcher-fatal.${Date.now() - 1000}-aaaa.log`);
  const newer = path.join(root, `update-worker.${Date.now()}-bbbb.log`);
  for (const file of [older, newer]) {
    fs.writeFileSync(file, ""); fs.truncateSync(file, 60 * 1024 * 1024);
  }
  fs.utimesSync(older, new Date(Date.now() - 1000), new Date(Date.now() - 1000));
  pruneLogDirectory(root); assert.equal(fs.existsSync(older), false); assert.equal(fs.existsSync(newer), true);
  fs.writeFileSync(newer, "2026-10-17T10:00:00.000Z update complete\n");
  const { collectDiagnostics } = require("../../electron/diagnostics/bundle.cjs");
  const result = collectDiagnostics({ logsDirectory: root, coreHome: root });
  assert.ok(result.records.some(record => record.event === "update.worker" && record.detail.message === "update complete"));
});
