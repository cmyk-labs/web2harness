import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as configModule from "../../src/config";
import * as integration from "../../src/codex/integration";
import * as service from "../../src/runtime/service";
import * as tunnel from "../../src/runtime/tunnel";
import * as tunnelService from "../../src/runtime/tunnel-service";
import * as browserHost from "../../src/browser/launcher-client";
import * as browserLogin from "../../src/browser/login";
import { launcherCapabilityProbeRequired, setup, setupDevProfile, setupProxyIsReady } from "../../src/setup";

const config = {
  mode: "browser-only" as const,
  releaseVersion: "0.2.0",
};

test("setup accepts only a matching daemon that is ready for new Codex turns", () => {
  const ready = {
    service: "web2harness",
    status: "ok",
    mode: "browser-only",
    version: "0.2.0",
    accepting_turns: true,
  };

  expect(setupProxyIsReady(ready, config)).toBe(true);
  expect(setupProxyIsReady({ ...ready, accepting_turns: false }, config)).toBe(false);
  expect(setupProxyIsReady({ ...ready, status: "degraded" }, config)).toBe(false);
  expect(setupProxyIsReady({ ...ready, version: "0.1.16" }, config)).toBe(false);
});

test("launcher setup refreshes account capabilities only when missing or explicitly requested", () => {
  const verifiedLauncher = {
    browserHost: "launcher",
    solAvailable: true,
    extraHighAvailable: false, proAvailable: false,
  };

  expect(launcherCapabilityProbeRequired(undefined)).toBe(true);
  expect(launcherCapabilityProbeRequired(verifiedLauncher as never)).toBe(false);
  expect(launcherCapabilityProbeRequired({ ...verifiedLauncher, extraHighAvailable: undefined } as never)).toBe(true);
  expect(launcherCapabilityProbeRequired({
    browserHost: "launcher",
    extraHighAvailable: false, proAvailable: false,
  } as never)).toBe(true);
  expect(launcherCapabilityProbeRequired(verifiedLauncher as never, true)).toBe(true);
  expect(launcherCapabilityProbeRequired({
    ...verifiedLauncher,
    browserInteractionMode: "manual",
  } as never)).toBe(false);
  expect(launcherCapabilityProbeRequired({
    ...verifiedLauncher,
    browserInteractionMode: "manual",
  } as never, false, "automatic")).toBe(true);
});

for (const development of [false, true]) for (const interaction of ["manual", "automatic"] as const) {
  test(`${development ? "DEV" : "production"} ${interaction} setup commits the tunnel inputs before its supervisor starts the runtime`, async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-web-setup-owner-"));
    const previousEnv = {
      WEB2HARNESS_DEV_HOME: process.env.WEB2HARNESS_DEV_HOME,
      WEB2HARNESS_HOME: process.env.WEB2HARNESS_HOME,
      CODEX_HOME: process.env.CODEX_HOME,
    };
    if (development) {
      process.env.WEB2HARNESS_DEV_HOME = root;
      process.env.WEB2HARNESS_HOME = root;
      process.env.CODEX_HOME = join(root, "codex-home");
    }
    const key = join(root, "runtime.key");
    writeFileSync(key, "fixture-runtime-key");
    const calls: string[] = [];
    let saved: configModule.AppConfig | undefined;
    const mocks = [
      spyOn(configModule, "getConfigPath").mockReturnValue(join(root, "config.json")),
      spyOn(configModule, "saveConfig").mockImplementation(value => { saved = value; calls.push("save"); }),
      spyOn(integration, "preflightCodexIntegration").mockImplementation(() => {}),
      spyOn(integration, "installCodexIntegration").mockImplementation(() => { calls.push("integrate"); return {} as never; }),
      spyOn(service, "getServiceStatus").mockReturnValue({ installed: false, loaded: false } as never),
      spyOn(service, "removeLegacyRuntimeArtifacts").mockImplementation(() => {}),
      spyOn(tunnelService, "getTunnelServiceStatus").mockReturnValue({ installed: false, loaded: false } as never),
      spyOn(tunnel, "managedRuntimeKeyPath").mockReturnValue(key),
      spyOn(tunnel, "installTunnelClient").mockResolvedValue(join(root, "tunnel-client")),
      spyOn(tunnel, "connectTunnel").mockImplementation(() => { throw new Error("setup started a runtime before committing its inputs"); }),
      spyOn(tunnel, "stopTunnel").mockImplementation(() => { throw new Error("setup stopped the supervisor's runtime"); }),
      spyOn(browserHost, "readLauncherBrowserHostDescriptor").mockReturnValue({ profile: development ? "development" : "production" } as never),
      spyOn(browserHost, "inspectLauncherBrowserHost").mockResolvedValue({ solAvailable: true, proAvailable: true, extraHighAvailable: true } as never),
    ];
    try {
      const options = {
        mode: "mcp-bridge" as const,
        browserInteractionMode: interaction,
        subagentProtocol: "native" as const,
        browserHostDescriptorPath: development ? join(root, "runtime", "launcher-browser.json") : join(root, "launcher-browser.json"),
        tunnelId: `tunnel_${"a".repeat(32)}`,
        acknowledgedUnofficial: true,
      };
      const listener = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
      const port = listener.port!;
      await listener.stop(true);
      const result = await (development ? setupDevProfile : setup)({ ...options, port,
        ...(interaction === "automatic" ? { experimentalFreshConversationPerTurn: true } : {}),
        useSavedChats: true,
      });
      expect(calls).toEqual(["save", "integrate"]);
      expect(saved?.tunnel?.alias).toBe(`web2harness${development ? "-dev" : ""}${interaction === "manual" ? "-zero-risk" : ""}`);
      expect(result.tunnelReady).not.toBe(true);
      expect(result.connectorSetupRequired).toBe(true);
      expect(saved?.experimentalFreshConversationPerTurn).toBe(interaction === "automatic");
      expect(saved?.useSavedChats).toBe(true);

      if (development && interaction === "automatic") {
        writeFileSync(join(root, "config.json"), "{}");
        const originalTunnel = structuredClone(saved!.tunnel);
        let previous = structuredClone(saved!);
        mocks.push(spyOn(configModule, "loadConfigForSetup").mockImplementation(() => previous));
        // Native-tools must retain private profiles without starting a tunnel.
        await setupDevProfile({ ...options, mode: "native-tools", port });
        expect(saved!.mode).toBe("native-tools");
        expect(saved!.tunnel).toBeUndefined();
        expect(saved!.automaticTunnel).toEqual(originalTunnel);
        previous = structuredClone(saved!);
        // No new ID/key is supplied on the return trip.
        await setupDevProfile({ ...options, tunnelId: undefined, port });
        expect(saved!.mode).toBe("mcp-bridge");
        expect(saved!.tunnel!.tunnelId).toBe(originalTunnel!.tunnelId);
        expect(saved!.tunnel!.runtimeKeyFile).toBe(originalTunnel!.runtimeKeyFile);
      }
      calls.length = 0;
      mocks.push(spyOn(configModule, "saveConfig").mockImplementation(() => { throw new Error("config commit failed"); }));
      await expect((development ? setupDevProfile : setup)({ ...options, port })).rejects.toThrow("config commit failed");
      expect(calls).toEqual([]);
    } finally {
      for (const mock of mocks.reverse()) mock.mockRestore();
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test.skipIf(process.platform !== "darwin")("external service setup retains validation cleanup on success and failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-web-external-setup-"));
  const configPath = join(root, "config.json");
  const key = join(root, "runtime.key");
  writeFileSync(key, "fixture-runtime-key");
  writeFileSync(configPath, "{}");
  const existing = {
    ...configModule.defaultConfig("mcp-bridge"),
    subagentProtocol: "native" as const,
    acknowledgedUnofficialAt: new Date().toISOString(),
  };
  const proxy = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({
    service: "web2harness", status: "ok", mode: "mcp-bridge", version: existing.releaseVersion, accepting_turns: true,
  }) });
  existing.port = proxy.port!;
  const calls: string[] = [];
  let ready = true;
  let stopFails = false;
  const mocks = [
    spyOn(configModule, "getConfigPath").mockReturnValue(configPath),
    spyOn(configModule, "loadConfigForSetup").mockReturnValue(existing),
    spyOn(configModule, "saveConfig").mockImplementation(() => {}),
    spyOn(integration, "preflightCodexIntegration").mockImplementation(() => {}),
    spyOn(integration, "installCodexIntegration").mockImplementation(() => ({} as never)),
    spyOn(browserLogin, "browserLoginStateExists").mockReturnValue(true),
    spyOn(browserLogin, "storedBrowserLoginCapabilities").mockReturnValue({ solAvailable: true, extraHighAvailable: false, proAvailable: false } as never),
    spyOn(service, "getServiceStatus").mockReturnValue({ installed: true, loaded: true } as never),
    spyOn(service, "assertServiceIdle").mockResolvedValue(undefined),
    spyOn(service, "installService").mockReturnValue({ installed: true, loaded: true } as never),
    spyOn(service, "restartService").mockResolvedValue({ installed: true, loaded: true } as never),
    spyOn(service, "removeLegacyRuntimeArtifacts").mockImplementation(() => {}),
    spyOn(tunnelService, "getTunnelServiceStatus").mockReturnValue({ installed: false, loaded: false } as never),
    spyOn(tunnelService, "installTunnelService").mockImplementation(() => { calls.push("service"); return { installed: true, loaded: true } as never; }),
    spyOn(tunnel, "managedRuntimeKeyPath").mockReturnValue(key),
    spyOn(tunnel, "installTunnelClient").mockResolvedValue(join(root, "tunnel-client")),
    spyOn(tunnel, "connectTunnel").mockImplementation(() => { calls.push("connect"); }),
    spyOn(tunnel, "waitForTunnelReady").mockImplementation(async () => { calls.push("ready"); return { ok: ready, detail: "fixture readiness" } as never; }),
    spyOn(tunnel, "stopTunnel").mockImplementation(() => {
      calls.push("stop");
      if (stopFails) throw new Error("fixture stop failure");
    }),
  ];
  try {
    const options = { mode: "mcp-bridge" as const, subagentProtocol: "native" as const, tunnelId: `tunnel_${"b".repeat(32)}`, restartService: true };
    expect((await setup(options)).tunnelReady).toBe(true);
    expect(calls).toEqual(["connect", "ready", "stop", "service", "ready"]);
    ready = false;
    calls.length = 0;
    await expect(setup(options)).rejects.toThrow("did not become healthy and ready");
    expect(calls).toEqual(["connect", "ready", "stop"]);
    stopFails = true;
    calls.length = 0;
    await expect(setup(options)).rejects.toThrow("fixture readiness; temporary tunnel cleanup also failed: fixture stop failure");
    expect(calls).toEqual(["connect", "ready", "stop"]);
  } finally {
    for (const mock of mocks.reverse()) mock.mockRestore();
    await proxy.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});
