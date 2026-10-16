import { expect, test } from "bun:test";
import { parseRequest } from "../../../../src/responses/parser";
import type { ModelToolChoice } from "../../../../src/responses/tool-choice";
import { toolIdentityKey } from "../../../../src/types";
import { ToolBatchHandoff } from "../../../../src/adapters/chatgpt-web/tools/tool-batch-handoff";
import { compileChatGptWebPrompt } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import { CHATGPT_WEB_MODEL_ID } from "../../../../src/adapters/chatgpt-web/model";

const tools = [
  { type: "namespace", name: "clock", tools: [{ type: "function", name: "sleep", parameters: {} }] },
  { type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] },
  { type: "function", name: "clock__sleep", parameters: {} },
  { type: "tool_search" },
];
const choices: Exclude<ModelToolChoice, string>[] = [
  { type: "function", namespace: "clock", name: "sleep" },
  { type: "custom", namespace: "functions", name: "exec" },
  { type: "function", name: "clock__sleep" },
  { type: "allowed_tools", mode: "required", tools: [
    { type: "function", namespace: "clock", name: "sleep" },
    { type: "custom", namespace: "functions", name: "exec" },
    { type: "tool_search" },
  ] },
];

for (const choice of choices) test(`handoff and prompt expose the same explicit tool identities: ${JSON.stringify(choice)}`, () => {
  const body = { model: CHATGPT_WEB_MODEL_ID, tools, tool_choice: choice, parallel_tool_calls: false, input: "Fixture task" };
  const original = structuredClone(body);
  const parsed = parseRequest(body);
  const round = new ToolBatchHandoff(parsed.context.tools!, parsed.options);
  expect(round.callControls.tool_choice).toEqual(choice);
  const compiled = compileChatGptWebPrompt(parsed,
    { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
    "turn_fixture_binding", { toolBatchHandoff: true });
  const match = compiled.text.match(/Current Codex call controls: (.+)\. Preserve these controls\./);
  expect(match).not.toBeNull();
  expect(JSON.parse(match![1]!)).toEqual({ tool_choice: choice, parallel_tool_calls: false });
  const envelope = JSON.parse(compiled.text.split("<codex_context_json>\n")[1]!.split("\n</codex_context_json>")[0]!);
  expect(envelope.controls.tool_choice).toEqual(choice);
  expect(envelope.tools).toEqual(tools);
  expect(parsed.context.source?.controls.tool_choice).toEqual(choice);
  expect(body).toEqual(original);
  if ("name" in choice) {
    const call = { name: choice.name, ...("namespace" in choice ? { namespace: choice.namespace } : {}),
      ...(choice.type === "custom" ? { input: "fixture input" } : { arguments: {} }) };
    expect(() => round.submit("fixture", [call])).not.toThrow();
  }
});

test("controls never invent a tool identity for an unresolved internal key", () => {
  const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, tools });
  const round = new ToolBatchHandoff(parsed.context.tools!, { toolChoice: { name: toolIdentityKey("missing", "run") } });
  expect(() => round.callControls).toThrow(/not available/);
});

test("model-visible controls are detached from the enforcement policy", () => {
  const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, tools, tool_choice: choices[3] });
  const round = new ToolBatchHandoff(parsed.context.tools!, parsed.options);
  const controls = round.callControls.tool_choice as { tools: Array<{ name?: string }> };
  controls.tools[0]!.name = "changed";
  expect(round.callControls.tool_choice).toEqual(choices[3]);
  expect(() => round.submit("fixture", [{ name: "clock__sleep", arguments: {} }])).toThrow("outside");
});
