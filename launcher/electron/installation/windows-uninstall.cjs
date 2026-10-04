const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");
const { createStateStore } = require("../state.cjs");
const { RuntimeSupervisor } = require("../runtime/runtime-supervisor.cjs");
const { processRunning } = require("../common/process-tree.cjs");
const {
  APP_ID, assertPlainPath, identity, recordPaths, readJson, loadInstallation,
  registerInstallation, cleanupTargets, removeOwnedData,
} = require("./installation-record.cjs");

function runPowerShell(script, executable, run = spawnSync) {
  const shell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = run(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, WEB2HARNESS_UNINSTALL_EXE: executable },
    encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() || `System check exited with ${result.status}`);
  }
}

function assertLauncherClosed(executable) {
  runPowerShell(`$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'Web2Harness.exe'")
foreach ($item in $processes) {
  if (-not $item.ExecutablePath -or [string]::Equals($item.ExecutablePath, $env:WEB2HARNESS_UNINSTALL_EXE, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Web2Harness is still running. Finish its tasks, choose Exit in the tray menu, and retry. / 请先结束任务并从托盘退出 Web2Harness，再重试。'
  }
}`, executable);
}

function removeAutostart(executable) {
  runPowerShell(`$ErrorActionPreference = 'Stop'
$runPath = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($runPath, $true)
try {
  if ($key) {
    $value = $key.GetValue('Web2Harness', $null)
    if ($null -ne $value) {
      $expected = '"' + $env:WEB2HARNESS_UNINSTALL_EXE + '" --hidden'
      $unquoted = $env:WEB2HARNESS_UNINSTALL_EXE + ' --hidden'
      if ($value -ne $expected -and $value -ne $unquoted) { throw 'Web2Harness autostart entry was changed; it was preserved.' }
      $key.DeleteValue('Web2Harness', $false)
      $approved = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', $true)
      if ($approved) { try { $approved.DeleteValue('Web2Harness', $false) } finally { $approved.Dispose() } }
    }
  }
} finally { if ($key) { $key.Dispose() } }`, executable);
}

function preserveDisconnectedSettings(record) {
  const configPath = path.join(record.coreHome, "config.json");
  const savedPath = path.join(record.coreHome, "config.uninstalled.json");
  assertPlainPath(configPath);
  assertPlainPath(savedPath);
  if (fs.existsSync(configPath)) {
    writePrivateFileAtomic(savedPath, fs.readFileSync(configPath));
    fs.unlinkSync(configPath);
  }
  const statePath = path.join(record.userData, "launcher-state.json");
  assertPlainPath(statePath);
  if (fs.existsSync(statePath)) createStateStore(statePath).update({
    autoStart: false, coreSetupComplete: false, codexCatalogVerified: false,
    mcpSetupComplete: false, mcpRuntimeInstalled: false, mcpGuideStep: 0,
    browserSmokePassed: false, browserSmokeVersion: null, codexRestartRequired: true,
  });
}

async function stopOwnedRuntime(record, logger) {
  const supervisor = new RuntimeSupervisor({
    app: { isPackaged: true }, logger, sourceRoot: record.installRoot,
    coreHome: record.coreHome, browserDescriptorPath: path.join(record.coreHome, "runtime", "launcher-browser.json"),
  });
  const state = supervisor.readState();
  if (state && state.ownerPid !== process.pid && processRunning(state.ownerPid)) {
    throw new Error("A launcher still owns this runtime. Exit Web2Harness before uninstalling.");
  }
  await supervisor.stopForSetup();
}

async function prepareUninstall(options, services) {
  const { installRoot, appData, homeDir, purge = false, ownerPid } = options;
  if (!Number.isInteger(ownerPid) || ownerPid < 1 || !processRunning(ownerPid)) throw new Error("Uninstaller owner is not running");
  assertPlainPath(installRoot);
  const executable = path.join(installRoot, "Web2Harness.exe");
  await services.assertLauncherClosed(executable);
  let record = loadInstallation(options);
  if (!record) {
    // Older packages used these exact defaults. Custom profiles require their persisted record.
    record = registerInstallation({ ...options, profile: {
      coreHome: path.join(homeDir, ".web2harness"), userData: path.join(appData, "Web2Harness"),
      codexHome: path.join(homeDir, ".codex"),
    } });
  }
  const paths = recordPaths(appData, installRoot);
  const existingLock = readJson(paths.lock);
  if (existingLock && existingLock.pid !== ownerPid && processRunning(existingLock.pid)) {
    throw new Error("Another uninstall is already in progress");
  }
  writePrivateFileAtomic(paths.lock, JSON.stringify({ appId: APP_ID, pid: ownerPid }));
  try {
    if (purge) cleanupTargets(record, options);
    // Check the integration before stopping services or removing any data. Recheck at commit.
    await services.preflightIntegration(record);
    await services.stopRuntime(record);
    await services.removeIntegration(record);
    preserveDisconnectedSettings(record);
    await services.removeAutostart(executable);
    await services.assertLauncherClosed(executable);
    if (purge) removeOwnedData(record, options);
    writePrivateFileAtomic(paths.profile, JSON.stringify({ ...record, uninstallPrepared: true, purge }));
    return { purge, prepared: true };
  } catch (error) {
    fs.rmSync(paths.lock, { force: true });
    throw error;
  }
}

function finishUninstall(options) {
  const record = loadInstallation(options);
  if (!record?.uninstallPrepared) throw new Error("Uninstall preparation has not completed");
  if (fs.existsSync(options.installRoot) && fs.readdirSync(options.installRoot).length > 0) {
    throw new Error(`Program files are still present. Close applications holding them and retry: ${options.installRoot}`);
  }
  const paths = recordPaths(options.appData, options.installRoot);
  fs.rmSync(paths.lock, { force: true });
  if (record.purge) {
    fs.unlinkSync(paths.profile);
    fs.rmdirSync(paths.directory);
    const parent = path.dirname(paths.directory);
    if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
  } else {
    writePrivateFileAtomic(paths.profile, JSON.stringify({ ...record, uninstallPrepared: false, purge: false }));
  }
}

module.exports = { prepareUninstall, finishUninstall, assertLauncherClosed, removeAutostart, stopOwnedRuntime, runPowerShell };
