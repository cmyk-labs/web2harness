import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, resolve, win32 } from "node:path";
import { expandUserPath, getConfigPath } from "../config";
import {
  readLauncherBrowserHostDescriptor,
  type LauncherBrowserHostDescriptor,
} from "../browser/launcher-client";

import { DEV_LAUNCHER_PROFILE } from "./constants";
import { assertSeparateDevHome } from "./isolation";

export interface DevProfilePaths {
  home: string;
  codexHome: string;
  launcherUserData: string;
  launcherStatePath: string;
  descriptorPath: string;
  chatsPath: string;
  runtimePath: string;
  configPath: string;
}

const WINDOWS_LAUNCHER_GUID = "8b7be269-ac7f-4ab6-82e9-71408ffa370b";

function registeredWindowsLauncherInstallLocation(): string | undefined {
  try {
    const output = execFileSync(
      "reg.exe",
      ["query", `HKCU\\Software\\${WINDOWS_LAUNCHER_GUID}`, "/v", "InstallLocation"],
      { encoding: "utf8", windowsHide: true },
    );
    const match = output.match(/^\s*InstallLocation\s+REG_SZ\s+(.+?)\s*$/mi);
    return match && win32.isAbsolute(match[1]) ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDevProfilePaths({
  environment = process.env,
  homeDirectory = homedir(),
}: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): DevProfilePaths {
  const home = resolve(expandUserPath(
    environment.WEB2HARNESS_DEV_HOME?.trim() || join(homeDirectory, ".web2harness-dev"),
  ));
  const productionHome = resolve(expandUserPath(
    environment.WEB2HARNESS_HOME?.trim() || join(homeDirectory, ".web2harness"),
  ));
  assertSeparateDevHome(home, [productionHome, join(homeDirectory, ".web2harness"),
    join(homeDirectory, ".codex"),
    ...(environment.CODEX_HOME ? [environment.CODEX_HOME] : []),
    ...(environment.WEB2HARNESS_LAUNCHER_DATA_DIR ? [environment.WEB2HARNESS_LAUNCHER_DATA_DIR] : []),
  ]);
  const launcherUserData = join(home, "launcher");
  return {
    home,
    codexHome: join(home, "codex-home"),
    launcherUserData,
    launcherStatePath: join(launcherUserData, "launcher-state.json"),
    descriptorPath: join(home, "runtime", "launcher-browser.json"),
    chatsPath: join(home, "chats"),
    runtimePath: join(home, "runtime", "dev-chat"),
    configPath: join(home, "config.json"),
  };
}

export interface DevChatExperimentalFeatures {
  contextFiles: boolean;
  contextTripleBudget: boolean;
}

/** Read the canonical DEV runtime setting consumed by repository chat commands. */
export function readDevChatExperimentalFeatures(
  paths = resolveDevProfilePaths(),
): DevChatExperimentalFeatures {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(paths.configPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { contextFiles: false, contextTripleBudget: false };
    throw new Error(
      `Could not read DEV runtime settings from ${paths.configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || ![3, 4].includes((value as { version?: number }).version ?? 0)) {
    throw new Error(`Invalid DEV runtime settings in ${paths.configPath}`);
  }
  const config = value as { experimentalContextFiles?: unknown; experimentalContextTripleBudget?: unknown; experimentalBiggerContext?: unknown };
  const enabled = config.experimentalContextFiles ?? config.experimentalBiggerContext;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error(`Invalid context file preference in ${paths.configPath}`);
  }
  if (config.experimentalContextTripleBudget !== undefined && typeof config.experimentalContextTripleBudget !== "boolean") {
    throw new Error(`Invalid context budget preference in ${paths.configPath}`);
  }
  return { contextFiles: enabled === true, contextTripleBudget: enabled === true && config.experimentalContextTripleBudget === true };
}

export function activateDevProfileEnvironment(paths = resolveDevProfilePaths()): DevProfilePaths {
  process.env.WEB2HARNESS_DEV_HOME = paths.home;
  process.env.WEB2HARNESS_HOME = paths.home;
  process.env.CODEX_HOME = paths.codexHome;
  if (getConfigPath() !== paths.configPath) {
    throw new Error("DEV profile environment did not resolve to its isolated configuration path");
  }
  return paths;
}

function executableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (process.platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

export function installedLauncherCandidates({
  environment = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
  windowsInstallLocation,
}: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  windowsInstallLocation?: string;
} = {}): string[] {
  const override = environment.WEB2HARNESS_LAUNCHER_EXECUTABLE?.trim();
  const candidates = override ? [expandUserPath(override)] : [];
  const targetPath = platform === "win32" ? win32 : posix;
  if (platform === "darwin") {
    candidates.push(
      "/Applications/Web2Harness.app/Contents/MacOS/Web2Harness",
      posix.join(homeDirectory, "Applications", "Web2Harness.app", "Contents", "MacOS", "Web2Harness"),
    );
  } else if (platform === "win32") {
    const registeredLocation = windowsInstallLocation?.trim()
      || (process.platform === "win32" && environment === process.env
        ? registeredWindowsLauncherInstallLocation() : undefined);
    if (registeredLocation && win32.isAbsolute(registeredLocation)) {
      candidates.push(win32.join(registeredLocation, "Web2Harness.exe"));
    } else {
      const localAppData = environment.LOCALAPPDATA?.trim();
      if (localAppData) {
        candidates.push(win32.join(localAppData, "Programs", "Web2Harness", "Web2Harness.exe"));
      }
    }
  } else if (platform === "linux") {
    candidates.push(posix.join(homeDirectory, ".local", "bin", "web2harness-desktop"));
    for (const entry of (environment.PATH || "").split(":").filter(Boolean)) {
      candidates.push(posix.join(entry, "web2harness-desktop"));
    }
  }
  return [...new Set(candidates.map(candidate => targetPath.resolve(candidate)))];
}

export function findInstalledLauncherExecutable(options: Parameters<typeof installedLauncherCandidates>[0] = {}): string {
  const candidates = installedLauncherCandidates(options);
  const executable = candidates.find(executableFile);
  if (executable) return executable;
  throw new Error(
    "Installed launcher (legacy Web2Harness package) was not found. Install it first or set WEB2HARNESS_LAUNCHER_EXECUTABLE to its absolute executable path."
      + ` Checked: ${candidates.join(", ") || "no platform candidates"}`,
  );
}

export function devLauncherEnvironment(
  paths: DevProfilePaths,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment };
  delete childEnvironment.WEB2HARNESS_HOME;
  delete childEnvironment.CODEX_HOME;
  delete childEnvironment.WEB2HARNESS_LAUNCHER_DATA_DIR;
  // IDE extension hosts export ELECTRON_RUN_AS_NODE, which makes the spawned
  // launcher exe run as plain Node and reject --dev-profile before any app code.
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  childEnvironment.WEB2HARNESS_DEV_HOME = paths.home;
  return childEnvironment;
}

function devDescriptor(path: string): LauncherBrowserHostDescriptor {
  const descriptor = readLauncherBrowserHostDescriptor(path);
  if (descriptor.profile !== DEV_LAUNCHER_PROFILE) {
    throw new Error(`Launcher descriptor belongs to ${descriptor.profile}, not the isolated DEV profile`);
  }
  return descriptor;
}

export async function waitForDevLauncher(
  descriptorPath: string,
  timeoutMs = 30_000,
): Promise<LauncherBrowserHostDescriptor> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "descriptor is not ready";
  while (Date.now() < deadline) {
    try {
      return devDescriptor(descriptorPath);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`DEV launcher did not become ready within ${timeoutMs}ms: ${lastError}`);
}

export async function launchDevProfile(
  paths = resolveDevProfilePaths(),
  options: { executable?: string; timeoutMs?: number } = {},
): Promise<{ descriptor: LauncherBrowserHostDescriptor; executable: string; alreadyRunning: boolean }> {
  let existing: LauncherBrowserHostDescriptor | undefined;
  try { existing = devDescriptor(paths.descriptorPath); }
  catch { /* A stale or absent descriptor is replaced only by its owning launcher. */ }

  const sourceScript = resolve(import.meta.dir, "../../launcher/scripts/dev.cjs");
  const fromSource = !options.executable && !process.env.WEB2HARNESS_LAUNCHER_EXECUTABLE
    && existsSync(sourceScript);
  const executable = fromSource ? process.execPath
    : options.executable ? resolve(options.executable) : findInstalledLauncherExecutable();
  if (!isAbsolute(executable) || !executableFile(executable)) {
    throw new Error(`DEV launcher executable is not an executable regular file: ${executable}`);
  }
  const child = spawn(executable, fromSource ? ["run", sourceScript] : ["--dev-profile"], {
    detached: true,
    env: devLauncherEnvironment(paths),
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  const descriptor = await waitForDevLauncher(paths.descriptorPath, options.timeoutMs);
  return { descriptor, executable, alreadyRunning: existing?.pid === descriptor.pid };
}
