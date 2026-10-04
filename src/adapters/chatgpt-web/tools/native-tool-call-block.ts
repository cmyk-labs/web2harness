import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { namespacedToolName, type CodexTool } from "../../../types";

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
  /** Exact flattened wire name the model used (namespace__name for MCP tools). */
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
    const wireName = namespacedToolName(tool.namespace, tool.name);
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
 * Each matched block ends at the next bare closing fence.
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

function blockCalls(body: string): { calls: unknown[] } | { invalid: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return { invalid: `block is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (Array.isArray(parsed)) return { calls: parsed };
  if (isObj(parsed) && Array.isArray(parsed.calls)) return { calls: parsed.calls };
  return { invalid: 'block must be a JSON object of the shape {"calls":[…]} (or a JSON array of calls)' };
}

function issueFor(
  callIndex: number | null,
  problem: string,
  wireName?: string,
): NativeToolCallIssue {
  return { callIndex, ...(wireName !== undefined ? { wireName } : {}), problem };
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
 * Parse and validate the ```codex_tool_calls blocks of one ChatGPT reply against the tools the
 * current Codex round actually declared. Unknown names, malformed JSON, and schema violations are
 * returned as issues (never thrown) so the caller can feed them back for a corrected block
 * instead of failing the turn.
 */
export function parseNativeToolCallReply(text: string, tools: readonly CodexTool[]): ParsedNativeToolCallReply {
  const index = buildToolIndex(tools);
  const { visibleText, blocks, unclosed } = splitNativeToolCallBlocks(text);
  const calls: NativeToolCall[] = [];
  const issues: NativeToolCallIssue[] = [];
  if (unclosed) {
    issues.push(issueFor(null, "a tool-call block was opened but never closed with ```"));
  }
  for (const block of blocks) {
    const decoded = blockCalls(block.body);
    if ("invalid" in decoded) {
      issues.push(issueFor(null, decoded.invalid));
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
        issues.push(issueFor(callIndex, 'call entry is missing the required string field "name"'));
        continue;
      }
      const entry = index.get(name);
      if (!entry) {
        issues.push(issueFor(callIndex, `unknown tool ${JSON.stringify(name)} — use an exact declared tool name`, name));
        continue;
      }
      if (raw.arguments === undefined) {
        issues.push(issueFor(callIndex, `call to ${name} is missing "arguments" (use {} when there are none)`, name));
        continue;
      }
      if (!isObj(raw.arguments)) {
        issues.push(issueFor(callIndex, `"arguments" for ${name} must be a JSON object`, name));
        continue;
      }
      const unexpectedKeys = Object.keys(raw).filter(key => key !== "name" && key !== "arguments");
      if (unexpectedKeys.length > 0) {
        issues.push(issueFor(
          callIndex,
          `call to ${name} has unsupported field(s) ${unexpectedKeys.map(key => JSON.stringify(key)).join(", ")} — only "name" and "arguments" are allowed`,
          name,
        ));
        continue;
      }
      const validate = entry.validate;
      if (validate && !validate(raw.arguments)) {
        issues.push(issueFor(callIndex, `arguments for ${name} do not match its schema: ${compactAjvErrors(validate)}`, name));
        continue;
      }
      calls.push({
        wireName: entry.wireName,
        name: entry.tool.name,
        ...(entry.tool.namespace ? { namespace: entry.tool.namespace } : {}),
        freeform: entry.tool.freeform === true,
        toolSearch: entry.tool.toolSearch === true,
        arguments: structuredClone(raw.arguments),
      });
    }
  }
  if (blocks.length > 0 && calls.length === 0 && issues.length === 0) {
    issues.push(issueFor(null, "tool-call block contained no calls — omit the block entirely when no tool is needed"));
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
    "Keep the same JSON shape {\"calls\":[{\"name\":…,\"arguments\":…}]}, use only declared tool names, and fix only what is listed above.",
    "</codex_tool_call_correction>",
  ].join("\n");
}

/**
 * Transport-contract lines describing how ChatGPT must express tool-call decisions. Appended to
 * the native-tools prompt (prompt.ts wiring lives in the mode integration).
 */
export function nativeToolCallContractLines(): string[] {
  return [
    `This task runs on Codex native tools. You decide tool calls; a local Codex agent executes them. You never execute anything yourself.`,
    `When the latest request needs a local effect or fresh local evidence, reply with exactly one \`\`\`${CODEX_TOOL_CALLS_FENCE} fenced block: a single JSON object {"calls":[{"name":"<tool>","arguments":{…}},…]}.`,
    `Use each tool's EXACT declared name from the supplied tool catalog. Freeform tools (for example apply_patch) take arguments {"input":"<raw tool body>"}.`,
    `The block must contain valid JSON only: no comments, no trailing commas, no prose inside the fence. When no tool is needed, answer normally without any block.`,
    `Text you write outside the block reaches the Codex user; keep it brief before a tool call and write the complete final answer only after the last tool result has settled.`,
    `After tool results appear in the context, continue the task: either another block with the next calls, or the final answer with no block.`,
  ];
}
