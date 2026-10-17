const { parentPort, workerData } = require("node:worker_threads");
const { collectRuntimeVersions } = require("./runtime-retention.cjs");
parentPort.postMessage(collectRuntimeVersions(workerData));
