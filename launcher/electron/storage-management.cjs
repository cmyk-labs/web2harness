const fs = require("node:fs/promises");
const path = require("node:path");
const { assertPlainPath } = require("./installation/installation-record.cjs");

async function directoryBytes(root) {
  assertPlainPath(root);
  let bytes = 0;
  const pending = [root];
  while (pending.length) {
    const file = pending.pop();
    let stat;
    try { stat = await fs.lstat(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(file)) pending.push(path.join(file, name));
    } else if (stat.isFile()) bytes += stat.size;
  }
  return bytes;
}

function createStorageManager({ coreHome, logsDirectory, sessions, whileIdle = action => action() }) {
  let measuring = null;
  let clearing = false;
  const measure = () => {
    if (measuring) return measuring;
    const operation = (async () => {
      const owned = [...new Set(sessions())];
      let httpCacheBytes = 0, codeCacheBytes = 0, siteDataBytes = 0;
      for (const session of owned) {
        const root = session.getStoragePath();
        if (!root) continue;
        const [http, code, total, diskHttp] = await Promise.all([
          session.getCacheSize(), directoryBytes(path.join(root, "Code Cache")),
          // The shell's root contains nested persistent partitions; measure those separately.
          fs.readdir(root).then(async names => {
            let size = 0;
            for (const name of names) {
              if (["Partitions", "logs"].includes(name)) continue;
              size += await directoryBytes(path.join(root, name));
            }
            return size;
          }).catch(error => { if (error.code === "ENOENT") return 0; throw error; }),
          directoryBytes(path.join(root, "Cache")),
        ]);
        httpCacheBytes += http; codeCacheBytes += code;
        siteDataBytes += Math.max(0, total - diskHttp - code);
      }
      const [runtimeBytes, launcherLogs, runtimeLogs] = await Promise.all([
        directoryBytes(path.join(coreHome, "versions")), directoryBytes(logsDirectory), directoryBytes(path.join(coreHome, "logs")),
      ]);
      return { runtimeBytes, httpCacheBytes, codeCacheBytes, siteDataBytes, logBytes: launcherLogs + runtimeLogs,
        measuredAt: new Date().toISOString() };
    })();
    measuring = operation;
    operation.finally(() => { if (measuring === operation) measuring = null; }).catch(() => {});
    return operation;
  };
  return {
    measure,
    async clearCaches() {
      if (clearing) throw new Error("Cache cleanup is already running / 缓存清理正在进行");
      clearing = true;
      try {
        await whileIdle(async () => {
          for (const session of [...new Set(sessions())]) {
            // Never clearStorageData: cookies, IndexedDB, local storage and service workers survive.
            await session.clearCache();
            await session.clearCodeCaches({});
          }
        });
        if (measuring) await measuring;
        return await measure();
      } finally { clearing = false; }
    },
  };
}
module.exports = { createStorageManager, directoryBytes };
