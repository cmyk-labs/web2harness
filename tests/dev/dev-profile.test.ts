import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  devLauncherEnvironment,
  installedLauncherCandidates,
  readDevChatExperimentalFeatures,
  resolveDevProfilePaths,
} from "../../src/dev/profile";

test("DEV profile paths isolate browser, Codex, config, chat, and runtime state", () => {
  const homeDirectory = "/Users/tester";
  const devHome = resolve(homeDirectory, "development");
  const paths = resolveDevProfilePaths({
    homeDirectory,
    environment: {
      WEB2HARNESS_HOME: join(homeDirectory, "production"),
      WEB2HARNESS_DEV_HOME: join(homeDirectory, "development"),
    },
  });
  expect(paths).toEqual({
    home: devHome,
    codexHome: join(devHome, "codex-home"),
    launcherUserData: join(devHome, "launcher"),
    launcherStatePath: join(devHome, "launcher", "launcher-state.json"),
    descriptorPath: join(devHome, "runtime", "launcher-browser.json"),
    chatsPath: join(devHome, "chats"),
    runtimePath: join(devHome, "runtime", "dev-chat"),
    configPath: join(devHome, "config.json"),
  });
});

test("Bigger Context is disabled by default and read from the isolated DEV runtime config", () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-dev-features-"));
  try {
    const paths = resolveDevProfilePaths({
      homeDirectory: root,
      environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") },
    });
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: false, contextTripleBudget: false });
    mkdirSync(paths.home, { recursive: true });
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: true,
    }));
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: true, contextTripleBudget: false });
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: "yes",
    }));
    expect(() => readDevChatExperimentalFeatures(paths)).toThrow("Invalid context file preference");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV profile path refuses production home reuse", () => {
  const shared = "/Users/tester/shared";
  expect(() => resolveDevProfilePaths({
    homeDirectory: "/Users/tester",
    environment: {
      WEB2HARNESS_HOME: shared,
      WEB2HARNESS_DEV_HOME: shared,
    },
  })).toThrow("must differ from the production");
});

test("installed launcher discovery has explicit platform candidates", () => {
  expect(installedLauncherCandidates({
    platform: "darwin",
    homeDirectory: "/Users/tester",
    environment: {},
  })).toEqual([
    "/Applications/Web2Harness.app/Contents/MacOS/Web2Harness",
    "/Users/tester/Applications/Web2Harness.app/Contents/MacOS/Web2Harness",
  ]);
  expect(installedLauncherCandidates({
    platform: "linux",
    homeDirectory: "/home/tester",
    environment: { PATH: "/usr/local/bin:/usr/bin" },
  })).toEqual([
    "/home/tester/.local/bin/web2harness-desktop",
    "/usr/local/bin/web2harness-desktop",
    "/usr/bin/web2harness-desktop",
  ]);
  expect(installedLauncherCandidates({
    platform: "win32",
    homeDirectory: "C:\\Users\\tester",
    environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
  })).toEqual([
    "C:\\Users\\tester\\AppData\\Local\\Programs\\Web2Harness\\Web2Harness.exe",
  ]);
  expect(installedLauncherCandidates({
    platform: "win32",
    homeDirectory: "C:\\Users\\tester",
    environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    windowsInstallLocation: "D:\\Apps\\Web2Harness",
  })).toEqual([
    "D:\\Apps\\Web2Harness\\Web2Harness.exe",
  ]);
});

test("injected Windows discovery avoids the live registry while ordinary discovery still uses it", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const registry = spyOn(childProcess, "execFileSync").mockImplementation((() =>
    "    InstallLocation    REG_SZ    D:\\Installed\\Web2Harness\n"
  ) as unknown as typeof childProcess.execFileSync);
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    expect(installedLauncherCandidates({
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\Fixture\\AppData\\Local" },
    })).toEqual(["C:\\Fixture\\AppData\\Local\\Programs\\Web2Harness\\Web2Harness.exe"]);
    expect(registry).not.toHaveBeenCalled();
    expect(installedLauncherCandidates({ platform: "win32", environment: process.env }))
      .toEqual(["D:\\Installed\\Web2Harness\\Web2Harness.exe"]);
    expect(registry).toHaveBeenCalledTimes(1);
    expect(installedLauncherCandidates({
      platform: "win32", environment: {}, windowsInstallLocation: "E:\\Explicit",
    })).toEqual(["E:\\Explicit\\Web2Harness.exe"]);
    expect(registry).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(process, "platform", platform);
    registry.mockRestore();
  }
});

test("DEV launcher child cannot inherit production home or browser-profile overrides", () => {
  const paths = resolveDevProfilePaths({
    homeDirectory: "/Users/tester",
    environment: {
      WEB2HARNESS_HOME: "/Users/tester/production",
      WEB2HARNESS_DEV_HOME: "/Users/tester/development",
    },
  });
  expect(devLauncherEnvironment(paths, {
    KEEP_ME: "yes",
    WEB2HARNESS_HOME: paths.home,
    CODEX_HOME: "/Users/tester/production-codex",
    WEB2HARNESS_LAUNCHER_DATA_DIR: "/Users/tester/production-launcher",
    ELECTRON_RUN_AS_NODE: "1",
  })).toEqual({
    KEEP_ME: "yes",
    WEB2HARNESS_DEV_HOME: paths.home,
  });
});
