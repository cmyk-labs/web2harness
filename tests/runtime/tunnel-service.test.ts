import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../src/config";
import { createTunnelConfig, mcpCommand } from "../../src/runtime/tunnel";
import { tunnelServiceDefinition } from "../../src/runtime/tunnel-service";
import { existingMcpBridgeSetupCredentials, tunnelWorkerRuntimeChanged } from "../../src/setup";

const roots: string[] = [];

// Mirrors the pinned tunnel-client's config parser: backslash escapes the next rune and quotes
// group an argument. This catches Windows command strings that look right but reconstruct the
// wrong executable, script path, or named pipe in the actual tunnel worker.
function parsePinnedTunnelCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  let started = false;
  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      started = true;
    } else if (character === "\\") {
      escaped = true;
      started = true;
    } else if (character === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(character) && !quoted) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else {
      current += character;
      started = true;
    }
  }
  if (escaped || quoted) throw new Error("invalid tunnel command");
  if (started) args.push(current);
  return args;
}

afterEach(() => {
  delete process.env.WEB2HARNESS_HOME;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("tunnel launchd ownership", () => {
  test("runs the pinned client directly and asks launchd to restore it", () => {
    const root = join(tmpdir(), `web2harness-tunnel-service-${process.pid}-${Date.now()}`);
    roots.push(root);
    process.env.WEB2HARNESS_HOME = root;
    const binary = join(root, "bin", "tunnel-client");
    const key = join(root, "secrets", "runtime.key");
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(join(root, "secrets"), { recursive: true });
    writeFileSync(binary, "binary");
    writeFileSync(key, "secret");
    const config = defaultConfig("mcp-bridge");
    config.tunnel = createTunnelConfig({
      binaryPath: binary,
      runtimeKeyFile: key,
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
    });

    const definition = tunnelServiceDefinition(config);
    expect(definition).toContain("<string>run</string>");
    expect(definition).toContain(`<string>${config.tunnel.profileDir}</string>`);
    expect(definition).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(definition).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(definition).not.toContain("tmux");
    expect(definition).not.toContain("/bin/sh");
    expect(definition).not.toContain(config.tunnel.tunnelId);
    expect(definition).not.toContain(key);
  });

  test("restarts the long-lived MCP worker when the installed release changes", () => {
    const root = join(tmpdir(), `web2harness-tunnel-runtime-${process.pid}-${Date.now()}`);
    roots.push(root);
    process.env.WEB2HARNESS_HOME = root;
    const runtime = join(root, "bin", "web2harness");
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(runtime, "runtime");
    const before = defaultConfig("browser-only");
    before.mode = "mcp-bridge";
    before.releaseVersion = "0.1.3";
    before.runtimeCommand = [runtime];
    const after = structuredClone(before);
    after.releaseVersion = "0.1.9";

    expect(tunnelWorkerRuntimeChanged(before, after)).toBe(true);
    after.releaseVersion = before.releaseVersion;
    expect(tunnelWorkerRuntimeChanged(before, after)).toBe(false);
  });

  test("reuses complete MCP Bridge tunnel credentials during setup updates", () => {
    const root = join(tmpdir(), `web2harness-existing-tunnel-${process.pid}-${Date.now()}`);
    roots.push(root);
    process.env.WEB2HARNESS_HOME = root;
    const key = join(root, "secrets", "runtime.key");
    mkdirSync(join(root, "secrets"), { recursive: true });
    writeFileSync(key, "secret");
    const config = defaultConfig("mcp-bridge");
    config.tunnel = createTunnelConfig({
      binaryPath: process.execPath,
      runtimeKeyFile: key,
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
    });

    expect(existingMcpBridgeSetupCredentials(config)).toEqual({ tunnelId: true, runtimeKey: true });
    config.automaticTunnel = config.tunnel;
    delete config.tunnel;
    config.mode = "native-tools";
    expect(existingMcpBridgeSetupCredentials(config)).toEqual({ tunnelId: true, runtimeKey: true });
    expect(existingMcpBridgeSetupCredentials(config, "manual")).toEqual({ tunnelId: false, runtimeKey: false });
    rmSync(key);
    expect(existingMcpBridgeSetupCredentials(config)).toEqual({ tunnelId: true, runtimeKey: false });
    expect(existingMcpBridgeSetupCredentials(defaultConfig("browser-only"))).toEqual({ tunnelId: false, runtimeKey: false });
  });

  test("passes the Windows MCP runtime directly to tunnel-client without cmd.exe", () => {
    const root = join(tmpdir(), `web2harness-windows-mcp-${process.pid}-${Date.now()}`);
    roots.push(root);
    process.env.WEB2HARNESS_HOME = root;
    const runtime = join(root, "Program Files", "runtime", "bun.exe");
    mkdirSync(join(root, "Program Files", "runtime"), { recursive: true });
    writeFileSync(runtime, "runtime");
    const config = defaultConfig("browser-only");
    config.runtimeCommand = [runtime, join(root, "Program Files", "app", "cli.js")];
    config.brokerSocketPath = "\\\\.\\pipe\\web2harness-test";

    const command = mcpCommand(config, "win32");
    expect(command).toBe(
      `"${runtime.replaceAll("\\", "\\\\")}" `
      + `"${join(root, "Program Files", "app", "cli.js").replaceAll("\\", "\\\\")}" `
      + '"mcp" "--contract" "native" "--broker-socket" "\\\\\\\\.\\\\pipe\\\\web2harness-test"',
    );
    expect(command).not.toContain("cmd.exe");
    expect(existsSync(join(root, "bin", "mcp-launcher.cmd"))).toBe(false);
    expect(parsePinnedTunnelCommand(command)).toEqual([
      runtime,
      join(root, "Program Files", "app", "cli.js"),
      "mcp",
      "--contract",
      "native",
      "--broker-socket",
      "\\\\.\\pipe\\web2harness-test",
    ]);

    config.browserInteractionMode = "manual";
    expect(parsePinnedTunnelCommand(mcpCommand(config, "win32"))).toContain("safe");
  });

});
