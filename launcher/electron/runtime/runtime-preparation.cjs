const path = require("node:path");
const { Worker } = require("node:worker_threads");

function prepareRuntimeInBackground({ app, coreHome, resourcesPath, verifyRoot, startupOnly = false, onProgress }) {
  if (!app.isPackaged) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "../installation/runtime-install-worker.cjs"), {
      workerData: { version: app.getVersion(), coreHome, resourcesPath, verifyRoot, startupOnly },
    });
    let result;
    worker.on("message", message => {
      if (message.type === "progress") onProgress?.(message.progress);
      else result = message;
    });
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code !== 0 || !result || result.error || typeof result.runtimeRoot !== "string") {
        reject(Object.assign(new Error(result?.error || `Runtime preparation worker exited without a result (${code})`), {
          code: result?.errorCode, reason: result?.errorReason,
        }));
      } else resolve(result.runtimeRoot);
    });
  });
}

module.exports = { prepareRuntimeInBackground };
