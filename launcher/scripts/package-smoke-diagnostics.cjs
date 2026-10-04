const fs = require("node:fs");
const path = require("node:path");
const { redactExportText, sanitizeForExport } = require("../electron/logging.cjs");

const MAX_LOG_BYTES = 1024 * 1024;
const LOG_FILES = ["launcher.jsonl", "launcher-fatal.log", "process-stream-errors.log"];

function readLogTail(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, MAX_LOG_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    return size > length ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Export only smoke-owned diagnostics; never copy the browser profile or environment. */
function capturePackageSmokeFailure({ scratch, outputDirectory, error, commands }) {
  const root = fs.realpathSync(scratch);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const destination = fs.mkdtempSync(path.join(outputDirectory, `${process.platform}-`));
  const report = { error: error.stack || String(error), commands, logs: [], logErrors: [] };
  for (const name of LOG_FILES) {
    const file = path.join(scratch, "launcher-data", "logs", name);
    try {
      const actual = fs.realpathSync(file);
      const relative = path.relative(root, actual);
      if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)
        || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) {
        throw new Error("Diagnostic log is outside the owned smoke directory or is not a plain file");
      }
      const sanitized = readLogTail(file).split(/\r?\n/).map(line => {
        if (name.endsWith(".jsonl")) {
          try { return JSON.stringify(sanitizeForExport(JSON.parse(line))); } catch {}
        }
        return redactExportText(line);
      }).join("\n");
      fs.writeFileSync(path.join(destination, name), sanitized, { mode: 0o600 });
      report.logs.push(name);
    } catch (caught) {
      if (caught.code !== "ENOENT") report.logErrors.push({ name, error: caught.message });
    }
  }
  fs.writeFileSync(path.join(destination, "failure.json"),
    JSON.stringify(sanitizeForExport(report), null, 2) + "\n", { mode: 0o600 });
  return destination;
}

module.exports = { capturePackageSmokeFailure };
