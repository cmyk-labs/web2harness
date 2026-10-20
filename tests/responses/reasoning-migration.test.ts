import { expect, test } from "bun:test";
import { migrateVisibleReasoning, preflightContextCompatibility } from "../../src/responses/context-compatibility";
import { encodeReasoningEnvelope } from "../../src/responses/reasoning-envelope";
import { defaultConfig } from "../../src/config";
import { responseRequest } from "../../src/server";
import { compileChatGptWebPrompt } from "../../src/adapters/chatgpt-web/prompt/compile";
import { expandPreviousResponseInput, responseStateScope } from "../../src/responses/state";

const reasoning = { type: "reasoning", id: "r", encrypted_content: "opaque-native-state",
  summary: [{ type: "summary_text", text: "visible summary" }], vendor_metadata: { preserve: true } };
const visible = [{ role: "user", content: "Continue" },
  { type: "function_call", call_id: "call", name: "read_file", arguments: '{"path":"fixture.txt"}' },
  { type: "function_call_output", call_id: "call", output: "exact original result" }];

test("visible-history reset preserves original history and every visible field", () => {
  const input = [reasoning, ...visible], before = structuredClone(input);
  const result = migrateVisibleReasoning(input);
  expect(result.resetItemCount).toBe(1);
  expect(result.input).toEqual([{ type: "reasoning", id: "r", summary: reasoning.summary, vendor_metadata: reasoning.vendor_metadata }, ...visible]);
  expect(input).toEqual(before);
  expect(preflightContextCompatibility(input).status).toBe("blocked");
  expect(preflightContextCompatibility(result.input).status).toBe("compatible");
  expect(migrateVisibleReasoning(Array.from({ length: 100 }, () => reasoning)).resetItemCount).toBe(100);
});

test("transparent states survive; malformed, nested, compaction, agent and tool ciphertext stay blocked", () => {
  const bridge = { type: "reasoning", encrypted_content: encodeReasoningEnvelope({ txt: "" }) };
  expect(migrateVisibleReasoning([bridge]).input).toEqual([bridge]);
  for (const item of [
    { type: "compaction", encrypted_content: "opaque" },
    { type: "agent_message", content: [{ type: "encrypted_content", encrypted_content: "opaque" }] },
    { type: "function_call_output", call_id: "x", encrypted_content: "opaque" },
    { type: "function_call", encrypted_function_args: ["command"] },
    { type: "reasoning", encrypted_content: "ocxr1:broken" },
    { type: "reasoning", encrypted_content: "" },
    { type: "reasoning", summary: [{ type: "encrypted_content", encrypted_content: "opaque" }] },
  ]) {
    const input = [reasoning, item];
    expect(migrateVisibleReasoning(input)).toEqual({ input, resetItemCount: 0 });
  }
});

test.each([undefined, "strict", "misspelled"])("no implicit reset for %s", async mode => {
  const response = await responseRequest(new Request("http://localhost/v1/responses", { method: "POST",
    headers: mode ? { "x-web2harness-reasoning-migration": mode } : {},
    body: JSON.stringify({ model: "chatgpt-web/gpt-6-sol", input: [reasoning, ...visible] }) }),
  defaultConfig("native-tools"), () => { throw Error("must not invoke adapter"); }, { rememberState: false });
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe(mode === "misspelled" ? "invalid_context_migration" : "incompatible_web_context");
});

test.each([false, true])("explicit reset survives HTTP %s delivery and keeps original continuation state", async stream => {
  let called = 0;
  const req = new Request("http://localhost/v1/responses", { method: "POST",
    headers: { "x-web2harness-reasoning-migration": "visible-history", authorization: "Bearer owned-migration-test" },
    body: JSON.stringify({ model: "chatgpt-web/gpt-6-sol", input: [reasoning, ...visible], stream,
      tools: [{ type: "function", name: "read_file", parameters: { type: "object" } }] }) });
  const response = await responseRequest(req, defaultConfig("native-tools"), () => ({ name: "migration-fixture",
    async runTurn(parsed, _incoming, emit) {
      called++;
      const prompt = compileChatGptWebPrompt(parsed, { nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true });
      expect(prompt.text).toContain("visible summary");
      expect(prompt.text).toContain("exact original result");
      expect(prompt.text).toContain("restart reasoning");
      expect(prompt.text).not.toContain("opaque-native-state");
      expect(parsed.context.tools?.[0]?.name).toBe("read_file");
      emit({ type: "text_delta", text: "continued" }); emit({ type: "done" });
    } }), { memoryOnlyState: true });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-web2harness-reasoning-reset-items")).toBe("1");
  const text = await response.text();
  expect(text).toContain("continued"); expect(called).toBe(1);
  const completed = stream ? text.split("\n").filter(l => l.startsWith("data: {")).map(l => JSON.parse(l.slice(6))).find(e => e.type === "response.completed")?.response : JSON.parse(text);
  expect(completed?.id).toBeDefined();
  const expanded = expandPreviousResponseInput({ model: "chatgpt-web/gpt-6-sol", previous_response_id: completed.id, input: [] }, responseStateScope(req.headers)) as any;
  expect(expanded.input[0]).toEqual(reasoning);
});
