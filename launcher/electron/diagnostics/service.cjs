const path = require("node:path");
const { Worker } = require("node:worker_threads");
function runDiagnostics(job, options, input, destination, snapshot) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "worker.cjs"), { workerData: { job, options, input, destination, snapshot } });
    let finished = false;
    const timer = setTimeout(() => { worker.terminate(); finish(new Error("Diagnostic collection timed out")); }, 120000);
    function finish(error, result) { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
    worker.once("message", message => finish(message.error ? new Error(message.error) : null, message.result));
    worker.once("error", error => finish(error));
    worker.once("exit", code => { if (!finished) finish(new Error(`Diagnostic worker exited (${code})`)); });
  });
}
module.exports = { runDiagnostics };
