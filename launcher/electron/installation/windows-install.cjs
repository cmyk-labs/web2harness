const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");
const { processRunning } = require("../common/process-tree.cjs");
const { resolveLauncherProfile } = require("../profile.cjs");
const { APP_ID, OWNER_FILE, assertPlainPath, identity, recordPaths, readJson, loadInstallation,
  registerInstallation, validateRecord } = require("./installation-record.cjs");
const { ensurePackagedRuntime, installedRuntimePath } = require("./runtime-install.cjs");
const { stageShortcutIcon } = require("./windows-shortcuts.cjs");

async function stage(services, name, action) {
  const start = Date.now();
  services.onProgress?.({ stage: name, status: "running", elapsedMs: 0 });
  try {
    const result = await action();
    services.onProgress?.({ stage: name, status: "completed", elapsedMs: Date.now() - start });
    return result;
  } catch (error) {
    services.onProgress?.({ stage: name, status: "failed", elapsedMs: Date.now() - start });
    throw error;
  }
}

async function updateIcons(options, services) {
  if (!options.shortcutIconSource) return;
  await stage(services, "updating-shortcuts", async () => {
    const icon = stageShortcutIcon(options);
    await services.setShortcutIcons(options.installRoot, icon);
  });
}

function locations(options) {
  const record = recordPaths(options.appData, options.installRoot);
  const transaction = path.join(record.directory, "setup-transaction");
  assertPlainPath(transaction);
  return { ...record, transaction, journal: path.join(transaction, "journal.json"),
    registration: path.join(transaction, "registration.json") };
}

function within(parent, child) {
  const relative = path.relative(identity(parent), identity(child));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function validateOptions(options) {
  for (const key of ["installRoot", "appData", "localAppData", "homeDir"]) assertPlainPath(options[key]);
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(options.version)) throw new Error("Invalid installation version");
  if (!Number.isInteger(options.ownerPid) || !processRunning(options.ownerPid)) throw new Error("Setup owner is not running");
  if ([options.homeDir, options.appData, options.localAppData, path.join(options.homeDir, ".codex"),
    path.join(options.homeDir, ".web2harness"), path.join(options.homeDir, ".web2harness-dev")]
    .some(target => within(options.installRoot, target))) throw new Error("Unsafe application installation directory");
  for (const protectedPath of [path.join(options.homeDir, ".codex"), path.join(options.homeDir, ".web2harness"),
    path.join(options.homeDir, ".web2harness-dev"), path.join(options.appData, "Web2Harness-installations"),
    path.join(options.appData, "Web2Harness"), path.join(options.localAppData, "web2harness-launcher-updater")]) {
    if (within(protectedPath, options.installRoot)) throw new Error("Application installation overlaps protected data");
  }
}

function inspectTree(root) {
  assertPlainPath(root);
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Setup cannot follow redirected files: ${file}`);
    if (entry.isDirectory()) inspectTree(file);
    else if (!entry.isFile()) throw new Error(`Unsupported installation entry: ${file}`);
  }
}

function snapshotFile(file) {
  assertPlainPath(file);
  return fs.existsSync(file) ? fs.readFileSync(file).toString("base64") : null;
}

function restoreFile(file, data) {
  assertPlainPath(file);
  if (data === null) fs.rmSync(file, { force: true });
  else writePrivateFileAtomic(file, Buffer.from(data, "base64"));
}

function save(paths, journal) { writePrivateFileAtomic(paths.journal, JSON.stringify(journal)); }

function loadTransaction(options) {
  validateOptions(options);
  const paths = locations(options);
  const journal = readJson(paths.journal);
  if (!journal) return { paths, journal: null };
  if (journal.appId !== APP_ID || journal.version !== 1 || identity(journal.installRoot) !== identity(options.installRoot)
    || !["preparing", "prepared", "committed"].includes(journal.status)
    || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(journal.targetVersion)) throw new Error("Invalid setup recovery record");
  validateRecord(journal.record, options);
  if (journal.status === "prepared" && (!Array.isArray(journal.metadata) || journal.metadata.length !== 5
    || journal.metadata.some(value => value !== null && (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)))
    || typeof journal.hadApplication !== "boolean" || typeof journal.hadRuntime !== "boolean")) {
    throw new Error("Invalid setup recovery snapshots");
  }
  if (journal.ownerPid !== options.ownerPid && processRunning(journal.ownerPid)) throw new Error("Another setup is running");
  return { paths, journal };
}

function runtimeRoot(journal) {
  return installedRuntimePath(journal.record.coreHome, { version: journal.targetVersion, platform: process.platform, arch: process.arch });
}

function metadataPaths(journal, paths) {
  return [paths.profile, ...[journal.record.coreHome, journal.record.userData, journal.record.installerCache]
    .map(root => path.join(root, OWNER_FILE)), `${runtimeRoot(journal)}.verified.json`];
}

function restoreDirectory(target, backup, existed) {
  inspectTree(target);
  if (existed && !fs.existsSync(backup)) throw new Error(`Setup recovery copy is missing: ${backup}`);
  fs.rmSync(target, { recursive: true, force: true });
  if (existed) { inspectTree(backup); fs.cpSync(backup, target, { recursive: true, errorOnExist: true, force: false }); }
}

function discardTransaction(paths) {
  // Exact private transaction directory, never a user-selected or discovered cleanup target.
  assertPlainPath(paths.transaction);
  inspectTree(paths.transaction);
  fs.rmSync(paths.transaction, { recursive: true, force: true });
  fs.rmSync(paths.lock, { force: true });
}

async function rollbackInstall(options, services) {
  const { paths, journal } = loadTransaction(options);
  if (!journal) return;
  if (journal.status === "prepared") {
    await stage(services, "recovering-installation", async () => {
      await services.assertLauncherClosed(path.join(options.installRoot, "Web2Harness.exe"));
      restoreDirectory(options.installRoot, path.join(paths.transaction, "application"), journal.hadApplication);
      restoreDirectory(runtimeRoot(journal), path.join(paths.transaction, "runtime"), journal.hadRuntime);
      metadataPaths(journal, paths).forEach((file, index) => restoreFile(file, journal.metadata[index]));
      await services.restoreRegistration(paths.registration);
    });
  }
  discardTransaction(paths);
}

async function beginInstall(options, services) {
  validateOptions(options);
  const paths = locations(options);
  const lock = readJson(paths.lock);
  if (lock && lock.pid !== options.ownerPid && processRunning(lock.pid)) throw new Error("Another installation operation is running");
  await services.assertLauncherClosed(path.join(options.installRoot, "Web2Harness.exe"));
  // An interrupted installer must recover before taking another snapshot of the installation.
  if (fs.existsSync(paths.journal)) await rollbackInstall(options, services);
  else if (fs.existsSync(paths.transaction)) throw new Error(`Setup recovery record is missing: ${paths.transaction}`);
  const previous = loadInstallation(options);
  const profile = previous || resolveLauncherProfile({ argv: [], homeDir: options.homeDir, appData: options.appData,
    env: options.env || process.env });
  const record = validateRecord(previous || { version: 1, appId: APP_ID, id: randomUUID(), installRoot: options.installRoot,
    coreHome: profile.coreHome, userData: profile.userData, codexHome: profile.codexHome,
    installerCache: path.join(options.localAppData, "web2harness-launcher-updater") }, options);
  if (fs.existsSync(options.installRoot) && fs.readdirSync(options.installRoot).length
    && (!fs.existsSync(path.join(options.installRoot, "Web2Harness.exe"))
      || !fs.existsSync(path.join(options.installRoot, "Uninstall Web2Harness.exe")))) {
    throw new Error("Installation directory contains unrecognized files; no files were replaced");
  }
  writePrivateFileAtomic(paths.lock, JSON.stringify({ appId: APP_ID, pid: options.ownerPid }));
  const journal = { version: 1, appId: APP_ID, installRoot: options.installRoot, targetVersion: options.version,
    ownerPid: options.ownerPid, record, status: "preparing" };
  try {
    save(paths, journal);
    await stage(services, "stopping-runtime", () => services.stopRuntime(record));
    await stage(services, "saving-registration", () => services.captureRegistration(paths.registration));
    journal.metadata = metadataPaths(journal, paths).map(snapshotFile);
    journal.hadApplication = fs.existsSync(options.installRoot);
    journal.hadRuntime = fs.existsSync(runtimeRoot(journal));
    for (const [target, name, exists] of [[options.installRoot, "application", journal.hadApplication],
      [runtimeRoot(journal), "runtime", journal.hadRuntime]]) {
      if (!exists) continue;
      await stage(services, `saving-${name}`, () => {
        inspectTree(target);
        fs.cpSync(target, path.join(paths.transaction, name), { recursive: true, force: false, errorOnExist: true });
      });
    }
    journal.status = "prepared";
    save(paths, journal);
  } catch (error) {
    // No NSIS file replacement has started while begin is still running.
    discardTransaction(paths);
    throw error;
  }
  // From this point registration may change; retain the prepared journal on failure
  // so NSIS can restore the original shortcuts along with the application.
  await updateIcons(options, services);
  journal.replacementStartedAt = Date.now();
  save(paths, journal);
  services.onProgress?.({ stage: "replacing-application", status: "running", elapsedMs: 0 });
}

async function commitInstall(options, services) {
  const { paths, journal } = loadTransaction(options);
  if (!journal || journal.status !== "prepared" || journal.targetVersion !== options.version) throw new Error("Setup has no prepared transaction");
  if (Number.isSafeInteger(journal.replacementStartedAt) && journal.replacementStartedAt <= Date.now()) {
    services.onProgress?.({ stage: "replacing-application", status: "completed", elapsedMs: Date.now() - journal.replacementStartedAt });
  }
  await services.assertLauncherClosed(path.join(options.installRoot, "Web2Harness.exe"));
  await updateIcons(options, services);
  const installed = await stage(services, "deploying-runtime", () => ensurePackagedRuntime({
    app: { isPackaged: true, getVersion: () => options.version }, coreHome: journal.record.coreHome,
    resourcesPath: path.join(options.installRoot, "resources"), onProgress: services.onProgress,
  }));
  await stage(services, "registering-installation", () => registerInstallation({ ...options, profile: journal.record }));
  journal.status = "committed";
  save(paths, journal);
  // Backup cleanup failure must not turn a complete deployment into a failed upgrade.
  try { await stage(services, "finishing-installation", () => discardTransaction(paths)); }
  catch { fs.rmSync(paths.lock, { force: true }); }
  return installed;
}

module.exports = { beginInstall, commitInstall, rollbackInstall, locations };
