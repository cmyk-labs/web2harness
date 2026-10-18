import { expect, test } from "bun:test";
import { defaultConfig } from "../../src/config";
import { responseRequest as respond } from "../../src/server";
import { parseRequest } from "../../src/responses/parser";
import { compileChatGptWebPrompt } from "../../src/adapters/chatgpt-web/prompt/compile";
import { createChatGptStructuredOutputValidator } from "../../src/adapters/chatgpt-web/output-validation";

const responseRequest: typeof respond = (request, config, factory, options) =>
  respond(request, config, factory, { ...options, rememberState: false });

test.each([
  { max_output_tokens: 10 }, { temperature: 0 }, { top_p: 0.5 }, { stop: ["private-sentinel"] },
  { service_tier: "priority" }, { background: true }, { truncation: "auto" },
])("unsupported Web generation controls fail before adapter construction: %j", async controls => {
  let adapterCreated = false;
  const reply = await responseRequest(new Request("http://127.0.0.1/v1/responses", {
    method: "POST", body: JSON.stringify({ model: "chatgpt-web/gpt-6-sol", input: "fixture", ...controls }),
  }), defaultConfig("native-tools"), () => { adapterCreated = true; throw new Error("must not construct"); });
  expect(reply.status).toBe(400);
  const result = await reply.json();
  expect(result.error.code).toBe("unsupported_web_request_control");
  expect(result.error.retryable).toBe(false);
  expect(JSON.stringify(result)).not.toContain("private-sentinel");
  expect(adapterCreated).toBe(false);
});

test("json_object survives parsing and prompt transport and validates the whole answer", () => {
  const parsed = parseRequest({ model: "gpt-5.6-sol", input: "Return JSON", text: { format: { type: "json_object" } } });
  expect(parsed.options.outputFormat).toEqual({ type: "json_object" });
  const prompt = compileChatGptWebPrompt(parsed, { nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true });
  expect(prompt.text).toContain('"type":"json_object"');
  const validate = createChatGptStructuredOutputValidator(parsed.options.outputFormat)!;
  expect(() => validate('{"ok":true}')).not.toThrow();
  expect(() => validate('```json\n{"ok":true}\n```')).toThrow("malformed JSON");
});

test("null no-override controls and command-tool budgets remain usable", async () => {
  let invoked = false;
  const response = await responseRequest(new Request("http://127.0.0.1/v1/responses", {
    method: "POST", body: JSON.stringify({
      model: "chatgpt-web/gpt-6-sol", input: "fixture", max_output_tokens: null, temperature: null,
      top_p: null, stop: null, service_tier: null, presence_penalty: null, frequency_penalty: null,
      tools: [{ type: "function", name: "exec_command", parameters: { type: "object", properties: { max_output_tokens: { type: "integer" } } } }],
    }),
  }), defaultConfig("native-tools"), () => ({ name: "fixture", async runTurn(parsed, _incoming, emit) {
    invoked = true;
    expect(parsed.options.maxOutputTokens).toBeUndefined();
    expect(parsed.context.tools?.[0]?.parameters).toHaveProperty("properties.max_output_tokens");
    emit({ type: "text_delta", text: "ok" });
    emit({ type: "done" });
  } }));
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("completed");
  expect(invoked).toBe(true);
});

test.each(["reasoning", "compaction"])("opaque %s is a nonretryable preflight failure without adapter work", async type => {
  const response = await responseRequest(new Request("http://127.0.0.1/v1/responses", {
    method: "POST", body: JSON.stringify({ model: "chatgpt-web/gpt-6-sol", input: [{ type, encrypted_content: "private-sentinel" }] }),
  }), defaultConfig("native-tools"), () => { throw new Error("must not construct browser"); });
  expect(response.status).toBe(400);
  const result = await response.json();
  expect(result.error.code).toBe("incompatible_web_context");
  expect(result.error.issues[0].code).toBe(`encrypted_${type}`);
  expect(JSON.stringify(result)).not.toContain("private-sentinel");
});
