const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");
const { processRunning } = require("../common/process-tree.cjs");

const APP_ID = "dev.web2harness.launcher";
const OWNER_FILE = ".web2harness-owner.json";
const INSTALLER_CACHE_ENTRIES = new Set([OWNER_FILE, "installer.exe"]);
const CORE_ENTRIES = new Set([
  OWNER_FILE, "config.json", "config.uninstalled.json", "responses-state.json",
  "versions", "runtime", "codex", "browser", "bin", "secrets", "tunnel", "logs", "diagnostics",
]);
const DESKTOP_ENTRIES = new Set([
  OWNER_FILE, "launcher-state.json", "window-state.json", "limits.json", "logs",
  // RuntimeHost stages MCP credentials and passkey transfers under desktop userData.
  "secrets", "passkey-login",
  "Partitions", "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
  "Local Storage", "Session Storage", "IndexedDB", "Service Worker", "Network", "blob_storage",
  "Preferences", "Local State", "Cookies", "Cookies-journal", "Network Persistent State",
  "TransportSecurity", "Trust Tokens", "Trust Tokens-journal", "SharedStorage", "SharedStorage-wal",
  "Shared Dictionary", "WebStorage", "VideoDecodeStats", "media_device_salt", "DIPS", "DIPS-wal",
  "Crashpad", "Crash Reports", "BrowserMetrics", "component_crx_cache", "extensions_crx_cache",
  "first-party-sets-preloaded", "Variations", "SingletonCookie", "SingletonLock", "SingletonSocket",
  "Dictionaries", "DevToolsActivePort",
]);

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
  writePrivateFileAtomic(recordPaths(appData, installRoot).profile, `${JSON.stringify(record, null, 2)}\n`);
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
  for (const [root, allowed] of [[record.coreHome, CORE_ENTRIES], [record.userData, DESKTOP_ENTRIES],
    [record.installerCache, INSTALLER_CACHE_ENTRIES]]) {
    if (!fs.existsSync(root)) continue;
    const owner = readJson(path.join(root, OWNER_FILE));
    if (owner?.appId !== APP_ID || owner.id !== record.id) throw new Error(`Data ownership cannot be verified: ${root}`);
    for (const entry of fs.readdirSync(root)) {
      const spellcheckDictionary = allowed === DESKTOP_ENTRIES && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?-\d+-\d+\.bdic$/.test(entry);
      if (!allowed.has(entry) && !spellcheckDictionary) throw new Error(`Unrecognized data was preserved; move it before full cleanup: ${path.join(root, entry)}`);
    }
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
    fs.unlinkSync(path.join(root, OWNER_FILE));
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
