// Offline integration: real Codex + production DEV server/adapter; fixture browser and auth.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultConfig, saveConfig } from "../src/config";
import { installCodexIntegration } from "../src/codex/integration";
import { augmentNativeModelCatalog } from "../src/models/model-catalog";
import { startServer } from "../src/server";
import { namespacedToolName } from "../src/types";
import { createChatGptWebAdapter } from "../src/adapters/chatgpt-web/adapter";
import { ChatGptBrowserWorker, closeChatGptBrowserWorkers } from "../src/adapters/chatgpt-web/browser/browser-worker";
import { activateDevProfileEnvironment, resolveDevProfilePaths } from "../src/dev/profile";
import { devCodexCommand, devCodexEnvironment } from "../src/dev/codex";
import { LAUNCHER_BROWSER_IDLE_URL } from "../src/browser/launcher-client";

const expectReadOnly = process.argv.includes("--expect-read-only");
const codeMode = process.argv.includes("--code-mode");
const codeModeWait = process.argv.includes("--code-mode-wait");
if (codeModeWait && !codeMode) throw new Error("--code-mode-wait requires --code-mode");
const windowsSandbox = process.argv.find(arg => arg.startsWith("--windows-sandbox="))?.split("=")[1];
if (windowsSandbox && windowsSandbox !== "unelevated" && windowsSandbox !== "elevated") {
  throw new Error("--windows-sandbox must be elevated or unelevated");
}
const root = mkdtempSync(join(tmpdir(), "cgw-dev-native-smoke-"));
const paths = resolveDevProfilePaths({ environment: { WEB2HARNESS_DEV_HOME: join(root, "dev") } });
const sourceCli = resolve(import.meta.dir, "../src/cli.ts");
const originalEnvironment = { ...process.env };
activateDevProfileEnvironment(paths);
for (const directory of [paths.codexHome, join(paths.home, "runtime"), join(paths.home, "workspace")]) mkdirSync(directory, { recursive: true });
const executable = devCodexCommand(originalEnvironment);
const bundled = spawnSync(executable[0]!, [...executable.slice(1), "debug", "models", "--bundled"], {
  env: devCodexEnvironment(paths), encoding: "utf8", timeout: 15_000, windowsHide: true,
});
if (bundled.status !== 0) throw new Error("Cannot read Codex's bundled model catalog: " + bundled.stderr);
const config = { ...defaultConfig("native-tools"), purpose: "dev-harness" as const,
  browserHost: "launcher" as const, browserHostDescriptorPath: paths.descriptorPath,
  runtimeCommand: [process.execPath, sourceCli], port: 0 };
const helper = join(root, "unused-browser-helper.cjs");
writeFileSync(helper, "// Browser execution is replaced only in this offline smoke.\n");
writeFileSync(paths.descriptorPath, JSON.stringify({
  version: 3, kind: "web2harness-launcher", profile: "development", pid: process.pid,
  endpoint: "http://127.0.0.1:1", control: { endpoint: "http://127.0.0.1:1", token: "x".repeat(48) },
  helper: { executable: process.execPath, script: helper },
  partition: "persist:web2harness-dev-chatgpt", idleUrl: LAUNCHER_BROWSER_IDLE_URL,
  surfaceId: "d".repeat(32), surfaceTargets: { ["d".repeat(32)]: "offline-fixture" },
  createdAt: new Date().toISOString(),
}));
let rounds = 0;
let sawToolResult = false;
let toolResults = "";
let sawWait = false;
const server = startServer(config, {
  fetchUpstream: async () => { throw new Error("Offline DEV smoke forbids upstream requests"); },
  adapterFactory: provider => {
    const worker = ChatGptBrowserWorker.forProvider(provider);
    const adapter = createChatGptWebAdapter(provider);
    return {
      name: adapter.name,
      async runTurn(parsed, incoming, emit) {
        worker.run = async turn => {
          await turn.prepare();
          rounds += 1;
          if (rounds > 5) throw new Error("DEV smoke exceeded its round budget");
          sawToolResult ||= parsed.context.messages.some(message => message.role === "toolResult");
          toolResults = JSON.stringify(parsed.context.messages.filter(message => message.role === "toolResult"));
          const patch = parsed.context.tools?.find(tool => tool.name === (codeMode ? "exec" : "apply_patch"));
          if (!patch) throw new Error(`Real Codex did not declare ${codeMode ? "exec" : "apply_patch"}`);
          const patchInput = "*** Begin Patch\n*** Add File: dev-native-proof.txt\n+DEV_NATIVE_LOOP_OK\n*** End Patch";
          const lastResult = parsed.context.messages.filter(message => message.role === "toolResult").at(-1)?.content;
          const runningCell = typeof lastResult === "string" ? /Script running with cell ID ([^\s]+)/.exec(lastResult)?.[1] : undefined;
          const wait = parsed.context.tools?.find(tool => tool.name === "wait");
          if (runningCell && !wait) throw new Error("Real Codex did not declare wait for a yielded exec cell");
          sawWait ||= Boolean(runningCell);
          const fence = String.fromCharCode(96).repeat(3);
          const call = runningCell && wait
            ? { name: namespacedToolName(wait.namespace, wait.name), arguments: { cell_id: runningCell, yield_time_ms: 10000 } }
            : { name: namespacedToolName(patch.namespace, patch.name), arguments: { input: codeMode
              ? `${codeModeWait ? '// @exec: {"yield_time_ms": 1}\nawait new Promise(resolve => setTimeout(resolve, 350));\n' : ""}text(await tools.apply_patch(${JSON.stringify(patchInput)}));` : patchInput } };
          const answer = sawToolResult && !runningCell ? "DEV_NATIVE_LOOP_OK" : [
            fence + "codex_tool_calls",
            JSON.stringify({ calls: [call] }),
            fence,
          ].join("\n");
          turn.onTextDelta(answer);
          return answer;
        };
        await adapter.runTurn(parsed, incoming, emit);
      },
    };
  },
});
config.port = server.port!;
saveConfig(config);
installCodexIntegration(config);
const modelPath = join(paths.codexHome, "offline-models.json");
const catalog = augmentNativeModelCatalog(JSON.parse(bundled.stdout), config);
for (const model of catalog.models as Array<Record<string, unknown>>) {
  if (String(model.slug).startsWith("chatgpt-web/")) model.tool_mode = codeMode ? "code_mode_only" : null;
}
writeFileSync(modelPath, JSON.stringify(catalog));
const codexConfigPath = join(paths.codexHome, "config.toml");
writeFileSync(codexConfigPath, 'model_catalog_json = ' + JSON.stringify(modelPath) + "\n" + readFileSync(codexConfigPath, "utf8"));
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
writeFileSync(join(paths.codexHome, "auth.json"), JSON.stringify({
  auth_mode: "chatgpt", OPENAI_API_KEY: null,
  tokens: { id_token: b64({ alg: "none", typ: "JWT" }) + "." + b64({
    email: "offline-dev@example.invalid",
    "https://api.openai.com/auth": { chatgpt_plan_type: "plus", chatgpt_user_id: "local-fixture", chatgpt_account_id: "00000000-0000-4000-8000-000000000001" },
  }) + ".c2ln", access_token: "offline-fixture-not-a-credential", refresh_token: "offline-no-refresh",
    account_id: "00000000-0000-4000-8000-000000000001" },
  last_refresh: new Date().toISOString(),
}));
const child = Bun.spawn([process.execPath, sourceCli, "dev", "codex", "--",
  "-a", "never", ...(windowsSandbox ? ["-c", 'windows.sandbox="' + windowsSandbox + '"'] : []), "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "analytics.enabled=false", "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--json",
  "--model", "chatgpt-web/gpt-5.6-sol", "Create dev-native-proof.txt using apply_patch, then report the tool result."], {
  env: { ...originalEnvironment, WEB2HARNESS_DEV_HOME: paths.home,
    CODEX_HOME: join(root, "production-codex"), WEB2HARNESS_HOME: join(root, "production"),
    HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9", NO_PROXY: "localhost,127.0.0.1" },
  stdin: "ignore", stdout: "pipe", stderr: "pipe",
});
const timeout = setTimeout(() => child.kill(), 60_000);
try {
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const proof = join(paths.home, "workspace", "dev-native-proof.txt");
  const proofMatches = expectReadOnly
    ? !existsSync(proof) && toolResults.includes("writing is blocked by read-only sandbox")
    : existsSync(proof) && readFileSync(proof, "utf8").trim() === "DEV_NATIVE_LOOP_OK";
  if (exitCode !== 0 || (codeModeWait ? !sawWait || rounds < 3 : rounds !== 2) || !sawToolResult || !proofMatches) {
    throw new Error("DEV native loop failed: exit=" + exitCode + " rounds=" + rounds + "\n" + stdout.slice(-3000) + "\n" + stderr.slice(-2000) + "\nTool results: " + toolResults);
  }
  process.stdout.write(expectReadOnly
    ? "DEV_NATIVE_CODEX_SANDBOX_DENIAL_ROUNDTRIP_OK (write acceptance remains unverified)\n"
    : `DEV_NATIVE_CODEX_${codeModeWait ? "CODE_MODE_WAIT" : codeMode ? "CODE_MODE" : "PATCH"}_LOOP_OK (real Codex, fixture browser, isolated home)\n`);
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null) { child.kill(); await child.exited; }
  await server.stop(true);
  await closeChatGptBrowserWorkers();
  rmSync(root, { recursive: true, force: true });
}
