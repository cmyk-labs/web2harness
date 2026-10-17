const path = require("node:path");
const { Worker } = require("node:worker_threads");

function retainRuntimeVersions(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "../installation/runtime-retention-worker.cjs"), { workerData: options });
    let result;
    worker.on("message", value => { result = value; });
    worker.once("error", reject);
    worker.once("exit", code => code === 0 && result ? resolve(result) : reject(new Error(`Runtime retention worker exited (${code})`)));
  });
}
module.exports = { retainRuntimeVersions };
