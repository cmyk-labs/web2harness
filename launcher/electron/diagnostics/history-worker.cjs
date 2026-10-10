const { parentPort, workerData } = require("node:worker_threads");
const { createHistoryIndex } = require("./history-index.cjs");
const index = createHistoryIndex(workerData.options, workerData.directory);
parentPort.on("message", ({ id, input, cancellation }) => {
  try {
    const flag = new Int32Array(cancellation);
    const result = index.query(input, { cancelled: () => Atomics.load(flag, 0) !== 0 });
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: error.message, code: error.code }); }
});
