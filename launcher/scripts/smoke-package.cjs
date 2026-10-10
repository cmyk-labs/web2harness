const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateRuntimeBundle } = require("../electron/installation/runtime-install.cjs");
const { capturePackageSmokeFailure } = require("./package-smoke-diagnostics.cjs");
const { redactExportText } = require("../electron/logging.cjs");

const launcherRoot = path.resolve(__dirname, "..");
const artifactsDirectory = path.join(launcherRoot, "artifacts");
const launcherManifest = JSON.parse(
  fs.readFileSync(path.join(launcherRoot, "package.json"), "utf8"),
);
const expectedVersion = launcherManifest.version;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-package-smoke-"));
const markerPath = path.join(scratch, "ready.json");
const coreHome = path.join(scratch, "core-home");
let macAppBundle;
let failure;
const commands = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || scratch,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout || 45_000,
    windowsHide: true,
  });
  commands.push({ command, args, status: result.status, signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout?.slice(-64 * 1024), stderr: result.stderr?.slice(-64 * 1024) });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      redactExportText(`${command} failed with status ${result.status}:`
        + `\n${result.stderr?.trim() || ""}\n${result.stdout?.trim() || ""}`),
    );
  }
}

function windowsInstallLocation() {
  const guid = launcherManifest.build.nsis.guid;
  const registryKey = `HKCU\\Software\\${guid}`;
  const result = spawnSync("reg.exe", ["query", registryKey, "/v", "InstallLocation"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows installer did not register ${registryKey}: ${result.stderr?.trim() || "no output"}`);
  }
  const match = result.stdout.match(/^\s*InstallLocation\s+REG_SZ\s+(.+?)\s*$/mi);
  if (!match || !path.win32.isAbsolute(match[1])) {
    throw new Error(`Windows installer registered an invalid InstallLocation: ${result.stdout.trim()}`);
  }
  return match[1];
}

function artifact(pattern, label) {
  const matches = fs.readdirSync(artifactsDirectory)
    .filter((name) => pattern.test(name))
    .sort();
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} in ${artifactsDirectory}; found ${matches.join(", ") || "none"}`);
  }
  return path.join(artifactsDirectory, matches[0]);
}

function smokeEnvironment() {
  return {
    ...process.env,
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    WEB2HARNESS_LAUNCHER_DATA_DIR: path.join(scratch, "launcher-data"),
    WEB2HARNESS_HOME: coreHome,
    CODEX_HOME: path.join(scratch, "codex-home"),
    WEB2HARNESS_SMOKE_FILE: markerPath,
    WEB2HARNESS_LICENSE_FILE: path.join(scratch, "unactivated.w2h"),
  };
}

try {
  let executable;
  let command;
  let args;
  const env = smokeEnvironment();

  if (process.platform === "darwin") {
    const archive = artifact(/-mac-(?:arm64|x64)\.zip$/, "macOS launcher archive");
    const stage = path.join(scratch, "stage");
    fs.mkdirSync(stage);
    run("ditto", ["-x", "-k", archive, stage]);
    macAppBundle = path.join(stage, "Web2Harness.app");
    executable = path.join(macAppBundle, "Contents", "MacOS", "Web2Harness");
    command = executable;
    args = ["--launcher-smoke-test"];
  } else if (process.platform === "linux") {
    if (!["x64", "arm64"].includes(process.arch)) {
      throw new Error(`Unsupported Linux AppImage architecture: ${process.arch}`);
    }
    executable = artifact(new RegExp(`-linux-${process.arch}\\.AppImage$`), `Linux ${process.arch} AppImage`);
    fs.chmodSync(executable, 0o755);
    run(path.join(launcherRoot, "scripts", "smoke-linux-appimage-symbols.sh"), [executable], {
      timeout: 120_000,
    });
    command = "xvfb-run";
    args = ["-a", executable, "--launcher-smoke-test"];
    env.APPIMAGE_EXTRACT_AND_RUN = "1";
  } else if (process.platform === "win32") {
    const installer = artifact(/-win-x64\.exe$/, "Windows installer");
    run(installer, ["/S", "/currentuser"], { env, timeout: 120_000 });
    executable = path.join(windowsInstallLocation(), `${launcherManifest.build.productName}.exe`);
    command = executable;
    args = ["--launcher-smoke-test"];
  } else {
    throw new Error(`Unsupported package smoke platform: ${process.platform}`);
  }

  if (!fs.existsSync(executable)) throw new Error(`Packaged launcher executable is missing: ${executable}`);
  run(command, args, { env });
  if (!fs.existsSync(markerPath)) throw new Error("Packaged launcher did not write its readiness marker");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  if (marker.ok !== true
    || marker.packaged !== true
    || marker.runtimeVerified !== true
    || marker.activationRequired !== true
    || marker.version !== expectedVersion
    || marker.platform !== process.platform) {
    throw new Error(`Unexpected packaged launcher marker: ${JSON.stringify(marker)}`);
  }
  const installedRuntime = path.join(
    coreHome,
    "versions",
    `${expectedVersion}-${process.platform}-${process.arch}`,
  );
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(installedRuntime, "manifest.json"), "utf8"),
  );
  const repositoryRoot = path.resolve(launcherRoot, "..");
  for (const relative of ["LICENSE", ...fs.readdirSync(path.join(repositoryRoot, "LICENSES"))
    .filter(name => fs.statSync(path.join(repositoryRoot, "LICENSES", name)).isFile())
    .map(name => path.join("LICENSES", name))]) {
    if (!fs.readFileSync(path.join(installedRuntime, relative)).equals(fs.readFileSync(path.join(repositoryRoot, relative)))) {
      throw new Error(`Packaged license differs from source: ${relative}`);
    }
  }
  if (fs.statSync(path.join(installedRuntime, "THIRD_PARTY_NOTICES.txt")).size === 0) {
    throw new Error("Packaged third-party notices are empty");
  }
  validateRuntimeBundle(installedRuntime, {
    version: expectedVersion,
    platform: process.platform,
    arch: process.arch,
  });
  if (installedManifest.schemaVersion !== 2
    || installedManifest.appVersion !== expectedVersion
    || installedManifest.platform !== process.platform
    || installedManifest.arch !== process.arch
    || !Array.isArray(installedManifest.files)
    || installedManifest.files.length === 0
    || !/^[a-f0-9]{64}$/.test(installedManifest.bundleId)) {
    throw new Error(`Packaged launcher installed the wrong durable runtime: ${JSON.stringify(installedManifest)}`);
  }
} catch (error) {
  failure = error;
} finally {
  try {
    if (macAppBundle) {
      const launchServices =
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
      run(
        launchServices,
        ["-u", macAppBundle],
      );
      run(launchServices, ["-gc"]);
    }
  } catch (error) {
    failure ??= error;
  }
  let retainScratch = false;
  if (failure) {
    try {
      const diagnostics = capturePackageSmokeFailure({ scratch, error: failure, commands,
        outputDirectory: path.join(launcherRoot, "..", "output", "package-smoke") });
      process.stderr.write(`Package smoke diagnostics: ${diagnostics}\n`);
    } catch (error) {
      retainScratch = true;
      process.stderr.write(`Could not export smoke diagnostics: ${redactExportText(error.message)}\n`
        + `Retained smoke directory: ${scratch}\n`);
    }
  }
  if (!retainScratch) {
    if (fs.realpathSync(path.dirname(scratch)) !== fs.realpathSync(os.tmpdir())
      || !path.basename(scratch).startsWith("web2harness-package-smoke-")) {
      throw new Error("Refusing to remove an unowned package smoke directory");
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
if (failure) throw failure;
process.stdout.write(`PACKAGED_LAUNCHER_SMOKE_OK ${process.platform}/${process.arch}\n`);
