const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { stageShortcutIcon, setShortcutIcons, removeSetupAssets } = require("../../electron/installation/windows-shortcuts.cjs");
const { createSetupReporter } = require("../../electron/installation/setup-progress.cjs");
const { recordPaths } = require("../../electron/installation/installation-record.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "w2h-shortcut-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root), /^w2h-shortcut-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, appData: path.join(root, "roaming"), installRoot: path.join(root, "application"),
    version: "1.0.1", language: "zh-CN", shortcutIconSource: path.resolve(__dirname, "../../../assets/brand/icon.ico") };
}

test("shortcut icons survive executable replacement and do not overwrite earlier icon revisions", t => {
  const options = fixture(t);
  const icon = stageShortcutIcon(options);
  assert.ok(icon.startsWith(recordPaths(options.appData, options.installRoot).directory));
  fs.mkdirSync(options.installRoot);
  fs.writeFileSync(path.join(options.installRoot, "Web2Harness.exe"), "old");
  fs.unlinkSync(path.join(options.installRoot, "Web2Harness.exe"));
  assert.deepEqual(fs.readFileSync(icon), fs.readFileSync(options.shortcutIconSource));
  assert.equal(stageShortcutIcon(options), icon);
  const other = path.join(options.root, "next.ico");
  fs.writeFileSync(other, Buffer.concat([fs.readFileSync(options.shortcutIconSource), Buffer.from("revision")]));
  assert.notEqual(stageShortcutIcon({ ...options, shortcutIconSource: other }), icon);
  fs.writeFileSync(icon, "corrupt");
  assert.throws(() => stageShortcutIcon(options), /verification/);
  assert.throws(() => stageShortcutIcon({ ...options, shortcutIconSource: icon }), /ICO/);
  const directory = path.dirname(icon), evidence = path.join(directory, "unrelated.txt");
  fs.writeFileSync(evidence, "keep");
  removeSetupAssets(directory);
  assert.deepEqual(fs.readdirSync(directory), ["unrelated.txt"]);
});

test("setup reports localized real stages and persists bounded fields without private paths", t => {
  const options = fixture(t), lines = [];
  const report = createSetupReporter(options, line => lines.push(line));
  report({ stage: "saving-application", status: "running", elapsedMs: 0, secret: "never-log" });
  report({ stage: "saving-application", status: "completed", elapsedMs: 3250 });
  report({ stage: "deploying-runtime", status: "failed", elapsedMs: 42 });
  assert.match(lines.join(""), /备份当前应用/);
  assert.match(lines.join(""), /完成 3.3s/);
  assert.match(lines.join(""), /失败/);
  const log = fs.readFileSync(path.join(recordPaths(options.appData, options.installRoot).directory, "setup-timings.jsonl"), "utf8");
  assert.equal(log.includes(options.root), false);
  assert.equal(log.includes("never-log"), false);
  assert.equal(JSON.parse(log.trim().split("\n")[1]).elapsedMs, 3250);
});

test("Windows changes only owned fixture shortcut icons, preserving targets, arguments and unrelated links", {
  skip: process.platform !== "win32",
}, t => {
  const options = fixture(t), icon = stageShortcutIcon(options);
  const own = path.join(options.root, "owned.lnk"), other = path.join(options.root, "other.lnk"), absent = path.join(options.root, "absent.lnk");
  const target = path.join(options.installRoot, "Web2Harness.exe");
  // Only private fixture links: no desktop, start-menu, registry or installed application access.
  function powershell(script) {
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", windowsHide: true, env: { ...process.env, W2H_FIXTURE: JSON.stringify({ own, other, target }) },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const input = "$ErrorActionPreference='Stop'; $f=$env:W2H_FIXTURE | ConvertFrom-Json; $s=New-Object -ComObject WScript.Shell;";
  powershell(input + "$l=$s.CreateShortcut($f.own); $l.TargetPath=$f.target; $l.Arguments='--fixture'; $l.Save(); $l=$s.CreateShortcut($f.other); $l.TargetPath='C:\\Windows\\notepad.exe'; $l.Save()");
  const before = fs.readFileSync(other);
  setShortcutIcons(options.installRoot, icon, [own, other, absent]);
  assert.deepEqual(fs.readFileSync(other), before);
  assert.equal(fs.existsSync(absent), false);
  const actual = JSON.parse(powershell(input + "$l=$s.CreateShortcut($f.own); @{target=$l.TargetPath; arguments=$l.Arguments; icon=$l.IconLocation} | ConvertTo-Json -Compress"));
  assert.equal(actual.target, target);
  assert.equal(actual.arguments, "--fixture");
  assert.equal(actual.icon, `${icon},0`);
});
