const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

/** One running query plus one replaceable pending query; no unbounded history-reader queue. */
function createHistoryService(options, { timeoutMs = 120000 } = {}) {
  let worker = null, directory = null, active = null, pending = null, serial = 0, closed = false, resetting = null;
  function settle(job, error, result) {
    clearTimeout(job.timer);
    if (job.superseded) job.resolve({ records: [], total: 0, available: { start: null, end: null }, partial: false, superseded: true });
    else if (error) job.reject(error);
    else job.resolve(result);
  }
  function removeOwnedDirectory(target) {
    if (!target || path.dirname(target) !== fs.realpathSync(os.tmpdir()) || !path.basename(target).startsWith("web2harness-history-")) throw new Error("Unsafe history cache directory");
    fs.rmSync(target, { recursive: true, force: true });
  }
  function reset(error) {
    if (resetting) return resetting;
    const previous = worker, oldDirectory = directory;
    worker = null; directory = null;
    if (active) { settle(active, error); active = null; }
    resetting = (async () => {
      if (previous) { previous.removeAllListeners(); await previous.terminate(); }
      if (oldDirectory) removeOwnedDirectory(oldDirectory);
    })().finally(() => { resetting = null; if (!closed) pump(); });
    return resetting;
  }
  function startWorker() {
    directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "web2harness-history-"));
    if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
    worker = new Worker(path.join(__dirname, "history-worker.cjs"), { workerData: { options, directory } });
    worker.on("message", message => {
      if (!active || active.id !== message.id) return;
      const job = active; active = null;
      if (message.code === "HISTORY_SUPERSEDED") job.superseded = true;
      settle(job, message.error ? new Error(message.error) : null, message.result); pump();
    });
    worker.on("error", error => { void reset(error); });
    worker.on("exit", code => { void reset(new Error(`History worker exited (${code})`)); });
    worker.unref();
  }
  function pump() {
    if (closed || resetting || active || !pending) return;
    active = pending; pending = null;
    const job = active;
    try {
      if (!worker) startWorker();
      job.timer = setTimeout(() => { void reset(new Error("Log query timed out")); }, timeoutMs);
      worker.postMessage({ id: job.id, input: job.input, cancellation: job.flag.buffer });
    } catch (error) { void reset(error); }
  }
  return {
    query(input = {}) {
      if (closed) return Promise.reject(new Error("History reader is closed"));
      return new Promise((resolve, reject) => {
        if (active) { active.superseded = true; Atomics.store(active.flag, 0, 1); }
        if (pending) { pending.superseded = true; settle(pending); }
        pending = { id: ++serial, input, resolve, reject, flag: new Int32Array(new SharedArrayBuffer(4)) };
        pump();
      });
    },
    async close() {
      closed = true;
      if (pending) { pending.superseded = true; settle(pending); pending = null; }
      await reset(new Error("History reader closed"));
    },
  };
}
module.exports = { createHistoryService };
