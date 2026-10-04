const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

test("setup registration recovery is scoped to the package identity and transports paths as data", () => {
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname, "../../electron/installation/windows-registration.cjs"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, process, require(name) {
    if (name === "node:child_process") return { spawnSync: (...args) => { calls.push(args); return { status: 0 }; } };
    return require(name);
  } });
  const manifest = require("../../package.json");
  assert.equal(module.exports.INSTALL_GUID, manifest.build.nsis.guid);
  const target = path.join(__dirname, "fixture $(must-not-run).json");
  module.exports.captureRegistration(target);
  assert.equal(calls[0][2].env.WEB2HARNESS_SETUP_SNAPSHOT, target);
  assert.equal(calls[0][1].at(-1).includes(target), false);
  assert.equal(calls[0][2].windowsHide, true);
});

test("Windows PowerShell parses setup snapshot and restore scripts without running them", { skip: process.platform !== "win32" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-registry-syntax-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = path.join(root, "snapshot.json"); fs.writeFileSync(snapshot, "{}");
  const scripts = [], module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../electron/installation/windows-registration.cjs"), "utf8"), {
    module, process, require(name) {
      if (name === "node:child_process") return { spawnSync: (_file, args) => { scripts.push(args.at(-1)); return { status: 0 }; } };
      return require(name);
    },
  });
  module.exports.captureRegistration(snapshot); module.exports.restoreRegistration(snapshot);
  for (let index = 0; index < scripts.length; index++) {
    const file = path.join(root, `script-${index}.ps1`); fs.writeFileSync(file, scripts[index]);
    const result = spawnSync(path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; [void][scriptblock]::Create([IO.File]::ReadAllText($env:WEB2HARNESS_SYNTAX_FILE))"],
      { env: { ...process.env, WEB2HARNESS_SYNTAX_FILE: file }, windowsHide: true, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
  }
});
