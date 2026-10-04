import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { defaultBrokerEndpoint, defaultConfig, ZERO_RISK_CHATGPT_CONNECTOR_NAME } from "../src/config";
import { LAUNCHER_BROWSER_IDLE_URL } from "../src/browser/launcher-client";

setDefaultTimeout(30_000);

async function runCli(args: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn([
    process.execPath,
    resolve(import.meta.dir, "../src/cli.ts"),
    ...args,
  ], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function removeModeFixture(root: string): void {
  if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-cli-mode-")) {
    throw new Error("Refusing to remove a directory outside this test's temporary fixture");
  }
  rmSync(root, { recursive: true, force: true });
}

test("MCP Bridge CLI selection runs credential preflight without starting a runtime", async () => {
  const root = mkdtempSync(join(resolve(tmpdir()), "web2harness-cli-mode-"));
  const env = {
    ...process.env,
    CODEX_HOME: join(root, "codex"),
    WEB2HARNESS_HOME: join(root, "app"),
    WEB2HARNESS_DEV_HOME: join(root, "dev"),
  };
  try {
    const args = [
      "setup", "--mcp-bridge", "--preflight-only", "--acknowledge-unofficial",
      "--browser-host-descriptor", join(root, "launcher-browser.json"),
    ];
    const missingTunnel = await runCli(args, env);
    expect(missingTunnel.exitCode).toBe(1);
    expect(missingTunnel.stderr).toContain("Automatic mode needs its own MCP Tunnel ID");

    const withTunnel = [...args, "--tunnel-id", `tunnel_${"a".repeat(32)}`];
    const missingKey = await runCli(withTunnel, env);
    expect(missingKey.exitCode).toBe(1);
    expect(missingKey.stderr).toContain("Automatic mode needs its own MCP runtime key");

    const key = join(root, "runtime.key");
    writeFileSync(key, "fixture-runtime-key-only\n", { mode: 0o600 });
    const ready = await runCli([...withTunnel, "--runtime-key-file", key], env);
    expect(ready).toEqual({ exitCode: 0, stdout: "Setup preflight complete.\n", stderr: "" });
    expect(existsSync(join(root, "app", "config.json"))).toBeFalse();
    expect(existsSync(join(root, "codex", "config.toml"))).toBeFalse();

    for (const command of [["--help"], ["dev", "help"]]) {
      const help = await runCli(command, env);
      expect(help.exitCode).toBe(0);
      expect(help.stdout).toContain("--mcp-bridge");
    }
  } finally {
    removeModeFixture(root);
  }
});

test("production and DEV setup accept MCP Bridge flags and reject invalid or conflicting mode flags", async () => {
  const root = mkdtempSync(join(resolve(tmpdir()), "web2harness-cli-mode-"));
  const env = {
    ...process.env,
    CODEX_HOME: join(root, "codex"),
    WEB2HARNESS_HOME: join(root, "app"),
    WEB2HARNESS_DEV_HOME: join(root, "dev"),
  };
  try {
    for (const command of [["setup"], ["dev", "setup"]]) {
      const invalidPort = await runCli([
        ...command, "--mcp-bridge", "--port", "0", "--acknowledge-unofficial",
      ], env);
      expect(invalidPort.exitCode).toBe(1);
      expect(invalidPort.stderr).toContain("--port must be an integer from 1 to 65535");
      expect(invalidPort.stderr).not.toMatch(/Unknown.*arguments/);

      const invalidMode = await runCli([
        ...command, "--unsupported-mode", "--acknowledge-unofficial",
      ], env);
      expect(invalidMode.exitCode).toBe(1);
      expect(invalidMode.stderr).toMatch(/Unknown.*arguments: --unsupported-mode/);

      for (const flags of [
        ["--mcp-bridge", "--browser-only"],
        ["--mcp-bridge", "--native-tools"],
        ["--browser-only", "--native-tools"],
      ]) {
        const conflict = await runCli([...command, ...flags, "--acknowledge-unofficial"], env);
        expect(conflict.exitCode).toBe(1);
        expect(conflict.stderr).toMatch(/Choose at most one (DEV )?setup mode/);
        expect(conflict.stderr).toContain("--mcp-bridge");
      }
    }
    expect(existsSync(join(root, "app", "config.json"))).toBeFalse();
    expect(existsSync(join(root, "dev", "config.json"))).toBeFalse();
    expect(existsSync(join(root, "codex", "config.toml"))).toBeFalse();
    expect(existsSync(join(root, "dev", "codex-home", "config.toml"))).toBeFalse();
  } finally {
    removeModeFixture(root);
  }
});

test("production and DEV setup reject the removed connector-name option before configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-fixed-connector-"));
  try {
    const env = {
      ...process.env,
      CODEX_HOME: join(root, "codex"),
      WEB2HARNESS_HOME: join(root, "app"),
      WEB2HARNESS_DEV_HOME: join(root, "dev"),
    };
    for (const command of [["setup"], ["dev", "setup"]]) {
      const result = await runCli([
        ...command, "--browser-only", "--app-name", "Other Connector", "--acknowledge-unofficial",
      ], env);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/Unknown.*arguments: --app-name Other Connector/);
    }
    expect(existsSync(join(root, "app", "config.json"))).toBeFalse();
    expect(existsSync(join(root, "dev", "config.json"))).toBeFalse();
    const help = await runCli(["--help"], env);
    expect(help.stdout).not.toContain("--app-name");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production and DEV setup reject conflicting conversation modes before configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-web-conversation-flags-"));
  try {
    for (const command of [["setup"], ["dev", "setup"]]) {
      const result = await runCli([
        ...command, "--browser-only", "--fresh-conversation", "--retained-conversation",
      ], {
        ...process.env,
        CODEX_HOME: join(root, "codex"),
        WEB2HARNESS_HOME: join(root, "app"),
        WEB2HARNESS_DEV_HOME: join(root, "dev"),
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Choose --fresh-conversation or --retained-conversation");
    }
    expect(existsSync(join(root, "app", "config.json"))).toBeFalse();
    expect(existsSync(join(root, "dev", "config.json"))).toBeFalse();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup validates the port before performing runtime work", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-"));
  try {
    const result = await runCli([
      "setup",
      "--browser-only",
      "--chrome",
      process.execPath,
      "--browser-host-descriptor",
      join(root, "launcher-browser.json"),
      "--port",
      "0",
      "--acknowledge-unofficial",
    ], {
      ...process.env,
      CODEX_HOME: join(root, "codex"),
      WEB2HARNESS_HOME: join(root, "app"),
    });
    const { stderr } = result;
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("--port must be an integer from 1 to 65535");
    expect(stderr).not.toContain("Choose either --chrome or --browser-host-descriptor");
    expect(stderr).not.toContain("Unknown arguments");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup browser-interaction flags are explicit and mutually exclusive", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-interaction-"));
  try {
    const result = await runCli([
      "setup",
      "--browser-only",
      "--automatic-browser-interaction",
      "--zero-risk-browser-interaction",
      "--acknowledge-unofficial",
    ], {
      ...process.env,
      CODEX_HOME: join(root, "codex"),
      WEB2HARNESS_HOME: join(root, "app"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Choose at most one browser interaction mode");

    const profileConflict = await runCli([
      "setup",
      "--browser-only",
      "--zero-risk-browser-interaction",
      "--zero-risk-pro",
      "--zero-risk-default",
      "--acknowledge-unofficial",
    ], {
      ...process.env,
      CODEX_HOME: join(root, "codex"),
      WEB2HARNESS_HOME: join(root, "app"),
    });
    expect(profileConflict.exitCode).toBe(1);
    expect(profileConflict.stderr).toContain("Choose at most one Zero Risk model profile");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manual setup rejects capability refresh and Context as File", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-manual-invalid-"));
  try {
    const env = {
      ...process.env,
      CODEX_HOME: join(root, "codex"),
      WEB2HARNESS_HOME: join(root, "app"),
    };
    const refresh = await runCli([
      "setup",
      "--browser-only",
      "--zero-risk-browser-interaction",
      "--refresh-account-capabilities",
      "--acknowledge-unofficial",
    ], env);
    expect(refresh.exitCode).toBe(1);
    expect(refresh.stderr).toContain("cannot refresh account capabilities");

    const bigger = await runCli([
      "setup",
      "--browser-only",
      "--zero-risk-browser-interaction",
      "--context-files",
      "--acknowledge-unofficial",
    ], env);
    expect(bigger.exitCode).toBe(1);
    expect(bigger.stderr).toContain("does not support Context as File");

    const browserOnly = await runCli([
      "setup",
      "--browser-only",
      "--zero-risk-browser-interaction",
      "--acknowledge-unofficial",
    ], env);
    expect(browserOnly.exitCode).toBe(1);
    expect(browserOnly.stderr).toContain("requires --mcp-bridge");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

test("passkey capture cannot be invoked outside the live Launcher control channel", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-passkey-auth-"));
  try {
    const result = await runCli([
      "login",
      "--launcher-control",
      "--chrome",
      process.execPath,
      "--storage-state",
      join(root, "storage-state.json"),
    ], { ...process.env });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Launcher-controlled passkey login requires a live launcher authorization");
    expect(existsSync(join(root, "storage-state.json"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV chat list works without starting launcher, broker, or Responses services", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-dev-list-"));
  try {
    const result = await runCli(["dev", "list"], {
      ...process.env,
      WEB2HARNESS_DEV_HOME: join(root, "dev"),
      WEB2HARNESS_HOME: join(root, "app"),
      CODEX_HOME: join(root, "codex"),
    });
    expect(result).toEqual({ exitCode: 0, stdout: "No named DEV chats yet.\n", stderr: "" });
    expect(existsSync(join(root, "codex", "config.toml"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV help exposes separate history-fill and live composer-fill operations", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-dev-help-"));
  try {
    const result = await runCli(["dev", "help"], {
      ...process.env,
      WEB2HARNESS_DEV_HOME: join(root, "dev"),
      WEB2HARNESS_HOME: join(root, "app"),
      CODEX_HOME: join(root, "codex"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("/fill TOKENS");
    expect(result.stdout).toContain("/send-fill TOKENS");
    expect(result.stderr).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV status reports the isolated home without creating a Codex route", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-dev-status-"));
  const devHome = join(root, "dev");
  try {
    const result = await runCli(["dev", "status", "--json"], {
      ...process.env,
      WEB2HARNESS_DEV_HOME: devHome,
      WEB2HARNESS_HOME: join(root, "production"),
      CODEX_HOME: join(root, "production-codex"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      paths: {
        home: devHome,
        codexHome: join(devHome, "codex-home"),
        launcherUserData: join(devHome, "launcher"),
      },
      launcher: { running: false },
      config: { configured: false },
    });
    expect(existsSync(join(root, "production-codex", "config.toml"))).toBe(false);
    expect(existsSync(join(devHome, "codex-home", "config.toml"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV chat explains the isolated launcher setup when its profile is empty", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-dev-empty-"));
  try {
    const result = await runCli(["dev", "chat", "smoke", "hello"], {
      ...process.env,
      WEB2HARNESS_DEV_HOME: join(root, "dev"),
      WEB2HARNESS_HOME: join(root, "production"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("In the window labelled DEV");
    expect(result.stderr).toContain("Complete optional MCP setup only for MCP Bridge mode");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generic --home cannot collapse DEV mode into another runtime home", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-dev-home-"));
  try {
    const result = await runCli(["--home", join(root, "shared"), "dev", "status"], {
      ...process.env,
      WEB2HARNESS_DEV_HOME: join(root, "dev"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--home does not apply to DEV mode");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV setup installs a real isolated Codex route and Responses server", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-dev-setup-"));
  const devHome = join(root, "dev");
  const descriptorPath = join(devHome, "runtime", "launcher-browser.json");
  const helperScript = join(root, "helper.cjs");
  const controlToken = "dev-launcher-control-token-0123456789abcdefghijklmnop";
  let inspections = 0;
  const control = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    inspections += 1;
    expect(request.url).toBe("/v1/session/inspect");
    expect(request.headers.authorization).toBe(`Bearer ${controlToken}`);
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({ detectCapabilities: true });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      authenticated: true,
      temporary: true,
      solAvailable: true,
      extraHighAvailable: false, proAvailable: false,
      url: "https://chatgpt.com/?temporary-chat=true",
    }));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    control.once("error", rejectListen);
    control.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = control.address();
    if (!address || typeof address === "string") throw new Error("control server has no port");
    mkdirSync(join(devHome, "runtime"), { recursive: true });
    writeFileSync(helperScript, "module.exports = {};\n", { mode: 0o700 });
    writeFileSync(descriptorPath, `${JSON.stringify({
      version: 3,
      kind: "web2harness-launcher",
      profile: "development",
      pid: process.pid,
      endpoint: "http://127.0.0.1:48121",
      control: { endpoint: `http://127.0.0.1:${address.port}`, token: controlToken },
      helper: { executable: process.execPath, script: helperScript },
      partition: "persist:web2harness-dev-chatgpt",
      idleUrl: LAUNCHER_BROWSER_IDLE_URL,
      surfaceId: "d".repeat(32),
      surfaceTargets: { ["d".repeat(32)]: "native-owned-target" },
      createdAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });

    const result = await runCli([
      "dev",
      "setup",
      "--browser-only",
      "--browser-host-descriptor",
      descriptorPath,
      "--acknowledge-unofficial",
    ], {
      ...process.env,
      WEB2HARNESS_DEV_HOME: devHome,
      WEB2HARNESS_HOME: join(root, "production"),
      CODEX_HOME: join(root, "production-codex"),
    });
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Codex integration installed only in the isolated DEV home");
    expect(result.stdout).toContain("DEV launcher owns the Responses runtime");
    expect(inspections).toBe(1);
    expect(JSON.parse(readFileSync(join(devHome, "config.json"), "utf8"))).toMatchObject({
      version: 5,
      purpose: "dev-harness",
      mode: "browser-only",
      appName: "Codex Native2 DEV",
      browserHost: "launcher",
      browserHostDescriptorPath: descriptorPath,
      solAvailable: true,
      extraHighAvailable: false, proAvailable: false,
    });
    expect(existsSync(join(root, "production-codex", "config.toml"))).toBe(false);
    const devConfig = JSON.parse(readFileSync(join(devHome, "config.json"), "utf8"));
    expect(devConfig.port).not.toBe(17841);
    expect(readFileSync(join(devHome, "codex-home", "config.toml"), "utf8"))
      .toContain("http://127.0.0.1:" + devConfig.port + "/v1");
    const daemon = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "serve"], {
      env: { ...process.env, WEB2HARNESS_DEV_HOME: devHome,
        WEB2HARNESS_HOME: devHome, CODEX_HOME: join(devHome, "codex-home") },
      stdout: "pipe", stderr: "pipe",
    });
    try {
      const endpoint = "http://127.0.0.1:" + devConfig.port;
      let ready = false;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !ready) {
        try {
          const health = await (await fetch(endpoint + "/healthz")).json() as { pid: number };
          ready = health.pid === daemon.pid;
        } catch { await Bun.sleep(50); }
      }
      expect(ready).toBe(true);
      expect((await fetch(endpoint + "/v1/responses")).status).toBe(426);
      expect(existsSync(join(root, "production-codex", "config.toml"))).toBe(false);
      expect(existsSync(join(root, "production", "config.json"))).toBe(false);
    } finally {
      daemon.kill();
      await daemon.exited;
    }
  } finally {
    await new Promise<void>(resolveClose => control.close(() => resolveClose()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV setup accepts explicit browser-interaction flags and preserves manual fail-closed validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-dev-interaction-"));
  const devHome = join(root, "dev");
  const descriptorPath = join(devHome, "runtime", "launcher-browser.json");
  const helperScript = join(root, "helper.cjs");
  try {
    mkdirSync(join(devHome, "runtime"), { recursive: true });
    writeFileSync(helperScript, "module.exports = {};\n", { mode: 0o700 });
    writeFileSync(descriptorPath, `${JSON.stringify({
      version: 3,
      kind: "web2harness-launcher",
      profile: "development",
      pid: process.pid,
      endpoint: "http://127.0.0.1:48131",
      control: {
        endpoint: "http://127.0.0.1:48132",
        token: "dev-manual-control-token-0123456789abcdefghijklmnop",
      },
      helper: { executable: process.execPath, script: helperScript },
      partition: "persist:web2harness-dev-chatgpt",
      idleUrl: LAUNCHER_BROWSER_IDLE_URL,
      surfaceId: "m".repeat(32),
      surfaceTargets: { ["m".repeat(32)]: "native-owned-target" },
      createdAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });
    const env = {
      ...process.env,
      WEB2HARNESS_DEV_HOME: devHome,
      WEB2HARNESS_HOME: join(root, "production"),
      CODEX_HOME: join(root, "production-codex"),
    };

    const manualBrowserOnly = await runCli([
      "dev",
      "setup",
      "--browser-only",
      "--browser-host-descriptor",
      descriptorPath,
      "--zero-risk-browser-interaction",
      "--acknowledge-unofficial",
    ], env);
    expect(manualBrowserOnly.exitCode).toBe(1);
    expect(manualBrowserOnly.stderr).toContain("requires --mcp-bridge");
    expect(manualBrowserOnly.stderr).not.toContain("Unknown DEV arguments");

    const conflicting = await runCli([
      "dev",
      "setup",
      "--browser-only",
      "--automatic-browser-interaction",
      "--zero-risk-browser-interaction",
    ], env);
    expect(conflicting.exitCode).toBe(1);
    expect(conflicting.stderr).toContain("Choose at most one browser interaction mode");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("browser check uses metadata-only launcher liveness in Zero Risk", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-manual-browser-check-"));
  const appHome = join(root, "app");
  const descriptorPath = join(appHome, "runtime", "launcher-browser.json");
  const helperScript = join(root, "helper.cjs");
  let requests = 0;
  const cdp = createServer((request, response) => {
    requests += 1;
    expect(request.url).toBe("/json/version");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      webSocketDebuggerUrl: "ws://127.0.0.1:48142/devtools/browser/manual-check",
    }));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    cdp.once("error", rejectListen);
    cdp.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = cdp.address();
    if (!address || typeof address === "string") throw new Error("CDP test server has no port");
    mkdirSync(join(appHome, "runtime"), { recursive: true });
    writeFileSync(helperScript, "module.exports = {};\n", { mode: 0o700 });
    writeFileSync(descriptorPath, `${JSON.stringify({
      version: 3,
      kind: "web2harness-launcher",
      profile: "production",
      pid: process.pid,
      endpoint: `http://127.0.0.1:${address.port}`,
      control: {
        endpoint: "http://127.0.0.1:48143",
        token: "manual-browser-check-token-0123456789abcdefghijklmnop",
      },
      helper: { executable: process.execPath, script: helperScript },
      partition: "persist:web2harness-chatgpt",
      idleUrl: LAUNCHER_BROWSER_IDLE_URL,
      surfaceId: "s".repeat(32),
      surfaceTargets: { ["s".repeat(32)]: "native-owned-target" },
      createdAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });
    const config = {
      ...defaultConfig("mcp-bridge"),
      appName: ZERO_RISK_CHATGPT_CONNECTOR_NAME,
      browserHost: "launcher",
      browserInteractionMode: "manual",
      browserHostDescriptorPath: descriptorPath,
      tunnel: {
        binaryPath: process.execPath,
        tunnelId: `tunnel_${"a".repeat(32)}`,
        runtimeKeyFile: join(root, "runtime.key"),
        profileDir: join(root, "tunnel-profile"),
        profileName: "manual-check",
        alias: "manual-check",
      },
    };
    writeFileSync(join(appHome, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });

    const result = await runCli(["browser", "check"], {
      ...process.env,
      WEB2HARNESS_HOME: appHome,
      CODEX_HOME: join(root, "codex"),
    });
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("DOM inspection is intentionally disabled");
    expect(requests).toBe(1);
  } finally {
    await new Promise<void>(resolveClose => cdp.close(() => resolveClose()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("terminal uninstall refuses to race a launcher-owned runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-uninstall-"));
  const appHome = join(root, "app");
  const configPath = join(appHome, "config.json");
  mkdirSync(appHome, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    version: 3,
    releaseVersion: "0.2.0",
    mode: "browser-only",
    host: "127.0.0.1",
    port: 17841,
    contextWindow: 256_000,
    appName: "Codex Native",
    browserHost: "launcher",
    browserHostDescriptorPath: join(appHome, "runtime", "launcher-browser.json"),
    chromeExecutablePath: process.execPath,
    storageStatePath: join(appHome, "browser", "storage-state.json"),
    brokerSocketPath: defaultBrokerEndpoint(appHome),
    headed: true,
    extraHighAvailable: false, proAvailable: false,
    autoApproveToolCalls: false,
    controlToken: "launcher-uninstall-control-token-0123456789abcdef",
    runtimeCommand: [process.execPath],
  })}\n`);
  try {
    const result = await runCli([
      "uninstall",
      "--yes",
    ], {
      ...process.env,
      CODEX_HOME: join(root, "codex"),
      WEB2HARNESS_HOME: appHome,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must be removed from Web2Harness Settings");
    expect(existsSync(configPath)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const keepRuntime of [false, true]) test(`authorized launcher uninstall preserves runtime=${keepRuntime} without re-probing the stopped service`, async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-cli-launcher-uninstall-"));
  const appHome = join(root, "app");
  const codexHome = join(root, "codex");
  const descriptorPath = join(appHome, "runtime", "launcher-browser.json");
  const helperScript = join(root, "helper.cjs");
  const runtimeKeyFile = join(appHome, "secrets", "runtime.key");
  const token = "launcher-uninstall-control-token-0123456789abcdef";
  const versions = join(appHome, "versions");
  mkdirSync(versions, { recursive: true });
  writeFileSync(join(versions, "fixture.verified.json"), "verified");
  writeFileSync(join(appHome, ".web2harness-owner.json"), '{"fixture-owner":true}');
  mkdirSync(join(appHome, "runtime"), { recursive: true });
  mkdirSync(join(appHome, "secrets"), { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(helperScript, "module.exports = {};\n");
  writeFileSync(runtimeKeyFile, "test-key\n");
  writeFileSync(descriptorPath, `${JSON.stringify({
    version: 3,
    kind: "web2harness-launcher",
    profile: "production",
    pid: process.pid,
    endpoint: "http://127.0.0.1:48111",
    control: { endpoint: "http://127.0.0.1:48112", token },
    helper: { executable: process.execPath, script: helperScript },
    partition: "persist:web2harness-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL,
    surfaceId: "a".repeat(32),
    surfaceTargets: { ["a".repeat(32)]: "native-owned-target" },
    createdAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  writeFileSync(join(appHome, "config.json"), `${JSON.stringify({
    version: 3,
    releaseVersion: "0.2.0",
    mode: "mcp-bridge",
    host: "127.0.0.1",
    port: 17841,
    contextWindow: 256_000,
    appName: "Codex Native",
    browserHost: "launcher",
    browserHostDescriptorPath: descriptorPath,
    chromeExecutablePath: process.execPath,
    storageStatePath: join(appHome, "browser", "storage-state.json"),
    brokerSocketPath: defaultBrokerEndpoint(appHome),
    headed: true,
    extraHighAvailable: false, proAvailable: false,
    autoApproveToolCalls: false,
    controlToken: "runtime-control-token-0123456789abcdef0123456789",
    runtimeCommand: [process.execPath],
    tunnel: {
      binaryPath: join(root, "missing-tunnel-client"),
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      runtimeKeyFile,
      profileDir: join(appHome, "tunnel", "profiles"),
      profileName: "web2harness",
      alias: "web2harness",
    },
  })}\n`);
  try {
    const result = await runCli([
      "uninstall",
      "--yes",
      "--launcher-control",
      ...(keepRuntime ? ["--keep-runtime"] : []),
    ], {
      ...process.env,
      CODEX_HOME: codexHome,
      WEB2HARNESS_HOME: appHome,
      WEB2HARNESS_BROWSER_HOST_DESCRIPTOR: descriptorPath,
      WEB2HARNESS_LAUNCHER_CONTROL_TOKEN: token,
    });
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain(keepRuntime ? "installed runtime was preserved" : "removed private application data");
    expect(existsSync(appHome)).toBe(keepRuntime);
    expect(existsSync(join(appHome, "config.json"))).toBe(false);
    expect(existsSync(runtimeKeyFile)).toBe(false);
    expect(existsSync(versions)).toBe(keepRuntime);
    expect(existsSync(join(appHome, ".web2harness-owner.json"))).toBe(keepRuntime);
    if (keepRuntime) expect(readFileSync(join(versions, "fixture.verified.json"), "utf8")).toBe("verified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
