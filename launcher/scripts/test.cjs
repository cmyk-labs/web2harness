const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const launcherRoot = path.resolve(__dirname, "..");
const testsRoot = path.join(launcherRoot, "tests");

// Discover only the maintained fixture tree, never generated packages or local evidence.
function collectTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(filename);
    return entry.isFile() && entry.name.endsWith(".test.cjs") ? [filename] : [];
  });
}

const files = collectTests(testsRoot).sort();
if (files.length === 0) throw new Error(`No launcher tests found under ${testsRoot}`);
const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], {
  cwd: launcherRoot,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`Launcher test runner terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
