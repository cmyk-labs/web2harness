import { describe, expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../../../src/adapters/chatgpt-web/adapter-error";
import { validateChatGptWebRequestControls } from "../../../src/adapters/chatgpt-web/request-controls";

describe("Web request controls", () => {
  test("ordinary Codex requests retain tool, reasoning, output and transport settings", () => {
    const request = {
      model: "chatgpt-web/gpt-5.6-sol", stream: true, store: false,
      input: [{ role: "user", content: "Return JSON after checking the workspace." }],
      instructions: "Use the task tools.", previous_response_id: "resp_previous",
      reasoning: { effort: "high", summary: "auto" }, include: ["reasoning.encrypted_content"],
      text: { verbosity: "high", format: { type: "json_object" } },
      tool_choice: "auto", parallel_tool_calls: true,
      tools: [{ type: "function", name: "exec_command", parameters: { type: "object" } }],
      prompt_cache_key: "thread", metadata: { temperature: 0.2 },
    };
    const original = structuredClone(request);
    expect(() => validateChatGptWebRequestControls(request)).not.toThrow();
    expect(request).toEqual(original);
  });

  test("accepts absent controls and no-override defaults", () => {
    expect(() => validateChatGptWebRequestControls({})).not.toThrow();
    expect(() => validateChatGptWebRequestControls({
      max_output_tokens: null, temperature: null, top_p: undefined, stop: [],
      presence_penalty: 0, frequency_penalty: 0, service_tier: "auto",
      background: false, truncation: "disabled",
    })).not.toThrow();
    expect(() => validateChatGptWebRequestControls({
      max_output_tokens: undefined, temperature: undefined, top_p: null, stop: null,
      presence_penalty: null, frequency_penalty: undefined, service_tier: null,
      background: null, truncation: undefined,
    })).not.toThrow();
  });

  test("does not inspect or alter command-tool output budgets or historical arguments", () => {
    const argumentsObject = { cmd: "Get-Content notes.txt", max_output_tokens: 4000, temperature: 0 };
    const request = {
      tools: [{ type: "function", name: "exec_command", parameters: {
        type: "object", properties: { max_output_tokens: { type: "number", default: 4000 } },
      } }],
      input: [{ type: "function_call", name: "exec_command", arguments: JSON.stringify(argumentsObject) },
        { type: "custom_tool_call", input: "await tools.exec_command({max_output_tokens: 4000})" }],
      metadata: { max_output_tokens: 7 },
    };
    const original = structuredClone(request);
    expect(() => validateChatGptWebRequestControls(request)).not.toThrow();
    expect(request).toEqual(original);
  });

  test.each([
    ["max_output_tokens", 1], ["max_output_tokens", 100000],
    ["temperature", 0], ["temperature", 0.7], ["temperature", 1],
    ["top_p", 0.1], ["top_p", 1], ["stop", "END"], ["stop", ["END"]],
    ["stop", ""], ["presence_penalty", 0.5], ["frequency_penalty", -0.5],
    ["service_tier", "priority"], ["service_tier", "default"], ["service_tier", "flex"],
    ["background", true], ["truncation", "auto"],
  ])("rejects unsupported top-level %s=%j explicitly", (name, value) => {
    const request = { [name as string]: value };
    try {
      validateChatGptWebRequestControls(request);
      throw new Error("request should be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatGptWebAdapterError);
      expect(error).toMatchObject({
        status: 400, errorType: "invalid_request_error", code: "unsupported_web_request_control", retryable: false,
      });
      expect((error as Error).message).toContain(JSON.stringify(name));
      expect(request).toEqual({ [name as string]: value });
    }
  });

  test("does not leak caller values in unsupported-control errors", () => {
    try {
      validateChatGptWebRequestControls({ stop: ["private-stop-sequence"] });
      throw new Error("request should be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatGptWebAdapterError);
      expect((error as Error).message).not.toContain("private-stop-sequence");
    }
  });
});
