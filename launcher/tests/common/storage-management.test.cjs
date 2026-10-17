const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStorageManager } = require("../../electron/storage-management.cjs");
const { RequestQueue } = require("../../electron/runtime/request-queue.cjs");

function fixture(t, whileIdle) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w2h-storage-"));
  t.after(() => { assert.match(path.basename(root), /^w2h-storage-/); fs.rmSync(root, { recursive: true, force: true }); });
  const profile = path.join(root, "profile"), coreHome = path.join(root, "core");
  for (const file of ["Cache/data", "Code Cache/code", "Cookies", "Local Storage/data", "IndexedDB/data"]) {
    fs.mkdirSync(path.dirname(path.join(profile, file)), { recursive: true }); fs.writeFileSync(path.join(profile, file), "1234");
  }
  const calls = [];
  const session = { getStoragePath: () => profile, getCacheSize: async () => fs.statSync(path.join(profile, "Cache/data")).size,
    clearCache: async () => { calls.push("http"); fs.writeFileSync(path.join(profile, "Cache/data"), ""); },
    clearCodeCaches: async options => { assert.deepEqual(options, {}); calls.push("code"); fs.writeFileSync(path.join(profile, "Code Cache/code"), ""); },
    clearStorageData: () => assert.fail("Authentication and site data must not be cleared") };
  return { profile, calls, manager: createStorageManager({ coreHome, logsDirectory: path.join(profile, "logs"), sessions: () => [session, session], whileIdle }) };
}
test("cache cleanup only clears HTTP and code, preserving login and site data", async t => {
  const f = fixture(t), before = await f.manager.measure();
  assert.equal(before.httpCacheBytes, 4); assert.equal(before.codeCacheBytes, 4); assert.equal(before.siteDataBytes, 12);
  const after = await f.manager.clearCaches();
  assert.deepEqual(f.calls, ["http", "code"]);
  assert.equal(after.httpCacheBytes + after.codeCacheBytes, 0);
  for (const file of ["Cookies", "Local Storage/data", "IndexedDB/data"]) assert.equal(fs.readFileSync(path.join(f.profile, file), "utf8"), "1234");
});
test("failed idle admission leaves all caches untouched", async t => {
  const f = fixture(t, async () => { throw new Error("active task"); });
  await assert.rejects(f.manager.clearCaches(), /active task/);
  assert.deepEqual(f.calls, []);
});
test("idle maintenance excludes simultaneous clears and releases admission after errors", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = Object.assign(Object.create(RequestQueue.prototype), { tail: Promise.resolve(), snapshot: () => ({ active: 0, waiting: 0 }) });
  const f = fixture(t, action => queue.whileIdle(async () => { await gate; return action(); }));
  const first = f.manager.clearCaches();
  await assert.rejects(f.manager.clearCaches(), /already running/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(queue.admissionBlocked, true);
  release(); await first; assert.equal(queue.admissionBlocked, false);
  queue.snapshot = () => ({ active: 1, waiting: 0 });
  await assert.rejects(f.manager.clearCaches(), /tasks are idle/);
});
