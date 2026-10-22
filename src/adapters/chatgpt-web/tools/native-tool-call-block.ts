import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { toolIdentityKey, type CodexTool } from "../../../types";

/**
 * Native-tools reply contract.
 *
 * In native-tools mode ChatGPT Web never executes tools itself: it only DECIDES tool calls by
 * writing one fenced block into its reply, and this module turns that text into validated
 * CodexToolCall material. The bridge relays each call back as a Responses function_call /
 * custom_tool_call / tool_search_call item; Codex executes everything under its own sandbox and
 * approvals, then returns the results as function_call_output in the next request.
 */

export const CODEX_TOOL_CALLS_FENCE = "codex_tool_calls";

export interface NativeToolCall {
  /** Internal routing key; never shown as a model-facing tool name. */
  wireName: string;
  name: string;
  namespace?: string;
  freeform: boolean;
  toolSearch: boolean;
  arguments: Record<string, unknown>;
}

export interface NativeToolCallIssue {
  /** 0-based position inside the merged call list; null for block-level problems. */
  callIndex: number | null;
  wireName?: string;
  problem: string;
  /** Static classification only. problem/wireName are private corrective feedback, never logs. */
  category?: "block_json" | "block_shape" | "call_shape" | "tool_name" | "tool_namespace"
    | "tool_kind" | "call_fields" | "arguments_shape" | "arguments_schema" | "empty_block" | "batch_constraints";
  schemaKeywords?: string[];
}

const SCHEMA_KEYWORDS = new Set("type required additionalProperties enum const anyOf oneOf allOf not if false schema maximum minimum exclusiveMaximum exclusiveMinimum multipleOf maxLength minLength pattern format maxItems minItems uniqueItems contains maxContains minContains maxProperties minProperties dependencies dependentRequired propertyNames additionalItems items".split(" "));

/** No error messages, schema paths, property names, tool identities or argument values. */
export function nativeToolCallIssueDiagnostics(issues: readonly NativeToolCallIssue[]) {
  return {
    issueCount: issues.length,
    issues: issues.slice(0, 16).map(issue => ({
      category: issue.category ?? "internal_error", callIndex: issue.callIndex,
      ...(issue.schemaKeywords ? { keywords: [...new Set(issue.schemaKeywords)]
        .filter(keyword => SCHEMA_KEYWORDS.has(keyword)).slice(0, 16).map(code => ({ code })) } : {}),
    })),
    omittedIssues: Math.max(0, issues.length - 16),
  };
}

export interface ParsedNativeToolCallReply {
  calls: NativeToolCall[];
  issues: NativeToolCallIssue[];
  /** Reply text with every tool-call block removed — the user-visible assistant text. */
  visibleText: string;
  blockCount: number;
}

interface ToolIndexEntry {
  tool: CodexTool;
  wireName: string;
  validate: ValidateFunction | undefined;
}

function buildToolIndex(tools: readonly CodexTool[]): Map<string, ToolIndexEntry> {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    validateFormats: false,
  });
  addFormats(ajv);
  const index = new Map<string, ToolIndexEntry>();
  for (const tool of tools) {
    const wireName = toolIdentityKey(tool.namespace, tool.name);
    let validate: ValidateFunction | undefined;
    try {
      validate = ajv.compile(tool.parameters as object | boolean);
    } catch {
      // A tool schema Codex cannot express for ajv must not poison the whole reply; the call
      // still reaches Codex, which validates authoritatively and can self-correct via feedback.
      validate = undefined;
    }
    index.set(wireName, { tool, wireName, validate });
  }
  return index;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SplitBlock {
  body: string;
  /** Line range of the whole block, used to strip it from the visible text. */
  startLine: number;
  endLine: number; // exclusive
}

/**
 * Turndown escapes `_` in plain DOM text, and ChatGPT renders the fence's info string as a label
 * chip OUTSIDE the `<pre>` (see P5 incident: the live DOM yields `codex\_tool\_calls` as a text
 * paragraph followed by an anonymous fence). Un-escape only the token we compare, never the body.
 */
function unescapeMarkdownToken(token: string): string {
  return token.replaceAll("\\_", "_");
}

/**
 * Line-based fence scanner. A model's reply must never be parsed with a heroic regex: fences can
 * be indented, carry an info string, or be left unclosed. A block is recognized in either of the
 * two shapes the reply can reach us in:
 *
 *  1. Authored shape — an opening fence whose info token is exactly `codex_tool_calls`
 *     (what the model writes and in-process/dev paths see verbatim).
 *  2. DOM-extracted shape — a standalone `codex_tool_calls` label line (possibly escaped by
 *     turndown) followed by blank lines and a bare opening fence (what the browser Markdown
 *     extraction produces, because ChatGPT's DOM drops the info string from the `<pre>`).
 *
 * Each matched block ends at the next bare closing fence or the completed reply's EOF.
 */
export function splitNativeToolCallBlocks(text: string): {
  visibleText: string;
  blocks: SplitBlock[];
  unclosed: boolean;
} {
  const lines = text.split("\n");
  const kept: string[] = [];
  const blocks: SplitBlock[] = [];
  let unclosed = false;
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index]!.trim();
    let bodyStart: number | undefined;
    if (trimmed.startsWith("```")) {
      const infoToken = trimmed.slice(3).trimStart().split(/[ \t]/, 1)[0] ?? "";
      if (unescapeMarkdownToken(infoToken) === CODEX_TOOL_CALLS_FENCE) bodyStart = index + 1;
    } else if (unescapeMarkdownToken(trimmed) === CODEX_TOOL_CALLS_FENCE) {
      // Detached label: the marker survived as text, so the JSON must sit in the next bare fence.
      let probe = index + 1;
      while (probe < lines.length && lines[probe]!.trim() === "") probe += 1;
      if (probe < lines.length && lines[probe]!.trim() === "```") {
        // The paragraph separator before the label belonged to the block being removed.
        while (kept.length > 0 && kept.at(-1)!.trim() === "") kept.pop();
        bodyStart = probe + 1;
      }
    }
    if (bodyStart === undefined) {
      kept.push(lines[index]!);
      index += 1;
      continue;
    }
    const startLine = index;
    const body: string[] = [];
    index = bodyStart;
    let closed = false;
    while (index < lines.length) {
      if (lines[index]!.trim() === "```") {
        closed = true;
        index += 1;
        break;
      }
      body.push(lines[index]!);
      index += 1;
    }
    if (!closed) unclosed = true;
    blocks.push({ body: body.join("\n"), startLine, endLine: index });
  }
  return { visibleText: kept.join("\n"), blocks, unclosed };
}

function blockCalls(body: string): { calls: unknown[] } | { invalid: string; category: "block_json" | "block_shape" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return { invalid: `block is not valid JSON (${error instanceof Error ? error.message : String(error)})`, category: "block_json" };
  }
  if (Array.isArray(parsed)) return { calls: parsed };
  if (isObj(parsed) && Array.isArray(parsed.calls)) return { calls: parsed.calls };
  return { invalid: 'block must be a JSON object of the shape {"calls":[…]} (or a JSON array of calls)', category: "block_shape" };
}

function issueFor(
  callIndex: number | null,
  problem: string,
  wireName?: string,
  category: NativeToolCallIssue["category"] = "call_shape",
  schemaKeywords?: string[],
): NativeToolCallIssue {
  return { callIndex, ...(wireName !== undefined ? { wireName } : {}), problem, category,
    ...(schemaKeywords ? { schemaKeywords } : {}) };
}

function compactAjvErrors(validate: ValidateFunction): string {
  const errors = validate.errors ?? [];
  return errors
    .slice(0, 5)
    .map(error => {
      const path = error.instancePath || "(root)";
      return `${path}: ${error.message ?? "invalid value"}`;
    })
    .join("; ");
}

/**
 * Parse and validate the ```codex_tool_calls blocks of one completed ChatGPT reply against the tools the
 * current Codex round actually declared. Unknown names, malformed JSON, and schema violations are
 * returned as issues (never thrown) so the caller can feed them back for a corrected block
 * instead of failing the turn.
 */
export function parseNativeToolCallReply(text: string, tools: readonly CodexTool[]): ParsedNativeToolCallReply {
  const index = buildToolIndex(tools);
  const { visibleText, blocks } = splitNativeToolCallBlocks(text);
  const calls: NativeToolCall[] = [];
  const issues: NativeToolCallIssue[] = [];
  // Markdown allows EOF to close a fence. Only completed replies reach this parser;
  // JSON parsing and the declared tool contract still reject truncated or invalid calls.
  for (const block of blocks) {
    const decoded = blockCalls(block.body);
    if ("invalid" in decoded) {
      issues.push(issueFor(null, decoded.invalid, undefined, decoded.category));
      continue;
    }
    for (const raw of decoded.calls) {
      const callIndex = calls.length + issues.filter(issue => issue.callIndex !== null).length;
      if (!isObj(raw)) {
        issues.push(issueFor(callIndex, "call entry must be a JSON object"));
        continue;
      }
      const name = raw.name;
      if (typeof name !== "string" || name.length === 0) {
        issues.push(issueFor(callIndex, 'call entry is missing the required string field "name"', undefined, "tool_name"));
        continue;
      }
      const namespace = raw.namespace;
      if (namespace !== undefined && (typeof namespace !== "string" || namespace.length === 0)) {
        issues.push(issueFor(callIndex, "namespace must be a nonempty string when supplied", name, "tool_namespace"));
        continue;
      }
      const entry = index.get(toolIdentityKey(namespace as string | undefined, name));
      if (!entry) {
        issues.push(issueFor(callIndex, `unknown tool ${JSON.stringify(name)} — use an exact declared tool name`, name,
          tools.some(tool => tool.name === name) ? "tool_namespace" : "tool_name"));
        continue;
      }
      const expectedType = entry.tool.toolSearch ? "tool_search_call" : entry.tool.freeform ? "custom_tool_call" : "function_call";
      if (raw.type !== undefined && raw.type !== expectedType) {
        issues.push(issueFor(callIndex, `tool requires type ${expectedType}`, name, "tool_kind"));
        continue;
      }
      // Untyped, unnamespaced legacy calls remain readable; never infer a namespace from a name.
      const args = entry.tool.freeform && typeof raw.input === "string"
        ? { input: raw.input } : raw.arguments;
      const fields = entry.tool.freeform && raw.input !== undefined
        ? ["type", "name", "namespace", "input"] : ["type", "name", "namespace", "arguments"];
      const unexpectedKeys = Object.keys(raw).filter(key => !fields.includes(key));
      if (unexpectedKeys.length) {
        issues.push(issueFor(callIndex, `unsupported field(s): ${unexpectedKeys.join(", ")}`, name, "call_fields"));
        continue;
      }
      if (!isObj(args)) {
        issues.push(issueFor(callIndex, entry.tool.freeform ? "custom tool requires raw string input" : '"arguments" must be a JSON object', name, "arguments_shape"));
        continue;
      }
      if (entry.tool.freeform && raw.type !== undefined && typeof raw.input !== "string") {
        issues.push(issueFor(callIndex, "custom_tool_call requires input, not a synthetic arguments wrapper", name, "arguments_shape"));
        continue;
      }
      const validate = entry.validate;
      if (validate && !validate(args)) {
        issues.push(issueFor(callIndex, `arguments for ${name} do not match its schema: ${compactAjvErrors(validate)}`, name,
          "arguments_schema", (validate.errors ?? []).map(error => error.keyword)));
        continue;
      }
      calls.push({
        wireName: entry.wireName,
        name: entry.tool.name,
        ...(entry.tool.namespace ? { namespace: entry.tool.namespace } : {}),
        freeform: entry.tool.freeform === true,
        toolSearch: entry.tool.toolSearch === true,
        arguments: structuredClone(args),
      });
    }
  }
  if (blocks.length > 0 && calls.length === 0 && issues.length === 0) {
    issues.push(issueFor(null, "tool-call block contained no calls — omit the block entirely when no tool is needed", undefined, "empty_block"));
  }
  return { calls, issues, visibleText: visibleText.trim(), blockCount: blocks.length };
}

/**
 * Corrective feedback for a reply whose blocks failed parsing or validation. Sent back to the
 * same ChatGPT conversation so the model can re-issue one corrected block; nothing here reaches
 * Codex, keeping malformed text out of the Responses history entirely. The failing block text is
 * quoted because the retry may run in a fresh browser conversation that never saw the attempt.
 */
export function formatNativeToolCallCorrection(
  issues: readonly NativeToolCallIssue[],
  previousBlockText?: string,
): string {
  const lines = issues.map(issue => {
    const where = issue.callIndex === null
      ? "block"
      : `call ${issue.callIndex + 1}${issue.wireName ? ` (${issue.wireName})` : ""}`;
    return `- ${where}: ${issue.problem}`;
  });
  return [
    "<codex_tool_call_correction>",
    "Your previous tool-call block could not be used:",
    ...(previousBlockText !== undefined && previousBlockText.length > 0
      ? ["<previous_tool_call_block>", previousBlockText, "</previous_tool_call_block>"]
      : []),
    ...lines,
    "Re-issue exactly one corrected ```codex_tool_calls block now, or answer normally without any block when no tool is needed.",
    "Use {\"calls\":[…]} with the original type, namespace and name. Function calls use arguments; custom calls use raw input. Fix only the listed errors.",
    "</codex_tool_call_correction>",
  ].join("\n");
}

/**
 * Transport-contract lines describing how ChatGPT must express tool-call decisions. Appended to
 * the native-tools prompt (prompt.ts wiring lives in the mode integration).
 */
export function nativeToolCallContractLines(): string[] {
  return [
    "Codex executes the supplied tools under its own sandbox and approvals. This page only returns call decisions.",
    'Return calls in one fenced codex_tool_calls JSON block: {"calls":[{"type":"function_call","namespace":"<original namespace, if any>","name":"<original name>","arguments":{...}}]}.',
    "The call block encodes tool calls only. Preserve any user-facing progress update or tool preamble required by the active Codex task as ordinary reply text before the block; the block does not replace that message. Keep private reasoning private, and never invent an execution result.",
    'For custom tools use {"type":"custom_tool_call","namespace":"<original namespace, if any>","name":"<original name>","input":"<raw source>"}. For tool_search use type tool_search_call with name tool_search and arguments.',
    "Use the exact declared namespace, name and kind. A namespace group supplies its namespace to its children. Omit namespace only for a tool declared outside a namespace. Never combine namespace and name into an alias.",
    "The catalog describes top-level Codex tools. It does not declare members of exec's tools object. Inside exec use only the nested exports and globals declared by its original description or discovered from its runtime ALL_TOOLS; top-level tools do not imply nested exports.",
    "A requested capability may be deferred or available only through the declared exec gateway. If it is absent from the initial top-level catalog, use the supplied tool_search or exec discovery mechanism, if declared, before concluding it is unavailable. Discovery is itself an outer Codex call returned in a codex_tool_calls block; never invent tool names or schemas, and keep the original task permissions.",
    "Return custom exec source unchanged in input. Codex executes it; do not run it using this page's own tools or connector.",
    "After returning a call block, wait for the matching Codex tool output before reporting its outcome. When no call is needed, return the requested answer without a call block.",
    "JSON escaping is transport encoding only. Preserve raw custom input after JSON decoding, including newlines and backslashes.",
  ];
}
