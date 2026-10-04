const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { resolveLauncherProfile } = require("../../electron/profile.cjs");
const { registerInstallation } = require("../../electron/installation/installation-record.cjs");
const { capturePackageSmokeFailure } = require("../../scripts/package-smoke-diagnostics.cjs");

const script = path.resolve(__dirname, "../../scripts/smoke-package.cjs");
const source = fs.readFileSync(script, "utf8");
const originalRequire = createRequire(script);

function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-smoke-fixture-"));
  try { action(root); } finally {
    assert.equal(fs.realpathSync(path.dirname(root)), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("web2harness-smoke-fixture-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Execute the actual harness with fixture processes, never an installer or desktop app.
function runWindowsHarness(root, { fail = false, exportFails = false } = {}) {
  const launcher = path.join(root, "launcher");
  const temp = path.join(root, "temp");
  fs.mkdirSync(path.join(launcher, "artifacts"), { recursive: true });
  fs.mkdirSync(temp);
  fs.writeFileSync(path.join(launcher, "package.json"), JSON.stringify({ version: "6.0.0",
    build: { productName: "Web2Harness", nsis: { guid: "fixture" } } }));
  fs.writeFileSync(path.join(launcher, "artifacts", "web2harness-6.0.0-win-x64.exe"), "fixture");
  const options = { homeDir: path.join(root, "user"), appData: path.join(root, "roaming"),
    localAppData: path.join(root, "local"), installRoot: path.join(root, "installed") };
  for (const location of Object.values(options)) fs.mkdirSync(location);
  const executable = path.join("C:\\smoke-fixture", "Web2Harness.exe");
  const calls = [];
  let validated = false;
  let stdout = "";
  let stderr = "";
  let thrown;
  function spawnSync(command, args, invocation) {
    if (command === "reg.exe") return { status: 0, stdout: "InstallLocation REG_SZ C:\\smoke-fixture\n" };
    calls.push({ command, args, env: invocation.env });
    const profile = resolveLauncherProfile({ ...options, argv: [], env: invocation.env });
    registerInstallation({ ...options, profile });
    if (args[0] === "/S") return { status: 0, stdout: "fixture installed", stderr: "" };
    assert.equal(command, executable);
    if (fail) {
      const logs = path.join(profile.userData, "logs");
      fs.mkdirSync(logs, { recursive: true });
      fs.writeFileSync(path.join(logs, "launcher-fatal.log"), "fixture fatal error sk-fixtureSecret123456789\n");
      fs.writeFileSync(path.join(profile.userData, "storage-state.json"), "PRIVATE_PROFILE_SENTINEL");
      return { status: 1, stdout: "fixture stdout diagnostic", stderr: "fixture stderr diagnostic" };
    }
    fs.writeFileSync(invocation.env.WEB2HARNESS_SMOKE_FILE, JSON.stringify({ ok: true,
      packaged: true, runtimeVerified: true, version: "6.0.0", platform: "win32" }));
    const installed = path.join(profile.coreHome, "versions", "6.0.0-win32-x64");
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ schemaVersion: 2,
      appVersion: "6.0.0", platform: "win32", arch: "x64", files: [{ path: "fixture" }], bundleId: "a".repeat(64) }));
    return { status: 0, stdout: "", stderr: "" };
  }
  try {
    vm.runInNewContext(source, {
      __dirname: path.join(launcher, "scripts"),
      process: { platform: "win32", arch: "x64", env: {},
        stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } },
      require(name) {
        if (name === "node:fs") return { ...fs, existsSync: file => file === executable || fs.existsSync(file) };
        if (name === "node:os") return { tmpdir: () => temp };
        if (name === "node:child_process") return { spawnSync };
        if (name === "../electron/installation/runtime-install.cjs") return { validateRuntimeBundle: () => { validated = true; } };
        if (exportFails && name === "./package-smoke-diagnostics.cjs") {
          return { capturePackageSmokeFailure: () => { throw new Error("fixture export denied"); } };
        }
        return originalRequire(name);
      },
    }, { filename: script });
  } catch (error) { thrown = error; }
  return { calls, validated, stdout, stderr, thrown, temp, diagnostics: path.join(root, "output", "package-smoke") };
}

test("Windows package smoke installs and starts with the same isolated profile", () => fixture(root => {
  const result = runWindowsHarness(root);
  assert.equal(result.thrown, undefined);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].env, result.calls[1].env);
  assert.equal(result.validated, true);
  assert.match(result.stdout, /PACKAGED_LAUNCHER_SMOKE_OK win32\/x64/);
  assert.deepEqual(fs.readdirSync(result.temp), []);
  assert.equal(fs.existsSync(result.diagnostics), false);
}));

test("failed package smoke retains sanitized diagnostics before removing its temporary profile", () => fixture(root => {
  const result = runWindowsHarness(root, { fail: true });
  assert.match(result.thrown?.message, /failed with status 1/);
  assert.doesNotMatch(result.stdout, /SMOKE_OK/);
  assert.match(result.stderr, /Package smoke diagnostics:/);
  assert.deepEqual(fs.readdirSync(result.temp), []);
  const reportDirectory = path.join(result.diagnostics, fs.readdirSync(result.diagnostics)[0]);
  assert.deepEqual(fs.readdirSync(reportDirectory).sort(), ["failure.json", "launcher-fatal.log"]);
  const report = fs.readFileSync(path.join(reportDirectory, "failure.json"), "utf8");
  assert.match(report, /fixture stdout diagnostic/);
  assert.match(report, /fixture stderr diagnostic/);
  const fatal = fs.readFileSync(path.join(reportDirectory, "launcher-fatal.log"), "utf8");
  assert.match(fatal, /fixture fatal error/);
  assert.doesNotMatch(fatal + report, /fixtureSecret|PRIVATE_PROFILE_SENTINEL/);
}));

test("diagnostic export failure preserves the original smoke error and owned workspace", () => fixture(root => {
  const result = runWindowsHarness(root, { fail: true, exportFails: true });
  assert.match(result.thrown?.message, /failed with status 1/);
  assert.match(result.stderr, /fixture export denied/);
  assert.match(result.stderr, /Retained smoke directory:/);
  assert.equal(fs.readdirSync(result.temp).length, 1);
}));

test("smoke diagnostic export refuses logs linked outside its owned workspace", () => fixture(root => {
  const scratch = path.join(root, "scratch");
  const outside = path.join(root, "outside");
  fs.mkdirSync(path.join(scratch, "launcher-data"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "launcher-fatal.log"), "OUTSIDE_LOG_SENTINEL");
  fs.symlinkSync(outside, path.join(scratch, "launcher-data", "logs"), process.platform === "win32" ? "junction" : "dir");
  const output = capturePackageSmokeFailure({ scratch, outputDirectory: path.join(root, "reports"),
    error: new Error("fixture failure"), commands: [] });
  assert.deepEqual(fs.readdirSync(output), ["failure.json"]);
  const report = JSON.parse(fs.readFileSync(path.join(output, "failure.json"), "utf8"));
  assert.equal(report.logErrors.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /OUTSIDE_LOG_SENTINEL/);
}));
