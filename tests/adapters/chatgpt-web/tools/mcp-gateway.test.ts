import { expect, test } from "bun:test";
import type { ChatGptTurnEnvironment } from "../../../../src/adapters/chatgpt-web/prompt/environment";
import { handoffCalls } from "../../../../src/adapters/chatgpt-web/tools/handoff-gateway";
import { execCommandGatewayProgram, execGatewayProgram } from "../../../../src/adapters/chatgpt-web/tools/mcp-gateway";
import { ToolBatchHandoff } from "../../../../src/adapters/chatgpt-web/tools/tool-batch-handoff";

type Emission = { kind: string; args: unknown[] };
type FixtureTool = (input: unknown) => unknown;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
  new (...source: string[]) => (...args: unknown[]) => Promise<void>;

// Execute only the generated wrapper against in-memory tools and output collectors.
// No broker, shell, browser, or real Codex tool is involved.
async function runGateway(program: string, tools: Record<string, FixtureTool>): Promise<Emission[]> {
  const output: Emission[] = [];
  const channels = ["text", "image", "audio", "generatedImage"];
  const run = new AsyncFunction("ALL_TOOLS", "tools", ...channels, program);
  await run(Object.keys(tools).map(name => ({ name })), tools,
    ...channels.map(kind => (...args: unknown[]) => { output.push({ kind, args }); }));
  return output;
}

const nested = (arguments_: Record<string, unknown> = {}) =>
  execGatewayProgram("fixture_tool", false, { arguments: arguments_ }, []);

test.each([false, true])("empty content preserves structured results and isError=%s", async isError => {
  const metadata = { structuredContent: { answer: 42 }, isError, _meta: { trace: "fixture" }, status: "completed" };
  const result = { content: [], ...metadata };
  expect(await runGateway(nested(), { fixture_tool: () => result })).toEqual([
    { kind: "text", args: [metadata] },
  ]);
  expect(result).toEqual({ content: [], ...metadata });
});

test("mixed results retain error metadata, annotated text, resources, images and audio exactly once", async () => {
  const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png", _meta: { detail: "original" } };
  const audio = { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" };
  const resource = { type: "resource", resource: { uri: "fixture://report", text: "source" } };
  const annotations = { audience: ["assistant"], priority: 1 };
  const metadata = { isError: true, structuredContent: { code: "DENIED" }, _meta: { trace: "fixture" } };
  const result = { ...metadata, content: [
    { type: "text", text: "permission denied", annotations }, image, audio, resource,
  ] };
  const snapshot = structuredClone(result);
  expect(await runGateway(nested(), { fixture_tool: () => result })).toEqual([
    { kind: "text", args: [metadata] },
    { kind: "text", args: [{ annotations }] },
    { kind: "text", args: ["permission denied"] },
    { kind: "image", args: [image] },
    { kind: "audio", args: [audio] },
    { kind: "text", args: [resource] },
  ]);
  expect(result).toEqual(snapshot);
});

test("URL media keeps native output channels and sibling metadata without printing media data as text", async () => {
  const image = { image_url: "data:image/png;base64,aW1n", detail: "original", _meta: { origin: "viewer" } };
  const audio = { audio_url: "data:audio/wav;base64,YXVk", isError: false };
  const generated = { image_url: "data:image/png;base64,Z2Vu", output_hint: "fixture", _meta: { origin: "generator" } };
  const result = [image, audio, generated];
  expect(await runGateway(nested(), { fixture_tool: () => result })).toEqual([
    { kind: "text", args: [{ _meta: { origin: "viewer" } }] },
    { kind: "image", args: [image.image_url, "original"] },
    { kind: "text", args: [{ isError: false }] },
    { kind: "audio", args: [audio.audio_url] },
    { kind: "text", args: [{ _meta: { origin: "generator" } }] },
    { kind: "generatedImage", args: [generated] },
  ]);
});

test("ordinary text and object results keep their output without empty metadata fragments", async () => {
  const result = [{ content: [{ type: "text", text: "plain" }] }, { exit_code: 0, output: "done" }];
  expect(await runGateway(nested(), { fixture_tool: () => result })).toEqual([
    { kind: "text", args: ["plain"] }, { kind: "text", args: [{ exit_code: 0, output: "done" }] },
  ]);
});

test("structured arguments normalize nested object order while preserving values and array order", async () => {
  const first = { z: [{ b: 2, a: "line\r\n中文" }, null, false], a: { y: 1, x: 0 }, omitted: undefined };
  const second = { a: { x: 0, y: 1 }, z: [{ a: "line\r\n中文", b: 2 }, null, false] };
  const before = structuredClone(first);
  expect(nested(first)).toBe(nested(second));
  let received: unknown;
  await runGateway(nested(first), { fixture_tool: input => { received = input; return "ok"; } });
  expect(received).toEqual(second);
  expect(first).toEqual(before);
  expect(nested({ ...second, z: [...second.z].reverse() })).not.toBe(nested(second));
});

test("nested handoff retries with reordered arguments reuse the receipt; changed values remain rejected", () => {
  const environment: ChatGptTurnEnvironment = {
    cwd: "fixture-unused", roots: [], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false },
    tools: [{ name: "exec", namespace: "functions", freeform: true, description: "fixture", parameters: {} }],
  };
  const calls = (arguments_: Record<string, unknown>) => handoffCalls(environment, "native", [
    { scope: "exec", name: "fixture_tool", arguments: arguments_ },
  ]);
  const round = new ToolBatchHandoff(environment.tools);
  const receipt = round.submit("same-request", calls({ second: { b: 2, a: 1 }, first: 0 }));
  expect(round.submit("same-request", calls({ first: 0, second: { a: 1, b: 2 } }))).toEqual(receipt);
  expect(() => round.submit("same-request", calls({ first: 1, second: { a: 1, b: 2 } }))).toThrow("different batch");
});

test("freeform input reaches the nested tool byte-for-byte, including line endings and whitespace", async () => {
  const input = ' // 中文\r\nconst value = { z: 1, a: 2 };\r\ntext(`quotes: " \\\\ ${value.z}`);\n\t';
  const program = execGatewayProgram("fixture_tool", true, { input }, []);
  let received: unknown;
  await runGateway(program, { fixture_tool: value => { received = value; return "ok"; } });
  expect(received).toBe(input);
  expect(Buffer.from(received as string)).toEqual(Buffer.from(input));
  expect(execGatewayProgram("fixture_tool", true, { input: `${input} ` }, [])).not.toBe(program);
});

test.each(["exec_command", "shell_command"])("command gateway normalizes both argument sets and preserves %s results", async name => {
  const exec = { workdir: "fixture", cmd: "fixture-only", nested: { z: 2, a: 1 } };
  const shell = { timeout_ms: 100, command: "fixture-only", nested: { z: 2, a: 1 } };
  const program = execCommandGatewayProgram(exec, shell);
  expect(program).toBe(execCommandGatewayProgram(
    { nested: { a: 1, z: 2 }, cmd: "fixture-only", workdir: "fixture" },
    { nested: { a: 1, z: 2 }, command: "fixture-only", timeout_ms: 100 },
  ));
  let received: unknown;
  const metadata = { isError: true, structuredContent: { exit_code: 1 } };
  expect(await runGateway(program, { [name]: input => { received = input; return { content: [], ...metadata }; } })).toEqual([
    { kind: "text", args: [metadata] },
  ]);
  expect(received).toEqual(name === "exec_command" ? exec : shell);
});
