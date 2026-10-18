/**
 * Real installed Codex CLI + shared startServer + synthetic model decisions.
 * Direct-tool fixture, NOT browser/Code Mode or authenticated model acceptance.
 * Run: bun run scripts/smoke-codex-websocket.ts
 * Every run keeps its own output evidence. Never copies production authentication.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerWebSocket } from "bun";

type Json = Record<string, any>;
const outputParent = resolve("output");
mkdirSync(outputParent, { recursive: true });
const root = mkdtempSync(join(outputParent, "codex-websocket-"));
const initialEnvironment = { ...process.env };
const productionPaths = [...new Set([
  join(homedir(), ".codex", "config.toml"), join(homedir(), ".codex", "auth.json"),
  ...(initialEnvironment.CODEX_HOME ? [join(initialEnvironment.CODEX_HOME, "config.toml"), join(initialEnvironment.CODEX_HOME, "auth.json")] : []),
  join(initialEnvironment.WEB2HARNESS_HOME || join(homedir(), ".web2harness"), "config.json"),
])];
function baseline() {
  return productionPaths.map(path => ({ path, sha256: existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null }));
}
const before = baseline();
// This dedicated process owns its own bridge/cache/license and Codex homes, before imports.
for (const key of Object.keys(process.env)) {
  if (/^(CODEX_|OPENAI_|CHATGPT_|WEB2HARNESS_)/i.test(key)) delete process.env[key];
}
process.env.WEB2HARNESS_HOME = join(root, "bridge");
process.env.CODEX_HOME = join(root, "bootstrap-codex");
mkdirSync(process.env.CODEX_HOME, { recursive: true });
const { devCodexCommand } = await import("../src/dev/codex");
const command = devCodexCommand(initialEnvironment);
const { createLicenseFixture } = await import("../tests/fixtures/license-fixture");
const license = await createLicenseFixture(join(root, "license"));
process.env.WEB2HARNESS_LICENSE_KEYS_FILE = license.keyFile;
process.env.WEB2HARNESS_LICENSE_FILE = license.licenseFile;
const { defaultConfig } = await import("../src/config");
const { augmentNativeModelCatalog } = await import("../src/models/model-catalog");
const { startServer } = await import("../src/server");
const { rememberResponseState, expandPreviousResponseInput, flushResponseState, responseStateScope } = await import("../src/responses/state");
const { toolIdentityKey } = await import("../src/types");
const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const model = "chatgpt-web/gpt-6-sol";
const fixtureKey = "local-websocket-fixture-only";

async function cli(args: string[], cwd: string, environment: NodeJS.ProcessEnv, timeoutMs = 60_000) {
  const child = Bun.spawn([...command, ...args], { cwd, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { pid: child.pid, exit, timedOut, stdout, stderr };
  } finally { clearTimeout(timer); }
}

const environment: NodeJS.ProcessEnv = { ...process.env, OPENAI_API_KEY: fixtureKey };
delete environment.ELECTRON_RUN_AS_NODE;
const version = await cli(["--version"], root, environment, 15_000);
const bundled = await cli(["debug", "models", "--bundled"], root, environment, 15_000);
if (version.exit !== 0 || bundled.exit !== 0) {
  writeFileSync(join(root, "bootstrap.private.json"), JSON.stringify({ version, bundled }, null, 2));
  throw new Error(`Installed Codex bootstrap failed; evidence: ${root}`);
}
const config = { ...defaultConfig("native-tools"), host: "127.0.0.1" as const, port: 0, solAvailable: true, extraHighAvailable: true, proAvailable: true };
const catalog = augmentNativeModelCatalog(JSON.parse(bundled.stdout), config);
// Deliberate direct-tool fixture: preserve the model, but expose the native executor directly.
for (const row of catalog.models as Json[]) if (row.slug === model) row.tool_mode = "direct";
if (!(catalog.models as Json[]).some(row => row.slug === model)) throw new Error(`Fixture model missing: ${model}`);
const catalogPath = join(root, "models.json");
writeFileSync(catalogPath, JSON.stringify(catalog));
writeFileSync(join(root, "ownership.json"), JSON.stringify({ kind: "real-cli-direct-tool-synthetic-adapter", pid: process.pid, command, version: version.stdout.trim(), root }, null, 2));

interface Preparation {
  connection: number;
  input: unknown;
  startAdapterCreations: number;
  startModelTurns: number;
  createdId?: string;
  responseId?: string;
  completed: boolean;
  emptyOutput: boolean;
  adapterCreations?: number;
  modelTurns?: number;
  errors: string[];
  unexpectedEvents: string[];
  continuation?: { connection: number; expectedInput: unknown[] };
  restoredInputExact?: boolean;
}
interface Scenario {
  name: string;
  directory: string;
  workspace: string;
  nonce: string;
  rounds: Json[];
  transport: Json[];
  evict: boolean;
  evicted?: string;
  recoveryError: boolean;
  recoveryFullHistory: boolean;
  toolFailures: string[];
  adapterCreations: number;
  preparations: Preparation[];
}
let current: Scenario;
function record(event: Json, scenario = current) {
  const entry = { time: new Date().toISOString(), ...event };
  scenario.transport.push(entry);
  appendFileSync(join(scenario.directory, "transport.jsonl"), `${JSON.stringify(entry)}\n`);
}
function sourceOutputs(input: unknown): Json[] {
  return Array.isArray(input) ? input.filter(item => item && typeof item === "object" && /^(function_call_output|custom_tool_call_output)$/.test(item.type)) : [];
}
function commandFor(stage: number): string {
  const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
  const auditPath = join(current.workspace, "executed.txt");
  const inputPath = join(current.workspace, "fixture-input.txt");
  if (process.platform === "win32") {
    return `[System.IO.File]::AppendAllText(${quote(auditPath)}, ${quote(`round-${stage}\n`)}); Write-Output ${quote(`WS_TOOL_${stage}:`)}; Get-Content -LiteralPath ${quote(inputPath)}`;
  }
  return `printf '%s\\n' ${quote(`round-${stage}`)} >> ${quote(auditPath)}; printf '%s\\n' ${quote(`WS_TOOL_${stage}:`)}; cat ${quote(inputPath)}`;
}
const shared = startServer(config, {
  fetchUpstream: async () => { throw new Error("Fixture refuses native upstream network requests"); },
  adapterFactory: () => {
    current.adapterCreations++;
    return {
      name: "websocket-synthetic-decisions",
      async runTurn(parsed, _incoming, emit) {
        const input = parsed.context.source?.input;
        const prepared = current.preparations.find(item => item.continuation && item.restoredInputExact === undefined);
        if (prepared?.continuation) {
          prepared.restoredInputExact = JSON.stringify(input) === JSON.stringify(prepared.continuation.expectedInput);
          record({ direction: "fixture", action: "prepared-input-restored", responseId: prepared.responseId,
            exact: prepared.restoredInputExact, inputItems: Array.isArray(input) ? input.length : null });
        }
        const outputs = sourceOutputs(input);
        const first = outputs.find(item => item.call_id === `ws_call_1_${current.nonce}`);
        const second = outputs.find(item => item.call_id === `ws_call_2_${current.nonce}`);
        const stage = second ? 3 : first ? 2 : 1;
        const round = { stage, inputItems: Array.isArray(input) ? input.length : null, toolOutputs: outputs.map(item => ({ call_id: item.call_id, output: item.output })) };
        current.rounds.push(round);
        appendFileSync(join(current.directory, "rounds.private.jsonl"), JSON.stringify(round) + "\n");
        if (stage > 1 && (!JSON.stringify(first).includes(current.nonce) || !JSON.stringify(first).includes("WS_TOOL_1:"))) {
          current.toolFailures.push(String(first?.output ?? "First native command result missing"));
          emit({ type: "text_delta", text: "WEBSOCKET_TOOL_FIXTURE_BLOCKED: first native command failed; see tool evidence." });
          emit({ type: "done", stopReason: "stop", endTurn: true });
          return;
        }
        if (stage === 3) {
          if (!JSON.stringify(second).includes(current.nonce) || !JSON.stringify(second).includes("WS_TOOL_2:")) {
            current.toolFailures.push(String(second?.output ?? "Second native command result missing"));
            emit({ type: "text_delta", text: "WEBSOCKET_TOOL_FIXTURE_BLOCKED: second native command failed; see tool evidence." });
            emit({ type: "done", stopReason: "stop", endTurn: true });
            return;
          }
          emit({ type: "text_delta", text: `WEBSOCKET_TOOL_ROUNDTRIP_OK_${current.nonce}` });
          emit({ type: "done", stopReason: "stop", endTurn: true });
          return;
        }
        const tool = parsed.context.tools?.find(tool => tool.name === "exec_command")
          ?? parsed.context.tools?.find(tool => tool.name === "shell_command");
        if (!tool) {
          writeFileSync(join(current.directory, "tools.private.json"), JSON.stringify(parsed.context.tools, null, 2));
          throw new Error("Installed CLI did not expose exec_command or shell_command in the direct-tool fixture");
        }
        const args = tool.name === "exec_command"
          ? { cmd: commandFor(stage), workdir: current.workspace, login: false, yield_time_ms: 10_000, max_output_tokens: 2_000, sandbox_permissions: "use_default" }
          : { command: commandFor(stage), workdir: current.workspace, timeout_ms: 10_000, sandbox_permissions: "use_default" };
        emit({ type: "tool_call_start", id: `ws_call_${stage}_${current.nonce}`, name: toolIdentityKey(tool.namespace, tool.name) });
        emit({ type: "tool_call_delta", arguments: JSON.stringify(args) });
        emit({ type: "tool_call_end" });
        emit({ type: "done", stopReason: "tool_use", endTurn: false });
      },
    };
  },
});

// Evidence-only loopback relay. It forwards exact text frames; all execution is in startServer.
// A fallback HTTP POST is recorded and refused, so it can never make this WS fixture pass.
type RelayData = { id: number; upstream: WebSocket; headers: Headers; ready: boolean; pending: string[]; scenario: Scenario; preparation?: Preparation };
const relays = new Set<ServerWebSocket<RelayData>>();
let connectionId = 0;
const observer = Bun.serve<RelayData>({
  hostname: "127.0.0.1", port: 0,
  fetch: (request, server) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/v1/responses" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (request.headers.get("authorization") !== `Bearer ${fixtureKey}`) return new Response("Fixture auth mismatch", { status: 401 });
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) if (name.startsWith("sec-websocket-") || ["connection", "upgrade", "host"].includes(name)) headers.delete(name);
      const upstream = new BunWebSocket(`ws://127.0.0.1:${shared.port}/v1/responses`, { headers: Object.fromEntries(headers) });
      const data: RelayData = { id: ++connectionId, upstream, headers, ready: false, pending: [], scenario: current };
      if (server.upgrade(request, { data })) return;
      upstream.close(); return new Response("Fixture upgrade failed", { status: 400 });
    }
    record({ direction: "http", method: request.method, path, fallback: request.method === "POST" && path === "/v1/responses" });
    if (request.method === "GET" && path === "/v1/models") return Response.json(catalog);
    return Response.json({ error: { type: "invalid_request_error", code: "fixture_requires_websocket", message: "This fixture requires actual WebSocket generation; HTTP fallback cannot pass." } }, { status: 400 });
  },
  websocket: {
    maxPayloadLength: 64 * 1024 * 1024, backpressureLimit: 64 * 1024 * 1024, closeOnBackpressureLimit: true,
    open(ws) {
      relays.add(ws);
      const current = ws.data.scenario;
      const upstream = ws.data.upstream;
      record({ direction: "upgrade", connection: ws.data.id }, current);
      const sendUpstream = () => {
        ws.data.ready = true;
        for (const text of ws.data.pending.splice(0)) upstream.send(text);
      };
      upstream.onopen = sendUpstream;
      if (upstream.readyState === WebSocket.OPEN) sendUpstream();
      upstream.onmessage = event => {
        const text = String(event.data), value = JSON.parse(text) as Json;
        record({ direction: "server", connection: ws.data.id, type: value.type, status: value.status, code: value.error?.code ?? value.response?.error?.code, responseId: value.response?.id, outputTypes: value.response?.output?.map((item: Json) => item.type) }, current);
        appendFileSync(join(current.directory, "frames.private.jsonl"), JSON.stringify({ direction: "server", frame: value }) + "\n");
        const preparation = ws.data.preparation;
        if (preparation) {
          if (value.type === "response.created") preparation.createdId = value.response?.id;
          else if (value.type === "response.completed") {
            preparation.responseId = value.response?.id;
            preparation.completed = value.response?.status === "completed";
            preparation.emptyOutput = Array.isArray(value.response?.output) && value.response.output.length === 0;
          } else if (value.type === "error" || value.type === "response.failed" || value.type === "response.incomplete") {
            preparation.errors.push(value.error?.code ?? value.response?.error?.code ?? value.type);
          } else if (value.type !== "response.in_progress") preparation.unexpectedEvents.push(value.type);
          if (["response.completed", "response.failed", "response.incomplete", "error"].includes(value.type)) {
            preparation.adapterCreations = current.adapterCreations - preparation.startAdapterCreations;
            preparation.modelTurns = current.rounds.length - preparation.startModelTurns;
            ws.data.preparation = undefined;
            record({ direction: "fixture", action: "preparation-finished", responseId: preparation.responseId,
              completed: preparation.completed, emptyOutput: preparation.emptyOutput,
              adapterCreations: preparation.adapterCreations, modelTurns: preparation.modelTurns,
              errors: preparation.errors, unexpectedEvents: preparation.unexpectedEvents }, current);
          }
        }
        if (value.type === "error" && value.error?.code === "previous_response_not_found") current.recoveryError = true;
        if (current.evict && !current.evicted && value.type === "response.completed"
          && value.response?.output?.some((item: Json) => item.call_id === `ws_call_1_${current.nonce}`)) {
          const id = String(value.response.id);
          const scope = responseStateScope(ws.data.headers);
          const probe = { previous_response_id: id, input: [] };
          if (expandPreviousResponseInput(probe, scope) === probe) throw new Error("Fixture response was not cached under its caller scope before eviction");
          // Real shared cache count eviction, confined to this script process/home. No frame rewrite.
          for (let index = 0; index < 1_001; index++) {
            rememberResponseState({ input: [] }, { id: `fixture_evict_${current.nonce}_${index}`, output: [], status: "completed" }, { force: true, memoryOnly: true, scope });
          }
          if (expandPreviousResponseInput(probe, scope) !== probe) throw new Error("Fixture could not evict its response cache entry");
          current.evicted = id;
          record({ direction: "fixture", action: "shared-cache-count-eviction", responseId: id }, current);
        }
        if (ws.send(text) === 0) upstream.close();
      };
      upstream.onclose = event => { record({ direction: "upstream-close", connection: ws.data.id, code: event.code }, current); ws.close(event.code === 1006 ? 1011 : event.code, "Shared fixture connection closed"); };
      upstream.onerror = () => { record({ direction: "upstream-error", connection: ws.data.id }, current); ws.close(1011, "Shared fixture connection error"); };
    },
    message(ws, message) {
      if (typeof message !== "string") { ws.close(1003, "Fixture expects text"); return; }
      const current = ws.data.scenario;
      const value = JSON.parse(message) as Json;
      const outputs = sourceOutputs(value.input);
      record({ direction: "client", connection: ws.data.id, type: value.type, generate: value.generate, model: value.model,
        previousResponseId: value.previous_response_id ?? null, inputItems: Array.isArray(value.input) ? value.input.length : null,
        toolOutputIds: outputs.map(item => item.call_id), toolCallIds: Array.isArray(value.input) ? value.input.filter((item: Json) => item.type === "function_call").map((item: Json) => item.call_id) : [] }, current);
      appendFileSync(join(current.directory, "frames.private.jsonl"), JSON.stringify({ direction: "client", frame: value }) + "\n");
      if (value.model !== model) { ws.close(1008, "Fixture model changed"); return; }
      if (value.type === "response.create" && value.generate === false) {
        const preparation: Preparation = { connection: ws.data.id, input: value.input,
          startAdapterCreations: current.adapterCreations, startModelTurns: current.rounds.length,
          completed: false, emptyOutput: false, errors: [], unexpectedEvents: [] };
        current.preparations.push(preparation);
        ws.data.preparation = preparation;
      } else if (value.type === "response.create" && value.previous_response_id) {
        const preparation = current.preparations.find(item => item.completed && item.responseId === value.previous_response_id);
        if (preparation && Array.isArray(preparation.input) && Array.isArray(value.input)) {
          preparation.continuation = { connection: ws.data.id, expectedInput: [...preparation.input, ...value.input] };
        }
      }
      if (current.recoveryError && !value.previous_response_id && outputs.some(item => item.call_id === `ws_call_1_${current.nonce}`)
        && value.input.some((item: Json) => item.type === "function_call" && item.call_id === `ws_call_1_${current.nonce}`)) current.recoveryFullHistory = true;
      if (ws.data.ready) ws.data.upstream.send(message);
      else if (ws.data.pending.length < 2) ws.data.pending.push(message);
      else ws.close(1013, "Fixture pending frame limit");
    },
    close(ws) { relays.delete(ws); ws.data.upstream.close(); },
  },
});

const proofs: Json[] = [];
let exitCode = 1;
try {
  for (const name of ["roundtrip", "cache-recovery"]) {
    const directory = join(root, name), taskHome = join(directory, "codex"), workspace = join(directory, "workspace");
    mkdirSync(taskHome, { recursive: true }); mkdirSync(workspace, { recursive: true });
    current = { name, directory, workspace, nonce: randomUUID().replaceAll("-", ""), rounds: [], transport: [], evict: name === "cache-recovery", recoveryError: false, recoveryFullHistory: false, toolFailures: [], adapterCreations: 0, preparations: [] };
    writeFileSync(join(workspace, "fixture-input.txt"), current.nonce + "\n");
    writeFileSync(join(taskHome, "config.toml"), [
      `model = ${JSON.stringify(model)}`, 'model_provider = "fixture"', `model_catalog_json = ${JSON.stringify(catalogPath)}`,
      'approval_policy = "never"', 'sandbox_mode = "workspace-write"', 'cli_auth_credentials_store = "file"',
      '[model_providers.fixture]', 'name = "Isolated WebSocket transport fixture"',
      `base_url = "http://127.0.0.1:${observer.port}/v1"`, 'env_key = "OPENAI_API_KEY"',
      'wire_api = "responses"', 'supports_websockets = true',
      ...(process.platform === "win32" ? ['[windows]', 'sandbox = "unelevated"'] : []),
    ].join("\n"));
    console.log(JSON.stringify({ event: "scenario-start", name, evidence: directory }));
    const result = await cli(["exec", "--skip-git-repo-check", "--json", "Execute the two local fixture command-tool calls exactly once and return their file contents. Keep the normal sandbox enabled."], workspace, { ...environment, CODEX_HOME: taskHome });
    writeFileSync(join(directory, "cli.private.jsonl"), result.stdout);
    writeFileSync(join(directory, "cli.private.stderr.log"), result.stderr);
    const auditPath = join(workspace, "executed.txt"), audit = existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "";
    const frames = current.transport.filter(event => event.direction === "client");
    const errors = current.transport.filter(event => event.direction === "server" && ["error", "response.failed", "response.incomplete"].includes(event.type));
    const fallback = current.transport.filter(event => event.fallback);
    const toolRoundtripPassed = result.exit === 0 && !result.timedOut && result.stdout.includes(`WEBSOCKET_TOOL_ROUNDTRIP_OK_${current.nonce}`)
      && audit === "round-1\nround-2\n" && JSON.stringify(current.rounds.map(round => round.stage)) === "[1,2,3]"
      && frames.some(event => event.previousResponseId) && fallback.length === 0;
    const recoveryPassed = !current.evict || Boolean(current.evicted && current.recoveryError && current.recoveryFullHistory && toolRoundtripPassed);
    const prewarmRejected = current.preparations.some(item => item.errors.length > 0);
    const prewarmPassed = current.preparations.length > 0 && current.preparations.every(item =>
      item.completed && item.emptyOutput && Boolean(item.responseId) && item.createdId === item.responseId
      && item.adapterCreations === 0 && item.modelTurns === 0 && item.errors.length === 0 && item.unexpectedEvents.length === 0
      && item.continuation?.connection === item.connection && item.restoredInputExact === true);
    const unexpectedErrors = errors.filter(event => !(current.evict && current.evicted && event.code === "previous_response_not_found"));
    const preparations = current.preparations.map(({ input, continuation, ...item }) => ({ ...item,
      inputItems: Array.isArray(input) ? input.length : null, continuedOnConnection: continuation?.connection,
      restoredInputItems: continuation?.expectedInput.length }));
    const proof = { name, kind: "real-cli-direct-tool-synthetic-adapter", version: version.stdout.trim(), pid: result.pid,
      exit: result.exit, timedOut: result.timedOut, sandbox: "workspace-write", windowsSandbox: process.platform === "win32" ? "unelevated" : null,
      supportsWebsockets: true, upgrades: current.transport.filter(event => event.direction === "upgrade").length,
      frames, errors, httpFallbacks: fallback.length, prewarmSent: frames.some(event => event.generate === false), prewarmRejected,
      prewarmPassed, preparations, unexpectedErrors, adapterCreations: current.adapterCreations,
      stages: current.rounds.map(round => round.stage), actualToolExecutions: audit.trim().split(/\r?\n/).filter(Boolean),
      toolFailures: current.toolFailures,
      evictedResponse: current.evicted, recoveryError: current.recoveryError, recoveryFullHistory: current.recoveryFullHistory,
      toolRoundtripPassed, recoveryPassed, passed: toolRoundtripPassed && recoveryPassed && prewarmPassed && unexpectedErrors.length === 0 };
    proofs.push(proof); writeFileSync(join(directory, "proof.json"), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify({ event: "scenario-result", ...proof }));
    for (const relay of [...relays]) { relay.data.upstream.close(); relay.close(1001, "Fixture case finished"); }
    // Settle owned connections before assigning the next evidence context.
    await Bun.sleep(50);
  }
  const unchanged = JSON.stringify(before) === JSON.stringify(baseline());
  const proof = { kind: "real-cli-direct-tool-synthetic-adapter", evidence: root, productionHashesUnchanged: unchanged, productionBaselines: before, cases: proofs, passed: unchanged && proofs.every(proof => proof.passed) };
  writeFileSync(join(root, "proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ passed: proof.passed, productionHashesUnchanged: unchanged, evidence: root }));
  exitCode = proof.passed ? 0 : 1;
} catch (error) {
  writeFileSync(join(root, "failure.txt"), String(error));
  console.error(`WebSocket CLI fixture failed: ${String(error)}; evidence: ${root}`);
} finally {
  for (const relay of [...relays]) { relay.data.upstream.close(); relay.close(1001, "Fixture shutdown"); }
  await observer.stop(true);
  flushResponseState();
  await shared.stop(true);
}
process.exit(exitCode);
