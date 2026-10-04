import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertSeparateDevHome, devPathContains } from "../../src/dev/isolation";
import { devCodexEnvironment } from "../../src/dev/codex";
import { readDevChatExperimentalFeatures, resolveDevProfilePaths } from "../../src/dev/profile";

test("DEV rejects overlapping homes, including directory junctions", () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-dev-isolation-"));
  try {
    const production = join(root, "production");
    mkdirSync(production);
    for (const dev of [production, join(production, "nested"), root]) {
      expect(() => assertSeparateDevHome(dev, [production])).toThrow("must not overlap");
    }
    const alias = join(root, "alias");
    symlinkSync(production, alias, process.platform === "win32" ? "junction" : "dir");
    expect(() => assertSeparateDevHome(join(alias, "not-created"), [production])).toThrow("must not overlap");
    expect(devPathContains(production, join(root, "production-neighbor"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DEV accepts v4 preferences without changing the config", () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-dev-v4-"));
  try {
    const paths = resolveDevProfilePaths({ environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") } });
    mkdirSync(paths.home);
    const content = JSON.stringify({ version: 4, experimentalBiggerContext: true });
    writeFileSync(paths.configPath, content);
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ contextFiles: true, contextTripleBudget: false });
    expect(readFileSync(paths.configPath, "utf8")).toBe(content);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real DEV Codex cannot inherit the parent task identity, auth or route overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-dev-env-"));
  try {
    const paths = resolveDevProfilePaths({ environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") } });
    expect(devCodexEnvironment(paths, {
      PATH: "keep", CODEX_HOME: "/production", CODEX_THREAD_ID: "production-thread",
      CODEX_API_KEY: "production-key", OPENAI_API_KEY: "production-key",
      OPENAI_BASE_URL: "https://production.invalid", ELECTRON_RUN_AS_NODE: "1",
    })).toEqual({
      PATH: "keep", CODEX_HOME: paths.codexHome,
      WEB2HARNESS_HOME: paths.home, WEB2HARNESS_DEV_HOME: paths.home,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DEV codex forwards CLI arguments, uses private cwd/home, and preserves production files", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-dev-codex-"));
  try {
    const production = join(root, "production");
    const productionCodex = join(root, "production-codex");
    mkdirSync(production);
    mkdirSync(productionCodex);
    writeFileSync(join(production, "config.json"), "production sentinel");
    writeFileSync(join(productionCodex, "config.toml"), "production sentinel");
    const fakeCodex = join(root, "fake-codex.mjs");
    writeFileSync(fakeCodex, [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync("receipt.json", JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.CODEX_HOME,thread:process.env.CODEX_THREAD_ID,auth:process.env.OPENAI_API_KEY}));',
      'process.exitCode = 7;',
    ].join("\n"));
    const dev = join(root, "dev");
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../src/cli.ts"),
      "dev", "codex", "--", "--help", "--version", "literal $() & text"], {
      env: { ...process.env, WEB2HARNESS_DEV_HOME: dev, WEB2HARNESS_HOME: production,
        CODEX_HOME: productionCodex, CODEX_THREAD_ID: "production-thread", OPENAI_API_KEY: "sentinel",
        WEB2HARNESS_CODEX_EXECUTABLE: fakeCodex },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 7, stderr: "" });
    const receipt = JSON.parse(readFileSync(join(dev, "workspace", "receipt.json"), "utf8"));
    expect(receipt).toEqual({
      args: ["-c", 'cli_auth_credentials_store="file"', "--help", "--version", "literal $() & text"],
      cwd: join(dev, "workspace"), home: join(dev, "codex-home"),
    });
    expect(readFileSync(join(production, "config.json"), "utf8")).toBe("production sentinel");
    expect(readFileSync(join(productionCodex, "config.toml"), "utf8")).toBe("production sentinel");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

