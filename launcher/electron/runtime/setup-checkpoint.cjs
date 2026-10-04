const path = require("node:path");
const fs = require("node:fs");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");

const MAX_CHECKPOINT_FILE_BYTES = 16 * 1024 * 1024;

function captureRegularFile(filePath, { followSymlink = false } = {}) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { path: filePath, exists: false };
    throw error;
  }
  let symlink;
  if (followSymlink && stat.isSymbolicLink()) {
    symlink = { link: fs.readlinkSync(filePath), target: fs.realpathSync(filePath) };
    stat = fs.lstatSync(symlink.target);
  }
  if (!stat.isFile()) {
    throw new Error(`Setup checkpoint path is not a regular file: ${filePath}`);
  }
  if (stat.size > MAX_CHECKPOINT_FILE_BYTES) {
    throw new Error(`Setup checkpoint file exceeds ${MAX_CHECKPOINT_FILE_BYTES} bytes: ${filePath}`);
  }
  return {
    path: filePath,
    exists: true,
    data: fs.readFileSync(symlink?.target ?? filePath),
    mode: stat.mode & 0o777,
    ...(symlink ? { symlink } : {}),
  };
}

function checkpointWritePath(snapshot) {
  if (!snapshot.symlink) return snapshot.path;
  if (!fs.lstatSync(snapshot.path).isSymbolicLink()
    || fs.readlinkSync(snapshot.path) !== snapshot.symlink.link
    || fs.realpathSync(snapshot.path) !== snapshot.symlink.target) {
    throw new Error(`Codex config symlink changed during setup: ${snapshot.path}`);
  }
  return snapshot.symlink.target;
}

function restoreRegularFile(snapshot, platform) {
  if (!snapshot.exists) {
    fs.rmSync(snapshot.path, { force: true });
    return;
  }
  const writePath = checkpointWritePath(snapshot);
  writePrivateFileAtomic(writePath, snapshot.data, snapshot.symlink
    ? { mode: snapshot.mode, protectDirectory: false }
    : undefined);
  if (platform !== "win32") fs.chmodSync(writePath, snapshot.mode);
}

function regularFileChanged(snapshot, platform) {
  let filePath;
  try { filePath = checkpointWritePath(snapshot); } catch { return true; }
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return snapshot.exists;
    throw error;
  }
  if (!snapshot.exists || !stat.isFile()) return true;
  if (platform !== "win32" && (stat.mode & 0o777) !== snapshot.mode) return true;
  if (stat.size > MAX_CHECKPOINT_FILE_BYTES) return true;
  return !fs.readFileSync(filePath).equals(snapshot.data);
}

function captureSetupCheckpoint({ configPath, coreHome, codexHome, launchAgentsDir, platform, runtimeSnapshot }) {
  if (typeof configPath !== "string" || !path.isAbsolute(configPath)) {
    throw new Error("Launcher runtime supervisor has no absolute configuration path for setup rollback");
  }
  const checkpointHome = coreHome || path.dirname(configPath);
  const paths = new Set([
    configPath,
    path.join(checkpointHome, "codex", "integration-journal.json"),
    path.join(checkpointHome, "codex", "integration-journal.recovery.json"),
    path.join(codexHome, "config.toml"),
    path.join(codexHome, "models_cache.json"),
    path.join(checkpointHome, "secrets", "tunnel-runtime.key"),
    path.join(checkpointHome, "secrets", "tunnel-runtime-automatic.key"),
    path.join(checkpointHome, "secrets", "tunnel-runtime-zero-risk.key"),
    path.join(checkpointHome, "tunnel", "profiles", "web2harness.yaml"),
    path.join(checkpointHome, "tunnel", "profiles", "web2harness-zero-risk.yaml"),
    path.join(checkpointHome, "tunnel", "profiles", "web2harness-dev.yaml"),
    path.join(checkpointHome, "tunnel", "profiles", "web2harness-dev-zero-risk.yaml"),
  ]);
  if (runtimeSnapshot.owner === "external" && platform === "darwin") {
    paths.add(path.join(launchAgentsDir, "io.github.web2harness.daemon.plist"));
    paths.add(path.join(launchAgentsDir, "io.github.web2harness.tunnel.plist"));
  }
  const tunnels = [
    runtimeSnapshot.config?.tunnel,
    runtimeSnapshot.config?.automaticTunnel,
    runtimeSnapshot.config?.manualTunnel,
  ];
  for (const tunnel of tunnels) {
    if (!tunnel || typeof tunnel !== "object") continue;
    if (typeof tunnel.runtimeKeyFile === "string" && tunnel.runtimeKeyFile) {
      paths.add(tunnel.runtimeKeyFile);
    }
    if (typeof tunnel.profileDir === "string"
      && tunnel.profileDir
      && typeof tunnel.profileName === "string"
      && tunnel.profileName) {
      paths.add(path.join(tunnel.profileDir, `${tunnel.profileName}.yaml`));
    }
  }
  return [...paths].map(filePath => captureRegularFile(filePath, {
    followSymlink: filePath === path.join(codexHome, "config.toml"),
  }));
}

function setupCheckpointChanged(checkpoint, platform) {
  return checkpoint ? checkpoint.some(snapshot => regularFileChanged(snapshot, platform)) : false;
}

function restoreSetupCheckpoint(checkpoint, platform) {
  if (!checkpoint) return;
  const failures = [];
  for (const snapshot of [...checkpoint].reverse()) {
    try {
      restoreRegularFile(snapshot, platform);
    } catch (error) {
      failures.push(`${snapshot.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Setup checkpoint restoration failed: ${failures.join("; ")}`);
  }
}

module.exports = { captureSetupCheckpoint, setupCheckpointChanged, restoreSetupCheckpoint };
