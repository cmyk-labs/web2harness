import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { defaultConfig } from "../../src/config";
import { responseRequest } from "../../src/server";
import { HttpBodyBudget } from "../../src/http-body-budget";
import type { CodexParsedRequest } from "../../src/types";
import type { InputReferenceTransport } from "../../src/responses/input-references";

const model = "chatgpt-web/gpt-6-sol";
const config = { ...defaultConfig("native-tools"), extraHighAvailable: true };
const url = "https://assets.example.com/source.txt";
const input = [{ type: "message", role: "user", content: [
  { type: "input_text", text: "Read this task-provided file" },
  { type: "input_file", file_url: url, filename: "source.txt" },
] }];
const request = (extra: Record<string, unknown> = {}) => new Request("http://127.0.0.1/v1/responses", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer reference-fixture" },
  body: JSON.stringify({ model, reasoning: { effort: "xhigh" }, input, stream: false, ...extra }),
});
function fixture() {
  const parsed: CodexParsedRequest[] = [];
  let downloads = 0, cancelled = 0;
  const bytes = Buffer.from("AUTHORED-FILE-" + randomUUID());
  const transport: InputReferenceTransport = async (_url, signal) => {
    expect(signal.aborted).toBe(false); downloads++;
    return { status: 200, headers: new Headers({ "content-type": "text/plain", "content-length": String(bytes.length) }),
      body: (async function* () { yield bytes; })(), cancel() { cancelled++; } };
  };
  const adapter = () => ({ name: "reference-component-fixture", async runTurn(value: CodexParsedRequest, _incoming: unknown, emit: (event: any) => void) {
    parsed.push(value); emit({ type: "text_delta", text: "fixture", phase: "final_answer" }); emit({ type: "done", endTurn: true });
  } });
  return { parsed, bytes, transport, adapter, counts: () => ({ downloads, cancelled }) };
}

test("remote input resolves original bytes through shared validation and request budget", async () => {
  const f = fixture(), budget = new HttpBodyBudget();
  const response = await responseRequest(request(), config, f.adapter, { inputReferenceTransport: f.transport, bodyBudget: budget, rememberState: false });
  expect(response.status).toBe(200); await response.text();
  expect(f.counts()).toEqual({ downloads: 1, cancelled: 1 });
  expect(f.parsed).toHaveLength(1);
  const source = (f.parsed[0]!.context.source!.input as any[])[0].content[1];
  expect(source).toEqual({ type: "input_file", filename: "source.txt", file_data: "data:text/plain;base64," + f.bytes.toString("base64") });
  expect(input[0]!.content[1]).toHaveProperty("file_url", url);
  // The native TransformStream pipe settles after its consumer observes the final bytes.
  for (let i = 0; i < 20 && budget.snapshot().reservations; i++) await Bun.sleep(5);
  expect(budget.snapshot().reservedBytes).toBe(0);
});

test("preparation keeps references without network and later resolves the complete replay prefix", async () => {
  const f = fixture();
  const prepared = await responseRequest(request({ store: false }), config, f.adapter, { prepareOnly: true, inputReferenceTransport: f.transport });
  expect(prepared.status).toBe(200);
  const frames = (await prepared.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  const completed = frames.find(event => event.type === "response.completed");
  expect(completed.response.output).toEqual([]);
  expect(f.counts().downloads).toBe(0); expect(f.parsed).toHaveLength(0);
  const response = await responseRequest(request({ previous_response_id: completed.response.id, input: [{ type: "message", role: "user", content: "Now read it" }] }),
    config, f.adapter, { inputReferenceTransport: f.transport, rememberState: false });
  expect(response.status).toBe(200); await response.text();
  expect(f.counts().downloads).toBe(1);
  expect(f.parsed[0]!._replayPrefixLen).toBe(1);
  expect(f.parsed[0]!.context.source!.input).toHaveLength(2);
});

test("invalid context, controls, tool declarations and missing history never download references", async () => {
  const f = fixture();
  for (const override of [
    { previous_response_id: "resp_missing_" + randomUUID() }, { temperature: 0.5 },
    { tools: [{ type: "unimplemented_tool" }] }, { model: "chatgpt-web/not-real" },
    { input: [...input, { type: "reasoning", encrypted_content: "opaque-native-state" }] },
  ]) {
    const response = await responseRequest(request(override), config, f.adapter, { inputReferenceTransport: f.transport, rememberState: false });
    expect(response.status).toBe(400); await response.text();
  }
  expect(f.counts().downloads).toBe(0); expect(f.parsed).toHaveLength(0);
});

test("known unsupported provider files cannot receive a successful preparation ID", async () => {
  const f = fixture();
  const response = await responseRequest(request({ input: [{ role: "user", content: [{ type: "input_file", file_id: "file_native_unknown" }] }] }),
    config, f.adapter, { prepareOnly: true, inputReferenceTransport: f.transport });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "unsupported_provider_file_reference", retryable: false } });
  expect(f.counts().downloads).toBe(0); expect(f.parsed).toHaveLength(0);
});

test("text and reference preparation remain local when the Launcher descriptor is unavailable", async () => {
  const f = fixture();
  const unavailable = { ...config, browserHost: "launcher" as const,
    browserHostDescriptorPath: resolve(import.meta.dir, `missing-launcher-${randomUUID()}.json`) };
  for (const content of ["Prepare this text", input]) {
    const response = await responseRequest(request({ input: content }), unavailable, f.adapter,
      { prepareOnly: true, inputReferenceTransport: f.transport });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"response.completed"');
  }
  const invalid = await responseRequest(request({ input: "invalid", tools: [{ type: "unimplemented_tool" }] }),
    unavailable, f.adapter, { prepareOnly: true });
  expect(invalid.status).toBe(400); await invalid.text();
  let generationError: unknown;
  try { await responseRequest(request({ input: "Generate now" }), unavailable, f.adapter); }
  catch (error) { generationError = error; }
  expect(generationError).toBeInstanceOf(Error);
  expect(f.counts().downloads).toBe(0); expect(f.parsed).toHaveLength(0);
});

test("download allocations respect shared request budget and release it on failure", async () => {
  const f = fixture(), budget = new HttpBodyBudget(512 * 1024 + 9000);
  const response = await responseRequest(request(), config, f.adapter, { inputReferenceTransport: async () => ({
    status: 200, headers: new Headers({ "content-type": "text/plain" }),
    body: (async function* () { yield Buffer.alloc(2000, 65); })(), cancel() {},
  }), bodyBudget: budget, rememberState: false });
  expect(response.status).toBe(503); await response.text();
  expect(f.parsed).toHaveLength(0); expect(budget.snapshot().reservedBytes).toBe(0);
});

test("steering validation has no cache, download or model side effects and preserves model restrictions", async () => {
  const f = fixture();
  const response = await responseRequest(request(), config, f.adapter, { validateOnly: true, inputReferenceTransport: f.transport });
  expect(response.status).toBe(204);
  const unsupported = await responseRequest(request({ model: "chatgpt-web/gpt-5.6-sol" }), config, f.adapter, { validateOnly: true, inputReferenceTransport: f.transport });
  expect(unsupported.status).toBe(400);
  expect(await unsupported.json()).toMatchObject({ error: { code: "steering_not_supported" } });
  expect(f.counts().downloads).toBe(0); expect(f.parsed).toHaveLength(0);
});
