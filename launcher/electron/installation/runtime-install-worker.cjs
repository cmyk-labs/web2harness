const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const { preparePackagedRuntime, checkPackagedRuntimeReady, validateRuntimeBundle } = require("./runtime-install.cjs");

const { version, coreHome, resourcesPath, verifyRoot, startupOnly } = workerData;
Promise.resolve().then(() => verifyRoot
  ? validateRuntimeBundle(verifyRoot, { version, platform: process.platform, arch: process.arch })
  : (startupOnly ? checkPackagedRuntimeReady : preparePackagedRuntime)({ app: { isPackaged: true, getVersion: () => version }, coreHome, resourcesPath,
    onProgress: progress => parentPort.postMessage({ type: "progress", progress }),
  }))
  .then(runtimeRoot => parentPort.postMessage({ runtimeRoot }), error => {
    let message = error instanceof Error ? error.message : String(error);
    if (verifyRoot) {
      // Do not replace code under an active runtime. Invalidate only our installation receipt;
      // the next launch verifies and repairs transactionally before starting any helper.
      try { fs.rmSync(`${verifyRoot}.verified.json`, { force: true }); }
      catch (receiptError) { message += `; could not mark repair: ${receiptError.message}`; }
      message += process.platform === "win32"
        ? "; close Web2Harness and run its installer to repair / 请退出应用后运行安装程序修复"
        : "; restart Web2Harness to verify and repair the runtime";
    }
    parentPort.postMessage({ error: message, errorCode: error?.code, errorReason: error?.reason });
  });
