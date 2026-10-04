const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { renameAtomicFile, writePrivateFileAtomic } = require("../common/atomic-file.cjs");
const { runtimeBundlePaths } = require("../runtime/runtime-command.cjs");

const DEFAULT_SOURCE_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_SOURCE_WAIT_INTERVAL_MS = 50;
const { createRuntimeProgress } = require("../runtime/runtime-progress.cjs");
class RuntimeIntegrityError extends Error {
  constructor(reason, message) { super(message); this.name = "RuntimeIntegrityError"; this.reason = reason; }
}
const missing = error => error?.code === "ENOENT" || error?.code === "ENOTDIR";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bundleIdFor(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function validateManifestPath(relativePath) {
  if (typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath === "manifest.json"
    || relativePath.includes("\\")
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some(segment => segment.length === 0 || segment === "." || segment === "..")) {
    throw new RuntimeIntegrityError("invalid-manifest", `Runtime manifest contains an unsafe file path: ${JSON.stringify(relativePath)}`);
  }
  return relativePath;
}

function readRuntimeManifest(runtimeRoot, { version, platform, arch, bundleId }) {
  const manifestPath = path.join(runtimeRoot, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (missing(error)) throw new RuntimeIntegrityError("missing-manifest", `Runtime manifest is missing: ${manifestPath}`);
    if (!(error instanceof SyntaxError)) throw error;
    throw new RuntimeIntegrityError("invalid-manifest",
      `Runtime manifest is invalid: ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expectedLauncher = `bin/${platform === "win32" ? "web2harness.cmd" : "web2harness"}`;
  if (manifest?.schemaVersion !== 2
    || manifest.appVersion !== version
    || manifest.platform !== platform
    || manifest.arch !== arch
    || manifest.launcher !== expectedLauncher
    || manifest.entrypoint !== "app/cli.js"
    || typeof manifest.bunVersion !== "string"
    || typeof manifest.playwright !== "string"
    || !SHA256_PATTERN.test(manifest.bundleId)
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0) {
    const received = manifest && typeof manifest === "object" ? {
      schemaVersion: manifest.schemaVersion,
      appVersion: manifest.appVersion,
      bundleId: manifest.bundleId,
      bunVersion: manifest.bunVersion,
      platform: manifest.platform,
      arch: manifest.arch,
      launcher: manifest.launcher,
      entrypoint: manifest.entrypoint,
      playwright: manifest.playwright,
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : null,
    } : manifest;
    throw new RuntimeIntegrityError("identity-mismatch",
      `Runtime bundle identity mismatch: expected ${version} ${platform}/${arch}, received ${JSON.stringify(received)}`,
    );
  }

  if (bundleId && manifest.bundleId !== bundleId) {
    throw new RuntimeIntegrityError("bundle-changed", "Runtime bundle content has changed");
  }
  let previousPath = null;
  const files = manifest.files.map((file, index) => {
    if (!file || typeof file !== "object"
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !SHA256_PATTERN.test(file.sha256)) {
      throw new RuntimeIntegrityError("invalid-manifest", `Runtime manifest contains an invalid file record at index ${index}`);
    }
    const relativePath = validateManifestPath(file.path);
    if (previousPath !== null && comparePaths(previousPath, relativePath) >= 0) {
      throw new RuntimeIntegrityError("invalid-manifest", `Runtime manifest file paths are not unique and sorted: ${relativePath}`);
    }
    previousPath = relativePath;
    return { path: relativePath, size: file.size, sha256: file.sha256 };
  });
  if (bundleIdFor(files) !== manifest.bundleId) {
    throw new RuntimeIntegrityError("invalid-manifest", `Runtime manifest bundleId does not match its file records: ${manifestPath}`);
  }
  return { ...manifest, files };
}

function runtimeFilePaths(runtimeRoot) {
  const paths = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => comparePaths(left.name, right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(runtimeRoot, absolutePath).split(path.sep).join("/");
      if (relativePath === "manifest.json") continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      paths.push(relativePath);
    }
  };
  visit(runtimeRoot);
  return paths.sort(comparePaths);
}

function validateRuntimeFile(runtimeRoot, canonicalRoot, file) {
  const absolutePath = path.join(runtimeRoot, ...file.path.split("/"));
  let metadata;
  try {
    metadata = fs.statSync(absolutePath);
  } catch (error) {
    if (!missing(error)) throw error;
    throw new RuntimeIntegrityError("missing-file", `Runtime bundle file is missing: ${absolutePath}`);
  }
  if (!metadata.isFile()) throw new RuntimeIntegrityError("damaged-runtime", `Runtime bundle entry is not a file: ${absolutePath}`);
  if (fs.lstatSync(absolutePath).isSymbolicLink()) {
    const target = fs.realpathSync(absolutePath);
    if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new RuntimeIntegrityError("damaged-runtime", `Runtime bundle symlink escapes the bundle: ${absolutePath}`);
    }
  }
  if (metadata.size !== file.size) {
    throw new RuntimeIntegrityError("damaged-runtime", `Runtime bundle file size mismatch: ${absolutePath}`);
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  if (sha256 !== file.sha256) {
    throw new RuntimeIntegrityError("damaged-runtime", `Runtime bundle file checksum mismatch: ${absolutePath}`);
  }
}

function inspectRuntimeBundle(runtimeRoot, identity, progress) {
  const manifest = readRuntimeManifest(runtimeRoot, identity);
  const expectedPaths = manifest.files.map(file => file.path);
  const expectedSet = new Set(expectedPaths);
  const paths = runtimeBundlePaths(runtimeRoot, identity.platform);
  for (const required of [
    paths.executable,
    paths.entrypoint,
    path.join(runtimeRoot, "app", "browser-helper.cjs"),
    path.join(runtimeRoot, ...manifest.launcher.split("/")),
  ]) {
    const relativePath = path.relative(runtimeRoot, required).split(path.sep).join("/");
    if (!expectedSet.has(relativePath)) {
      throw new RuntimeIntegrityError("invalid-manifest", `Runtime manifest does not declare required file: ${required}`);
    }
  }

  const actualPaths = runtimeFilePaths(runtimeRoot);
  const actualSet = new Set(actualPaths);
  const missing = expectedPaths.find(relativePath => !actualSet.has(relativePath));
  if (missing) throw new RuntimeIntegrityError("damaged-runtime", `Runtime bundle file is missing: ${path.join(runtimeRoot, ...missing.split("/"))}`);
  const unexpected = actualPaths.find(relativePath => !expectedSet.has(relativePath));
  if (unexpected) {
    throw new RuntimeIntegrityError("damaged-runtime", `Runtime bundle contains an unmanifested file: ${path.join(runtimeRoot, ...unexpected.split("/"))}`);
  }
  if (actualPaths.length !== expectedPaths.length) {
    throw new RuntimeIntegrityError("damaged-runtime", `Runtime bundle file count mismatch: expected ${expectedPaths.length}, received ${actualPaths.length}`);
  }

  const canonicalRoot = fs.realpathSync(runtimeRoot);
  let completed = 0;
  for (const file of manifest.files) {
    validateRuntimeFile(runtimeRoot, canonicalRoot, file);
    progress?.advance(++completed, manifest.files.length);
  }
  if (identity.platform !== "win32" && (fs.statSync(paths.executable).mode & 0o111) === 0) {
    throw new RuntimeIntegrityError("damaged-runtime", `Bundled Bun runtime is not executable: ${paths.executable}`);
  }
  return { manifest, runtimeRoot: paths.runtimeRoot };
}

function validateRuntimeBundle(runtimeRoot, identity) {
  return inspectRuntimeBundle(runtimeRoot, identity).runtimeRoot;
}

async function waitForPackagedRuntimeBundle({
  app, resourcesPath, timeoutMs = DEFAULT_SOURCE_WAIT_TIMEOUT_MS,
  intervalMs = DEFAULT_SOURCE_WAIT_INTERVAL_MS, progress = createRuntimeProgress(),
}) {
  if (!app.isPackaged) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Packaged runtime source wait requires non-negative timeoutMs and positive intervalMs");
  }
  const source = path.join(resourcesPath, "runtime");
  const identity = { version: app.getVersion(), platform: process.platform, arch: process.arch };
  const deadline = Date.now() + timeoutMs;
  let manifest;
  let pending;
  let lastDetail = "Runtime manifest is missing";
  progress.start("waiting-source");
  for (;;) {
    if (!manifest) {
      try { manifest = readRuntimeManifest(source, identity); pending = manifest.files; }
      catch (error) {
        if (!(error instanceof RuntimeIntegrityError) || error.reason !== "missing-manifest") throw error;
        lastDetail = error.message;
      }
    }
    if (manifest) {
      // Retry metadata only for unresolved entries, without walking or hashing the tree.
      pending = pending.filter(file => {
        const filePath = path.join(source, ...file.path.split("/"));
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) throw new RuntimeIntegrityError("damaged-runtime", "Runtime bundle entry is not a file: " + filePath);
          if (stat.size === file.size) return false;
          lastDetail = "Runtime bundle file size mismatch: " + filePath;
        } catch (error) {
          if (!missing(error)) throw error;
          lastDetail = "Runtime bundle file is missing: " + filePath;
        }
        return true;
      });
      if (pending.length === 0) break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Packaged runtime did not fully materialize within " + timeoutMs + "ms: " + lastDetail);
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  progress.complete({ totalFiles: manifest.files.length });
  progress.start("verifying-source", { totalFiles: manifest.files.length });
  const result = inspectRuntimeBundle(source, identity, progress);
  progress.complete({ totalFiles: manifest.files.length });
  return result;
}

async function waitForPackagedRuntimeSource(options) {
  return (await waitForPackagedRuntimeBundle(options))?.runtimeRoot ?? null;
}

function installedRuntimePath(coreHome, identity) {
  return path.join(coreHome, "versions", `${identity.version}-${identity.platform}-${identity.arch}`);
}

function recordVerifiedInstall(runtimeRoot, manifest) {
  writePrivateFileAtomic(`${runtimeRoot}.verified.json`, JSON.stringify({
    schemaVersion: 1, bundleId: manifest.bundleId,
    appVersion: manifest.appVersion, platform: manifest.platform, arch: manifest.arch,
    verifiedAt: new Date().toISOString(),
  }));
  return runtimeRoot;
}

function inspectInstalledRuntimeStartup(runtimeRoot, identity) {
  const manifest = readRuntimeManifest(runtimeRoot, identity);
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(runtimeRoot + ".verified.json", "utf8")); }
  catch (error) {
    if (!missing(error) && !(error instanceof SyntaxError)) throw error;
    throw new RuntimeIntegrityError("missing-receipt", "Runtime installation needs a complete integrity check");
  }
  if (!receipt || receipt.schemaVersion !== 1 || receipt.bundleId !== manifest.bundleId
    || receipt.appVersion !== identity.version || receipt.platform !== identity.platform || receipt.arch !== identity.arch) {
    throw new RuntimeIntegrityError("invalid-receipt", "Runtime installation needs a complete integrity check");
  }
  const paths = runtimeBundlePaths(runtimeRoot, identity.platform);
  const entries = [paths.executable, paths.entrypoint,
    path.join(runtimeRoot, "app", "browser-helper.cjs"), path.join(runtimeRoot, ...manifest.launcher.split("/"))];
  const canonicalRoot = fs.realpathSync(runtimeRoot);
  for (const entry of entries) {
    const file = manifest.files.find(file => file.path === path.relative(runtimeRoot, entry).split(path.sep).join("/"));
    if (!file) throw new RuntimeIntegrityError("invalid-manifest", "Runtime manifest does not declare a startup entry");
    validateRuntimeFile(runtimeRoot, canonicalRoot, file);
  }
  if (identity.platform !== "win32" && (fs.statSync(paths.executable).mode & 0o111) === 0) {
    throw new RuntimeIntegrityError("damaged-runtime", "Bundled Bun runtime is not executable");
  }
  return paths.runtimeRoot;
}

// On a normal launch only the durable bundle is executed, including the browser helper.
// A receipt records the completed full installation check; it is not a signature or a trust
// boundary against a process running as this user. Daily startup checks identity and four entry
// files. Recursive integrity checks belong to installation, upgrade, repair and diagnostics.
async function preparePackagedRuntime(options) {
  const { app, coreHome, resourcesPath, onProgress } = options;
  if (!app.isPackaged) return null;
  const progress = createRuntimeProgress(onProgress);
  const identity = { version: app.getVersion(), platform: process.platform, arch: process.arch };
  const source = path.join(resourcesPath, "runtime");
  const destination = installedRuntimePath(coreHome, identity);
  progress.start("checking-installation");
  let manifest;
  try { manifest = readRuntimeManifest(source, identity); }
  catch (error) {
    if (!(error instanceof RuntimeIntegrityError) || error.reason !== "missing-manifest") throw error;
  }
  let reason = "source-not-ready";
  if (manifest) {
    try {
      const installed = inspectInstalledRuntimeStartup(destination, { ...identity, bundleId: manifest.bundleId });
      progress.complete({ reason: "verified-installation" });
      return installed;
    } catch (error) {
      // Access, sharing and disk errors are operational failures, not evidence of corruption.
      if (!(error instanceof RuntimeIntegrityError)) throw error;
      reason = error.reason;
      if (reason === "missing-manifest") {
        try { fs.statSync(destination); reason = "damaged-runtime"; }
        catch (statError) { if (!missing(statError)) throw statError; reason = "first-install"; }
      }
    }
  }
  progress.complete({ reason });
  const sourceBundle = await waitForPackagedRuntimeBundle({ ...options, progress });
  return installVerifiedRuntime({ source, sourceBundle, coreHome, identity, progress });
}

function checkPackagedRuntimeReady({ app, coreHome, resourcesPath, onProgress }) {
  if (!app.isPackaged) return null;
  const identity = { version: app.getVersion(), platform: process.platform, arch: process.arch };
  const progress = createRuntimeProgress(onProgress);
  progress.start("checking-installation");
  try {
    const manifest = readRuntimeManifest(path.join(resourcesPath, "runtime"), identity);
    const installed = inspectInstalledRuntimeStartup(installedRuntimePath(coreHome, identity), {
      ...identity, bundleId: manifest.bundleId,
    });
    progress.complete({ reason: "verified-installation" });
    return installed;
  } catch (error) {
    if (!(error instanceof RuntimeIntegrityError)) throw error;
    throw new RuntimeIntegrityError(error.reason,
      "Installation needs repair. Close Web2Harness and run its Windows installer again. / 安装需要修复，请退出 Web2Harness 后重新运行 Windows 安装程序。"
      + ` (${error.reason})`);
  }
}

function ensurePackagedRuntime({ app, coreHome, resourcesPath, onProgress }) {
  if (!app.isPackaged) return null;
  const identity = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
  const source = path.join(resourcesPath, "runtime");
  const progress = createRuntimeProgress(onProgress);
  progress.start("verifying-source");
  const sourceBundle = inspectRuntimeBundle(source, identity, progress);
  progress.complete({ totalFiles: sourceBundle.manifest.files.length });
  return installVerifiedRuntime({ source, sourceBundle, coreHome, identity, progress });
}

function installVerifiedRuntime({ source, sourceBundle, coreHome, identity, progress = createRuntimeProgress() }) {
  const expectedIdentity = { ...identity, bundleId: sourceBundle.manifest.bundleId };
  const versionsRoot = path.join(coreHome, "versions");
  const destination = installedRuntimePath(coreHome, identity);
  if (fs.existsSync(destination)) {
    try {
      progress.start("verifying-installed", { totalFiles: sourceBundle.manifest.files.length });
      inspectRuntimeBundle(destination, expectedIdentity, progress);
      progress.complete();
      return recordVerifiedInstall(destination, sourceBundle.manifest);
    } catch (error) {
      if (!(error instanceof RuntimeIntegrityError)) throw error;
      progress.complete({ reason: error.reason });
      // A terminated installer or external cleanup can leave a version directory present but
      // incomplete. Rebuild the launcher-owned bundle transactionally from the verified source.
    }
  }

  fs.mkdirSync(versionsRoot, { recursive: true, mode: 0o700 });
  const stagingRoot = fs.mkdtempSync(`${destination}.tmp-`);
  // Reserve an exclusive container, but let cp create its destination. Bun rejects
  // an existing directory with errorOnExist, even when that directory is empty.
  const temporary = path.join(stagingRoot, "runtime");
  const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
  let previousMoved = false;
  const totalFiles = sourceBundle.manifest.files.length;
  const declaredFiles = new Set(sourceBundle.manifest.files.map(file => file.path));
  let copied = 0;
  try {
    progress.start("copying-runtime", { totalFiles });
    fs.cpSync(source, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
      filter(from) {
        if (declaredFiles.has(path.relative(source, from).split(path.sep).join("/"))) {
          progress.advance(copied++, totalFiles);
        }
        return true;
      },
    });
    progress.complete({ completedFiles: copied, totalFiles });
    progress.start("verifying-copy", { totalFiles });
    inspectRuntimeBundle(temporary, expectedIdentity, progress);
    if (process.platform !== "win32") fs.chmodSync(temporary, 0o700);
    progress.complete({ totalFiles });
    progress.start("committing-runtime");
    if (fs.existsSync(destination)) {
      renameAtomicFile(destination, previous);
      previousMoved = true;
    }
    try {
      renameAtomicFile(temporary, destination);
      // The exclusively owned verified tree moves on the same filesystem.
      // Receipt failure rolls back before the old tree can be discarded.
      recordVerifiedInstall(destination, sourceBundle.manifest);
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      if (previousMoved) {
        try {
          renameAtomicFile(previous, destination);
          previousMoved = false;
        } catch (restoreError) {
          throw new Error(
            `Runtime replacement failed: ${error instanceof Error ? error.message : String(error)}`
            + `; previous runtime restoration failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          );
        }
      }
      throw error;
    }
    if (previousMoved) {
      try { fs.rmSync(previous, { recursive: true, force: true }); }
      catch (error) { progress.complete({ cleanupDeferred: true, errorCode: error.code }); }
      previousMoved = false;
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (previousMoved && fs.existsSync(previous) && !fs.existsSync(destination)) {
      renameAtomicFile(previous, destination);
      previousMoved = false;
    }
  }
  progress.complete();
  return destination;
}

module.exports = {
  ensurePackagedRuntime,
  preparePackagedRuntime,
  checkPackagedRuntimeReady,
  installedRuntimePath,
  validateRuntimeBundle,
  waitForPackagedRuntimeSource,
};
