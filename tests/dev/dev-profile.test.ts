import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  devLauncherEnvironment,
  installedLauncherCandidates,
  launchDevProfile,
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

test("Context as File defaults on with standard budget and respects only sourced DEV preferences", () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-dev-features-"));
  try {
    const paths = resolveDevProfilePaths({
      homeDirectory: root,
      environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") },
    });
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: true, contextTripleBudget: false });
    mkdirSync(paths.home, { recursive: true });
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: true,
    }));
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: true, contextTripleBudget: false });
    for (const version of [4, 5]) {
      writeFileSync(paths.configPath, JSON.stringify({ version, experimentalContextFiles: true, experimentalContextTripleBudget: true, contextPreferenceSources: { files: "user", budget: "user" } }));
      expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: true, contextTripleBudget: true });
    }
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: "yes",
    }));
    expect(() => readDevChatExperimentalFeatures(paths)).toThrow("Invalid experimentalBiggerContext");
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

async function withLauncherSpawnFixture(
  executable: string | undefined,
  check: (calls: { args: string[]; options: childProcess.SpawnOptions; child: EventEmitter }[], result: Promise<Error | null>) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "web2harness-dev-prepare-"));
  const paths = resolveDevProfilePaths({ homeDirectory: root, environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") } });
  const override = process.env.WEB2HARNESS_LAUNCHER_EXECUTABLE;
  delete process.env.WEB2HARNESS_LAUNCHER_EXECUTABLE;
  const calls: { args: string[]; options: childProcess.SpawnOptions; child: EventEmitter }[] = [];
  const spawn = spyOn(childProcess, "spawn").mockImplementation(((_command: string, args: string[], options: childProcess.SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), { unref() {} });
    calls.push({ args, options, child });
    return child;
  }) as unknown as typeof childProcess.spawn);
  const result = launchDevProfile(paths, { executable, timeoutMs: 1 }).then(() => null, (error: Error) => error);
  try {
    await check(calls, result);
  } finally {
    // Keep the mock installed until all asynchronous launch work is finished.
    // A failed assertion must never let cleanup start a real launcher.
    for (const call of calls) call.child.emit("exit", 1, null);
    await result;
    spawn.mockRestore();
    if (override === undefined) delete process.env.WEB2HARNESS_LAUNCHER_EXECUTABLE;
    else process.env.WEB2HARNESS_LAUNCHER_EXECUTABLE = override;
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-dev-prepare-")) {
      throw new Error("Refusing to remove an unowned DEV preparation fixture");
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test("source DEV waits for dependency preparation before starting its readiness deadline", async () => {
  await withLauncherSpawnFixture(undefined, async (calls, result) => {
    expect(calls).toHaveLength(1);
    expect(calls[0].args.at(-1)).toBe("--prepare");
    expect(calls[0].options.detached).not.toBe(true);
    expect(calls[0].options.stdio).toBe("inherit");
    expect(calls[0].options.windowsHide).toBe(true);
    expect(calls[0].options.env?.WEB2HARNESS_HOME).toBeUndefined();
    expect(calls[0].options.env?.CODEX_HOME).toBeUndefined();
    // This exceeds the 1ms readiness timeout but must not time out preparation.
    await Bun.sleep(20);
    expect(calls).toHaveLength(1);
    calls[0].child.emit("exit", 0, null);
    expect((await result)?.message).toContain("DEV launcher did not become ready within 1ms");
    expect(calls).toHaveLength(2);
    expect(calls[1].args.at(-1)).not.toBe("--prepare");
    expect(calls[1].options.detached).toBe(true);
    expect(calls[1].options.env).toEqual(calls[0].options.env);
  });
});

for (const failure of ["exit", "error", "signal"] as const) {
  test(`source DEV preparation ${failure} fails without starting the runtime`, async () => {
    await withLauncherSpawnFixture(undefined, async (calls, result) => {
      expect(calls[0].args.at(-1)).toBe("--prepare");
      if (failure === "error") calls[0].child.emit("error", new Error("fixture spawn failed"));
      else calls[0].child.emit("exit", failure === "exit" ? 7 : null, failure === "signal" ? "SIGTERM" : null);
      const error = await result;
      expect(error?.message).toContain(failure === "error" ? "fixture spawn failed" : "DEV launcher dependency preparation failed");
      expect(calls).toHaveLength(1);
    });
  });
}

test("an explicit packaged DEV executable does not run source dependency preparation", async () => {
  await withLauncherSpawnFixture(process.execPath, async (calls, result) => {
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["--dev-profile"]);
    expect(calls[0].options.detached).toBe(true);
    expect((await result)?.message).toContain("DEV launcher did not become ready within 1ms");
  });
});
