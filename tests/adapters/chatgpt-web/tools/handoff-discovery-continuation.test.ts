import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defaultBrokerEndpoint } from "../../../../src/config";
import { toolIdentityKey, type AdapterEvent, type CodexParsedRequest, type CodexSourceContext } from "../../../../src/types";
import { parseRequest } from "../../../../src/responses/parser";
import { buildResponseJSON } from "../../../../src/responses/json";
import { CHATGPT_WEB_MODEL_ID } from "../../../../src/adapters/chatgpt-web/model";
import { compileChatGptWebPrompt } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import {
  chatGptConversationKey, rememberRetainedConversationSource, retainedConversationResumeRequest,
} from "../../../../src/adapters/chatgpt-web/conversation/conversation-key";
import { TurnBroker, type BrokerToolRequest } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";
import { createHandoffMcpServer } from "../../../../src/adapters/chatgpt-web/tools/mcp-handoff-server";
import { HandoffDeliveryJournal } from "../../../../src/adapters/chatgpt-web/tools/handoff-delivery-journal";
import type { HandoffReceipt } from "../../../../src/adapters/chatgpt-web/tools/tool-batch-handoff";

const capabilities = { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true };
const discoverySpecification = { type: "tool_search", execution: "client" };
const spawnSpecification = {
  type: "function", name: "spawn_agent", description: "Delegate a bounded task to a child agent.", strict: true,
  parameters: {
    type: "object",
    properties: {
      message: { type: "string" }, agent_type: { type: "string", enum: ["default", "explorer"] },
      fork_context: { type: "boolean" },
    },
    required: ["message", "agent_type", "fork_context"], additionalProperties: false,
  },
};
const discoveredNamespace = {
  type: "namespace", name: "multi_agent_v1", description: "Task-bound child agents retain the parent's permissions.",
  tools: [spawnSpecification],
};
const spawnArguments = {
  message: 'Inspect the "fixture" context only.\nDo not create descendants.', agent_type: "explorer", fork_context: false,
};

function fixture() {
  const parent = resolve(tmpdir());
  // Leave room for runtime/turn-broker.sock under macOS's long TMPDIR.
  const prefix = "w2h-disc-";
  const root = mkdtempSync(join(parent, prefix));
  return { root, cleanup() {
    if (resolve(root) !== root || dirname(root) !== parent || !basename(root).startsWith(prefix)) {
      throw new Error("Fixture ownership mismatch");
    }
    rmSync(root, { recursive: true, force: true });
  } };
}

function contextEnvelope(parsed: CodexParsedRequest, token: string, manual: boolean) {
  const compiled = compileChatGptWebPrompt(parsed, capabilities, token, {
    toolBatchHandoff: true, ...(manual ? { manualControl: true as const } : {}),
  });
  const json = compiled.contextFile?.text
    ?? compiled.text.split("<codex_context_json>\n")[1]?.split("\n</codex_context_json>")[0];
  expect(json).toBeString();
  return JSON.parse(json!) as CodexSourceContext & { transport_context: { mode: string; prefix_items?: number; prefix_sha256?: string } };
}

// Supply the encoder's public mapping inputs from the parsed registry, as the Responses
// server does. These are emitted call records only: there is deliberately no executor.
function canonicalResponse(parsed: CodexParsedRequest, requests: BrokerToolRequest[]) {
  const events: AdapterEvent[] = requests.flatMap(request => [
    { type: "tool_call_start" as const, id: request.callId, name: request.wireName },
    { type: "tool_call_delta" as const, arguments: JSON.stringify(request.arguments) },
    { type: "tool_call_end" as const },
  ]);
  events.push({ type: "done", endTurn: false, stopReason: "tool_use" });
  const tools = parsed.context.tools ?? [];
  return buildResponseJSON(events, parsed.modelId, {
    toolNsMap: new Map(tools.map(tool => [toolIdentityKey(tool.namespace, tool.name), { namespace: tool.namespace ?? "", name: tool.name }])),
    toolSearchToolNames: new Set(tools.filter(tool => tool.toolSearch).map(tool => toolIdentityKey(tool.namespace, tool.name))),
  });
}

function settleAndJournal(broker: TurnBroker, token: string, receipt: HandoffReceipt, journal: HandoffDeliveryJournal) {
  const path = join(journal.directory, `${receipt.round_id}.json`);
  let writes = 0;
  const persist = (record: Parameters<HandoffDeliveryJournal["record"]>[0]) => {
    journal.record(record);
    writes++;
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
  };
  expect(existsSync(path)).toBeFalse();
  expect(() => broker.takeHandoffBatch(token, persist)).toThrow();
  expect(writes).toBe(0);
  expect(() => broker.confirmHandoffPhysicalSettlement(token)).toThrow();
  const revision = broker.beginCompletionFence(token);
    if (!("revision" in revision)) throw new Error("Expected a ready fence");
  expect(revision).toBeDefined();
  expect(broker.commitCompletionFence(token, revision.revision)).toMatchObject({ state: "committed" });
  expect(() => broker.takeHandoffBatch(token, persist)).toThrow();
  expect(writes).toBe(0);
  expect(existsSync(path)).toBeFalse();

  // This owner acknowledgement simulates physical settlement; it is not browser evidence.
  broker.confirmHandoffPhysicalSettlement(token);
  expect(() => broker.takeHandoffBatch(token, () => { throw new Error("fixture journal unavailable"); }))
    .toThrow("fixture journal unavailable");
  expect(existsSync(path)).toBeFalse();
  const requests = broker.takeHandoffBatch(token, persist);
  expect(writes).toBe(1);
  expect(requests.map(request => request.callId)).toEqual(receipt.call_ids);
  const stored = readFileSync(path, "utf8");
  expect(JSON.parse(stored)).toMatchObject({ roundId: receipt.round_id, batchId: receipt.batch_id,
    callIds: receipt.call_ids, state: "delivery_prepared" });
  expect(stored).not.toContain(token);
  expect(stored).not.toContain(JSON.stringify(spawnArguments));
  expect(broker.takeHandoffBatch(token, persist)).toEqual(requests);
  expect(writes).toBe(1);
  return requests;
}

// Real parser, MCP handlers, broker and encoder; synthetic discovery output only.
// Never launch Codex, a browser, or the spawn_agent whose call is being transported.
for (const manual of [false, true]) test(`two-round ${manual ? "manual" : "automatic"} discovery retains and submits a namespaced tool without exec`, async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  const server = createHandoffMcpServer({ brokerSocketPath: broker.socketPath, contract: manual ? "safe" : "native" });
  const client = new Client({ name: "handoff-discovery-continuation-fixture", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const journal = new HandoffDeliveryJournal(join(f.root, "receipts"));
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const scope = `discovery-continuation-${randomUUID()}`;
    const body = {
      model: CHATGPT_WEB_MODEL_ID, instructions: "Keep the task's permissions and original tool identities.",
      input: [{ role: "developer", content: "A child must not create descendants." }, { role: "user", content: "Discover a tool for one bounded child task." }],
      // Reproduce a 25-entry inventory after discovery without declaring any exec gateway.
      tools: [discoverySpecification, ...Array.from({ length: 23 }, (_, index) => ({
        type: "function", name: `fixture_read_${index}`, description: "Uncalled fixture catalog entry.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }))],
      parallel_tool_calls: false, tool_choice: "auto",
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: scope, turn_id: "fixture-turn" }) },
    };
    const first = parseRequest(body);
    const register = async (parsed: CodexParsedRequest) => {
      const nonce = `fixture_surface_${randomUUID()}`;
      const token = await broker.registerHandoff({ cwd: f.root, roots: [f.root], writableRoots: [],
        sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: parsed.context.tools ?? [],
      }, { ...(manual ? { surfaceNonce: nonce } : {}),
        policy: { toolChoice: parsed.options.toolChoice, parallelToolCalls: parsed.options.parallelToolCalls }, ttlMs: 30_000 });
      const reference = manual ? { request_id: token } : { turn_token: token };
      if (manual) {
        expect((await client.callTool({ name: "codex_turn_start", arguments: reference })).isError).not.toBeTrue();
        broker.confirmSafeTurnSent(token, nonce);
      }
      return { token, reference };
    };
    const firstRound = await register(first);
    const key = chatGptConversationKey(first, scope)!;
    expect(key).toBeString();
    expect(contextEnvelope(first, firstRound.token, manual)).toMatchObject({ transport_context: { mode: "complete" },
      instructions: body.instructions, input: body.input, tools: body.tools });
    const initialInventory = await client.callTool({ name: "codex_tool_inventory", arguments: { ...firstRound.reference, limit: 50 } });
    expect(initialInventory.isError).not.toBeTrue();
    expect(initialInventory.structuredContent).toMatchObject({ nested_gateway: null,
      submission_tool: "codex_submit_tool_call", submission_field: "call",
      discovery_tools: [{ scope: "top_level", name: "tool_search", kind: "tool_search" }],
      call_controls: { parallel_tool_calls: false, max_calls_per_batch: 1 } });
    expect(first.context.tools).toHaveLength(24);
    expect(first.context.tools?.some(tool => tool.name === "spawn_agent" || tool.name === "exec")).toBeFalse();
    const unloaded = await client.callTool({ name: "codex_tool_inventory", arguments: {
      ...firstRound.reference, query: "spawn_agent",
    } });
    expect(unloaded.structuredContent).toMatchObject({ catalog_scope: "currently_loaded_tools",
      total_loaded: 24, matched_loaded: 0, tools: [], next_offset: null,
      discovery_tools: [{ name: "tool_search", parameters: expect.any(Object) }] });
    const query = { query: "multi_agent_v1 spawn_agent", limit: 1 };
    const firstSubmission = initialInventory.structuredContent as { submission_tool: string; submission_field: string };
    const discovery = await client.callTool({ name: firstSubmission.submission_tool, arguments: { ...firstRound.reference,
      submission_id: "discover_child", [firstSubmission.submission_field]: { scope: "top_level", name: "tool_search", arguments: query },
    } });
    expect(discovery.isError).not.toBeTrue();
    const discoveryReceipt = discovery.structuredContent as unknown as HandoffReceipt;
    expect(discoveryReceipt).toMatchObject({ execution_state: "not_executed", sealed: true });
    expect(await broker.waitForHandoffIntent(firstRound.token)).toEqual({ kind: "tools", batchId: discoveryReceipt.batch_id });
    const discoveryRequests = settleAndJournal(broker, firstRound.token, discoveryReceipt, journal);
    const discoveryResponse = canonicalResponse(first, discoveryRequests);
    expect(discoveryResponse).toMatchObject({ status: "completed", end_turn: false, output: [
      { type: "tool_search_call", call_id: discoveryReceipt.call_ids[0], execution: "client", arguments: query, status: "completed" },
    ] });
    rememberRetainedConversationSource(first, scope, key);
    broker.revoke(firstRound.token);

    const discoveryOutput = { type: "tool_search_output", call_id: discoveryReceipt.call_ids[0], status: "completed",
      tools: [discoveredNamespace] };
    const suffix = [...discoveryResponse.output as unknown[], discoveryOutput];
    const next = parseRequest({ ...body, input: [...body.input, ...suffix] });
    expect(next.context.source?.tools).toEqual(body.tools); // Loaded declarations arrive only in input.
    expect(next.context.tools).toHaveLength(25);
    expect(next.context.tools?.find(tool => tool.name === "spawn_agent")).toMatchObject({ name: "spawn_agent",
      namespace: "multi_agent_v1", specification: spawnSpecification, parameters: spawnSpecification.parameters, strict: true });
    expect(next.context.messages).toContainEqual(expect.objectContaining({ role: "toolResult", toolName: "tool_search",
      toolCallId: discoveryReceipt.call_ids[0], isError: false, content: JSON.stringify(discoveryOutput) }));
    expect(chatGptConversationKey(next, scope)).toBe(key);
    const resume = retainedConversationResumeRequest(next, key)!;
    expect(resume).not.toBe(next);
    expect(resume.context.source?.input).toEqual(suffix);
    expect(resume.context.tools).toEqual(next.context.tools);
    const nextRound = await register(resume);
    expect(nextRound.token).not.toBe(firstRound.token);
    const envelope = contextEnvelope(resume, nextRound.token, manual);
    expect(envelope).toMatchObject({ instructions: body.instructions, tools: body.tools, input: suffix,
      controls: { parallel_tool_calls: false, tool_choice: "auto" },
      transport_context: { mode: "append", prefix_items: body.input.length, prefix_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(envelope.input).toEqual(suffix);
    expect(next.context.source?.input).toEqual([...body.input, ...suffix]);

    const inventory = await client.callTool({ name: "codex_tool_inventory", arguments: { ...nextRound.reference, limit: 50 } });
    expect(inventory.isError).not.toBeTrue();
    expect(inventory.structuredContent).toMatchObject({ nested_gateway: null,
      submission_tool: "codex_submit_tool_call", submission_field: "call",
      call_controls: { tool_choice: "auto", parallel_tool_calls: false, max_calls_per_batch: 1 } });
    const { tools: entries, submission_tool: submissionTool, submission_field: submissionField } = inventory.structuredContent as {
      tools: Array<{ scope: string; name: string; namespace?: string }>;
      submission_tool: string; submission_field: string;
    };
    expect(entries).toHaveLength(25);
    const firstPage = await client.callTool({ name: "codex_tool_inventory", arguments: nextRound.reference });
    expect(firstPage.structuredContent).toMatchObject({ total_loaded: 25, matched_loaded: 25, next_offset: 20 });
    expect((firstPage.structuredContent as { tools: unknown[] }).tools).toHaveLength(20);
    const lastPage = await client.callTool({ name: "codex_tool_inventory", arguments: { ...nextRound.reference, offset: 20 } });
    expect(lastPage.structuredContent).toMatchObject({ next_offset: null, discovery_tools: [{ name: "tool_search" }] });
    expect((lastPage.structuredContent as { tools: unknown[] }).tools).toHaveLength(5);
    const queried = await client.callTool({ name: "codex_tool_inventory", arguments: {
      ...nextRound.reference, query: "MULTI_AGENT_V1", include_schema: false,
    } });
    expect(queried.structuredContent).toMatchObject({ matched_loaded: 1, tools: [{ name: "spawn_agent", namespace: "multi_agent_v1" }] });
    expect((queried.structuredContent as { tools: Record<string, unknown>[] }).tools[0]).not.toHaveProperty("parameters");
    expect((queried.structuredContent as { tools: Record<string, unknown>[] }).tools[0]).not.toHaveProperty("specification");
    const spawn = entries.find(tool => tool.name === "spawn_agent")!;
    expect(spawn).toMatchObject({ scope: "top_level", name: "spawn_agent", namespace: "multi_agent_v1",
      kind: "function", type: "function", strict: true, parameters: spawnSpecification.parameters });
    expect(entries.some(tool => tool.name === "exec")).toBeFalse();
    const call = { scope: spawn.scope, name: spawn.name, namespace: spawn.namespace, arguments: spawnArguments };
    const reject = async (id: string, calls: Record<string, unknown>[], code?: string) => {
      const result = await client.callTool({ name: "codex_submit_tool_batch", arguments: {
        ...nextRound.reference, submission_id: id, calls,
      } });
      expect(result.isError).toBeTrue();
      if (code) expect(result.structuredContent).toMatchObject({ accepted: false, execution_state: "not_executed", code });
    };
    await reject("unknown_scope", [{ ...call, scope: "nested" }]);
    await reject("no_exec_gateway", [{ scope: "exec", name: "multi_agent_v1__spawn_agent", arguments: spawnArguments }], "tool_input_invalid");
    await reject("no_catalog_gateway", [{ scope: "catalog", name: "$catalog", arguments: {} }], "tool_input_invalid");
    await reject("undeclared_identity", [{ ...call, name: "undeclared_agent" }], "tool_identity_mismatch");
    await reject("missing_namespace", [{ scope: "top_level", name: "spawn_agent", arguments: spawnArguments }], "tool_identity_mismatch");
    await reject("joined_identity", [{ ...call, name: "multi_agent_v1.spawn_agent" }], "tool_identity_mismatch");
    await reject("invalid_loaded_schema", [{ ...call, arguments: { ...spawnArguments, agent_type: "unsupported" } }], "tool_arguments_invalid");
    await reject("parallel_disabled", [call, call], "parallel_calls_disabled");
    const accepted = await client.callTool({ name: submissionTool, arguments: { ...nextRound.reference,
      submission_id: "submit_child", [submissionField]: call,
    } });
    expect(accepted.isError).not.toBeTrue();
    const receipt = accepted.structuredContent as unknown as HandoffReceipt;
    expect(receipt).toMatchObject({ execution_state: "not_executed", sealed: true });
    expect(await broker.waitForHandoffIntent(nextRound.token)).toEqual({ kind: "tools", batchId: receipt.batch_id });
    // A settled MCP handler leaves a fence revision. Schema rejection must not claim
    // broker activity at all: even a rejected broker submission advances that revision.
    const beforeInvalidArray = broker.beginCompletionFence(nextRound.token);
    expect(beforeInvalidArray).toBeDefined();
    const invalidArray = await client.callTool({ name: submissionTool, arguments: { ...nextRound.reference,
      submission_id: "array_is_not_a_call", [submissionField]: [call],
    } });
    expect(invalidArray.isError).toBeTrue();
    expect(invalidArray.structuredContent).toBeUndefined();
    expect(broker.beginCompletionFence(nextRound.token)).toEqual(beforeInvalidArray);
    const requests = settleAndJournal(broker, nextRound.token, receipt, journal);
    expect(requests).toEqual([{ callId: receipt.call_ids[0], wireName: toolIdentityKey("multi_agent_v1", "spawn_agent"),
      freeform: false, arguments: spawnArguments }]);
    const response = canonicalResponse(next, requests);
    expect(response).toMatchObject({ status: "completed", end_turn: false, output: [
      { type: "function_call", call_id: receipt.call_ids[0], name: "spawn_agent", namespace: "multi_agent_v1",
        arguments: JSON.stringify(spawnArguments), status: "completed" },
    ] });
    expect(response.output).toHaveLength(1);
    broker.revoke(nextRound.token);
  } finally {
    try { await client.close(); }
    finally { try { await server.close(); } finally { try { await broker.close(); } finally { f.cleanup(); } } }
  }
}, 20_000);
