import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint, defaultConfig } from "../../src/config";
import { responseRequest, compactRequest, startServer } from "../../src/server";
import { TurnBroker } from "../../src/adapters/chatgpt-web/tools/turn-broker";
import { createLicenseFixture } from "../fixtures/license-fixture";
import { licenseStatus } from "../../src/licensing/service";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "w2h-license-admission-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("missing license blocks Responses, compaction and automatic/manual MCP registration before work", async () => {
  const saved = process.env.WEB2HARNESS_LICENSE_FILE;
  process.env.WEB2HARNESS_LICENSE_FILE = join(root, "missing.w2h");
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  const config = defaultConfig("browser-only");
  let created = false;
  const factory = () => { created = true; throw new Error("must not create a browser adapter"); };
  const req = () => new Request("http://localhost/v1/responses", { method: "POST", body: JSON.stringify({ model: "chatgpt-web/medium", input: "hi" }) });
  try {
    const response = await responseRequest(req(), config, factory);
    expect(response.status).toBe(403);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("license_missing");
    const compact = await compactRequest(req(), config, factory);
    expect(compact.status).toBe(403);
    const environment = { cwd: root, roots: [root], writableRoots: [root], sandboxPolicy: { type: "workspaceWrite" as const, writableRoots: [root], networkAccess: false }, tools: [] };
    await assert.rejects(broker.register(environment, 60_000, "fixture", true), /license: missing/);
    await assert.rejects(broker.registerSafe(environment, "a".repeat(32), 60_000, "fixture", true), /license: missing/);
    expect(created).toBe(false);
    const server = startServer({ ...config, port: 0 });
    try { expect((await fetch(`http://127.0.0.1:${server.port}/healthz`)).status).toBe(200); }
    finally { await server.stop(true); }
  } finally {
    await broker.close();
    if (saved === undefined) delete process.env.WEB2HARNESS_LICENSE_FILE; else process.env.WEB2HARNESS_LICENSE_FILE = saved;
  }
});

test("source CLI imports through stdin without exposing the code in status output", async () => {
  const fixture = await createLicenseFixture(join(root, "cli"));
  const importedFile = join(root, "cli", "customer.w2h");
  const env = { ...process.env, WEB2HARNESS_LICENSE_KEYS_FILE: fixture.keyFile, WEB2HARNESS_LICENSE_FILE: importedFile };
  const child = Bun.spawn([process.execPath, "run", "src/cli.ts", "license", "import", "--stdin"], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(fixture.code); child.stdin.end();
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(JSON.parse(output).state).toBe("active");
  expect(output).not.toContain(fixture.code);
  writeFileSync(importedFile, "tampered");
  expect((await licenseStatus({ file: importedFile, keys: fixture.keys, device: async () => fixture.deviceCode })).state).toBe("invalid");
});
