const { parentPort, workerData } = require("node:worker_threads");
const { queryLogs, exportBundle } = require("./bundle.cjs");
try {
  const { job, options, input, destination, snapshot } = workerData;
  const result = job === "export" ? exportBundle(options, input, destination, snapshot) : queryLogs(options, input);
  parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: error.message }); }
