/** Real Codex executor + shared bridge, synthetic model/search upstreams. No account or Web login. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { devCodexCommand } from "../src/dev/codex";
import { defaultConfig, type AppConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/models/model-catalog";
import { startServer } from "../src/server";
import { toolIdentityKey } from "../src/types";

const root = resolve("output", `native-search-cli-${Date.now()}`);
const taskHome = join(root, "codex");
mkdirSync(taskHome, { recursive: true });
process.env.WEB2HARNESS_HOME = join(root, "bridge");
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (/^CODEX_|^(OPENAI_API_KEY|OPENAI_BASE_URL|CHATGPT_BASE_URL|ELECTRON_RUN_AS_NODE)$/.test(key)) delete environment[key];
}
environment.CODEX_HOME = taskHome;
environment.OPENAI_API_KEY = "local-search-fixture";
const command = devCodexCommand();
const bundled = Bun.spawn([...command, "debug", "models", "--bundled"], { env: environment, cwd: root, stdout: "pipe", stderr: "pipe" });
const [catalogText, catalogError, catalogExit] = await Promise.all([
  new Response(bundled.stdout).text(), new Response(bundled.stderr).text(), bundled.exited,
]);
if (catalogExit !== 0) throw new Error(`Cannot read bundled catalog: ${catalogError}`);
const config: AppConfig = { ...defaultConfig("native-tools"), host: "127.0.0.1", port: 0, solAvailable: true, extraHighAvailable: true, proAvailable: true };
const catalog = augmentNativeModelCatalog(JSON.parse(catalogText), config);
// Direct tools make this protocol fixture independent of Code Mode host availability.
// The real browser/Code Mode route is covered separately in authenticated DEV acceptance.
for (const model of catalog.models as Array<Record<string, unknown>>) if (String(model.slug).startsWith("chatgpt-web/")) model.tool_mode = "direct";
writeFileSync(join(root, "models.json"), JSON.stringify(catalog));
let rounds = 0;
let searches = 0;
const marker = "NATIVE_SEARCH_FIXTURE_RESULT";
const server = startServer(config, {
  fetchUpstream: async request => {
    if (!request.url.includes("/alpha/search")) throw new Error("Unexpected native upstream route");
    const body = await request.json() as any;
    writeFileSync(join(root, "search-request.private.json"), JSON.stringify(body, null, 2));
    if (body.model !== "gpt-6-sol" || body.settings?.external_web_access !== false
      || body.commands?.search_query?.[0]?.q !== "fixture query"
      || body.settings?.filters?.allowed_domains?.[0] !== "example.com") {
      throw new Error("Native executor changed search model/settings/commands");
    }
    searches += 1;
    return Response.json({ output: `${marker} https://example.com/fixture`, results: [] });
  },
  adapterFactory: () => ({
    name: "synthetic-search-decision",
    async runTurn(parsed, _incoming, emit) {
      rounds += 1;
      if (rounds === 1) {
        const tool = parsed.context.tools?.find(tool => tool.namespace === "web" && tool.name === "run");
        if (!tool) throw new Error("Codex did not expose its native web.run executor");
        emit({ type: "tool_call_start", id: "search_fixture_call", name: toolIdentityKey("web", "run") });
        emit({ type: "tool_call_delta", arguments: JSON.stringify({ search_query: [{ q: "fixture query" }], response_length: "short" }) });
        emit({ type: "tool_call_end" });
        emit({ type: "done", stopReason: "tool_use", endTurn: false });
      } else {
        if (rounds !== 2 || searches !== 1 || !JSON.stringify(parsed.context.source?.input).includes(marker)) {
          throw new Error("Codex did not return the actual native search result exactly once");
        }
        emit({ type: "text_delta", text: "NATIVE_SEARCH_CLI_OK" });
        emit({ type: "done", stopReason: "stop", endTurn: true });
      }
    },
  }),
});
writeFileSync(join(taskHome, "config.toml"), [
  'model = "chatgpt-web/gpt-6-sol"', 'model_provider = "fixture"',
  `model_catalog_json = ${JSON.stringify(join(root, "models.json"))}`,
  'web_search = "cached"', 'approval_policy = "never"', 'sandbox_mode = "read-only"',
  'cli_auth_credentials_store = "file"',
  '[tools.web_search]', 'allowed_domains = ["example.com"]',
  '[model_providers.fixture]', 'name = "Isolated native search fixture"',
  `base_url = "http://127.0.0.1:${server.port}/v1"`,
  'env_key = "OPENAI_API_KEY"', 'wire_api = "responses"',
  'supports_websockets = false', 'supports_standalone_web_search = true',
  '[features]', 'standalone_web_search = true',
].join("\n"));
let exitCode = 0;
try {
  const child = Bun.spawn([...command, "exec", "--skip-git-repo-check", "--json", "Use native search for the fixture query."], {
    env: environment, cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  const timer = setTimeout(() => child.kill(), 60_000);
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  clearTimeout(timer);
  writeFileSync(join(root, "cli.private.jsonl"), stdout);
  writeFileSync(join(root, "cli.private.stderr.log"), stderr);
  const proof = { kind: "real-cli-synthetic-upstreams", exit, rounds, searches, final: stdout.includes("NATIVE_SEARCH_CLI_OK") };
  writeFileSync(join(root, "proof.json"), JSON.stringify(proof, null, 2));
  if (exit !== 0 || rounds !== 2 || searches !== 1 || !proof.final) throw new Error(`Native search fixture failed; inspect ${root}`);
  console.log(JSON.stringify({ ...proof, evidence: root }));
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally { await server.stop(true); }
process.exit(exitCode);
