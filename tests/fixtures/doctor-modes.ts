// Run in a separate Bun process: these mocks must never affect other tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "web2harness-doctor-modes-"));
try {
  mkdirSync(join(root, "runtime"));
  const config = { mode: "native-tools", browserHost: "launcher", browserInteractionMode: "automatic",
    host: "127.0.0.1", port: 31234, releaseVersion: "1.0.1", browserHostDescriptorPath: join(root, "browser.json") };
  writeFileSync(join(root, "runtime/launcher-supervisor.json"), JSON.stringify({ version: 1, ownerPid: process.pid, daemonPid: process.pid, status: "ready" }));
  mock.module("../../src/config", () => ({ loadConfig: () => config, getConfigDir: () => root, getConfigPath: () => join(root, "config.json") }));
  mock.module("../../src/codex/integration", () => ({ inspectCodexIntegration: () => ({ installed: true, errors: [] }) }));
  mock.module("../../src/browser/login", () => ({ browserLoginStateExists: () => true, loginVerificationMarkerPath: () => "" }));
  mock.module("../../src/runtime/service", () => ({ getServiceStatus: () => ({ installed: false, loaded: false }) }));
  mock.module("../../src/runtime/tunnel", () => ({ tunnelStatus: () => assert.fail("Unexpected tunnel call") }));
  mock.module("../../src/runtime/tunnel-service", () => ({ getTunnelServiceStatus: () => assert.fail("Unexpected tunnel service call") }));
  mock.module("../../src/runtime/process", () => ({ processRunning: (pid: number) => pid === process.pid }));
  mock.module("../../src/browser/launcher-client", () => ({
    inspectLauncherBrowserHost: async () => ({}), inspectLauncherBrowserHostLiveness: async () => ({ pid: process.pid }),
    readLauncherBrowserHostDescriptor: () => ({ pid: process.pid }),
  }));
  globalThis.fetch = (async () => new Response(JSON.stringify({ service: "web2harness", status: "ok", mode: config.mode,
    version: config.releaseVersion, accepting_turns: true, pid: process.pid }))) as unknown as typeof fetch;
  const { runDoctor } = await import("../../src/doctor");
  const native = await runDoctor();
  assert.equal(native.ok, true);
  assert.equal(native.checks.find(check => check.id === "tools")?.status, "ok");
  assert.match(native.checks.find(check => check.id === "tools")!.message, /Native Tools.*Codex task/);
  assert.doesNotMatch(native.checks.find(check => check.id === "tools")!.message, /Browser-only/);
  config.mode = "browser-only";
  const browser = await runDoctor();
  assert.equal(browser.checks.find(check => check.id === "tools")?.status, "warning");
  assert.match(browser.checks.find(check => check.id === "tools")!.message, /Browser-only/);
  console.log("doctor modes verified");
} finally { rmSync(root, { recursive: true, force: true }); }
