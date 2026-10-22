import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { VERSION } from "../../../version";
import { diagnosticEvent, diagnosticReference } from "../../../diagnostics";
import type { ChatGptTurnEnvironment } from "../prompt/environment";
import { originalToolSpecification } from "../prompt/source-context";
import { callTurnBroker } from "./turn-broker";
import { safeVisibleTools } from "./mcp-tool-policy";
import { execGateway } from "./mcp-gateway";
import { CODEX_COMPACTION_CONTROL_WIRE_NAME } from "./native-compaction-control";
import { type HandoffReceipt, type ToolBatchHandoff } from "./tool-batch-handoff";
import { HandoffValidationError } from "./handoff-validation";
import { handoffContract, HANDOFF_ROUTING_INSTRUCTIONS } from "./handoff-contract";
import { searchToolInventory } from "./tool-inventory-search";
import { HANDOFF_V2, handoffProtocol, handoffSubmissionTools, type HandoffProtocol } from "../../../../launcher/shared/handoff-protocol.cjs";

export const HANDOFF_TOOL_NAMES = new Set([
  "codex_tool_inventory", "codex_submit_tool_call", "codex_submit_tool_batch", "codex_yield_turn", "codex_finish_turn", "codex_turn_start",
  "codex_submit_tool_call_v2", "codex_submit_tool_batch_v2",
]);

function result(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

/** Explicit protocol endpoint. None of these tools executes a Codex tool inline. */
export function createHandoffMcpServer(options: { brokerSocketPath: string; contract: "native" | "safe"; protocol?: HandoffProtocol }): McpServer {
  const protocol = handoffProtocol(options.protocol);
  const submissionTools = handoffSubmissionTools(protocol);
  const submissionIdentity = protocol === HANDOFF_V2
    ? "Do not supply submission_id. The host derives it; identical calls in this round reuse the receipt. If these v2 tools are absent, refresh the connector catalog; never use a v1 submission tool or switch protocol in this round."
    : "Identical retries reuse the caller's stable submission_id.";
  const { contract, brokerSocketPath } = options;
  const reference = contract === "safe" ? "request_id" : "turn_token";
  const tokenSchema = { [reference]: z.string().min(20).max(256) };
  const server = new McpServer({ name: `codex-${contract === "safe" ? "safe" : "native"}-handoff${protocol === HANDOFF_V2 ? "-v2" : ""}`, version: VERSION }, {
    instructions: handoffContract(reference, protocol).join(" "),
  });
  type Claim = { bindingId: string; traceId?: string; environment: ChatGptTurnEnvironment;
    callControls: ToolBatchHandoff["callControls"]; roundState: ToolBatchHandoff["roundState"] };
  const claimed = async <T>(input: Record<string, unknown>, signal: AbortSignal, action: (claim: Claim, activityId: string) => Promise<T> | T): Promise<T> => {
    const token = input[reference];
    if (typeof token !== "string") throw new Error(`${reference} is required`);
    const activityId = `activity_${randomBytes(18).toString("base64url")}`;
    try {
      const claim = await callTurnBroker<Claim>(brokerSocketPath, { method: "claim", token, contract, protocol, activityId }, 5_000, signal);
      return await action(claim, activityId);
    } finally {
      // Also retire an ambiguous claim. Never cancel cleanup with the caller's signal.
      let failure: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await callTurnBroker(brokerSocketPath, { method: "activity_complete", token, activityId }, 5_000); failure = undefined; break; }
        catch (error) { failure = error; }
      }
      if (failure) throw failure;
    }
  };
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  if (contract === "native") server.registerTool("codex_tool_call", {
    title: "Submit a context checkpoint",
    description: "Reserved context-compaction control only. Normal tools use the inventory's submission_tool and then end the Web response.",
    inputSchema: { turn_token: z.string().min(20).max(256), wire_name: z.literal(CODEX_COMPACTION_CONTROL_WIRE_NAME),
      arguments: z.strictObject({ handoff_id: z.string().min(1), summary: z.string() }) }, annotations,
  }, async (input, extra) => {
    await callTurnBroker(brokerSocketPath, { method: "submit_compaction_handoff", token: input.turn_token,
      handoffId: input.arguments.handoff_id, summary: input.arguments.summary }, 5_000, extra.signal);
    return result({ submitted: true });
  });
  if (contract === "safe") server.registerTool("codex_turn_start", {
    title: "Connect the manually sent Codex round", inputSchema: tokenSchema, annotations,
    description: "Connect only the current request_id. Each round requires the user's Sent confirmation.",
  }, async (input, extra) => result(await callTurnBroker(brokerSocketPath, {
    method: "safe_start", token: input[reference], protocol,
  }, 5_000, extra.signal)));

  server.registerTool("codex_tool_inventory", {
    title: "Search loaded tools and find discovery routes",
    inputSchema: { ...tokenSchema, query: z.string().max(500).optional(),
      offset: z.number().int().min(0).max(100_000).default(0),
      limit: z.number().int().min(1).max(50).default(20), include_schema: z.boolean().default(true) },
    description: "Search currently loaded Codex tools by name, namespace or description. Space/comma-separated keywords match any term; exact tool identifiers rank first. This is NOT the complete capability list: a miss can require the advertised discovery_tools. Submit discovery as a separate Codex call, then use the returned declarations next round. Read-only; this lookup does not execute tools or discover them implicitly.",
    annotations: { ...annotations, readOnlyHint: true },
  }, async (input, extra) => claimed(input, extra.signal, claim => {
    const visible = safeVisibleTools(claim.environment, contract);
    const needle = input.query?.trim().toLowerCase();
    const matches = searchToolInventory(visible, input.query);
    // Counts distinguish a query miss from an absent capability without persisting
    // search text, tool schemas, task content or transport credentials.
    const queryTerms = new Set(needle?.split(/[\s,;]+/).filter(Boolean) ?? []);
    diagnosticEvent("info", "tool.inventory_queried", {
      traceId: claim.traceId, totalLoaded: visible.length, matchedLoaded: matches.length,
      queryChars: needle?.length ?? 0, queryTermCount: queryTerms.size,
      identifierTermMatches: visible.filter(tool => queryTerms.has(tool.name.toLowerCase())
        || queryTerms.has(`${tool.namespace ?? ""}.${tool.name}`.toLowerCase())).length,
      offset: input.offset, limit: input.limit, returnedCount: matches.slice(input.offset, input.offset + input.limit).length,
      discoveryCount: visible.filter(tool => tool.toolSearch).length,
    });
    return result({ protocol, ...claim.roundState,
    call_controls: claim.callControls,
    submission_tool: claim.callControls.max_calls_per_batch === 1 ? submissionTools.single : submissionTools.batch,
    submission_identity: protocol === HANDOFF_V2 ? "host" : "caller",
    submission_field: claim.callControls.max_calls_per_batch === 1 ? "call" : "calls",
    catalog_scope: "currently_loaded_tools",
    discovery_tools: visible.filter(tool => tool.toolSearch).map(tool => ({
      scope: "top_level", name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}),
      kind: "tool_search", description: tool.description, parameters: tool.parameters,
    })),
    discovery_instructions: "A tool absent from this loaded catalog is not necessarily unavailable. Search loaded tools with query first; when absent and discovery_tools exists, submit its declared discovery call before concluding the capability is missing. Only a successfully submitted discovery call ends this Web round; real tool_search_output and new declarations arrive next round. This inventory lookup never ends the round. Do not combine discovery with a dependent call.",
    total_loaded: visible.length, matched_loaded: matches.length,
    next_offset: input.offset + input.limit < matches.length ? input.offset + input.limit : null,
    routing_instructions: HANDOFF_ROUTING_INSTRUCTIONS,
    // Keep one schema copy and inherited identity. Original unknown declaration fields
    // remain alongside it; tool_search receives its normalized invocation parameters.
    tools: matches.slice(input.offset, input.offset + input.limit).map(tool => {
      const { parameters: _parameters, format, ...specification } = originalToolSpecification(tool);
      return { ...specification,
      scope: "top_level", name: tool.name,
      ...(tool.namespace ? { namespace: tool.namespace } : {}),
      kind: tool.freeform ? "custom" : tool.toolSearch ? "tool_search" : "function",
      description: tool.description,
      ...(input.include_schema ? !tool.freeform ? { parameters: tool.parameters } : format ? { format } : {} : {}),
    }; }),
    nested_gateway: execGateway(claim.environment) ? {
      discovery: { scope: "catalog", name: "$catalog", arguments: { query: "", offset: 0, limit: 50 } },
      instructions: "Submit the catalog request using submission_tool and submission_field, then end the Web response. Codex returns the real ALL_TOOLS catalog in the next request. Invoke exact discovered exports with scope exec, name and arguments or input. Preserve images and structured outputs. Do not submit a catalog and dependent call in the same batch.",
    } : null,
  }); }));

  const callSchema = z.strictObject({ name: z.string().min(1), namespace: z.string().min(1).optional(),
    scope: z.enum(["top_level", "exec", "catalog"]).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(), input: z.string().optional(),
  });
  const submissionSchema: Record<string, z.ZodType> = { ...tokenSchema };
  if (protocol !== HANDOFF_V2) submissionSchema.submission_id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
  const submit = (input: Record<string, unknown> & { calls: z.infer<typeof callSchema>[] }, signal: AbortSignal) =>
    claimed(input, signal, async (claim, activityId) => {
    try {
      const receipt = await callTurnBroker<HandoffReceipt>(brokerSocketPath, {
        method: "handoff_submit", bindingId: claim.bindingId, protocol, activityId,
        ...(protocol !== HANDOFF_V2 ? { submissionId: input.submission_id as string } : {}), calls: input.calls, sealOnSubmit: true,
      }, 5_000, signal);
      if (!receipt.sealed) throw new Error("Restart the Web2Harness runtime to enable atomic handoff submission");
      diagnosticEvent("info", "tool.handoff_response_prepared", { traceId: claim.traceId,
        roundRef: diagnosticReference(receipt.round_id), count: receipt.call_ids.length,
        outcome: "accepted_not_executed" });
      return result({ ...receipt });
    } catch (error) {
      if (!(error instanceof HandoffValidationError)) throw error;
      return { ...result({ accepted: false, execution_state: "not_executed", code: error.code,
        message: error.message, call_controls: claim.callControls,
        submission_tool: claim.callControls.max_calls_per_batch === 1 ? submissionTools.single : submissionTools.batch }), isError: true };
    }
  });
  server.registerTool(submissionTools.single, {
    title: "Submit one Codex call and end this Web round", annotations,
    description: `Use when inventory submission_tool is ${submissionTools.single}, including parallel_tool_calls=false. Pass exactly one call object with the declared name, separate namespace and scope; custom tools use input, functions use arguments. Validates, registers and seals atomically WITHOUT executing. After success END this Web response immediately. Codex executes after physical completion and returns the real result in the next request. No yield or polling is needed. A validation error means not accepted; inspect the error without changing permissions. ${submissionIdentity}`,
    inputSchema: z.strictObject({ ...submissionSchema, call: callSchema }),
  }, (input, extra) => submit({ ...input, calls: [input.call] }, extra.signal));
  server.registerTool(submissionTools.batch, {
    title: "Submit a parallel Codex batch and end this Web round", annotations,
    description: `Use only when inventory submission_tool is ${submissionTools.batch}. If it selects ${submissionTools.single}, use that single-call interface instead. Pass independent declared calls within call_controls. Custom tools use input, functions use arguments. Validation, registration and sealing are atomic, but execution waits for physical Web completion. After success END this response. A validation error means not accepted; inspect the error without changing permissions. ${submissionIdentity}`,
    inputSchema: z.strictObject({ ...submissionSchema, calls: z.array(callSchema).min(1).max(32) }),
  }, (input, extra) => submit(input, extra.signal));

  server.registerTool("codex_yield_turn", {
    title: "Acknowledge a sealed batch (compatibility)", annotations,
    description: "Compatibility acknowledgement for an accepted submission; repeating it is idempotent. Both submission tools already seal atomically, so this extra call is not required. End this response. This is NOT task completion or proof of tool execution. Actual results arrive in a new Codex request.",
    inputSchema: { ...tokenSchema, batch_id: z.string().min(1).max(128) },
  }, async (input, extra) => claimed(input, extra.signal, async (claim, activityId) => result({
    ...await callTurnBroker<Record<string, unknown>>(brokerSocketPath, {
      method: "handoff_yield", bindingId: claim.bindingId, protocol, activityId, batchId: input.batch_id,
    }, 5_000, extra.signal),
  })));

  server.registerTool("codex_finish_turn", {
    title: "Submit a reply without tool calls", annotations,
    description: "Return this round's answer without a tool batch. Required for Zero Risk because the launcher does not read the page; optional in Automatic, where an ordinary completed reply is accepted. Do not call after submitting tools. A child ID or running command is not its result: use the declared wait/result tools when the task requires them. No pending tool batch may remain.",
    inputSchema: { ...tokenSchema, final_answer: z.string().min(1).max(5_000_000) },
  }, async (input, extra) => claimed(input, extra.signal, async (claim, activityId) => result({
    ...await callTurnBroker<Record<string, unknown>>(brokerSocketPath, {
      method: "handoff_finish", bindingId: claim.bindingId, protocol, activityId, finalAnswer: input.final_answer,
    }, 5_000, extra.signal),
  })));
  return server;
}
