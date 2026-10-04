const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { beginInstall, commitInstall, rollbackInstall, locations } = require("../../electron/installation/windows-install.cjs");
const { checkPackagedRuntimeReady, preparePackagedRuntime } = require("../../electron/installation/runtime-install.cjs");
const { registerInstallation, uninstallInProgress, loadInstallation } = require("../../electron/installation/installation-record.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "web2harness-setup-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { installRoot: path.join(root, "install"), homeDir: path.join(root, "user"),
    appData: path.join(root, "roaming"), localAppData: path.join(root, "local"), version: "6.0.0", ownerPid: process.pid, env: {} };
  const profile = { coreHome: path.join(options.homeDir, ".web2harness"), codexHome: path.join(options.homeDir, ".codex"),
    userData: path.join(options.appData, "Web2Harness") };
  fs.mkdirSync(profile.codexHome, { recursive: true });
  fs.writeFileSync(path.join(profile.codexHome, "auth.json"), "fixture-auth");
  fs.writeFileSync(path.join(profile.codexHome, "config.toml"), "fixture-route");
  let registration = "old-registration", stopped = false;
  const services = { assertLauncherClosed: async () => {},
    stopRuntime: async () => { stopped = true; },
    captureRegistration: file => fs.writeFileSync(file, registration),
    restoreRegistration: file => { registration = fs.readFileSync(file, "utf8"); } };
  const runtimeOptions = { app: { isPackaged: true, getVersion: () => options.version }, coreHome: profile.coreHome,
    resourcesPath: path.join(options.installRoot, "resources") };
  function application(content) {
    fs.mkdirSync(options.installRoot, { recursive: true });
    for (const name of ["Web2Harness.exe", "Uninstall Web2Harness.exe"]) fs.writeFileSync(path.join(options.installRoot, name), content);
    const runtime = path.join(runtimeOptions.resourcesPath, "runtime");
    const files = ["app/browser-helper.cjs", "app/cli.js", "app/node_modules/fixture/index.js",
      `bin/${process.platform === "win32" ? "web2harness.cmd" : "web2harness"}`,
      `runtime/${process.platform === "win32" ? "bun.exe" : "bun"}`].sort().map(name => {
      const file = path.join(runtime, name);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
      if (name.startsWith("runtime/")) fs.chmodSync(file, 0o700);
      return { path: name, size: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") };
    });
    const hash = createHash("sha256");
    for (const file of files) hash.update(`${file.path}\0${file.size}\0${file.sha256}\0`);
    fs.writeFileSync(path.join(runtime, "manifest.json"), JSON.stringify({ schemaVersion: 2, appVersion: options.version,
      platform: process.platform, arch: process.arch, launcher: files.find(file => file.path.startsWith("bin/")).path,
      entrypoint: "app/cli.js", bunVersion: "1.4.0", playwright: "1.62.0", bundleId: hash.digest("hex"), files }));
    registration = "new-registration";
  }
  return { root, options, profile, services, runtimeOptions, application, stopped: () => stopped,
    registration: () => registration, resetRegistration: () => { registration = "old-registration"; } };
}

async function previousInstall(f) {
  f.application("old"); f.resetRegistration();
  registerInstallation({ ...f.options, profile: f.profile });
  return preparePackagedRuntime(f.runtimeOptions);
}

test("installer prepares a fresh runtime before first startup, without editing Codex", async t => {
  const f = fixture(t);
  await beginInstall(f.options, f.services);
  assert.equal(uninstallInProgress(f.options.appData, f.options.installRoot), true);
  f.application("new");
  const installed = await commitInstall(f.options, f.services);
  assert.equal(checkPackagedRuntimeReady(f.runtimeOptions), installed);
  assert.equal(uninstallInProgress(f.options.appData, f.options.installRoot), false);
  assert.equal(fs.existsSync(locations(f.options).transaction), false);
  assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "auth.json"), "utf8"), "fixture-auth");
  assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "config.toml"), "utf8"), "fixture-route");
  assert.ok(f.stopped());
});

test("upgrade changes the runtime in setup and startup never scans or copies dependencies", async t => {
  const f = fixture(t); const installed = await previousInstall(f);
  await beginInstall(f.options, f.services); f.application("updated");
  await commitInstall(f.options, f.services);
  assert.equal(fs.readFileSync(path.join(installed, "app/cli.js"), "utf8"), "updated");
  const read = fs.readFileSync, scan = fs.readdirSync, copy = fs.cpSync, reads = [];
  try {
    fs.readFileSync = (file, ...args) => { reads.push(String(file)); return read(file, ...args); };
    fs.readdirSync = () => { throw new Error("Startup scanned files"); };
    fs.cpSync = () => { throw new Error("Startup copied files"); };
    assert.equal(checkPackagedRuntimeReady(f.runtimeOptions), installed);
    assert.equal(reads.some(file => file.includes("node_modules")), false);
  } finally { fs.readFileSync = read; fs.readdirSync = scan; fs.cpSync = copy; }
});

for (const problem of ["missing", "receipt", "changed-entry"]) {
  test(`startup requests installer repair for ${problem} and makes no repairs itself`, async t => {
    const f = fixture(t); const installed = await previousInstall(f);
    if (problem === "missing") fs.unlinkSync(path.join(installed, "app/cli.js"));
    if (problem === "receipt") fs.unlinkSync(`${installed}.verified.json`);
    if (problem === "changed-entry") fs.writeFileSync(path.join(installed, "app/cli.js"), "BAD");
    const copy = fs.cpSync;
    try {
      fs.cpSync = () => { throw new Error("Unexpected startup repair"); };
      assert.throws(() => checkPackagedRuntimeReady(f.runtimeOptions), /Windows installer again/);
    } finally { fs.cpSync = copy; }
  });
}

test("failed runtime preparation restores old program, runtime, receipt and registration", async t => {
  const f = fixture(t); const installed = await previousInstall(f);
  const receipt = fs.readFileSync(`${installed}.verified.json`), record = loadInstallation(f.options);
  await beginInstall(f.options, f.services); f.application("new");
  fs.writeFileSync(path.join(f.runtimeOptions.resourcesPath, "runtime/app/cli.js"), "BAD");
  await assert.rejects(commitInstall(f.options, f.services), /checksum mismatch/);
  await rollbackInstall(f.options, f.services);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(installed, "app/cli.js"), "utf8"), "old");
  assert.deepEqual(fs.readFileSync(`${installed}.verified.json`), receipt);
  assert.deepEqual(loadInstallation(f.options), record);
  assert.equal(f.registration(), "old-registration");
  assert.equal(checkPackagedRuntimeReady(f.runtimeOptions), installed);
});

test("rerunning the same installer fully checks dependencies even with a valid startup receipt", async t => {
  const f = fixture(t); const installed = await previousInstall(f);
  const dependency = path.join(installed, "app/node_modules/fixture/index.js");
  fs.writeFileSync(dependency, "BAD");
  assert.equal(checkPackagedRuntimeReady(f.runtimeOptions), installed);
  await beginInstall(f.options, f.services);
  await commitInstall(f.options, f.services);
  assert.equal(fs.readFileSync(dependency, "utf8"), "old");
});

test("corrupt recovery metadata stops recovery before program file removal", async t => {
  const f = fixture(t); await previousInstall(f);
  await beginInstall(f.options, f.services); f.application("candidate");
  const file = locations(f.options).journal, journal = JSON.parse(fs.readFileSync(file));
  delete journal.metadata; fs.writeFileSync(file, JSON.stringify(journal));
  await assert.rejects(rollbackInstall(f.options, f.services), /Invalid setup recovery/);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "candidate");
});

test("abandoned setup is recovered before retry and successful commit cannot be rolled back", async t => {
  const f = fixture(t); await previousInstall(f);
  await beginInstall(f.options, f.services); f.application("partial");
  await beginInstall(f.options, f.services);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "old");
  f.application("new"); await commitInstall(f.options, f.services);
  await rollbackInstall(f.options, f.services);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "new");
});

test("first-install rollback removes candidate files but preserves user and Codex data", async t => {
  const f = fixture(t); await beginInstall(f.options, f.services); f.application("partial");
  await rollbackInstall(f.options, f.services);
  assert.equal(fs.existsSync(f.options.installRoot), false);
  assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "auth.json"), "utf8"), "fixture-auth");
});

for (const upgrade of [false, true]) {
  test(`cancel and repeat installation is retryable (${upgrade ? "upgrade" : "fresh"})`, async t => {
    const f = fixture(t);
    if (upgrade) await previousInstall(f);
    // Exiting before the install step must also be harmless.
    await rollbackInstall(f.options, f.services);
    for (let attempt = 0; attempt < 2; attempt++) {
      await beginInstall(f.options, f.services); f.application("partial");
      await rollbackInstall(f.options, f.services);
      await rollbackInstall(f.options, f.services);
      assert.equal(fs.existsSync(locations(f.options).transaction), false);
      assert.equal(uninstallInProgress(f.options.appData, f.options.installRoot), false);
      if (upgrade) assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "old");
      else assert.equal(fs.existsSync(f.options.installRoot), false);
    }
    await beginInstall(f.options, f.services); f.application("complete");
    const installed = await commitInstall(f.options, f.services);
    assert.equal(checkPackagedRuntimeReady(f.runtimeOptions), installed);
    assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "config.toml"), "utf8"), "fixture-route");
    assert.equal(fs.readFileSync(path.join(f.profile.codexHome, "auth.json"), "utf8"), "fixture-auth");
  });
}

test("interrupted preparation discards only its incomplete backup before retry", async t => {
  const f = fixture(t); await previousInstall(f);
  await beginInstall(f.options, f.services);
  const paths = locations(f.options), journal = JSON.parse(fs.readFileSync(paths.journal));
  journal.status = "preparing";
  fs.writeFileSync(paths.journal, JSON.stringify(journal));
  fs.writeFileSync(path.join(paths.transaction, "application", "Web2Harness.exe"), "incomplete backup");
  await beginInstall(f.options, f.services);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(paths.transaction, "application", "Web2Harness.exe"), "utf8"), "old");
  f.application("new");
  await commitInstall(f.options, f.services);
});

test("interrupted runtime copy is rolled back and a new attempt uses a clean destination", async t => {
  const f = fixture(t); const installed = await previousInstall(f);
  await beginInstall(f.options, f.services); f.application("candidate");
  const copy = fs.cpSync;
  try {
    fs.cpSync = (source, destination, options) => {
      const result = copy(source, destination, options);
      if (source === path.join(f.runtimeOptions.resourcesPath, "runtime")) {
        throw Object.assign(new Error("fixture interrupted copy"), { code: "EIO" });
      }
      return result;
    };
    await assert.rejects(commitInstall(f.options, f.services), /interrupted copy/);
  } finally { fs.cpSync = copy; }
  await rollbackInstall(f.options, f.services);
  assert.equal(fs.readFileSync(path.join(installed, "app/cli.js"), "utf8"), "old");
  assert.deepEqual(fs.readdirSync(path.dirname(installed)).filter(name => name.includes(".tmp-") || name.includes(".previous-")), []);
  await beginInstall(f.options, f.services); f.application("new");
  assert.equal(await commitInstall(f.options, f.services), installed);
  assert.equal(checkPackagedRuntimeReady(f.runtimeOptions), installed);
});

test("a later process recovers an abruptly exited setup before replacing files", async t => {
  const f = fixture(t); await previousInstall(f);
  const child = spawnSync(process.execPath, ["-e", `
    const fs = require('node:fs'), path = require('node:path');
    const { beginInstall } = require(process.env.FIXTURE_SETUP_MODULE);
    const options = JSON.parse(process.env.FIXTURE_SETUP_OPTIONS);
    options.ownerPid = process.pid;
    beginInstall(options, {
      assertLauncherClosed: async () => {}, stopRuntime: async () => {},
      captureRegistration: file => fs.writeFileSync(file, 'old-registration'),
    }).then(() => {
      fs.writeFileSync(path.join(options.installRoot, 'Web2Harness.exe'), 'partial');
      process.exit(73); // No GUI callback or rollback: exercise the persisted journal.
    }).catch(error => { console.error(error); process.exit(1); });
  `], { cwd: f.root, encoding: "utf8", windowsHide: true, timeout: 10000,
    env: { ...process.env, WEB2HARNESS_HOME: f.profile.coreHome, CODEX_HOME: f.profile.codexHome,
      FIXTURE_SETUP_MODULE: require.resolve("../../electron/installation/windows-install.cjs"),
      FIXTURE_SETUP_OPTIONS: JSON.stringify(f.options) } });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 73, child.stderr);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "partial");
  await beginInstall(f.options, f.services);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "old");
  f.application("new"); await commitInstall(f.options, f.services);
  assert.equal(fs.existsSync(locations(f.options).transaction), false);
});

test("busy launcher and runtime prevent NSIS replacement and release the setup lock", async t => {
  const f = fixture(t); await previousInstall(f);
  for (const stage of ["assertLauncherClosed", "stopRuntime"]) {
    await assert.rejects(beginInstall(f.options, { ...f.services, [stage]: () => { throw new Error("fixture busy"); } }), /fixture busy/);
    assert.equal(fs.readFileSync(path.join(f.options.installRoot, "Web2Harness.exe"), "utf8"), "old");
    assert.equal(uninstallInProgress(f.options.appData, f.options.installRoot), false);
  }
});

test("unrecognized installation folders and redirected files are preserved", async t => {
  const f = fixture(t);
  fs.mkdirSync(f.options.installRoot); fs.writeFileSync(path.join(f.options.installRoot, "user-project.txt"), "keep");
  await assert.rejects(beginInstall(f.options, f.services), /unrecognized/);
  f.application("old");
  fs.symlinkSync(f.profile.codexHome, path.join(f.options.installRoot, "redirect"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(beginInstall(f.options, f.services), /redirected/);
  assert.equal(fs.readFileSync(path.join(f.options.installRoot, "user-project.txt"), "utf8"), "keep");
});

test("recovery failure retains its snapshots and a later recovery succeeds", async t => {
  const f = fixture(t); await previousInstall(f);
  await beginInstall(f.options, f.services); f.application("partial");
  await assert.rejects(rollbackInstall(f.options, { ...f.services, restoreRegistration: () => { throw new Error("fixture access denied"); } }), /access denied/);
  assert.ok(fs.existsSync(locations(f.options).journal));
  await rollbackInstall(f.options, f.services);
  assert.equal(fs.existsSync(locations(f.options).transaction), false);
});

test("NSIS prepares before old uninstall, commits before success, and has failure/exit recovery", () => {
  const script = fs.readFileSync(path.join(__dirname, "../../packaging/windows/windows-installer.nsh"), "utf8");
  assert.match(script, /!macro customCheckAppRunning\s+; Runs before NSIS[\s\S]*Call W2HSetupBegin/);
  assert.match(script, /!macro customInstall[\s\S]*install\.cjs.* commit /);
  assert.match(script, /Function \.onInstFailed\s+Call W2HSetupRollback/);
  assert.match(script, /Function \.onGUIEnd\s+Call W2HSetupRollback/);
});
