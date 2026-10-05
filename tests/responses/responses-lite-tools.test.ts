import { expect, test } from "bun:test";
import { defaultConfig } from "../../src/config";
import { parseRequest } from "../../src/responses/parser";
import { responseRequest } from "../../src/server";

const freeformFormat = {
  type: "grammar",
  syntax: "lark",
  definition: 'start: "tool"',
};

function responsesLiteTools() {
  return [{
    type: "namespace",
    name: "functions",
    description: "",
    tools: [
      { type: "custom", name: "exec", description: "Run native Codex code", format: freeformFormat },
      {
        type: "function",
        name: "wait",
        description: "Wait for native Codex code",
        strict: false,
        parameters: { type: "object", properties: {} },
      },
    ],
  }, {
    type: "namespace",
    name: "mcp__python",
    description: "Python tools",
    tools: [{
      type: "custom",
      name: "run_script",
      description: "Run a Python script",
      format: freeformFormat,
    }],
  }];
}

test("Responses Lite preserves custom tools and their format in every namespace", () => {
  const parsed = parseRequest({
    model: "chatgpt-web/luna",
    input: [{ type: "additional_tools", role: "developer", tools: responsesLiteTools() }],
  });

  expect(parsed.context.tools).toContainEqual(expect.objectContaining({
    name: "exec",
    freeform: true,
  }));
  const waitTool = parsed.context.tools?.find(tool => tool.name === "wait");
  expect(waitTool).toEqual(expect.objectContaining({ name: "wait" }));
  expect(waitTool).not.toHaveProperty("namespace");
  expect(parsed.context.tools).toContainEqual(expect.objectContaining({
    name: "run_script", namespace: "mcp__python", freeform: true, format: freeformFormat,
  }));
});

test("Responses Lite native exec survives a complete server request as one custom call", async () => {
  const config = defaultConfig("mcp-bridge");
  config.solAvailable = false;
  config.proAvailable = false;
  const turnId = "turn_responses_lite_exec_regression";
  const response = await responseRequest(new Request("http://127.0.0.1:17841/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "chatgpt-web/luna",
      stream: false,
      metadata: { turn_id: turnId, thread_id: "thread_responses_lite_exec_regression" },
      input: [{
        type: "additional_tools",
        role: "developer",
        tools: responsesLiteTools().slice(0, 1),
      }, {
        type: "message",
        id: "msg_responses_lite_exec_regression",
        role: "user",
        content: [{ type: "input_text", text: "Use the native exec tool" }],
        internal_chat_message_metadata_passthrough: { turn_id: turnId },
      }],
    }),
  }), config, () => ({
    name: "responses-lite-exec-regression",
    async runTurn(parsed, _incoming, emit) {
      expect(parsed.context.tools).toContainEqual(expect.objectContaining({ name: "exec", freeform: true }));
      emit({ type: "tool_call_start", id: "call_exec", name: "exec" });
      emit({ type: "tool_call_delta", arguments: JSON.stringify({ input: "text('ok')" }) });
      emit({ type: "tool_call_end" });
      emit({ type: "done", endTurn: false });
    },
  }), { rememberState: false });

  expect(response.status).toBe(200);
  const body = await response.json() as { output: Array<Record<string, unknown>> };
  const calls = body.output.filter(item => item.type === "custom_tool_call");
  expect(calls).toEqual([expect.objectContaining({
    call_id: "call_exec",
    name: "exec",
    input: "text('ok')",
  })]);
});

for (const stream of [false, true]) test(`namespaced custom calls retain identity beside same-name functions (stream=${stream})`, async () => {
  const config = defaultConfig("native-tools");
  const response = await responseRequest(new Request("http://localhost/v1/responses", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      model: "chatgpt-web/gpt-5.6-sol", stream, input: "Use both tools",
      tools: [
        { type: "namespace", name: "scripts", tools: [{ type: "custom", name: "run", format: freeformFormat }] },
        { type: "namespace", name: "commands", tools: [{ type: "function", name: "run", parameters: { type: "object" } }] },
      ],
    }),
  }), config, () => ({ name: "fixture", async runTurn(_parsed, _incoming, emit) {
    for (const [name, args] of [["scripts__run", { input: "print('你好')\n" }], ["commands__run", { command: "status" }]] as const) {
      emit({ type: "tool_call_start", id: `call_${name}`, name });
      emit({ type: "tool_call_delta", arguments: JSON.stringify(args) });
      emit({ type: "tool_call_end" });
    }
    emit({ type: "done", endTurn: false });
  } }), { rememberState: false });
  expect(response.status).toBe(200);
  const wire = await response.text();
  const events = stream ? wire.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6))) : [];
  const output = stream ? events.find(event => event.type === "response.completed").response.output : JSON.parse(wire).output;
  expect(output).toEqual([
    expect.objectContaining({ type: "custom_tool_call", name: "run", namespace: "scripts", input: "print('你好')\n" }),
    expect.objectContaining({ type: "function_call", name: "run", namespace: "commands", arguments: '{"command":"status"}' }),
  ]);
  if (stream) expect(events.filter(event => event.type === "response.output_item.added")[0].item.namespace).toBe("scripts");
  const replay = parseRequest({ model: "chatgpt-web/luna", input: [...output, { type: "custom_tool_call_output", call_id: "call_scripts__run", output: "ok" }] });
  expect(replay.context.messages.at(-1)).toEqual(expect.objectContaining({ role: "toolResult", toolNamespace: "scripts", toolName: "run" }));
});

test("tool namespace collisions fail explicitly and named choices preserve namespaces", () => {
  expect(() => parseRequest({ model: "x", tools: [
    { type: "function", name: "scripts__run" },
    { type: "namespace", name: "scripts", tools: [{ type: "function", name: "run" }] },
  ] })).toThrow("Ambiguous tool wire name");
  expect(parseRequest({ model: "x", tool_choice: { type: "custom", name: "run", namespace: "scripts" } }).options.toolChoice).toEqual({ name: "scripts__run" });
});
