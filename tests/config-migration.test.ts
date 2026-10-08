import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CURRENT_CONFIG_VERSION, migrateRuntimeConfig, needsRuntimeConfigMigration } from "../launcher/shared/config-migration.cjs";
import { defaultConfig, loadConfig, loadConfigForSetup, providerConfig, resolveInteractionConnectorIdentities, saveConfig } from "../src/config";

function withFixtureHome(run: (home: string) => void): void {
  const parent = resolve(tmpdir());
  const home = mkdtempSync(join(parent, "web2harness-mode-migration-"));
  const previous = process.env.WEB2HARNESS_HOME;
  process.env.WEB2HARNESS_HOME = home;
  try {
    run(home);
  } finally {
    if (previous === undefined) delete process.env.WEB2HARNESS_HOME;
    else process.env.WEB2HARNESS_HOME = previous;
    if (dirname(resolve(home)) !== parent || !basename(home).startsWith("web2harness-mode-migration-")) {
      throw new Error("Migration fixture cleanup escaped its owned directory");
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function legacyFixture(home: string, interaction: "automatic" | "manual") {
  const tunnel = (digit: string) => ({
    binaryPath: process.execPath,
    tunnelId: `tunnel_${digit.repeat(32)}`,
    runtimeKeyFile: join(home, `test-${digit}.key`),
    profileDir: join(home, `tunnel-${digit}`),
    profileName: `fixture-${digit}`,
    alias: `fixture-${digit}`,
  });
  const automaticTunnel = tunnel("a"), manualTunnel = tunnel("b");
  return {
    ...defaultConfig("mcp-bridge"),
    ...resolveInteractionConnectorIdentities(interaction),
    version: 4,
    mode: "full",
    browserHost: "launcher",
    browserHostDescriptorPath: join(home, "descriptor.json"),
    browserInteractionMode: interaction,
    automaticTunnel,
    manualTunnel,
    tunnel: interaction === "manual" ? manualTunnel : automaticTunnel,
    useSavedChats: false,
    autoApproveToolCalls: false,
    runtimeCommand: [process.execPath],
    retainedExtension: { tag: "fixture", enabled: false },
  };
}

describe("persisted runtime mode migration", () => {
  for (const interaction of ["automatic", "manual"] as const) {
    test(`upgrades ${interaction} state without changing connector, credential references or preferences`, () => {
      withFixtureHome(home => {
        const raw = legacyFixture(home, interaction);
        const original = structuredClone(raw);
        const migrated = migrateRuntimeConfig(raw);
        expect(migrated).toEqual({ ...original, version: CURRENT_CONFIG_VERSION, mode: "mcp-bridge" });
        expect(raw).toEqual(original);
        expect(needsRuntimeConfigMigration(raw)).toBe(true);
        expect(needsRuntimeConfigMigration(migrated)).toBe(false);

        const path = join(home, "config.json");
        const bytes = `\uFEFF${JSON.stringify(raw, null, 2)}\n`;
        writeFileSync(path, bytes);
        for (const load of [loadConfig, loadConfigForSetup]) {
          const config = load();
          expect(config).toMatchObject({ ...original, version: 5, mode: "mcp-bridge" });
          expect(providerConfig(config).chatgptWeb?.localToolsEnabled).toBe(true);
          expect(readFileSync(path, "utf8")).toBe(bytes);
        }
        // Normal configuration save persists only the canonical schema and keeps the BOM.
        saveConfig(loadConfigForSetup());
        const savedText = readFileSync(path, "utf8");
        expect(savedText.startsWith("\uFEFF")).toBe(true);
        const saved = JSON.parse(savedText.slice(1));
        expect(saved).toMatchObject({ ...original, version: 5, mode: "mcp-bridge" });
        expect(loadConfig()).toMatchObject({ version: 5, mode: "mcp-bridge" });
      });
    });
  }

  test("preserves explicit browser-only choices after the v3 default transition", () => {
    expect(migrateRuntimeConfig({ version: 3, mode: "browser-only" })).toEqual({ version: 5, mode: "native-tools" });
    expect(migrateRuntimeConfig({ version: 4, mode: "browser-only" })).toEqual({ version: 5, mode: "browser-only" });
    expect(migrateRuntimeConfig({ version: 3, mode: "full" })).toEqual({ version: 5, mode: "mcp-bridge" });
    const current = { version: 5, mode: "mcp-bridge" };
    expect(migrateRuntimeConfig(current)).toBe(current);
  });

  test("only setup can upgrade the earliest browser-host schemas", () => {
    const earliest = { version: 1, mode: "pro-only", custom: "preserved" };
    expect(migrateRuntimeConfig(earliest)).toBe(earliest);
    expect(migrateRuntimeConfig(earliest, { forSetup: true })).toEqual({
      version: 5, mode: "native-tools", browserHost: "managed-chrome", custom: "preserved",
    });
    expect(migrateRuntimeConfig({ version: 2, mode: "full" }, { forSetup: true })).toEqual({
      version: 5, mode: "mcp-bridge", browserHost: "managed-chrome",
    });
  });

  test("does not reinterpret unsupported schemas or infer modes from tunnel presence", () => {
    for (const raw of [null, [], 1, { mode: "full" }, { version: 6, mode: "full" }, { version: 5, mode: "full" }]) {
      expect(migrateRuntimeConfig(raw)).toBe(raw);
      expect(needsRuntimeConfigMigration(raw)).toBe(false);
    }
    withFixtureHome(home => {
      const path = join(home, "config.json");
      const raw = legacyFixture(home, "automatic");
      writeFileSync(path, JSON.stringify({ ...raw, version: 6 }));
      expect(() => loadConfig()).toThrow("Unsupported configuration version");
      writeFileSync(path, JSON.stringify({ ...raw, version: 5 }));
      expect(() => loadConfig()).toThrow("Invalid runtime mode");
      writeFileSync(path, JSON.stringify({ ...raw, mode: "unknown-mode" }));
      expect(() => loadConfig()).toThrow("Invalid runtime mode");
      writeFileSync(path, JSON.stringify({ ...raw, tunnel: undefined, automaticTunnel: undefined, manualTunnel: undefined }));
      expect(() => loadConfig()).toThrow("tunnel is missing");
    });
  });
});

test("current first-party contracts and documentation exclude the retired mode vocabulary", () => {
  const root = resolve(import.meta.dir, "..");
  const exceptions = new Set([
    "launcher/shared/config-migration.cjs",
    "launcher/tests/shared/config-migration.test.cjs",
    "tests/config-migration.test.ts",
  ]);
  const forbidden = /(["'`])full\1|--full\b|\bfull[- ](?:mode|harness|setup|profile)\b|\bFull Codex harness\b|\b(?:Existing|existing)FullSetupCredentials\b/i;
  const files: string[] = [];
  function visit(directory: string): void {
    for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
      const name = join(directory, item.name);
      if (item.isDirectory()) visit(name);
      else if (item.isFile() && /\.(?:ts|tsx|cjs|mjs|js|md|json|svg|yml|yaml|sh|ps1)$/.test(name)) files.push(name);
    }
  }
  for (const directory of ["src", "tests", "scripts", "assets", "launcher/src", "launcher/electron", "launcher/shared", "launcher/tests", "launcher/scripts", "launcher/packaging", "docs", ".github"]) visit(directory);
  for (const name of ["README", "AGENTS"]) files.push(`${name}.md`, `${name}.zh-CN.md`);
  const violations = files.flatMap(file => {
    const key = relative(root, join(root, file)).replaceAll("\\", "/");
    if (exceptions.has(key)) return [];
    return readFileSync(join(root, file), "utf8").split(/\r?\n/).flatMap((line, index) => forbidden.test(line) ? [`${key}:${index + 1}`] : []);
  });
  expect(violations).toEqual([]);
}, 30_000);
