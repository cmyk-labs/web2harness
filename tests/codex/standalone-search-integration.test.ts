import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { defaultConfig } from "../../src/config";
import {
  activateCodexIntegration,
  deactivateCodexIntegration,
  getCodexJournalPath,
  getCodexJournalRecoveryPath,
  getCodexModelsCachePath,
  inspectCodexIntegration,
  installCodexIntegration,
  preflightCodexIntegration,
  preflightUninstallCodexIntegration,
  uninstallCodexIntegration,
} from "../../src/codex/integration";
import {
  MANAGED_STANDALONE_WEB_SEARCH_LINE as managedLine,
  MANAGED_COMMENT, MANAGED_ROUTE_COMMENT,
  MANAGED_REMOTE_COMPACTION_LINE, MANAGED_MULTI_AGENT_LINE, MANAGED_MULTI_AGENT_V2_LINE,
  sha256,
} from "../../src/codex/integration-shared";
import { splitLines } from "../../src/codex/integration-document";

let root: string;
let configPath: string;
let owner: string;
let priorEnv: { CODEX_HOME?: string; WEB2HARNESS_HOME?: string };

beforeEach(() => {
  priorEnv = { CODEX_HOME: process.env.CODEX_HOME, WEB2HARNESS_HOME: process.env.WEB2HARNESS_HOME };
  root = mkdtempSync(join(tmpdir(), "web2harness-standalone-search-"));
  owner = randomUUID();
  writeFileSync(join(root, ".fixture-owner"), owner);
  const codexHome = join(root, "codex");
  mkdirSync(codexHome);
  process.env.CODEX_HOME = codexHome;
  process.env.WEB2HARNESS_HOME = join(root, "app");
  configPath = join(codexHome, "config.toml");
});

afterEach(() => {
  for (const key of ["CODEX_HOME", "WEB2HARNESS_HOME"] as const) {
    if (priorEnv[key] === undefined) delete process.env[key];
    else process.env[key] = priorEnv[key];
  }
  const target = resolve(root);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("web2harness-standalone-search-")
    || readFileSync(join(target, ".fixture-owner"), "utf8") !== owner) {
    throw new Error("Refusing to remove a fixture without verified path and ownership");
  }
  rmSync(target, { recursive: true });
});

function config(mode: "native-tools" | "browser-only" | "mcp-bridge" = "native-tools") {
  return { ...defaultConfig(mode), subagentProtocol: "native" as const };
}
function readConfig(): string { return readFileSync(configPath, "utf8"); }
function snapshot(): Array<string | undefined> {
  return [configPath, getCodexJournalPath(), getCodexJournalRecoveryPath(), getCodexModelsCachePath()]
    .map(path => existsSync(path) ? readFileSync(path, "utf8") : undefined);
}
function writeJournalCopies(text: string): void {
  writeFileSync(getCodexJournalPath(), text);
  writeFileSync(getCodexJournalRecoveryPath(), text);
}
function parsedConfig(): Record<string, unknown> { return Bun.TOML.parse(splitLines(readConfig()).join("\n")) as Record<string, unknown>; }

describe("Codex-native standalone search feature ownership", () => {
  for (const searchMode of [undefined, "live", "cached", "disabled"] as const) {
    for (const priorFeature of [undefined, true, false]) {
      test(`install/reapply/update/restore preserves web_search=${searchMode} and prior flag=${priorFeature}`, () => {
        const original = 'model = "user-model"\nmodel_reasoning_effort = "high"\n'
          + 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n'
          + (searchMode ? `web_search = "${searchMode}" # user policy\n` : "")
          + '\n[features]\nmulti_agent = false\ngoals = true\n'
          + (priorFeature === undefined ? "" : `standalone_web_search = ${priorFeature} # original\n`);
        writeFileSync(configPath, original);
        const before = snapshot();
        preflightCodexIntegration(config());
        expect(snapshot()).toEqual(before);
        const installed = installCodexIntegration(config());
        expect(installed.installed.standalone_web_search).toBe(true);
        expect(installed.previousStandaloneWebSearch?.present).toBe(priorFeature !== undefined);
        const text = readConfig();
        expect(text).toContain(managedLine);
        expect(parsedConfig()).toMatchObject({
          model: "user-model", model_reasoning_effort: "high", approval_policy: "on-request",
          sandbox_mode: "workspace-write", features: { standalone_web_search: true, multi_agent: false, goals: true },
        });
        expect(parsedConfig().web_search).toBe(searchMode);
        installCodexIntegration(config());
        expect(readConfig()).toBe(text);
        const updated = installCodexIntegration({ ...config(), port: 17842 });
        expect(updated.previousStandaloneWebSearch).toEqual(installed.previousStandaloneWebSearch);
        expect(readConfig()).toContain('openai_base_url = "http://127.0.0.1:17842/v1"');
        expect(deactivateCodexIntegration()).toEqual({ changed: true, active: false });
        expect(readConfig()).toBe(original);
        expect(deactivateCodexIntegration()).toEqual({ changed: false, active: false });
        expect(activateCodexIntegration()).toEqual({ changed: true, active: true });
        expect(readConfig()).toContain(managedLine);
        expect(activateCodexIntegration()).toEqual({ changed: false, active: true });
        expect(inspectCodexIntegration().errors).toEqual([]);
        preflightUninstallCodexIntegration();
        uninstallCodexIntegration();
        expect(readConfig()).toBe(original);
        expect(existsSync(getCodexJournalPath())).toBe(false);
      });
    }
  }

  for (const original of ["", 'model = "user-model"', 'model = "user-model"\r\n\r\n# tail\r\n',
    'model = "user-model"\r\n\n[features]\r\ngoals = true\nstandalone_web_search = false # keep\r']) {
    test(`round-trips original formatting and absent tables: ${JSON.stringify(original)}`, () => {
      writeFileSync(configPath, original);
      installCodexIntegration(config());
      expect(parsedConfig().features).toMatchObject({ standalone_web_search: true });
      uninstallCodexIntegration();
      expect(readConfig()).toBe(original);
    });
  }

  test("existing hook BOM rejection leaves the user's config unchanged in both modes", () => {
    writeFileSync(configPath, '\uFEFFmodel = "user-model"\r\n');
    const before = snapshot();
    for (const mode of ["browser-only", "native-tools"] as const) {
      expect(() => installCodexIntegration(config(mode))).toThrow("Unexpected character");
      expect(snapshot()).toEqual(before);
    }
  });

  for (const mode of ["browser-only", "mcp-bridge"] as const) {
    test(`${mode} leaves search untouched, mode switching relinquishes ownership`, () => {
      const original = 'web_search = "disabled"\n[features]\nstandalone_web_search = false\ngoals = true\n';
      writeFileSync(configPath, original);
      const other = installCodexIntegration(config(mode));
      expect(other.installed.standalone_web_search).toBeUndefined();
      expect(readConfig()).not.toContain(managedLine);
      installCodexIntegration(config());
      expect(readConfig()).toContain(managedLine);
      const switched = installCodexIntegration(config(mode));
      expect(switched.previousStandaloneWebSearch).toBeUndefined();
      expect(parsedConfig().features).toMatchObject({ standalone_web_search: false });
      deactivateCodexIntegration();
      activateCodexIntegration();
      expect(readConfig()).not.toContain(managedLine);
      uninstallCodexIntegration();
      expect(readConfig()).toBe(original);
    });
  }

  test("Compatibility V1 and search restore shared feature table ownership in reverse order", () => {
    const original = 'model = "user-model"\n';
    writeFileSync(configPath, original);
    const v1 = { ...config(), subagentProtocol: "compatibility-v1" as const };
    installCodexIntegration(v1);
    expect(parsedConfig().features).toMatchObject({ multi_agent: true, multi_agent_v2: false, standalone_web_search: true });
    installCodexIntegration(v1);
    deactivateCodexIntegration();
    expect(readConfig()).toBe(original);
    activateCodexIntegration();
    installCodexIntegration(config());
    expect(parsedConfig().features).toEqual({ standalone_web_search: true });
    uninstallCodexIntegration();
    expect(readConfig()).toBe(original);
  });

  for (const newline of ["\n", "\r\n", "\r"]) {
    for (const mode of ["native-tools", "browser-only"] as const) {
      test(`V1 restores the actual agents separator byte-for-byte (${JSON.stringify(newline)}, ${mode})`, () => {
        const original = [
          'model = "user-model"', 'web_search = "disabled"',
          'approval_policy = "on-request"', 'sandbox_mode = "workspace-write"',
          "[features]", "", "",
        ].join(newline);
        writeFileSync(configPath, original);
        const v1 = { ...config(mode), subagentProtocol: "compatibility-v1" as const };
        const installed = installCodexIntegration(v1);
        expect(installed.previousAgentMaxDepth?.separatorInserted).toBe(true);
        const active = readConfig();
        installCodexIntegration(v1);
        expect(readConfig()).toBe(active);
        deactivateCodexIntegration();
        expect(readConfig()).toBe(original);
        activateCodexIntegration();
        expect(readConfig()).toBe(active);
        uninstallCodexIntegration();
        expect(readConfig()).toBe(original);
        // Switching the protocol also releases the exact owned separator.
        installCodexIntegration(v1);
        installCodexIntegration(config(mode));
        uninstallCodexIntegration();
        expect(readConfig()).toBe(original);
      });
    }
  }

  for (const mode of ["native-tools", "browser-only", "mcp-bridge"] as const) {
    for (const legacyOverrides of [
      'model_provider = "local"\n[profiles.offline.features]\nstandalone_web_search = false\n',
      'model_provider = "openai"\n[profiles.offline.features]\nstandalone_web_search = true\n',
    ]) {
      test(`${mode} rejects an explicit legacy profile without interpreting its provider/features: ${legacyOverrides.trim()}`, () => {
        const original = 'profile = "offline"\nmodel_provider = "openai"\nmodel = "user-model"\n'
          + 'web_search = "disabled"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n'
          + '[profiles.offline]\nmodel = "profile-model"\n' + legacyOverrides;
        writeFileSync(configPath, original);
        writeFileSync(getCodexModelsCachePath(), '{"fixture":"preserve"}');
        const before = snapshot();
        for (const replaceExistingRoute of [false, true]) {
          expect(() => preflightCodexIntegration(config(mode), { replaceExistingRoute }))
            .toThrow("legacy default profile selector");
          expect(() => installCodexIntegration(config(mode), { replaceExistingRoute }))
            .toThrow("legacy default profile selector");
          expect(snapshot()).toEqual(before);
        }
      });
    }
  }

  for (const selector of ['"missing"', '""', "false", '["offline"]']) {
    test(`never guesses a default profile for an unsupported selector ${selector}`, () => {
      writeFileSync(configPath, `profile = ${selector}\nmodel = "user-model"\n`);
      const before = snapshot();
      expect(() => preflightCodexIntegration(config())).toThrow("legacy default profile selector");
      expect(() => installCodexIntegration(config())).toThrow("legacy default profile selector");
      expect(snapshot()).toEqual(before);
    });
  }

  test("unselected legacy tables and CLI profile files never override the root provider or feature", () => {
    const original = 'model_provider = "openai"\nmodel = "user-model"\nweb_search = "disabled"\n'
      + 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n'
      + '[profiles.offline]\nmodel_provider = "local"\nmodel = "profile-model"\n'
      + '[profiles.offline.features]\nstandalone_web_search = false\n';
    writeFileSync(configPath, original);
    const cliProfile = join(dirname(configPath), "offline.config.toml");
    const untouched = 'not-valid-toml = } # a CLI profile is not selected by integration\n';
    writeFileSync(cliProfile, untouched);
    installCodexIntegration(config());
    expect(parsedConfig()).toMatchObject({
      model_provider: "openai", model: "user-model", web_search: "disabled",
      approval_policy: "on-request", sandbox_mode: "workspace-write",
      features: { standalone_web_search: true },
      profiles: { offline: { model_provider: "local", model: "profile-model", features: { standalone_web_search: false } } },
    });
    deactivateCodexIntegration();
    expect(readConfig()).toBe(original);
    activateCodexIntegration();
    uninstallCodexIntegration();
    expect(readConfig()).toBe(original);
    expect(readFileSync(cliProfile, "utf8")).toBe(untouched);

    // An unused profile cannot make a custom root provider acceptable either.
    writeFileSync(configPath, 'model_provider = "local"\n[profiles.other]\nmodel_provider = "openai"\n');
    const before = snapshot();
    expect(() => installCodexIntegration(config())).toThrow("model_provider selects a custom provider");
    expect(snapshot()).toEqual(before);
  });

  for (const version of [10, 11]) {
    test(`a new legacy profile selector blocks activation/update but allows owned restoration (v${version})`, () => {
      const original = 'model = "user-model"\nweb_search = "cached"\n';
      const selected = 'profile = "offline"\n';
      writeFileSync(configPath, original);
      installCodexIntegration(config(version === 10 ? "browser-only" : "native-tools"));
      if (version === 10) {
        const journal = JSON.parse(readFileSync(getCodexJournalPath(), "utf8"));
        journal.version = 10;
        writeJournalCopies(`${JSON.stringify(journal, null, 2)}\n`);
      }
      writeFileSync(configPath, selected + readConfig());
      const before = snapshot();
      for (const action of [
        activateCodexIntegration,
        () => preflightCodexIntegration(config()),
        () => installCodexIntegration(config(), { replaceExistingRoute: true }),
      ]) {
        expect(action).toThrow("legacy default profile selector");
        expect(snapshot()).toEqual(before);
      }
      expect(inspectCodexIntegration().errors.join(" ")).toContain("legacy default profile selector");
      deactivateCodexIntegration();
      expect(readConfig()).toBe(selected + original);
      const disconnected = snapshot();
      expect(activateCodexIntegration).toThrow("legacy default profile selector");
      expect(snapshot()).toEqual(disconnected);
      uninstallCodexIntegration();
      expect(readConfig()).toBe(selected + original);
    });
  }

  test("native mode preserves a nested multi_agent_v2 table with an implicit features parent", () => {
    const original = '[features.multi_agent_v2]\nenabled = true\n# user configuration\n';
    writeFileSync(configPath, original);
    installCodexIntegration(config());
    expect(parsedConfig().features).toEqual({ multi_agent_v2: { enabled: true }, standalone_web_search: true });
    uninstallCodexIntegration();
    expect(readConfig()).toBe(original);
  });

  for (const edit of ["standalone_web_search = false # user edit", "standalone_web_search = true # user owner", ""]) {
    test(`active user edit is never overwritten, even by route replacement: ${edit}`, () => {
      writeFileSync(configPath, 'model = "user-model"\n');
      installCodexIntegration(config());
      writeFileSync(configPath, readConfig().replace(managedLine, edit));
      writeFileSync(getCodexModelsCachePath(), '{"fixture":"keep"}');
      const before = snapshot();
      for (const action of [
        () => preflightCodexIntegration(config()),
        () => preflightCodexIntegration(config(), { replaceExistingRoute: true }),
        () => installCodexIntegration(config()),
        () => installCodexIntegration(config(), { replaceExistingRoute: true }),
        () => installCodexIntegration(config("browser-only")),
        activateCodexIntegration, deactivateCodexIntegration,
        preflightUninstallCodexIntegration, uninstallCodexIntegration,
      ]) {
        expect(action).toThrow("standalone_web_search");
        expect(snapshot()).toEqual(before);
      }
      expect(inspectCodexIntegration().errors.join(" ")).toContain("standalone_web_search");
    });
  }

  test("disconnected explicit feature edits fail safely without losing the newer value", () => {
    writeFileSync(configPath, '[features]\nstandalone_web_search = false # original\n');
    installCodexIntegration(config());
    deactivateCodexIntegration();
    writeFileSync(configPath, readConfig().replace("false # original", "true # new choice"));
    const before = snapshot();
    for (const action of [activateCodexIntegration, deactivateCodexIntegration, uninstallCodexIntegration,
      () => preflightCodexIntegration(config()), () => installCodexIntegration(config(), { replaceExistingRoute: true })]) {
      expect(action).toThrow("standalone_web_search");
      expect(snapshot()).toEqual(before);
    }
  });

  test("unrelated edits during active and disconnected states survive reconnect and removal", () => {
    const original = 'web_search = "live"\n';
    writeFileSync(configPath, original);
    installCodexIntegration(config());
    writeFileSync(configPath, readConfig().replace('web_search = "live"', 'web_search = "disabled"')
      .replace(managedLine, `${managedLine}\ngoals = true # user addition`));
    deactivateCodexIntegration();
    const disconnected = readConfig();
    expect(disconnected).toContain("goals = true # user addition");
    expect(disconnected).not.toContain("standalone_web_search");
    activateCodexIntegration();
    uninstallCodexIntegration();
    expect(readConfig()).toBe(disconnected);
  });

  test("a user-added features table while disconnected is preserved", () => {
    writeFileSync(configPath, 'web_search = "cached"\n');
    installCodexIntegration(config());
    deactivateCodexIntegration();
    const changed = `${readConfig()}\n[features]\ngoals = true\n`;
    writeFileSync(configPath, changed);
    activateCodexIntegration();
    uninstallCodexIntegration();
    expect(readConfig()).toBe(changed);
  });

  test("route-only conflict repair retains the original search baseline", () => {
    const original = '[features]\nstandalone_web_search = false # original\n';
    writeFileSync(configPath, original);
    installCodexIntegration(config());
    writeFileSync(configPath, readConfig().replace("127.0.0.1:17841", "127.0.0.1:19000"));
    preflightCodexIntegration(config(), { replaceExistingRoute: true });
    installCodexIntegration(config(), { replaceExistingRoute: true });
    uninstallCodexIntegration();
    expect(readConfig()).toContain("standalone_web_search = false # original");
    expect(readConfig()).toContain("127.0.0.1:19000");
  });

  for (const active of [true, false]) {
    test(`old v10 migration adds ownership only on Native Tools setup (active=${active})`, () => {
      const original = 'web_search = "cached"\n[features]\nstandalone_web_search = false\n';
      writeFileSync(configPath, original);
      installCodexIntegration(config("browser-only"));
      if (!active) deactivateCodexIntegration();
      const legacy = JSON.parse(readFileSync(getCodexJournalPath(), "utf8"));
      legacy.version = 10;
      writeJournalCopies(`${JSON.stringify(legacy, null, 2)}\n`);
      const before = snapshot();
      preflightCodexIntegration(config());
      expect(snapshot()).toEqual(before);
      const migrated = installCodexIntegration(config());
      expect(migrated.installed.standalone_web_search).toBe(true);
      expect(migrated.previousStandaloneWebSearch?.value).toBe("false");
      uninstallCodexIntegration();
      expect(readConfig()).toBe(original);
    });
  }

  test("reconnect of a pre-feature journal does not guess the installation mode", () => {
    writeFileSync(configPath, 'web_search = "cached"\n');
    installCodexIntegration(config("browser-only"));
    deactivateCodexIntegration();
    const legacy = JSON.parse(readFileSync(getCodexJournalPath(), "utf8"));
    legacy.version = 10;
    writeJournalCopies(`${JSON.stringify(legacy, null, 2)}\n`);
    activateCodexIntegration();
    expect(readConfig()).not.toContain("standalone_web_search");
  });

  test("migrates a v9 journal and restores both hook and feature", () => {
    const original = 'model = "user-model"\n';
    writeFileSync(configPath, original);
    const installed = installCodexIntegration(config("browser-only"));
    const legacy = JSON.parse(readFileSync(getCodexJournalPath(), "utf8"));
    legacy.version = 9;
    delete legacy.interruptHook;
    writeFileSync(configPath, readConfig().replace(installed.interruptHook.fragment, ""));
    writeJournalCopies(JSON.stringify(legacy));
    installCodexIntegration(config());
    expect(readConfig()).toContain(managedLine);
    uninstallCodexIntegration();
    expect(readConfig()).toBe(original);
  });

  for (const version of [3, 4, 5, 6, 7, 8]) {
    test(`migrates v${version} to Native Tools, removing only legacy owned feature markers`, () => {
      const original = 'model = "user-model"\nweb_search = "disabled"\n';
      writeFileSync(configPath, original);
      const installed = installCodexIntegration(config("browser-only"));
      const legacy = JSON.parse(readFileSync(getCodexJournalPath(), "utf8"));
      let legacyConfig = readConfig().replace(installed.interruptHook.fragment, "")
        .replace(MANAGED_ROUTE_COMMENT, MANAGED_COMMENT)
        .replace(/^experimental_realtime_webrtc_call_base_url\s*=.*\n/gm, "");
      legacy.version = version;
      delete legacy.interruptHook;
      delete legacy.installed.experimental_realtime_webrtc_call_base_url;
      delete legacy.previousRealtimeWebrtcCallBaseUrl;
      if (version === 3) delete legacy.active;
      if (version < 8) delete legacy.installed.subagent_protocol;
      if (version === 5 || version === 6) {
        const absent = { present: false, tablePresent: false, tableName: "features", separatorInserted: true };
        legacy.previousRemoteCompactionV2 = { ...absent };
        legacy.previousMultiAgent = { ...absent };
        legacy.installed.remote_compaction_v2 = false;
        legacy.installed.multi_agent = true;
        legacyConfig += `\n[features]\n${MANAGED_REMOTE_COMPACTION_LINE}\n${MANAGED_MULTI_AGENT_LINE}\n`;
        if (version === 6) {
          legacy.previousMultiAgentV2 = { ...absent };
          legacy.installed.multi_agent_v2 = false;
          legacyConfig += `${MANAGED_MULTI_AGENT_V2_LINE}\n`;
        }
      }
      writeFileSync(configPath, legacyConfig);
      writeJournalCopies(`${JSON.stringify(legacy, null, 2)}\n`);
      const before = snapshot();
      preflightCodexIntegration(config());
      expect(snapshot()).toEqual(before);
      expect(installCodexIntegration(config()).version).toBe(11);
      expect(parsedConfig().features).toEqual({ standalone_web_search: true });
      expect(parsedConfig().web_search).toBe("disabled");
      expect(readConfig()).not.toContain(MANAGED_MULTI_AGENT_LINE);
      expect(readConfig()).not.toContain(MANAGED_REMOTE_COMPACTION_LINE);
      uninstallCodexIntegration();
      expect(readConfig()).toBe(original);
    });
  }

  test("v2 provider migration installs search while preserving the selected model and search policy", () => {
    const original = 'model = "user-model"\nweb_search = "disabled"\n';
    writeFileSync(configPath, original);
    installCodexIntegration(config("browser-only"));
    const catalogPath = join(root, "legacy-catalog.json");
    writeFileSync(catalogPath, "{}");
    const providerBlock = '[model_providers.web2harness]\nname = "legacy fixture"\n';
    const legacyConfig = `${original}${MANAGED_COMMENT}\nmodel_provider = "web2harness"\nmodel_catalog_json = ${JSON.stringify(catalogPath)}\n${providerBlock}`;
    writeFileSync(configPath, legacyConfig);
    writeJournalCopies(JSON.stringify({
      version: 2, configPath, catalogPath, catalogSha256: sha256("{}"), providerBlock,
      installed: { model_provider: "web2harness", model_catalog_json: catalogPath },
      previous: { model_provider: { present: false }, model_catalog_json: { present: false } },
    }));
    preflightCodexIntegration(config());
    installCodexIntegration(config());
    expect(parsedConfig()).toMatchObject({ model: "user-model", web_search: "disabled", features: { standalone_web_search: true } });
    expect(existsSync(catalogPath)).toBe(false);
    uninstallCodexIntegration();
    expect(readConfig()).toBe(original);
  });

  test("migration crash recovery chooses only the journal owning the physical feature", () => {
    writeFileSync(configPath, 'web_search = "live"\n');
    installCodexIntegration(config("browser-only"));
    const legacyConfig = readConfig();
    const legacy = JSON.parse(readFileSync(getCodexJournalPath(), "utf8"));
    legacy.version = 10;
    writeJournalCopies(`${JSON.stringify(legacy, null, 2)}\n`);
    const legacyJournal = readFileSync(getCodexJournalPath(), "utf8");
    installCodexIntegration(config());
    const currentConfig = readConfig();
    const currentJournal = readFileSync(getCodexJournalPath(), "utf8");
    for (const physical of [legacyConfig, currentConfig]) {
      writeFileSync(configPath, physical);
      writeFileSync(getCodexJournalPath(), legacyJournal);
      writeFileSync(getCodexJournalRecoveryPath(), currentJournal);
      expect(inspectCodexIntegration().errors).toEqual([]);
      const expected = physical === legacyConfig ? legacyJournal : currentJournal;
      expect(readFileSync(getCodexJournalPath(), "utf8")).toBe(expected);
      expect(readFileSync(getCodexJournalRecoveryPath(), "utf8")).toBe(expected);
    }
    uninstallCodexIntegration();
    expect(readConfig()).toBe('web_search = "live"\n');
  });

  test("v10-to-v11 recovery accepts a version-only upgrade but not a different baseline", () => {
    writeFileSync(configPath, 'web_search = "disabled"\n');
    installCodexIntegration(config("browser-only"));
    const currentJournal = readFileSync(getCodexJournalPath(), "utf8");
    const legacy = JSON.parse(currentJournal);
    legacy.version = 10;
    writeFileSync(getCodexJournalPath(), `${JSON.stringify(legacy, null, 2)}\n`);
    expect(inspectCodexIntegration().journal?.version).toBe(11);
    expect(readFileSync(getCodexJournalPath(), "utf8")).toBe(currentJournal);
    legacy.previous.openai_base_url = { present: true, value: "https://other.example/v1", rawLine: 'openai_base_url = "https://other.example/v1"' };
    writeFileSync(getCodexJournalPath(), JSON.stringify(legacy));
    expect(inspectCodexIntegration).toThrow("different baselines");
  });

  test("disconnect and reconnect crash recovery retain feature ownership and baseline", () => {
    const original = '[features]\nstandalone_web_search = false # original\n';
    writeFileSync(configPath, original);
    installCodexIntegration(config());
    const activeConfig = readConfig();
    const activeJournal = readFileSync(getCodexJournalPath(), "utf8");
    deactivateCodexIntegration();
    const inactiveJournal = readFileSync(getCodexJournalPath(), "utf8");
    for (const physical of [original, activeConfig]) {
      writeFileSync(configPath, physical);
      writeFileSync(getCodexJournalPath(), inactiveJournal);
      writeFileSync(getCodexJournalRecoveryPath(), activeJournal);
      expect(inspectCodexIntegration().active).toBe(physical === activeConfig);
      expect(inspectCodexIntegration().errors).toEqual([]);
    }
    uninstallCodexIntegration();
    expect(readConfig()).toBe(original);
  });

  for (const mutation of ["missing baseline", "missing flag", "invalid flag", "invalid baseline"]) {
    test(`malformed search journal fails without touching config: ${mutation}`, () => {
      writeFileSync(configPath, 'web_search = "cached"\n');
      installCodexIntegration(config());
      const journal = JSON.parse(readFileSync(getCodexJournalPath(), "utf8"));
      if (mutation === "missing baseline") delete journal.previousStandaloneWebSearch;
      if (mutation === "missing flag") delete journal.installed.standalone_web_search;
      if (mutation === "invalid flag") journal.installed.standalone_web_search = false;
      if (mutation === "invalid baseline") journal.previousStandaloneWebSearch = { present: false };
      writeJournalCopies(JSON.stringify(journal));
      const before = snapshot();
      expect(() => installCodexIntegration(config())).toThrow("Invalid Codex integration journal");
      expect(uninstallCodexIntegration).toThrow("Invalid Codex integration journal");
      expect(snapshot()).toEqual(before);
    });
  }

  for (const original of [
    'features = { standalone_web_search = false, goals = true }\n',
    'features.standalone_web_search = false\n',
    '[features]\n"standalone_web_search" = false\n',
    '[features]\nstandalone_web_search = "false"\n',
    `[features]\n${managedLine}\n`,
  ]) {
    test(`ambiguous TOML or unowned marker is rejected without configuration writes: ${original.trim()}`, () => {
      writeFileSync(configPath, original);
      const before = snapshot();
      expect(() => preflightCodexIntegration(config())).toThrow("standalone_web_search");
      expect(() => installCodexIntegration(config())).toThrow("standalone_web_search");
      expect(snapshot()).toEqual(before);
    });
  }
});
