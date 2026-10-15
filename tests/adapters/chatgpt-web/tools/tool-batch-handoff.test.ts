import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defaultBrokerEndpoint } from "../../../../src/config";
import type { CodexTool } from "../../../../src/types";
import { TurnBroker, callTurnBroker } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";
import { ToolBatchHandoff, TOOL_BATCH_HANDOFF_PROTOCOL, type HandoffReceipt } from "../../../../src/adapters/chatgpt-web/tools/tool-batch-handoff";
import { HandoffDeliveryJournal } from "../../../../src/adapters/chatgpt-web/tools/handoff-delivery-journal";
import { createHandoffMcpServer } from "../../../../src/adapters/chatgpt-web/tools/mcp-handoff-server";
import { RequestScheduler, DEFAULT_REQUEST_SCHEDULING } from "../../../../launcher/shared/request-scheduler.cjs";
import { buildResponseJSON } from "../../../../src/responses/json";

const tools: CodexTool[] = [
  { name: "wait_agent", namespace: "functions", description: "Wait for child agents under Codex ownership", parameters: {
    type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"], additionalProperties: false,
  } },
  { name: "exec", namespace: "functions", description: "Original Codex runtime", freeform: true, parameters: {},
    specification: { type: "custom", name: "exec", description: "Original Codex runtime" } },
];
const call = { name: "wait_agent", namespace: "functions", arguments: { ids: ["child-fixture"] } };
function fixture() {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "w2h-handoff-"));
  return { root, cleanup() {
    if (resolve(root) !== root || !root.startsWith(join(parent, "w2h-handoff-"))) throw new Error("Fixture ownership mismatch");
    rmSync(root, { recursive: true, force: true });
  } };
}
const environment = (root: string) => ({ cwd: root, roots: [root], writableRoots: [],
  sandboxPolicy: { type: "readOnly" as const, networkAccess: false }, tools });

test("a receipt, yield, and physical settlement are distinct; failed persistence blocks delivery", () => {
  const round = new ToolBatchHandoff(tools);
  const receipt = round.submit("request-1", [call]);
  expect(receipt.execution_state).toBe("not_executed");
  expect(round.canFinishWebRound).toBeFalse();
  expect(() => round.confirmPhysicalSettlement()).toThrow("not yielded");
  expect(() => round.takeForDelivery(() => {})).toThrow("not physically settled");
  expect(() => round.finish("done")).toThrow("pending handoff");
  round.seal(receipt.batch_id);
  expect(round.canFinishWebRound).toBeTrue();
  expect(() => round.takeForDelivery(() => {})).toThrow("not physically settled");
  round.confirmPhysicalSettlement();
  expect(() => round.takeForDelivery(() => { throw new Error("disk full"); })).toThrow("disk full");
  let writes = 0;
  const first = round.takeForDelivery(record => { writes++; expect(JSON.stringify(record)).not.toContain("child-fixture"); });
  expect(first[0]?.arguments).toEqual(call.arguments);
  first[0]!.arguments = {};
  const repeated = round.takeForDelivery(() => { writes++; });
  expect(writes).toBe(1);
  expect(repeated[0]?.callId).toBe(receipt.call_ids[0]);
  expect(repeated[0]?.arguments).toEqual(call.arguments);
});

test("identical retries preserve IDs, changed requests and extra batches are rejected", () => {
  const round = new ToolBatchHandoff(tools);
  const first = round.submit("id", [call]);
  expect(round.submit("id", [{ arguments: call.arguments, namespace: call.namespace, name: call.name }])).toEqual(first);
  first.call_ids.length = 0;
  expect(round.submit("id", [call]).call_ids).toHaveLength(1);
  expect(() => round.submit("different", [call])).toThrow("different batch");
  expect(() => round.submit("id", [{ ...call, arguments: { ids: ["another-child"] } }])).toThrow("different batch");
  expect(() => round.seal("other-batch")).toThrow("Unknown");
  const batch = round.submit("id", [call]);
  expect(round.seal(batch.batch_id)).toEqual(round.seal(batch.batch_id));
  expect(round.submit("id", [call])).toEqual(batch);
});

test("tool identity, input shape, declared schema, tool_choice and parallel policy stay enforced", () => {
  expect(() => new ToolBatchHandoff(tools).submit("id", [{ ...call, namespace: "wrong" }])).toThrow("identity");
  expect(() => new ToolBatchHandoff(tools).submit("id", [{ ...call, arguments: { ids: 1 } }])).toThrow("schema");
  expect(() => new ToolBatchHandoff(tools).submit("id", [{ ...call, input: "escape" }])).toThrow("arguments only");
  expect(() => new ToolBatchHandoff(tools).submit("id", [{ ...call, scope: "exec" } as typeof call])).toThrow("Invalid");
  expect(() => new ToolBatchHandoff(tools, { toolChoice: "none" }).submit("id", [call])).toThrow("tool_choice");
  expect(() => new ToolBatchHandoff(tools, { parallelToolCalls: false }).submit("id", [call, call])).toThrow("parallel_tool_calls");
  expect(() => new ToolBatchHandoff(tools, { toolChoice: "required" }).finish("done")).toThrow("requires");
});

test("raw exec is handed off byte-for-byte and cancellation cannot resurrect it", () => {
  const round = new ToolBatchHandoff(tools);
  const input = '// original body\nconst x = await tools.spawn_agent({message: "child"});\nawait tools.wait_agent({ids: [x.id]});\n';
  const receipt = round.submit("exec-1", [{ namespace: "functions", name: "exec", input }]);
  round.seal(receipt.batch_id);
  round.confirmPhysicalSettlement();
  expect(round.takeForDelivery(() => {})[0]?.input).toBe(input);
  round.cancel();
  expect(() => round.takeForDelivery(() => {})).toThrow("cancelled");
  expect(() => round.submit("exec-1", [{ namespace: "functions", name: "exec", input }])).toThrow("cancelled");
});

test("journal persists only delivery intent; partial or conflicting receipts fail closed", () => {
  const f = fixture();
  try {
    const journal = new HandoffDeliveryJournal(join(f.root, "receipts"));
    const round = new ToolBatchHandoff(tools);
    round.seal(round.submit("id", [call]).batch_id);
    round.confirmPhysicalSettlement();
    round.takeForDelivery(receipt => journal.record(receipt));
    const path = join(journal.directory, `${round.roundId}.json`);
    const contents = readFileSync(path, "utf8");
    expect(contents).toContain('"state":"delivery_prepared"');
    expect(contents).not.toContain("child-fixture");
    journal.record(JSON.parse(contents));
    expect(() => journal.record({ ...JSON.parse(contents), digest: "different" })).toThrow("unknown");
    writeFileSync(path, "{");
    expect(() => journal.record(JSON.parse(contents))).toThrow("unknown");
  } finally { f.cleanup(); }
});

for (const manual of [false, true]) test(`real MCP/broker ${manual ? "manual" : "automatic"} handoff cannot deliver before owner physical confirmation`, async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  const contract = manual ? "safe" : "native";
  const server = createHandoffMcpServer({ brokerSocketPath: broker.socketPath, contract });
  const client = new Client({ name: "handoff-fixture", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    const nonce = "surface_nonce_handoff_0123456789";
    const token = await broker.registerHandoff(environment(f.root), { ...(manual ? { surfaceNonce: nonce } : {}),
      policy: { parallelToolCalls: false }, ttlMs: 30_000 });
    const reference = manual ? { request_id: token } : { turn_token: token };
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getInstructions()).toContain("NOT EXECUTED");
    const listed = await client.listTools();
    if (manual) expect(listed.tools.map(tool => tool.name)).not.toContain("codex_tool_call");
    else expect(listed.tools.find(tool => tool.name === "codex_tool_call")?.description).toContain("Reserved context-compaction control");
    await expect(callTurnBroker(broker.socketPath, { method: "claim", token, contract })).rejects.toThrow("protocol mismatch");
    if (manual) {
      // Remote binding alone does not authorize a manually copied prompt.
      await client.callTool({ name: "codex_turn_start", arguments: reference });
      expect(() => broker.confirmSafeTurnSent(token, `${nonce}_wrong`)).toThrow("binding");
      broker.confirmSafeTurnSent(token, nonce);
    }
    const inventory = await client.callTool({ name: "codex_tool_inventory", arguments: reference });
    expect(inventory.isError).not.toBeTrue();
    expect(JSON.stringify(inventory.structuredContent)).toContain("wait_agent");
    expect((inventory.structuredContent as { call_controls: unknown }).call_controls).toEqual({
      tool_choice: "auto", parallel_tool_calls: false, max_calls_per_batch: 1,
    });
    const multi = await client.callTool({ name: "codex_submit_tool_batch", arguments: { ...reference,
      submission_id: "too_many", calls: [call, call, call],
    } });
    expect(multi.isError).toBeTrue();
    expect(multi.structuredContent).toMatchObject({ accepted: false, execution_state: "not_executed",
      code: "parallel_calls_disabled", call_controls: { parallel_tool_calls: false, max_calls_per_batch: 1 } });
    expect(JSON.stringify(multi.content)).toContain("one call at a time");
    const malformed = await client.callTool({ name: "codex_submit_tool_batch", arguments: { ...reference,
      submission_id: "wrong_arguments", calls: [{ ...call, arguments: { ids: 1 } }],
    } });
    expect(malformed.isError).toBeTrue();
    expect(malformed.structuredContent).toMatchObject({ code: "tool_arguments_invalid", accepted: false });
    if (!manual) expect((inventory.structuredContent as { tools: unknown[] }).tools).toContainEqual({
      scope: "top_level", name: "exec", namespace: "functions", kind: "custom",
      type: "custom", description: tools[1]!.description,
    });
    if (manual) expect(JSON.stringify(inventory.structuredContent)).not.toContain('"name":"exec"');
    const wrongIdentity = await client.callTool({ name: "codex_submit_tool_batch", arguments: { ...reference,
      submission_id: "wrong_identity", calls: [{ ...call, name: `functions.${call.name}` }],
    } });
    expect(wrongIdentity.isError).toBeTrue();
    expect(wrongIdentity.structuredContent).toMatchObject({ code: "tool_identity_mismatch", accepted: false });
    expect(JSON.stringify(wrongIdentity.content)).toContain("Copy the separate name and namespace");
    expect(JSON.stringify(wrongIdentity.content)).toContain("No batch was accepted");
    if (manual) expect(JSON.stringify(wrongIdentity.content)).not.toContain('\\"name\\":\\"exec\\"');
    if (manual) {
      const hidden = await client.callTool({ name: "codex_submit_tool_batch", arguments: { ...reference,
        submission_id: "forbidden", calls: [{ name: "exec", namespace: "functions", input: "text('not permitted');" }],
      } });
      expect(hidden.isError).toBeTrue();
    }
    const accepted = await client.callTool({ name: "codex_submit_tool_batch", arguments: { ...reference, submission_id: "one", calls: [call] } });
    expect(accepted.isError).not.toBeTrue();
    const receipt = accepted.structuredContent as unknown as HandoffReceipt;
    expect(receipt.execution_state).toBe("not_executed");
    expect(receipt.sealed).toBeTrue();
    expect(receipt.next_action).toBe("end_web_response");
    expect(await broker.waitForHandoffIntent(token)).toEqual({ kind: "tools", batchId: receipt.batch_id });
    await expect(broker.nextToolBatch(token)).rejects.toThrow("physical Web settlement");
    expect(broker.beginCompletionFence(token)).toBeDefined();
    const replay = await client.callTool({ name: "codex_submit_tool_batch", arguments: { ...reference, submission_id: "one", calls: [call] } });
    expect(replay.structuredContent).toEqual(receipt);
    const invalidFinal = await client.callTool({ name: "codex_finish_turn", arguments: { ...reference, final_answer: "pretend completed" } });
    expect(invalidFinal.isError).toBeTrue();
    const yielded = await client.callTool({ name: "codex_yield_turn", arguments: { ...reference, batch_id: receipt.batch_id } });
    expect(yielded.isError).not.toBeTrue();
    expect(await broker.waitForHandoffIntent(token)).toEqual({ kind: "tools", batchId: receipt.batch_id });
    // Keep one genuine claimed activity open to prove intent alone does not clear the fence.
    const held = await callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath, { method: "claim", token, contract, protocol: TOOL_BATCH_HANDOFF_PROTOCOL });
    await expect(callTurnBroker(broker.socketPath, { method: "invoke", bindingId: held.bindingId,
      activityId: held.activityId, protocol: TOOL_BATCH_HANDOFF_PROTOCOL, wireName: JSON.stringify(["functions", "wait_agent"]), arguments: call.arguments,
    })).rejects.toThrow("does not support synchronous invoke");
    expect(broker.beginCompletionFence(token)).toMatchObject({ state: "activity_in_flight" });
    expect(() => broker.confirmHandoffPhysicalSettlement(token)).toThrow("fence");
    await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: held.activityId });
    const revision = broker.beginCompletionFence(token);
    if (!("revision" in revision)) throw new Error("Expected a ready fence");
    expect(broker.commitCompletionFence(token, revision.revision)).toMatchObject({ state: "committed" });
    expect(() => broker.takeHandoffBatch(token, () => {})).toThrow("not physically settled");
    broker.confirmHandoffPhysicalSettlement(token); // fixture acknowledgement, NOT live browser evidence
    const journal = new HandoffDeliveryJournal(join(f.root, "receipts"));
    const requests = broker.takeHandoffBatch(token, record => journal.record(record));
    expect(requests[0]?.callId).toBe(receipt.call_ids[0]);
    expect(requests[0]?.arguments).toEqual(call.arguments);
    broker.revoke(token);
    expect(() => broker.takeHandoffBatch(token, () => {})).toThrow("Not a handoff");
    expect((await client.callTool({ name: "codex_yield_turn", arguments: { ...reference, batch_id: receipt.batch_id } })).isError).toBeTrue();
  } finally { await client.close(); await server.close(); await broker.close(); f.cleanup(); }
}, 20_000);

for (const manual of [false, true]) test(`deferred discovery without exec crosses ${manual ? "manual" : "automatic"} handoff as tool_search`, async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  const server = createHandoffMcpServer({ brokerSocketPath: broker.socketPath, contract: manual ? "safe" : "native" });
  const client = new Client({ name: "discovery-handoff-fixture", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const discovery: CodexTool = { name: "tool_search", description: "Discover deferred Codex tools", toolSearch: true,
    specification: { type: "tool_search", execution: "client" }, parameters: {
      type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"],
    } };
  try {
    const nonce = "surface_nonce_discovery_0123456789";
    const token = await broker.registerHandoff({ ...environment(f.root), tools: [discovery] }, {
      ...(manual ? { surfaceNonce: nonce } : {}), policy: { parallelToolCalls: false },
    });
    const reference = manual ? { request_id: token } : { turn_token: token };
    await server.connect(st); await client.connect(ct);
    if (manual) { await client.callTool({ name: "codex_turn_start", arguments: reference }); broker.confirmSafeTurnSent(token, nonce); }
    const inventory = await client.callTool({ name: "codex_tool_inventory", arguments: reference });
    expect(inventory.structuredContent).toMatchObject({ nested_gateway: null,
      discovery_tools: [{ scope: "top_level", name: "tool_search", kind: "tool_search", parameters: discovery.parameters }],
      tools: [{ name: "tool_search", type: "tool_search", execution: "client", parameters: discovery.parameters }],
    });
    const response = await client.callTool({ name: "codex_submit_tool_batch", arguments: { ...reference,
      submission_id: "discover_agents", calls: [{ name: "tool_search", arguments: { query: "spawn agent", limit: 3 } }],
    } });
    expect(response.isError).not.toBeTrue();
    const receipt = response.structuredContent as unknown as HandoffReceipt;
    expect(receipt.sealed).toBeTrue();
    expect(await broker.waitForHandoffIntent(token)).toEqual({ kind: "tools", batchId: receipt.batch_id });
    // No second MCP action: registration and seal are atomic, delivery is still gated.
    expect(() => broker.takeHandoffBatch(token, () => {})).toThrow("not physically settled");
    const revision = broker.beginCompletionFence(token);
    if (!("revision" in revision)) throw new Error("Expected a ready fence");
    expect(broker.commitCompletionFence(token, revision.revision)).toMatchObject({ state: "committed" });
    broker.confirmHandoffPhysicalSettlement(token);
    const [request] = broker.takeHandoffBatch(token, () => {});
    const json = buildResponseJSON([
      { type: "tool_call_start", id: request!.callId, name: request!.wireName },
      { type: "tool_call_delta", arguments: JSON.stringify(request!.arguments) }, { type: "tool_call_end" },
    ], "fixture", { toolSearchToolNames: new Set([request!.wireName]) });
    expect(json.output).toContainEqual(expect.objectContaining({ type: "tool_search_call", execution: "client",
      arguments: { query: "spawn agent", limit: 3 } }));
  } finally { await client.close(); await server.close(); await broker.close(); f.cleanup(); }
}, 20_000);

// A deterministic protocol/scheduler fixture. It does not create real Codex agents or
// claim ChatGPT capacity evidence; it checks that no parent holds a slot during execution.
for (const capacity of [1, 2, 4]) test(`parent/child/continuation fixture completes under ${capacity} global Web slot(s)`, () => {
  const scheduler = new RequestScheduler({ settings: { ...DEFAULT_REQUEST_SCHEDULING, maxConcurrent: capacity } });
  const received = new Set<string>();
  const nativeWaiting = new Set<string>();
  const completed = new Set<string>();
  const add = (id: string, groupId: string) => scheduler.enqueue({ id, groupId, mode: "mcp-handoff", model: "fixture", bytes: 100 });
  for (let i = 0; i < 4; i++) add(`parent-${i}`, `family-${i}`);
  let steps = 0;
  while (completed.size < 4) {
    if (++steps > 12) throw new Error("Protocol fixture stopped making progress");
    const item = scheduler.query({ state: "running" }).items[0];
    expect(item).toBeDefined();
    const lease = scheduler.lease(item!.id)!;
    const round = new ToolBatchHandoff(tools);
    const family = item!.groupId;
    if (item!.id.startsWith("parent-")) {
      round.seal(round.submit("spawn-and-wait", [call]).batch_id);
      expect(scheduler.snapshot().active).toBeLessThanOrEqual(capacity);
      round.confirmPhysicalSettlement(); // fixture: generation+cleanup acknowledged
      const requests = round.takeForDelivery(() => {});
      scheduler.settle(item!.id, lease, "succeeded", "web_round_handed_off");
      expect(requests).toHaveLength(1);
      // Only now does native execution wait for a child with its own queued Web round.
      nativeWaiting.add(family);
      add(`child-${family}`, family);
    } else if (item!.id.startsWith("child-")) {
      round.finish("child answer"); round.confirmPhysicalSettlement();
      scheduler.settle(item!.id, lease, "succeeded");
      expect(nativeWaiting.delete(family)).toBeTrue();
      received.add(family);
      add(`resume-${family}`, family);
    } else {
      expect(received.has(family)).toBeTrue();
      round.finish("The child round finished"); round.confirmPhysicalSettlement();
      scheduler.settle(item!.id, lease, "succeeded");
      completed.add(family);
    }
    expect(scheduler.snapshot().active).toBeLessThanOrEqual(capacity);
  }
  expect(nativeWaiting.size).toBe(0);
  expect(scheduler.snapshot().waiting).toBe(0);
  expect(scheduler.snapshot().active).toBe(0);
});

test("new stdio endpoint negotiates handoff explicitly and seals a final-only round", async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  const client = new Client({ name: "handoff-stdio-fixture", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath, "--protocol", TOOL_BATCH_HANDOFF_PROTOCOL],
    cwd: process.cwd(), stderr: "pipe" });
  try {
    const token = await broker.registerHandoff(environment(f.root));
    await client.connect(transport);
    expect(client.getInstructions()).toContain(TOOL_BATCH_HANDOFF_PROTOCOL);
    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name).sort()).toEqual(["codex_finish_turn", "codex_submit_tool_batch", "codex_submit_tool_call", "codex_tool_call", "codex_tool_inventory", "codex_yield_turn"]);
    const final = await client.callTool({ name: "codex_finish_turn", arguments: { turn_token: token, final_answer: "Actual final answer" } });
    expect(final.isError).not.toBeTrue();
    expect(await broker.waitForHandoffIntent(token)).toEqual({ kind: "final", answer: "Actual final answer" });
    const revision = broker.beginCompletionFence(token);
    if (!("revision" in revision)) throw new Error("Expected a ready fence");
    expect(broker.commitCompletionFence(token, revision.revision)).toMatchObject({ state: "committed" });
    broker.confirmHandoffPhysicalSettlement(token);
  } finally { await client.close(); await broker.close(); f.cleanup(); }
}, 20_000);

test("cancellation rejects pending intent waiters and old connector contracts cannot claim a handoff round", async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  try {
    const token = await broker.registerHandoff(environment(f.root));
    await expect(callTurnBroker(broker.socketPath, { method: "claim", token, contract: "native" })).rejects.toThrow("protocol mismatch");
    const ordinary = await broker.register(environment(f.root));
    await expect(callTurnBroker(broker.socketPath, { method: "claim", token: ordinary, protocol: TOOL_BATCH_HANDOFF_PROTOCOL })).rejects.toThrow("protocol mismatch");
    const pending = broker.waitForHandoffIntent(token);
    void pending.catch(() => {});
    broker.revoke(token, new Error("operator cancelled fixture"));
    await expect(pending).rejects.toThrow("operator cancelled");
    expect(() => broker.confirmHandoffPhysicalSettlement(token)).toThrow("fence");
  } finally { await broker.close(); f.cleanup(); }
});
