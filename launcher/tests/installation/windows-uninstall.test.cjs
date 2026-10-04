const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { registerInstallation, loadInstallation, cleanupTargets, removeOwnedData, recordPaths, OWNER_FILE, uninstallInProgress } = require("../../electron/installation/installation-record.cjs");
const { prepareUninstall, finishUninstall, runPowerShell } = require("../../electron/installation/windows-uninstall.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "web2harness-uninstall-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { homeDir: root, appData: path.join(root, "AppData"), localAppData: path.join(root, "LocalAppData"),
    installRoot: path.join(root, "install"), ownerPid: process.pid };
  const profile = { coreHome: path.join(root, ".web2harness"), codexHome: path.join(root, ".codex"), userData: path.join(options.appData, "Web2Harness") };
  for (const directory of [options.installRoot, options.appData, profile.codexHome]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(profile.codexHome, "auth.json"), "private-fixture-auth");
  const record = registerInstallation({ ...options, profile });
  fs.writeFileSync(path.join(record.installerCache, "installer.exe"), "fixture-installer-cache");
  fs.mkdirSync(path.join(profile.coreHome, "versions"));
  fs.writeFileSync(path.join(profile.coreHome, "versions", "fixture-runtime"), "fixture-runtime");
  fs.writeFileSync(path.join(profile.coreHome, "config.json"), '{"fixture":true}');
  fs.writeFileSync(path.join(profile.userData, "launcher-state.json"), JSON.stringify({ version: 1, language: "zh-CN", coreSetupComplete: true, autoStart: true }));
  const calls = [];
  const services = Object.fromEntries(["assertLauncherClosed", "preflightIntegration", "stopRuntime", "removeIntegration", "removeAutostart"].map(name => [name, async () => { calls.push(name); }]));
  return { root, options, profile, record, calls, services };
}

test("ordinary uninstall detaches while preserving runtime, browser data, preferences and Codex", async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.profile.userData, "Partitions"));
  fs.writeFileSync(path.join(f.profile.userData, "Partitions", "fixture-cookie"), "fixture-cookie");
  await prepareUninstall(f.options, f.services);
  assert.deepEqual(f.calls, ["assertLauncherClosed", "preflightIntegration", "stopRuntime", "removeIntegration", "removeAutostart", "assertLauncherClosed"]);
  assert.equal(uninstallInProgress(f.options.appData, f.options.installRoot), true);
  assert.equal(fs.existsSync(path.join(f.profile.coreHome, "config.json")), false);
  assert.equal(fs.readFileSync(path.join(f.profile.coreHome, "config.uninstalled.json"), "utf8"), '{"fixture":true}');
  assert.equal(fs.readFileSync(path.join(f.profile.coreHome, "versions", "fixture-runtime"), "utf8"), "fixture-runtime");
  assert.equal(fs.readFileSync(path.join(f.profile.userData, "Partitions", "fixture-cookie"), "utf8"), "fixture-cookie");
  const state = JSON.parse(fs.readFileSync(path.join(f.profile.userData, "launcher-state.json")));
  assert.equal(state.language, "zh-CN");
  assert.equal(state.autoStart, false);
  assert.equal(state.coreSetupComplete, false);
  finishUninstall(f.options);
  assert.equal(fs.readFileSync(path.join(f.record.installerCache, "installer.exe"), "utf8"), "fixture-installer-cache");
  assert.equal(uninstallInProgress(f.options.appData, f.options.installRoot), false);
  assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "auth.json"), "utf8"), "private-fixture-auth");
});

test("explicit purge removes both owned data roots and its own record, never Codex or sibling files", async t => {
  const f = fixture(t);
  const other = path.join(f.root, "web2harness-user-project.txt");
  fs.writeFileSync(other, "keep");
  await prepareUninstall({ ...f.options, purge: true }, f.services);
  assert.equal(fs.existsSync(f.profile.coreHome), false);
  assert.equal(fs.existsSync(f.profile.userData), false);
  assert.equal(fs.existsSync(f.record.installerCache), false);
  finishUninstall(f.options);
  assert.equal(fs.existsSync(recordPaths(f.options.appData, f.options.installRoot).profile), false);
  assert.equal(fs.readFileSync(other, "utf8"), "keep");
  assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "auth.json"), "utf8"), "private-fixture-auth");
});

for (const stage of ["assertLauncherClosed", "preflightIntegration", "stopRuntime", "removeIntegration"]) {
  test(`failure in ${stage} prevents data removal and leaves recovery evidence`, async t => {
    const f = fixture(t);
    f.services[stage] = async () => { f.calls.push(stage); throw new Error("fixture failure"); };
    await assert.rejects(prepareUninstall({ ...f.options, purge: true }, f.services), /fixture failure/);
    assert.ok(fs.existsSync(path.join(f.profile.coreHome, "config.json")));
    assert.ok(fs.existsSync(path.join(f.profile.userData, OWNER_FILE)));
    assert.equal(uninstallInProgress(f.options.appData, f.options.installRoot), false);
    assert.equal(f.calls.includes("removeAutostart"), false);
  });
}

test("unknown data blocks purge before any integration or file mutations", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.profile.userData, "user-project.txt"), "keep");
  await assert.rejects(prepareUninstall({ ...f.options, purge: true }, f.services), /Unrecognized data/);
  assert.deepEqual(f.calls, ["assertLauncherClosed"]);
  assert.ok(fs.existsSync(path.join(f.profile.coreHome, "config.json")));
});

test("unknown installer cache files block all cleanup before configuration changes", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.record.installerCache, "user-export.txt"), "keep");
  await assert.rejects(prepareUninstall({ ...f.options, purge: true }, f.services), /Unrecognized data/);
  assert.deepEqual(f.calls, ["assertLauncherClosed"]);
  assert.ok(fs.existsSync(path.join(f.profile.coreHome, "config.json")));
});

test("junctions inside owned data never expose another directory to cleanup", t => {
  const f = fixture(t);
  fs.symlinkSync(f.profile.codexHome, path.join(f.profile.coreHome, "browser"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => removeOwnedData(f.record, f.options), /link/);
  assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "auth.json"), "utf8"), "private-fixture-auth");
});

test("redirected root, changed owner and protected roots fail closed", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.profile.coreHome, OWNER_FILE), JSON.stringify({ appId: "other", id: f.record.id }));
  assert.throws(() => cleanupTargets(f.record, f.options), /ownership/);
  for (const target of [f.root, f.options.appData, f.profile.codexHome, f.options.installRoot]) {
    assert.throws(() => registerInstallation({ ...f.options, profile: { ...f.profile, coreHome: target } }), /protected/);
  }
});

test("custom dedicated directories use recorded paths and keep default unrelated data", async t => {
  const f = fixture(t);
  const otherInstall = path.join(f.root, "other-install");
  fs.mkdirSync(otherInstall);
  const options = { ...f.options, installRoot: otherInstall, localAppData: path.join(f.root, "other-local") };
  const profile = { coreHome: path.join(f.root, "custom-core"), userData: path.join(f.root, "custom-ui"), codexHome: f.profile.codexHome };
  registerInstallation({ ...options, profile });
  await prepareUninstall({ ...options, purge: true }, f.services);
  finishUninstall(options);
  assert.equal(fs.existsSync(profile.coreHome), false);
  assert.ok(fs.existsSync(f.profile.coreHome));
  assert.ok(loadInstallation(f.options));
});

test("default Codex subdirectories remain protected when a custom Codex home is configured", t => {
  const f = fixture(t);
  assert.throws(() => registerInstallation({ ...f.options, profile: {
    ...f.profile, codexHome: path.join(f.root, "custom-codex"), coreHome: path.join(f.root, ".codex", "keep"),
  } }), /protected/);
});

test("interrupted first registration retains its identity for the next startup", t => {
  const f = fixture(t);
  const options = { ...f.options, installRoot: path.join(f.root, "new-install"), localAppData: path.join(f.root, "new-local"),
    profile: { ...f.profile, coreHome: path.join(f.root, "new-core"), userData: path.join(f.root, "new-ui") } };
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === path.join(options.profile.userData, OWNER_FILE)) throw Object.assign(new Error("fixture disk failure"), { code: "EIO" });
    return rename(source, destination);
  };
  try { assert.throws(() => registerInstallation(options), /fixture disk failure/); }
  finally { fs.renameSync = rename; }
  const pending = loadInstallation(options);
  assert.ok(pending);
  const registered = registerInstallation(options);
  assert.equal(registered.id, pending.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(registered.userData, OWNER_FILE))).id, registered.id);
});

test("repeated preparation tolerates already detached integration and missing data", async t => {
  const f = fixture(t);
  await prepareUninstall({ ...f.options, purge: true }, f.services);
  await prepareUninstall({ ...f.options, purge: true }, f.services);
  finishUninstall(f.options);
  assert.equal(fs.existsSync(f.profile.codexHome), true);
});

test("observed Electron dictionaries and tunnel profiles are included in owned cleanup", async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.profile.userData, "Dictionaries"));
  fs.writeFileSync(path.join(f.profile.userData, "en-US-10-1.bdic"), "fixture-dictionary");
  fs.writeFileSync(path.join(f.profile.userData, "DevToolsActivePort"), "fixture-port");
  fs.mkdirSync(path.join(f.profile.coreHome, "tunnel"));
  await prepareUninstall({ ...f.options, purge: true }, f.services);
  finishUninstall(f.options);
  assert.equal(fs.existsSync(f.profile.userData), false);
});

test("locked child preserves its ownership marker and supports retry after partial removal", t => {
  const f = fixture(t);
  const remove = fs.rmSync;
  const locked = path.join(f.profile.coreHome, "versions");
  fs.rmSync = (target, options) => {
    if (target === locked) throw Object.assign(new Error("fixture locked file"), { code: "EPERM" });
    return remove(target, options);
  };
  try { assert.throws(() => removeOwnedData(f.record, f.options), /locked file/); }
  finally { fs.rmSync = remove; }
  assert.ok(fs.existsSync(path.join(f.profile.coreHome, OWNER_FILE)));
  removeOwnedData(f.record, f.options);
  assert.equal(fs.existsSync(f.profile.coreHome), false);
});

test("NSIS cannot report completion with program files left behind", async t => {
  const f = fixture(t);
  const remaining = path.join(f.options.installRoot, "fixture-busy-file");
  fs.writeFileSync(remaining, "still-installed");
  await prepareUninstall(f.options, f.services);
  assert.throws(() => finishUninstall(f.options), /Program files are still present/);
  assert.ok(loadInstallation(f.options).uninstallPrepared);
  fs.unlinkSync(remaining);
  finishUninstall(f.options);
});

test("Windows paths travel as environment data, never executable PowerShell text", () => {
  const target = 'C:\\Users\\fixture $($x)\\Web2Harness.exe';
  runPowerShell("static-script", target, (_file, args, options) => {
    assert.equal(args.at(-1), "static-script");
    assert.equal(options.env.WEB2HARNESS_UNINSTALL_EXE, target);
    assert.equal(options.windowsHide, true);
    return { status: 0 };
  });
});

test("NSIS skips upgrade cleanup, defaults to preservation and embeds an independent helper", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../packaging/windows/windows-installer.nsh"), "utf8");
  assert.match(source, /Function un\.W2HPrepare[\s\S]*?\$\{If\} \$\{isUpdated\}\s+Return/);
  assert.match(source, /StrCpy \$W2HPurge "0"/);
  assert.match(source, /File \/oname=bun\.exe/);
  assert.match(source, /File \/oname=uninstall\.cjs/);
  assert.match(source, /!macro customRemoveFiles[\s\S]*Call un\.atomicRMDir[\s\S]*Call un\.restoreFiles/);
  assert.doesNotMatch(source, /!macro customUnInstallSection/);
  assert.doesNotMatch(source, /KILL_PROCESS|taskkill|RMDir \/r.*APPDATA/);
});
