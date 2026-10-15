import { expect, test } from "bun:test";
import { compileChatGptWebPrompt } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import {
  activeCompactionToolResultInstruction,
  zeroRiskActiveCompactionToolResultInstruction,
} from "../../../../src/adapters/chatgpt-web/tools/native-compaction-control";
import type { CodexParsedRequest } from "../../../../src/types";

const capabilities = { localToolsEnabled: true, solAvailable: false, extraHighAvailable: false, proAvailable: false };
const requestId = "request_12345678901234567890123456789012";

function request(compaction = false): CodexParsedRequest {
  return {
    modelId: "chatgpt-web-zero-risk",
    stream: true,
    options: {},
    context: {
      messages: [{ role: "user", content: "Inspect the repository and fix the defect.", timestamp: 1 }],
      tools: [{
        name: "exec_command",
        description: "Run a command",
        parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
      }],
    },
    ...(compaction ? { _compactionRequest: true } : {}),
  };
}

test("Zero Risk prompt carries only a neutral request id while MCP metadata owns its lifecycle", () => {
  const compiled = compileChatGptWebPrompt(request(), capabilities, requestId, {
    manualControl: true,
  });
  expect(compiled.contextFile).toBeUndefined();
  expect(compiled.text).toContain("<codex_zero_risk_request_json>");
  expect(compiled.text).toContain(`\"request_id\":\"${requestId}\"`);
  expect(compiled.text).not.toContain("turn_token");
  expect(compiled.text).not.toContain("surface_nonce");
  expect(compiled.text).not.toContain("Before reasoning");
  expect(compiled.text).not.toContain("ordinary assistant text");
  expect(compiled.text).not.toContain("exactly once");
  expect(compiled.text).not.toContain("codex_turn_start");
  expect(compiled.text).not.toContain("codex_turn_complete");
  expect(compiled.text).not.toContain("ChatGPT Web Medium with no Codex Native bridge");
});

test("Zero Risk compaction prompt stays task-focused while MCP metadata owns completion", () => {
  const compiled = compileChatGptWebPrompt(request(true), capabilities, requestId, {
    manualControl: true,
  });
  expect(compiled.text).toContain("Codex-requested compaction operation");
  expect(compiled.text).toContain("without tool calls");
  expect(compiled.text).toContain("Produce the requested checkpoint summary now");
  expect(compiled.text).not.toContain("codex_turn_start");
  expect(compiled.text).not.toContain("codex_turn_complete");
});

test("Zero Risk prompt fails closed without MCP Bridge or an exact manual binding", () => {
  expect(() => compileChatGptWebPrompt(request(), { ...capabilities, localToolsEnabled: false }, requestId, {
    manualControl: true,
  })).toThrow("requires MCP Bridge");
  expect(() => compileChatGptWebPrompt(request(), capabilities, undefined, {
    manualControl: true,
  })).toThrow("requires a broker request id");
  expect(() => compileChatGptWebPrompt(request(), capabilities, requestId, {
    manualControl: true,
    experimentalContextFiles: true,
  })).toThrow("does not support context-file browser transport");
});

test("queued MCP keeps the current binding and one consistent routing contract", () => {
  for (const manualControl of [false, true]) {
    const parsed = request();
    parsed.options.parallelToolCalls = false;
    if (!manualControl) parsed.modelId = "gpt-5.6-sol";
    const text = compileChatGptWebPrompt(parsed, { ...capabilities, solAvailable: true }, requestId, {
      ...(manualControl ? { manualControl: true } : {}), toolBatchHandoff: true,
    }).text;
    const resume = text.slice(text.lastIndexOf("<codex_transport_resume>"));
    expect(resume).toContain(JSON.stringify(manualControl ? { request_id: requestId } : { turn_token: requestId }));
    expect(text).toContain("codex_tool_inventory");
    expect(text).toContain("atomically validates, registers and seals");
    expect(text).toContain("discovery_tools");
    expect(text).toContain("codex_finish_turn");
    expect(text).toContain("not executed, cause unconfirmed");
    expect(text).toContain("A namespace does NOT make it an exec-gateway tool");
    expect(text).toContain("function_call_output, custom_tool_call_output and tool_search_output");
    expect(text).not.toContain("For nested tools, discover and call them through the fixed gateway");
    expect(resume).toContain('"parallel_tool_calls":false');
    expect(resume).toContain("codex_submit_tool_call with one call object");
    expect(text).toContain("A Web round returns either a reply or a tool batch");
    expect(text).toContain("previous round only");
    expect(text).toContain("Accepted calls end only this round, not the user's task");
    expect(text).toContain(manualControl ? "the launcher does not read the page" : "No finish or yield tool is required");
    expect(text).not.toContain("A plain-text answer alone is not a protocol result");
    if (manualControl) expect(text).not.toContain("turn_token");
  }
});

test("active Zero Risk compaction returns its checkpoint through the bound completion control", () => {
  const automatic = activeCompactionToolResultInstruction();
  const safe = zeroRiskActiveCompactionToolResultInstruction(true);

  expect(automatic).toContain("separate structured compaction handoff request");
  expect(automatic.toLowerCase()).toContain("call no more tools");
  expect(automatic).not.toContain("codex_turn_complete");
  expect(safe).toContain("codex_turn_complete");
  expect(safe).toContain("Return only the complete checkpoint summary to Codex");
  expect(safe).toContain("CONTEXT CHECKPOINT COMPACTION");
  expect(safe).not.toContain("separate structured compaction handoff request");
});
