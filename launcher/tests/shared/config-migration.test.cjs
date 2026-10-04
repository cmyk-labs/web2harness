const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CURRENT_CONFIG_VERSION, migrateRuntimeConfig } = require("../../shared/config-migration.cjs");
const { RuntimeSupervisor, validateConfig } = require("../../electron/runtime/runtime-supervisor.cjs");
const { RuntimeHost } = require("../../electron/runtime/runtime.cjs");

function fixture(t, { launcherProfile = "production", interactionMode = "automatic" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-config-migration-"));
  t.after(() => {
    const ownedRoot = fs.realpathSync(root);
    assert.equal(path.dirname(ownedRoot).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.match(path.basename(ownedRoot), /^web2harness-config-migration-/);
    fs.rmSync(ownedRoot, { recursive: true, force: true });
  });
  const descriptorPath = path.join(root, "launcher-browser.json");
  const tunnel = (manual) => ({
    binaryPath: process.execPath,
    tunnelId: `tunnel_${(manual ? "b" : "a").repeat(32)}`,
    runtimeKeyFile: path.join(root, "secrets", `tunnel-runtime-${manual ? "zero-risk" : "automatic"}.key`),
    profileDir: path.join(root, "tunnel", "profiles"),
    profileName: manual ? "web2harness-zero-risk" : "web2harness",
    alias: manual ? "web2harness-zero-risk" : "web2harness",
  });
  const automaticTunnel = tunnel(false), manualTunnel = tunnel(true);
  const config = {
    version: 4,
    releaseVersion: "6.0.0",
    mode: "full",
    ...(launcherProfile === "development" ? { purpose: "dev-harness" } : {}),
    host: "127.0.0.1", port: 34891,
    contextWindow: 90_000,
    appName: interactionMode === "manual" ? "Codex Zero Risk" : "Codex Native2",
    browserHost: "launcher", browserHostDescriptorPath: descriptorPath,
    browserInteractionMode: interactionMode,
    chromeExecutablePath: process.execPath,
    storageStatePath: path.join(root, "storage-state.json"),
    brokerSocketPath: process.platform === "win32"
      ? "\\\\.\\pipe\\web2harness-config-migration-fixture"
      : path.join(root, "broker.sock"),
    headed: true, solAvailable: true, proAvailable: true, autoApproveToolCalls: false,
    controlToken: "fixture-config-migration-control-token-0123456789",
    runtimeCommand: [process.execPath],
    automaticTunnel, manualTunnel,
    tunnel: interactionMode === "manual" ? manualTunnel : automaticTunnel,
    useSavedChats: false,
    experimentalFreshConversationPerTurn: true,
  };
  const configPath = path.join(root, "config.json");
  const original = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(configPath, original);
  const app = { getPath: () => root, getVersion: () => config.releaseVersion };
  const logger = { info() {}, warn() {}, error() {} };
  const supervisor = new RuntimeSupervisor({ app, logger, coreHome: root,
    browserDescriptorPath: descriptorPath, launcherProfile });
  const host = new RuntimeHost({ app, logger, coreHome: root, codexHome: path.join(root, "codex-home"),
    sourceRoot: root, browserDescriptorPath: descriptorPath, launcherProfile, supervisor,
    getBrowserInteractionMode: () => interactionMode });
  return { config, configPath, descriptorPath, original, supervisor, host };
}

test("both launcher config readers canonicalize persisted v4 MCP mode without writing or losing settings", t => {
  for (const launcherProfile of ["production", "development"]) {
    for (const interactionMode of ["automatic", "manual"]) {
      const f = fixture(t, { launcherProfile, interactionMode });
      for (const loaded of [f.supervisor.readSetupConfig(), f.supervisor.readConfig()]) {
        assert.equal(loaded.version, CURRENT_CONFIG_VERSION);
        assert.equal(loaded.mode, "mcp-bridge");
        assert.equal(loaded.browserInteractionMode, interactionMode);
        assert.equal(loaded.appName, f.config.appName);
        assert.deepEqual(loaded.tunnel, f.config.tunnel);
        assert.deepEqual(loaded.automaticTunnel, f.config.automaticTunnel);
        assert.deepEqual(loaded.manualTunnel, f.config.manualTunnel);
        assert.equal(loaded.controlToken, f.config.controlToken);
        assert.equal(loaded.useSavedChats, false);
        assert.equal(loaded.experimentalFreshConversationPerTurn, true);
      }
      const snapshot = f.host.runtimeConfigSnapshot();
      assert.equal(snapshot.mode, "mcp-bridge");
      assert.equal(snapshot.config.mode, "mcp-bridge");
      assert.equal(JSON.parse(snapshot.serialized).mode, "mcp-bridge");
      assert.equal(snapshot.migrationRequired, true);
      assert.equal(f.supervisor.configMigrationRequired(), true);
      assert.equal(fs.readFileSync(f.configPath, "utf8"), f.original);
    }
  }
});

test("same-release launcher upgrade routes a schema migration through setup with the canonical flag", async t => {
  for (const interactionMode of ["automatic", "manual"]) {
    const f = fixture(t, { interactionMode });
    let invocation;
    f.host.runSetup = async (name, args, options) => {
      invocation = { name, args, options };
      assert.equal(fs.readFileSync(f.configPath, "utf8"), f.original);
      return { stdout: "fixture setup scheduled" };
    };
    const result = await f.host.upgradeManagedRuntime();
    assert.equal(result.updated, true);
    assert.equal(result.mode, "mcp-bridge");
    assert.equal(result.fromVersion, result.toVersion);
    assert.equal(result.connectorMigrated, false);
    assert.equal(invocation.name, "runtime-upgrade");
    assert.equal(invocation.args[1], "--mcp-bridge");
    assert.ok(invocation.args.includes(interactionMode === "manual"
      ? "--zero-risk-browser-interaction" : "--automatic-browser-interaction"));
    assert.equal(invocation.args.includes("--refresh-account-capabilities"), interactionMode === "automatic");
    assert.equal(fs.readFileSync(f.configPath, "utf8"), f.original,
      "only the setup transaction may persist migration; this fixture does not run setup");
    fs.writeFileSync(f.configPath, JSON.stringify(migrateRuntimeConfig(f.config)));
    assert.equal(f.supervisor.configMigrationRequired(), false);
    assert.deepEqual(await f.host.upgradeManagedRuntime(), { updated: false });
  }
});

test("launcher migration keeps schema and DEV ownership checks strict", t => {
  const f = fixture(t);
  const unchanged = JSON.parse(f.original);
  const currentLegacy = { ...unchanged, version: CURRENT_CONFIG_VERSION };
  assert.throws(() => validateConfig(currentLegacy, f.descriptorPath), /invalid mode/);
  assert.throws(() => validateConfig({ ...unchanged, version: 999 }, f.descriptorPath), /unsupported/);
  assert.throws(() => validateConfig(unchanged, f.descriptorPath, process.platform, "development"), /not marked dev-harness/);
  assert.deepEqual(unchanged, JSON.parse(f.original), "migration must not mutate its raw input");
  fs.writeFileSync(f.configPath, JSON.stringify(currentLegacy));
  assert.throws(() => f.supervisor.readSetupConfig(), /invalid setup mode/);
  assert.throws(() => f.supervisor.readConfig(), /invalid mode/);
});

test("earlier browser-only setup migrations preserve explicit later browser-only selections", t => {
  const f = fixture(t);
  const v3 = { ...f.config, version: 3, mode: "browser-only" };
  const migrated = validateConfig(v3, f.descriptorPath);
  assert.equal(migrated.mode, "native-tools");
  assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
  assert.equal(migrated.browserHostDescriptorPath, v3.browserHostDescriptorPath);
  assert.equal(migrated.brokerSocketPath, v3.brokerSocketPath);
  assert.equal(v3.version, 3);
  const explicit = validateConfig({ ...f.config, version: 4, mode: "browser-only" }, f.descriptorPath);
  assert.equal(explicit.mode, "browser-only");
  assert.equal(explicit.version, CURRENT_CONFIG_VERSION);
});

test("retired persisted mode is rejected on current health, tool-mode, and IPC boundaries", async t => {
  const f = fixture(t);
  const config = f.supervisor.readConfig();
  let health = { service: "web2harness", status: "ok", mode: "full", version: config.releaseVersion };
  f.supervisor.proxyHealthPayload = async () => health;
  assert.equal(await f.supervisor.proxyHealth(config), false);
  health = { ...health, mode: "mcp-bridge" };
  assert.equal(await f.supervisor.proxyHealth(config), true);
  await assert.rejects(f.host.setToolMode("full"), /Tool mode must be native-tools or mcp-bridge/);

  const main = fs.readFileSync(path.join(__dirname, "../../electron/main.cjs"), "utf8");
  const handlers = new Map();
  require("node:vm").runInNewContext(main.slice(main.indexOf('handle("launcher:tool-mode",'),
    main.indexOf('handle("launcher:browser-interaction-mode",')), {
    handle: (name, handler) => handlers.set(name, handler),
  });
  await assert.rejects(handlers.get("launcher:tool-mode")(null, "full"),
    /Tool mode must be native-tools or mcp-bridge/);
});
