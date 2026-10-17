const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");
const { processRunning } = require("../common/process-tree.cjs");

const APP_ID = "dev.web2harness.launcher";
const OWNER_FILE = ".web2harness-owner.json";

function identity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function within(parent, child) {
  const relative = path.relative(identity(parent), identity(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

// Check each existing ancestor. A redirected parent is unsafe even if the final entry is regular.
function assertPlainPath(target) {
  if (!path.isAbsolute(target)) throw new Error(`Expected an absolute application path: ${target}`);
  let current = path.resolve(target);
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing redirected application path: ${current}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function recordPaths(appData, installRoot) {
  const key = createHash("sha256").update(identity(installRoot)).digest("hex").slice(0, 24);
  const directory = path.join(appData, "Web2Harness-installations", key);
  return { directory, profile: path.join(directory, "profile.json"), lock: path.join(directory, "uninstall-lock.json") };
}

function readJson(file) {
  assertPlainPath(file);
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > 64 * 1024) throw new Error(`Installation record is too large: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateRecord(record, { appData, localAppData, installRoot, homeDir }) {
  if (record?.version !== 1 || record.appId !== APP_ID || typeof record.id !== "string"
    || !/^[a-f0-9-]{36}$/.test(record.id) || identity(record.installRoot) !== identity(installRoot)) {
    throw new Error("Web2Harness installation record is invalid or belongs to another installation");
  }
  const roots = [record.coreHome, record.userData, record.installerCache];
  if (!localAppData || identity(record.installerCache) !== identity(path.join(localAppData, "web2harness-launcher-updater"))) {
    throw new Error("Installer cache must use the recorded Windows application location");
  }
  for (const target of [installRoot, record.codexHome, ...roots]) assertPlainPath(target);
  const protectedPaths = [homeDir, appData, localAppData, path.parse(homeDir).root, installRoot,
    path.join(homeDir, ".codex"), record.codexHome, path.join(homeDir, ".web2harness-dev"),
    path.join(appData, "Web2Harness-installations"),
    ...["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"].map(name => path.join(homeDir, name))];
  for (const root of roots) {
    if (protectedPaths.some(protectedPath => within(root, protectedPath))
      || within(record.codexHome, root) || within(installRoot, root)
      || within(path.join(homeDir, ".codex"), root)
      || within(path.join(homeDir, ".web2harness-dev"), root)) {
      throw new Error(`Application data overlaps a protected location: ${root}`);
    }
  }
  if (roots.some((root, index) => roots.some((other, otherIndex) => index !== otherIndex && within(root, other)))) {
    throw new Error("Application data roots must not overlap");
  }
  return record;
}

function loadInstallation(options) {
  const record = readJson(recordPaths(options.appData, options.installRoot).profile);
  return record ? validateRecord(record, options) : null;
}

function uninstallInProgress(appData, installRoot) {
  const lock = readJson(recordPaths(appData, installRoot).lock);
  return lock?.appId === APP_ID && processRunning(lock.pid);
}

function registerInstallation(options) {
  const { profile, appData, localAppData, installRoot, homeDir } = options;
  const previous = loadInstallation(options);
  const record = validateRecord({ version: 1, appId: APP_ID, id: previous?.id ?? randomUUID(),
    installRoot: path.resolve(installRoot), coreHome: profile.coreHome,
    userData: profile.userData, codexHome: profile.codexHome,
    installerCache: path.join(localAppData, "web2harness-launcher-updater") }, { appData, localAppData, installRoot, homeDir });
  if (previous && ["coreHome", "userData", "codexHome"].some(key => identity(previous[key]) !== identity(record[key]))) {
    throw new Error("Installation data paths changed; preserve the previous record before using a different profile");
  }
  const roots = [record.coreHome, record.userData, record.installerCache];
  for (const root of roots) {
    const marker = path.join(root, OWNER_FILE);
    const owner = readJson(marker);
    if (owner && (owner.id !== record.id || owner.appId !== APP_ID)) throw new Error(`Data belongs to another installation: ${root}`);
  }
  // Persist the identity before creating markers so interrupted registration is retryable.
  if (!isDeepStrictEqual(previous, record)) {
    writePrivateFileAtomic(recordPaths(appData, installRoot).profile, `${JSON.stringify(record, null, 2)}\n`);
  }
  for (const root of roots) {
    const marker = path.join(root, OWNER_FILE);
    if (!fs.existsSync(marker)) writePrivateFileAtomic(marker, JSON.stringify({ appId: APP_ID, id: record.id }));
  }
  return record;
}

function checkOwnedTree(root) {
  assertPlainPath(root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Cleanup cannot follow a link: ${target}`);
    if (entry.isDirectory()) checkOwnedTree(target);
    else if (!entry.isFile()) throw new Error(`Cleanup found an unsupported entry: ${target}`);
  }
}

function cleanupTargets(record, options) {
  validateRecord(record, options);
  const targets = [];
  const defaults = {
    coreHome: path.join(options.homeDir, ".web2harness"),
    userData: path.join(options.appData, "Web2Harness"),
    installerCache: path.join(options.localAppData, "web2harness-launcher-updater"),
  };
  for (const [key, defaultRoot] of Object.entries(defaults)) {
    const root = record[key];
    if (!fs.existsSync(root)) continue;
    const marker = path.join(root, OWNER_FILE);
    const recovery = "Restore the installation record/marker, or keep data by clearing the data-cleanup checkbox. / 请恢复安装记录或归属标记，或取消勾选清理数据以保留数据卸载。";
    let owner;
    try { owner = readJson(marker); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error(`Data ownership marker is damaged / 数据归属标记损坏: ${root}. ${recovery}`);
    }
    if (owner === null && !fs.existsSync(marker)) {
      // Manual cleanup can remove the marker before uninstall. Only an existing,
      // matching installation record plus an exact dedicated default path may replace it.
      const persisted = loadInstallation(options);
      const matches = persisted?.id === record.id && ["installRoot", "coreHome", "userData", "codexHome", "installerCache"]
        .every(field => identity(persisted[field]) === identity(record[field]));
      if (!matches || identity(root) !== identity(defaultRoot)) {
        throw new Error(`Data ownership marker is missing / 数据归属标记缺失: ${root}. ${recovery}`);
      }
    } else if (owner?.appId !== APP_ID || owner.id !== record.id) {
      throw new Error(`Data ownership marker is invalid or belongs to another installation / 数据归属标记无效或属于其他安装: ${root}. ${recovery}`);
    }
    // Full cleanup covers every ordinary entry in this dedicated root, including
    // data introduced by future features or Chromium. Links still stop all cleanup.
    checkOwnedTree(root);
    targets.push(root);
  }
  return targets;
}

function removeOwnedData(record, options) {
  // Validate all roots before the first deletion, and retain ownership until every child is removed.
  const targets = cleanupTargets(record, options);
  for (const root of targets) {
    for (const entry of fs.readdirSync(root).filter(name => name !== OWNER_FILE)) {
      const target = path.join(root, entry);
      assertPlainPath(target);
      if (!within(root, target)) throw new Error("Cleanup path escaped its data root");
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.rmSync(path.join(root, OWNER_FILE), { force: true });
    try { fs.rmdirSync(root); }
    catch (error) {
      // Keep retry evidence if a concurrent writer left a file or removal was denied.
      writePrivateFileAtomic(path.join(root, OWNER_FILE), JSON.stringify({ appId: APP_ID, id: record.id }));
      throw error;
    }
  }
}

module.exports = { APP_ID, OWNER_FILE, assertPlainPath, identity, recordPaths, readJson,
  loadInstallation, registerInstallation, validateRecord, uninstallInProgress, cleanupTargets, removeOwnedData };
