import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import * as configModule from "../src/config";
import * as integration from "../src/codex/integration";
import * as isolation from "../src/dev/isolation";
import * as browserHost from "../src/browser/launcher-client";
import { preflightSetup, setupDevProfile } from "../src/setup";
import {
  findInstalledLauncherExecutable,
  installedLauncherCandidates,
  readDevChatExperimentalFeatures,
  resolveDevProfilePaths,
} from "../src/dev/profile";

const fixtureParent = resolve(process.env.WEB2HARNESS_CONFIG_FIXTURE_ROOT || tmpdir());
const environmentKeys = ["WEB2HARNESS_HOME", "CODEX_HOME", "WEB2HARNESS_LAUNCHER"] as const;
let root: string;
let previousEnvironment: Array<string | undefined>;

beforeEach(() => {
  root = mkdtempSync(join(fixtureParent, "web2harness-config-consistency-"));
  if (dirname(resolve(root)) !== fixtureParent || !basename(root).startsWith("web2harness-config-consistency-")) {
    throw new Error("Configuration fixture escaped its owned parent");
  }
  previousEnvironment = environmentKeys.map(key => process.env[key]);
  process.env.WEB2HARNESS_HOME = root;
  process.env.CODEX_HOME = join(root, "codex-home");
  process.env.WEB2HARNESS_LAUNCHER = process.execPath;
});

afterEach(() => {
  for (const [index, key] of environmentKeys.entries()) {
    const previous = previousEnvironment[index];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  if (dirname(resolve(root)) !== fixtureParent || !basename(root).startsWith("web2harness-config-consistency-")) {
    throw new Error("Configuration fixture cleanup escaped its owned parent");
  }
  rmSync(root, { recursive: true, force: true });
});

function fixtureConfig(): configModule.AppConfig {
  return { ...configModule.defaultConfig(), runtimeCommand: [process.execPath] };
}

for (const input of ["relative", "absolute", "home"] as const) {
  test(`setup normalizes the ${input} descriptor before preflight and persistence`, () => {
    const absolute = join(root, "runtime", "launcher-browser.json");
    const path = input === "relative" ? relative(process.cwd(), absolute)
      : input === "home" ? "~/fixture-launcher-descriptor.json" : absolute;
    const expected = input === "home" ? join(homedir(), "fixture-launcher-descriptor.json") : absolute;
    let prepared: configModule.AppConfig | undefined;
    const preflight = spyOn(integration, "preflightCodexIntegration").mockImplementation(config => {
      prepared = config;
    });
    try {
      preflightSetup({
        mode: "native-tools",
        subagentProtocol: "compatibility-v1",
        browserHostDescriptorPath: path,
        acknowledgedUnofficial: true,
      });
      expect(prepared?.browserHostDescriptorPath).toBe(expected);
      configModule.saveConfig(prepared!);
      expect(configModule.loadConfig().browserHostDescriptorPath).toBe(expected);
    } finally {
      preflight.mockRestore();
    }
  });
}

test("DEV setup passes its normalized descriptor to inspection before runtime work", async () => {
  const absolute = join(root, "runtime", "launcher-browser.json");
  const isolatedHome = spyOn(isolation, "assertDevRuntimeIsolation").mockReturnValue(root);
  const stopBeforeRuntime = new Error("fixture stops before runtime work");
  const descriptor = spyOn(browserHost, "readLauncherBrowserHostDescriptor").mockImplementation(() => {
    throw stopBeforeRuntime;
  });
  try {
    await expect(setupDevProfile({
      mode: "native-tools",
      subagentProtocol: "compatibility-v1",
      browserHostDescriptorPath: relative(process.cwd(), absolute),
      acknowledgedUnofficial: true,
      port: 18765,
    })).rejects.toThrow(stopBeforeRuntime);
    expect(descriptor).toHaveBeenCalledWith(absolute);
    expect(existsSync(configModule.getConfigPath())).toBe(false);
  } finally {
    descriptor.mockRestore();
    isolatedHome.mockRestore();
  }
});

const invalidChanges: Array<[string, Record<string, unknown>, string]> = [
  ["relative descriptor", { browserHost: "launcher", browserHostDescriptorPath: "runtime/descriptor.json" }, "must be absolute"],
  ["port", { port: 0 }, "Invalid port"],
  ["connector identity", { appName: "different-connector" }, "Active appName does not match"],
  ["runtime command", { runtimeCommand: ["relative-runtime"] }, "Runtime executable must be absolute"],
  ["source without value", { experimentalContextFiles: undefined, contextPreferenceSources: { files: "user" } }, "Missing user experimentalContextFiles"],
  ["non-finite timeout", { stallTimeoutSec: Infinity }, "Invalid stallTimeoutSec"],
];

for (const [label, change, error] of invalidChanges) {
  test(`save rejects invalid ${label} before overwriting an existing BOM configuration`, () => {
    const path = configModule.getConfigPath();
    const valid = fixtureConfig();
    const original = `\uFEFF${JSON.stringify(valid)}\n`;
    writeFileSync(path, original);
    const invalid = { ...valid, ...change } as configModule.AppConfig;
    expect(() => configModule.saveConfig(invalid)).toThrow(error);
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(configModule.loadConfig()).toMatchObject(valid);
  });
}

test("save rejects invalid new configuration without creating its destination", () => {
  process.env.WEB2HARNESS_HOME = join(root, "not-created");
  const invalid = { ...fixtureConfig(), port: 65_536 };
  expect(() => configModule.saveConfig(invalid)).toThrow("Invalid port");
  expect(existsSync(process.env.WEB2HARNESS_HOME)).toBe(false);
});

test("save validates serialized values rather than only the in-memory object", () => {
  const config = { ...fixtureConfig(), toJSON: () => ({ version: 999 }) };
  expect(() => configModule.saveConfig(config)).toThrow("Unsupported configuration version");
  expect(existsSync(configModule.getConfigPath())).toBe(false);
});

test("save retains default provenance while load applies current defaults without mutating the input", () => {
  const config = {
    ...fixtureConfig(),
    experimentalContextFiles: false,
    experimentalContextTripleBudget: true,
    experimentalBiggerContext: true,
  };
  const original = structuredClone(config);
  configModule.saveConfig(config);
  expect(config).toEqual(original);
  expect(configModule.readConfigJson(configModule.getConfigPath())).toEqual(original);
  expect(configModule.loadConfig()).toMatchObject({
    experimentalContextFiles: true,
    experimentalContextTripleBudget: false,
    contextPreferenceSources: { files: "default", budget: "default" },
  });
  expect(configModule.loadConfig()).not.toHaveProperty("experimentalBiggerContext");
});

for (const files of [false, true]) {
  test(`save preserves explicit user preferences with Context as File ${files ? "on" : "off"}`, () => {
    const config = {
      ...fixtureConfig(),
      experimentalContextFiles: files,
      experimentalContextTripleBudget: files,
      contextPreferenceSources: { files: "user", budget: "user" } as const,
    };
    const original = structuredClone(config);
    configModule.saveConfig(config);
    expect(configModule.loadConfig()).toEqual(original);
    expect(config).toEqual(original);
  });
}

for (const version of [3, 4, 5]) for (const bom of ["", "\uFEFF"]) {
  test(`DEV preferences and main loader agree for schema ${version} ${bom ? "with" : "without"} BOM`, () => {
    const paths = resolveDevProfilePaths({
      homeDirectory: root,
      environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") },
    });
    mkdirSync(paths.home);
    process.env.WEB2HARNESS_HOME = paths.home;
    const config = {
      ...fixtureConfig(), version,
      experimentalContextFiles: true,
      experimentalContextTripleBudget: true,
      contextPreferenceSources: { files: "user", budget: "user" },
    };
    writeFileSync(paths.configPath, `${bom}${JSON.stringify(config)}\n`);
    const loaded = configModule.loadConfig();
    expect(readDevChatExperimentalFeatures(paths)).toEqual({
      contextFiles: loaded.experimentalContextFiles,
      contextTripleBudget: loaded.experimentalContextTripleBudget,
    });
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: true, contextTripleBudget: true });
    configModule.saveConfig(loaded);
    expect(readFileSync(paths.configPath, "utf8").startsWith("\uFEFF")).toBe(Boolean(bom));
    expect(configModule.loadConfig()).toEqual(loaded);
  });
}

test("DEV preference reads retain missing-file defaults and reject invalid BOM content", () => {
  const paths = resolveDevProfilePaths({ homeDirectory: root, environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") } });
  expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: true, contextTripleBudget: false });
  mkdirSync(paths.home);
  for (const text of ["{", "[]", '{"version":999}']) {
    writeFileSync(paths.configPath, `\uFEFF${text}`);
    expect(() => readDevChatExperimentalFeatures(paths)).toThrow();
  }
});

test("explicit launcher candidates exclude all discovered installations on every supported platform", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    const executable = platform === "win32" ? "D:\\Fixture\\Web2Harness.exe" : "/fixture/Web2Harness";
    expect(installedLauncherCandidates({
      platform,
      homeDirectory: platform === "win32" ? "C:\\Fixture" : "/fixture-home",
      windowsInstallLocation: "E:\\OtherBuild",
      environment: { WEB2HARNESS_LAUNCHER_EXECUTABLE: ` ${executable} `, LOCALAPPDATA: "C:\\Other", PATH: "/other/bin" },
    })).toEqual([executable]);
  }
});

test("an invalid explicit launcher fails even when a default fixture installation is usable", () => {
  const environment = { LOCALAPPDATA: join(root, "app-data"), PATH: join(root, "bin") };
  // Use the Linux discovery layout on macOS to keep every filesystem candidate in the fixture.
  const options = { homeDirectory: root, environment, platform: process.platform === "darwin" ? "linux" as const : process.platform };
  const candidates = installedLauncherCandidates(options);
  const fallback = candidates[0]!;
  if (!resolve(fallback).startsWith(`${root}${sep}`)) {
    throw new Error("Launcher fixture escaped its owned root");
  }
  mkdirSync(dirname(fallback), { recursive: true });
  writeFileSync(fallback, "fixture only; never execute", { mode: 0o700 });
  expect(findInstalledLauncherExecutable(options)).toBe(fallback);
  const missing = join(root, "missing-launcher");
  for (const override of [missing, root, "", "  "]) {
    expect(() => findInstalledLauncherExecutable({
      ...options, environment: { ...environment, WEB2HARNESS_LAUNCHER_EXECUTABLE: override },
    })).toThrow("WEB2HARNESS_LAUNCHER_EXECUTABLE");
  }
  expect(findInstalledLauncherExecutable({
    ...options, environment: { ...environment, WEB2HARNESS_LAUNCHER_EXECUTABLE: fallback },
  })).toBe(fallback);
});

test.skipIf(process.platform === "win32")("explicit launcher rejects a non-executable regular fixture file", () => {
  const executable = join(root, "not-executable");
  writeFileSync(executable, "fixture", { mode: 0o600 });
  chmodSync(executable, 0o600);
  expect(() => findInstalledLauncherExecutable({
    homeDirectory: root, environment: { WEB2HARNESS_LAUNCHER_EXECUTABLE: executable },
  })).toThrow("WEB2HARNESS_LAUNCHER_EXECUTABLE is not an executable regular file");
});
