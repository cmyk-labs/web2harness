import { describe, expect, test } from "bun:test";
import {
  CODEX_TOOL_CALLS_FENCE,
  formatNativeToolCallCorrection,
  nativeToolCallContractLines,
  parseNativeToolCallReply,
  splitNativeToolCallBlocks,
} from "../../../../src/adapters/chatgpt-web/tools/native-tool-call-block";
import { buildResponseJSON } from "../../../../src/responses/json";
import { chatGptHtmlToMarkdown } from "../../../../src/adapters/chatgpt-web/markdown";
import type { AdapterEvent, CodexTool } from "../../../../src/types";

const execCommand: CodexTool = {
  name: "exec_command",
  description: "Run a command.",
  parameters: {
    type: "object",
    properties: {
      cmd: { type: "string" },
      workdir: { type: "string" },
      max_output_tokens: { type: "number" },
    },
    required: ["cmd"],
    additionalProperties: false,
  },
};

const applyPatch: CodexTool = {
  name: "apply_patch",
  description: "Apply a patch.",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "Raw patch body." },
    },
    required: ["input"],
  },
  freeform: true,
};

const toolSearch: CodexTool = {
  name: "tool_search",
  description: "Search deferred tools.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  toolSearch: true,
};

const mcpResolve: CodexTool = {
  name: "resolve",
  description: "Resolve docs.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  namespace: "mcp__context7",
};

const TOOLS = [execCommand, applyPatch, toolSearch, mcpResolve];

function block(body: string): string {
  return "```" + CODEX_TOOL_CALLS_FENCE + "\n" + body + "\n```\n";
}

describe("splitNativeToolCallBlocks", () => {
  test("keeps ordinary fences and text untouched", () => {
    const text = "Here is data:\n```json\n{\"a\":1}\n```\nDone.";
    const split = splitNativeToolCallBlocks(text);
    expect(split.blocks).toHaveLength(0);
    expect(split.unclosed).toBe(false);
    expect(split.visibleText).toBe(text);
  });

  test("extracts one block and strips it from visible text", () => {
    const split = splitNativeToolCallBlocks("Before.\n" + block('{"calls":[]}') + "After.");
    expect(split.blocks).toHaveLength(1);
    expect(split.blocks[0]!.body).toBe('{"calls":[]}');
    expect(split.visibleText).toBe("Before.\nAfter.");
  });

  test("tolerates an info string and indented fences", () => {
    const text = "  ```  codex_tool_calls json\n{}\n  ```";
    const split = splitNativeToolCallBlocks(text);
    expect(split.blocks).toHaveLength(1);
  });

  test("reports an unclosed block", () => {
    const split = splitNativeToolCallBlocks("```codex_tool_calls\n{}");
    expect(split.unclosed).toBe(true);
    expect(split.blocks).toHaveLength(1);
  });

  // P5 live-capture shape: ChatGPT's DOM drops the fence info string, so the browser Markdown
  // extraction yields the marker as a (turndown-escaped) text label plus an anonymous fence.
  test("recognizes the DOM-extracted label shape, escaped or not", () => {
    for (const label of ["codex_tool_calls", "codex\\_tool\\_calls"]) {
      const text = "Intro.\n\n" + label + "\n\n```\n{\"calls\":[]}\n```\n\nOutro.";
      const split = splitNativeToolCallBlocks(text);
      expect(split.blocks).toHaveLength(1);
      expect(split.blocks[0]!.body).toBe('{"calls":[]}');
      expect(split.visibleText.trim()).toBe("Intro.\n\nOutro.");
      expect(split.unclosed).toBe(false);
    }
  });

  test("a detached label without a following fence stays visible text", () => {
    const text = "Use the codex_tool_calls marker as documented.";
    const split = splitNativeToolCallBlocks(text);
    expect(split.blocks).toHaveLength(0);
    expect(split.visibleText).toBe(text);
  });

  test("an escaped info token still opens the block", () => {
    const split = splitNativeToolCallBlocks("```codex\\_tool\\_calls\n{\"calls\":[]}\n```");
    expect(split.blocks).toHaveLength(1);
  });
});

describe("parseNativeToolCallReply", () => {
  test("reply without a block is a plain read-only answer", () => {
    const parsed = parseNativeToolCallReply("Just an answer.", TOOLS);
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.blockCount).toBe(0);
    expect(parsed.visibleText).toBe("Just an answer.");
  });

  test("parses one valid function call with prose preserved", () => {
    const reply = "Checking the directory.\n"
      + block('{"calls":[{"name":"exec_command","arguments":{"cmd":"ls"}}]}')
      + "I will continue after the result.";
    const parsed = parseNativeToolCallReply(reply, TOOLS);
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls).toEqual([{
      wireName: "exec_command",
      name: "exec_command",
      freeform: false,
      toolSearch: false,
      arguments: { cmd: "ls" },
    }]);
    expect(parsed.visibleText).toBe("Checking the directory.\nI will continue after the result.");
  });

  test("resolves flattened MCP names to the namespace tool", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"mcp__context7__resolve","arguments":{"query":"bun test"}}]}'),
      TOOLS,
    );
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls[0]).toMatchObject({
      wireName: "mcp__context7__resolve",
      name: "resolve",
      namespace: "mcp__context7",
    });
  });

  test("freeform tool call carries input inside arguments", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"apply_patch","arguments":{"input":"*** Begin Patch\\n*** End Patch"}}]}'),
      TOOLS,
    );
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls[0]).toMatchObject({
      freeform: true,
      arguments: { input: "*** Begin Patch\n*** End Patch" },
    });
  });

  test("tool_search call is flagged for the tool_search_call relay", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"tool_search","arguments":{"query":"browser","limit":5}}]}'),
      TOOLS,
    );
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls[0]!.toolSearch).toBe(true);
  });

  test("bare JSON array block is tolerated and multiple blocks merge in order", () => {
    const parsed = parseNativeToolCallReply(
      block('[{"name":"exec_command","arguments":{"cmd":"a"}}]')
      + block('{"calls":[{"name":"exec_command","arguments":{"cmd":"b"}}]}'),
      TOOLS,
    );
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls.map(call => call.arguments.cmd)).toEqual(["a", "b"]);
    expect(parsed.blockCount).toBe(2);
  });

  test("duplicate same-tool calls are allowed", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"exec_command","arguments":{"cmd":"a"}},{"name":"exec_command","arguments":{"cmd":"b"}}]}'),
      TOOLS,
    );
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls).toHaveLength(2);
  });

  test("tolerates CRLF line endings", () => {
    const reply = "Text.\r\n```codex_tool_calls\r\n{\"calls\":[{\"name\":\"exec_command\",\"arguments\":{\"cmd\":\"x\"}}]}\r\n```\r\n";
    const parsed = parseNativeToolCallReply(reply, TOOLS);
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls).toHaveLength(1);
  });

  test("unknown tool is reported and dropped", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"shell","arguments":{"cmd":"ls"}},{"name":"exec_command","arguments":{"cmd":"ls"}}]}'),
      TOOLS,
    );
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]!.problem).toContain("unknown tool");
    expect(parsed.issues[0]!.wireName).toBe("shell");
  });

  test("missing and non-object arguments are reported", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"exec_command"},{"name":"exec_command","arguments":"ls"}]}'),
      TOOLS,
    );
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues[0]!.problem).toContain("missing \"arguments\"");
    expect(parsed.issues[1]!.problem).toContain("must be a JSON object");
  });

  test("unsupported call fields are rejected", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"exec_command","arguments":{"cmd":"ls"},"reason":"list files"}]}'),
      TOOLS,
    );
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.issues[0]!.problem).toContain("\"reason\"");
  });

  test("schema violations surface as issues", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"exec_command","arguments":{"workdir":"/tmp"}}]}'),
      TOOLS,
    );
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.issues[0]!.problem).toContain("do not match its schema");
    expect(parsed.issues[0]!.problem).toContain("cmd");
  });

  test("malformed JSON and unclosed fences are block-level issues", () => {
    const parsed = parseNativeToolCallReply(
      "```codex_tool_calls\n{\"calls\":[}\n```\n```codex_tool_calls\n{}",
      TOOLS,
    );
    expect(parsed.calls).toHaveLength(0);
    const problems = parsed.issues.map(issue => issue.problem);
    expect(problems.some(problem => problem.includes("not valid JSON"))).toBe(true);
    expect(problems.some(problem => problem.includes("never closed"))).toBe(true);
  });

  test("an empty call list is flagged", () => {
    const parsed = parseNativeToolCallReply(block('{"calls":[]}'), TOOLS);
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]!.problem).toContain("no calls");
  });

  test("a plain json fence with no marker is never a tool call", () => {
    const parsed = parseNativeToolCallReply(
      "Example payload:\n```json\n{\"calls\":[{\"name\":\"exec_command\",\"arguments\":{\"cmd\":\"ls\"}}]}\n```",
      TOOLS,
    );
    expect(parsed.blockCount).toBe(0);
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.issues).toHaveLength(0);
  });
});

describe("browser-extracted native reply (P5 live shape)", () => {
  test("ChatGPT's DOM label-plus-anonymous-fence markdown parses into a call", () => {
    // Reproduces the captured live turn: turndown keeps the code header label as escaped text
    // and serializes <pre> without the info string. The JSON body survives verbatim.
    const html = [
      "<div><p>我会读取 notes.txt。</p></div>",
      "<div class=\"markdown\"><p>codex_tool_calls</p>",
      "<pre><code>{\"calls\":[{\"name\":\"exec_command\",\"arguments\":{\"cmd\":\"Get-Content notes.txt\",\"workdir\":\"C:\\\\tmp\",\"max_output_tokens\":4000}}]}</code></pre></div>",
    ].join("");
    const markdown = chatGptHtmlToMarkdown(html);
    expect(markdown).toContain("codex\\_tool\\_calls");
    expect(markdown).not.toContain("```codex_tool_calls");

    const parsed = parseNativeToolCallReply(markdown, TOOLS);
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0]).toMatchObject({
      wireName: "exec_command",
      arguments: { cmd: "Get-Content notes.txt", workdir: "C:\\tmp", max_output_tokens: 4000 },
    });
    expect(parsed.visibleText).toBe("我会读取 notes.txt。");
  });
});

describe("formatNativeToolCallCorrection", () => {
  test("lists every problem and demands one corrected block", () => {
    const text = formatNativeToolCallCorrection([
      { callIndex: 0, wireName: "exec_command", problem: "arguments do not match its schema: /cmd: must be string" },
      { callIndex: null, problem: "block is not valid JSON (bad token)" },
    ]);
    expect(text).toContain("<codex_tool_call_correction>");
    expect(text).toContain("- call 1 (exec_command): arguments do not match its schema");
    expect(text).toContain("- block: block is not valid JSON");
    expect(text).toContain("```" + CODEX_TOOL_CALLS_FENCE);
    expect(text).toContain("</codex_tool_call_correction>");
  });
});

describe("nativeToolCallContractLines", () => {
  test("documents the fence, exact names, JSON-only rule, and freeform input", () => {
    const lines = nativeToolCallContractLines();
    const joined = lines.join("\n");
    expect(joined).toContain(CODEX_TOOL_CALLS_FENCE);
    expect(joined).toContain("EXACT declared name");
    expect(joined).toContain('{"input":"<raw tool body>"}');
    expect(joined).toContain("no comments, no trailing commas");
  });
});

describe("bridge round-trip of parsed native calls", () => {
  const toEvents = (calls: {
    id: string;
    wireName: string;
    namespace?: string;
    freeform: boolean;
    toolSearch: boolean;
    arguments: Record<string, unknown>;
  }[]): AdapterEvent[] => {
    const events: AdapterEvent[] = [];
    for (const call of calls) {
      events.push({ type: "tool_call_start", id: call.id, name: call.wireName });
      events.push({
        type: "tool_call_delta",
        arguments: JSON.stringify(call.arguments ?? {}),
      });
      events.push({ type: "tool_call_end" });
    }
    events.push({ type: "done", stopReason: "tool_use", endTurn: false });
    return events;
  };

  test("function call serializes with a JSON-string arguments payload", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"exec_command","arguments":{"cmd":"echo ok"}}]}'),
      TOOLS,
    );
    const json = buildResponseJSON(
      toEvents(parsed.calls.map((call, i) => ({ id: `call_${i + 1}`, ...call }))),
      "probe-model",
      {},
    );
    const item = (json.output as Record<string, unknown>[]).find(candidate => candidate.type === "function_call");
    expect(item).toBeDefined();
    expect((item as { arguments: unknown }).arguments).toBe('{"cmd":"echo ok"}');
    expect((item as { name: unknown }).name).toBe("exec_command");
  });

  test("namespaced call keeps its namespace field", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"mcp__context7__resolve","arguments":{"query":"x"}}]}'),
      TOOLS,
    );
    const json = buildResponseJSON(
      toEvents(parsed.calls.map((call, i) => ({ id: `call_${i + 1}`, ...call }))),
      "probe-model",
      { toolNsMap: new Map([["mcp__context7__resolve", { namespace: "mcp__context7", name: "resolve" }]]) },
    );
    const item = (json.output as Record<string, unknown>[]).find(candidate => candidate.type === "function_call");
    expect(item).toMatchObject({ namespace: "mcp__context7", name: "resolve" });
  });

  test("freeform call serializes as custom_tool_call with raw input", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"apply_patch","arguments":{"input":"*** Begin Patch"}}]}'),
      TOOLS,
    );
    const json = buildResponseJSON(
      toEvents(parsed.calls.map((call, i) => ({ id: `call_${i + 1}`, ...call }))),
      "probe-model",
      { freeformToolNames: new Set(["apply_patch"]) },
    );
    const item = (json.output as Record<string, unknown>[]).find(candidate => candidate.type === "custom_tool_call");
    expect(item).toMatchObject({ name: "apply_patch", input: "*** Begin Patch" });
  });

  test("tool_search call serializes as a client-executed tool_search_call", () => {
    const parsed = parseNativeToolCallReply(
      block('{"calls":[{"name":"tool_search","arguments":{"query":"browser","limit":5}}]}'),
      TOOLS,
    );
    const json = buildResponseJSON(
      toEvents(parsed.calls.map((call, i) => ({ id: `call_${i + 1}`, ...call }))),
      "probe-model",
      { toolSearchToolNames: new Set(["tool_search"]) },
    );
    const item = (json.output as Record<string, unknown>[]).find(candidate => candidate.type === "tool_search_call");
    expect(item).toMatchObject({
      execution: "client",
      arguments: { query: "browser", limit: 5 },
    });
  });
});
