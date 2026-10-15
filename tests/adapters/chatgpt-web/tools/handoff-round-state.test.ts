import { expect, spyOn, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseDiagnosticLine } from "../../../../launcher/shared/diagnostic-event.cjs";
import { defaultBrokerEndpoint } from "../../../../src/config";
import { toolIdentityKey, type CodexTool } from "../../../../src/types";
import { createHandoffMcpServer } from "../../../../src/adapters/chatgpt-web/tools/mcp-handoff-server";
import { callTurnBroker, TurnBroker, RemoteTurnBroker } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";
import { CompletionFenceWait } from "../../../../src/adapters/chatgpt-web/tools/completion-fence";
import { ToolBatchHandoff, type HandoffRoundState } from "../../../../src/adapters/chatgpt-web/tools/tool-batch-handoff";

const tools: CodexTool[] = [
  { name: "read_fixture", description: "Read a fixture", parameters: {
    type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false,
  } },
  { name: "tool_search", description: "Discover fixture tools", toolSearch: true, parameters: {
    type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false,
  } },
];
const call = { name: "read_fixture", arguments: { name: "fixture.txt" } };
const open = { round_state: "open", sealed: false, next_action: "continue_current_round" } as const;
const submitted = { round_state: "submitted", sealed: true, next_action: "end_web_response" } as const;
const finished = { round_state: "finished", sealed: true, next_action: "end_web_response" } as const;

function fixture() {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "w2h-round-state-"));
  return { root, cleanup() {
    if (resolve(root) !== root || !root.startsWith(join(parent, "w2h-round-state-"))) throw new Error("Fixture ownership mismatch");
    rmSync(root, { recursive: true, force: true });
  } };
}
const environment = (root: string) => ({ cwd: root, roots: [root], writableRoots: [],
  sandboxPolicy: { type: "readOnly" as const, networkAccess: false }, tools });

test("owner transport distinguishes missing intent from sealed but unsettled activity", async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  const owner = new RemoteTurnBroker(broker.socketPath);
  try {
    const token = await broker.registerHandoff(environment(f.root));
    const absent = await owner.beginCompletionFence(token);
    expect(absent).toEqual({ state: "awaiting_intent", activities: 0, invocations: 0, sealed: false });
    const missingWait = new CompletionFenceWait();
    missingWait.observe(absent, 0, 10_000);
    expect(() => missingWait.observe(absent, 10_000, 10_000)).toThrow("without sealing");
    const claim = await callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath, { method: "claim", token, protocol: "web2harness-handoff-v1" });
    await callTurnBroker(broker.socketPath, { method: "handoff_submit", bindingId: claim.bindingId,
      activityId: claim.activityId, protocol: "web2harness-handoff-v1", submissionId: "held", calls: [call], sealOnSubmit: true });
    const active = await owner.beginCompletionFence(token);
    if (active.state !== "activity_in_flight") throw new Error("Expected unsettled activity");
    expect(active).toEqual({ state: "activity_in_flight", activities: 1, invocations: 0, sealed: true });
    const wait = new CompletionFenceWait();
    wait.observe(active, 0, 10_000);
    try { wait.observe(active, 10_000, 10_000); throw new Error("Expected activity timeout"); }
    catch (error) { expect(error).toMatchObject({ code: "mcp_activity_unsettled", retryable: false }); }
    expect(await owner.commitCompletionFence(token, 0)).toEqual(active);
    expect(() => broker.confirmHandoffPhysicalSettlement(token)).toThrow("fence");
    await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claim.activityId });
    const ready = await owner.beginCompletionFence(token);
    expect(ready).toMatchObject({ state: "ready" });
    if (!("revision" in ready)) throw new Error("Expected revision");
    expect(await owner.commitCompletionFence(token, 0)).toMatchObject({ state: "revision_changed" });
    expect(await owner.commitCompletionFence(token, ready.revision)).toEqual({ state: "committed", revision: ready.revision, awaitingToolResults: true });
    expect(await owner.beginCompletionFence(token)).toEqual({ state: "already_committed", revision: ready.revision });
  } finally { await broker.close(); f.cleanup(); }
});

test("completion waiting cannot extend its deadline by changing reasons", () => {
  const wait = new CompletionFenceWait();
  wait.observe({ state: "awaiting_intent", activities: 0, invocations: 0, sealed: false }, 0, 10);
  expect(() => wait.observe({ state: "activity_in_flight", activities: 1, invocations: 0, sealed: true }, 10, 10)).toThrow("unsettled");
  wait.reset();
  expect(() => wait.observe({ state: "ready", revision: 1 }, 20, 10)).not.toThrow();
});

test("round snapshots distinguish open, accepted but unsealed, sealed and final without trusting old receipts", () => {
  const first = new ToolBatchHandoff(tools);
  expect(first.roundState).toEqual({ round_id: first.roundId, ...open });
  const snapshot = first.roundState;
  snapshot.round_state = "finished";
  expect(first.roundState.round_state).toBe("open");
  expect(() => first.submit("invalid", [{ ...call, arguments: { name: 1 } }])).toThrow("schema");
  expect(first.roundState).toEqual({ round_id: first.roundId, ...open });
  const receipt = first.submit("first", [call]);
  expect(first.roundState).toEqual({ round_id: receipt.round_id, ...open, round_state: "submitted" });
  first.seal(receipt.batch_id);
  expect(first.roundState).toEqual({ round_id: receipt.round_id, ...submitted });
  first.confirmPhysicalSettlement();
  first.takeForDelivery(() => {});
  expect(first.roundState.round_state).toBe("submitted"); // Delivery is not task completion.

  const next = new ToolBatchHandoff(tools);
  expect(next.roundId).not.toBe(receipt.round_id);
  expect(() => next.seal(receipt.batch_id)).toThrow("Unknown");
  expect(() => next.finish(" ")).toThrow("without a usable reply");
  expect(next.roundState).toEqual({ round_id: next.roundId, ...open });
  next.finish("Final fixture answer");
  expect(next.roundState).toEqual({ round_id: next.roundId, ...finished });
  next.cancel();
  expect(() => next.roundState).toThrow("cancelled");
});

test("policy validation failures leave the handoff open", () => {
  const round = new ToolBatchHandoff(tools, { toolChoice: "required", parallelToolCalls: false });
  expect(() => round.submit("parallel", [call, call])).toThrow("parallel_tool_calls");
  expect(() => round.finish("premature")).toThrow("requires a tool call");
  expect(round.roundState).toEqual({ round_id: round.roundId, ...open });
});

// Real MCP handlers and broker with isolated local endpoints; no browser or tool execution.
for (const manual of [false, true]) test(`${manual ? "safe" : "automatic"} inventory reflects actual round state across queries, rejection, submit and finish`, async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  const contract = manual ? "safe" : "native";
  const server = createHandoffMcpServer({ brokerSocketPath: broker.socketPath, contract });
  const client = new Client({ name: "round-state-fixture", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const logs: string[] = [];
  const logger = spyOn(console, "error").mockImplementation((...args) => { logs.push(args.join(" ")); });
  try {
    await server.connect(st);
    await client.connect(ct);
    const register = async () => {
      const nonce = "surface_nonce_round_state_0123456789";
      const token = await broker.registerHandoff(environment(f.root), {
        ...(manual ? { surfaceNonce: nonce } : {}), traceId: "round-state-fixture", ttlMs: 30_000,
      });
      const reference: Record<string, string> = manual ? { request_id: token } : { turn_token: token };
      let start: Record<string, unknown> | undefined;
      if (manual) {
        const response = await client.callTool({ name: "codex_turn_start", arguments: reference });
        expect(response.isError).not.toBeTrue();
        start = response.structuredContent as Record<string, unknown>;
        expect(start).toMatchObject({ started: true, duplicate: false, ...open });
        const duplicate = await client.callTool({ name: "codex_turn_start", arguments: reference });
        expect(duplicate.structuredContent).toEqual({ ...start, duplicate: true });
        broker.confirmSafeTurnSent(token, nonce);
      }
      return { token, reference, start };
    };
    const inventory = async (reference: Record<string, string>, extra: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name: "codex_tool_inventory", arguments: { ...reference, ...extra } });
      expect(response.isError).not.toBeTrue();
      const text = (response.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(JSON.parse(text)).toEqual(response.structuredContent);
      return response.structuredContent as HandoffRoundState & Record<string, unknown>;
    };
    const checkCatalog = async (reference: Record<string, string>, state: HandoffRoundState) => {
      for (const query of [{}, { query: "not_loaded" }, { limit: 1 }, { offset: 1, limit: 1, include_schema: false }]) {
        expect(await inventory(reference, query)).toMatchObject(state);
      }
    };
    const first = await register();
    const initial = await inventory(first.reference);
    expect(initial.round_id).toMatch(/^round_/);
    expect(initial).toMatchObject(open);
    if (manual) expect(first.start).toMatchObject({ round_id: initial.round_id, ...open });
    expect(initial.discovery_instructions).toContain("Only a successfully submitted discovery call ends this Web round");
    expect(initial.discovery_instructions).toContain("This inventory lookup never ends the round");
    expect(initial.discovery_instructions).not.toContain("Discovery ends this Web round");
    await checkCatalog(first.reference, { round_id: initial.round_id, ...open });
    const combined = await inventory(first.reference, { query: "read_fixture tool_search", limit: 1 });
    expect(combined).toMatchObject({ matched_loaded: 2, next_offset: 1,
      tools: [{ name: "read_fixture" }] });
    const queryEvent = logs.map(parseDiagnosticLine).filter(event => event?.event === "tool.inventory_queried").at(-1)!;
    expect(queryEvent.detail).toMatchObject({ traceId: "round-state-fixture", totalLoaded: 2, matchedLoaded: 2,
      queryTermCount: 2, identifierTermMatches: 2, returnedCount: 1, discoveryCount: 1 });
    expect(await inventory(first.reference, { query: "read_fixture tool_search", offset: 1, limit: 1 }))
      .toMatchObject({ next_offset: null, tools: [{ name: "tool_search" }] });
    expect(JSON.stringify(queryEvent)).not.toContain("read_fixture");
    expect(JSON.stringify(queryEvent)).not.toContain(first.token);
    expect(broker.beginCompletionFence(first.token)).toMatchObject({ state: "awaiting_intent" });

    const invalid = await client.callTool({ name: "codex_submit_tool_call", arguments: { ...first.reference,
      submission_id: "invalid", call: { ...call, arguments: { name: 1 } },
    } });
    expect(invalid.isError).toBeTrue();
    expect(invalid.structuredContent).toMatchObject({ accepted: false, code: "tool_arguments_invalid" });
    expect(await inventory(first.reference)).toMatchObject({ round_id: initial.round_id, ...open });
    expect(broker.beginCompletionFence(first.token)).toMatchObject({ state: "awaiting_intent" });

    const discoveryCall = { name: "tool_search", arguments: { query: "fixture" } };
    const accepted = await client.callTool({ name: manual ? "codex_submit_tool_call" : "codex_submit_tool_batch", arguments: {
      ...first.reference, submission_id: "discovery", ...(manual ? { call: discoveryCall } : { calls: [discoveryCall] }),
    } });
    expect(accepted.isError).not.toBeTrue();
    const receipt = accepted.structuredContent as HandoffRoundState & { batch_id: string };
    expect(receipt).toMatchObject({ round_id: initial.round_id, ...submitted, execution_state: "not_executed" });
    await checkCatalog(first.reference, { round_id: initial.round_id, ...submitted });
    expect(await broker.waitForHandoffIntent(first.token)).toEqual({ kind: "tools", batchId: receipt.batch_id });
    if (manual) {
      const duplicate = await client.callTool({ name: "codex_turn_start", arguments: first.reference });
      expect(duplicate.structuredContent).toEqual({ started: true, duplicate: true, round_id: initial.round_id, ...submitted });
    }
    const revision = broker.beginCompletionFence(first.token);
    if (!("revision" in revision)) throw new Error("Expected a ready fence");
    expect(broker.commitCompletionFence(first.token, revision.revision)).toMatchObject({ state: "committed" });
    if (manual) {
      const oldStart = await client.callTool({ name: "codex_turn_start", arguments: first.reference });
      expect(oldStart.isError).toBeTrue();
      expect(JSON.stringify(oldStart.content)).toContain("completion is already committed");
    }

    const next = await register();
    const nextInventory = await inventory(next.reference);
    expect(nextInventory.round_id).not.toBe(receipt.round_id);
    expect(nextInventory).toMatchObject(open);
    const staleYield = await client.callTool({ name: "codex_yield_turn", arguments: { ...next.reference, batch_id: receipt.batch_id } });
    expect(staleYield.isError).toBeTrue();
    expect(await inventory(next.reference)).toMatchObject({ round_id: nextInventory.round_id, ...open });
    expect(broker.beginCompletionFence(next.token)).toMatchObject({ state: "awaiting_intent" });
    const final = await client.callTool({ name: "codex_finish_turn", arguments: { ...next.reference, final_answer: "Fixture final" } });
    expect(final.isError).not.toBeTrue();
    expect(final.structuredContent).toMatchObject({ round_id: nextInventory.round_id, ...finished });
    await checkCatalog(next.reference, { round_id: nextInventory.round_id, ...finished });
    if (manual) {
      const duplicate = await client.callTool({ name: "codex_turn_start", arguments: next.reference });
      expect(duplicate.structuredContent).toEqual({ started: true, duplicate: true, round_id: nextInventory.round_id, ...finished });
      const starts = logs.map(parseDiagnosticLine).filter(event => event?.event === "tool.handoff_started");
      expect(starts.map(event => ({ status: event!.detail.status, duplicate: event!.detail.duplicate }))).toEqual([
        { status: "open", duplicate: false }, { status: "open", duplicate: true }, { status: "submitted", duplicate: true },
        { status: "open", duplicate: false }, { status: "open", duplicate: true }, { status: "finished", duplicate: true },
      ]);
      for (const event of starts) {
        expect(event!.detail.traceId).toBe("round-state-fixture");
        expect(Object.keys(event!.detail).sort()).toEqual(["duplicate", "pid", "processInstanceId", "seq", "sourceId", "status", "traceId"]);
        expect(JSON.stringify(event)).not.toContain(first.token);
        expect(JSON.stringify(event)).not.toContain(next.token);
      }
    }
  } finally {
    logger?.mockRestore();
    try { await client.close(); }
    finally { try { await server.close(); } finally { try { await broker.close(); } finally { f.cleanup(); } } }
  }
}, 20_000);

test("MCP rejection diagnostics distinguish identity and format mistakes without repairing or leaking calls", async () => {
  const f = fixture(), broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  broker.configureHandoffJournal(join(f.root, "receipts"));
  const server = createHandoffMcpServer({ brokerSocketPath: broker.socketPath, contract: "native" });
  const client = new Client({ name: "identity-diagnostic-fixture", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const logs: string[] = [];
  const logger = spyOn(console, "error").mockImplementation((...args) => { logs.push(args.join(" ")); });
  try {
    await server.connect(st); await client.connect(ct);
    const token = await broker.registerHandoff({ ...environment(f.root), tools: [
      { name: "apply_patch", namespace: "functions", description: "Patch", parameters: {}, freeform: true },
    ] }, { traceId: "identity-diagnostic", policy: { parallelToolCalls: false } });
    const calls = [
      { name: "apply_patch", input: "PRIVATE_PATCH" },
      { name: "functions.apply_patch", input: "PRIVATE_PATCH" },
      { name: "apply_patch", namespace: "PRIVATE_NAMESPACE", input: "PRIVATE_PATCH" },
      { name: "PRIVATE_IDENTIFIER_SECRET", arguments: { cmd: "PRIVATE_COMMAND" } },
      { name: "apply_patch", namespace: "functions", arguments: { input: "PRIVATE_PATCH" } },
    ];
    for (const [index, call] of calls.entries()) {
      const rejected = await client.callTool({ name: "codex_submit_tool_call", arguments: {
        turn_token: token, submission_id: `rejected_${index}`, call,
      } });
      expect(rejected.isError).toBeTrue();
      expect(rejected.structuredContent).toMatchObject({ accepted: false, execution_state: "not_executed",
        code: index === 4 ? "tool_input_invalid" : "tool_identity_mismatch" });
      expect(broker.beginCompletionFence(token)).toMatchObject({ state: "awaiting_intent" });
    }
    const rejectedEvents = logs.map(parseDiagnosticLine).filter(event => event?.event === "tool.handoff_rejected");
    expect(rejectedEvents).toHaveLength(5);
    const firstCall = (index: number) => (rejectedEvents[index]!.detail.diagnosticCalls as any[])[0];
    expect(firstCall(0)).toMatchObject({ namespaceSupplied: false, candidates: [{ nameMatched: true, namespaceMatched: false }] });
    expect(firstCall(1)).toMatchObject({ candidates: [{ qualifiedNameMatched: true, nameMatched: false }] });
    expect(firstCall(2)).toMatchObject({ namespaceSupplied: true, candidates: [{ nameMatched: true, namespaceMatched: false }] });
    expect(firstCall(3)).toMatchObject({ candidateCount: 0, exactIdentityMatch: false });
    expect(firstCall(4)).toMatchObject({ exactIdentityMatch: true, hasArguments: true, hasInput: false, candidates: [{ freeform: true }] });
    expect(logs.join("\n")).not.toContain("PRIVATE");
    expect(logs.join("\n")).not.toContain(token);
    const accepted = await client.callTool({ name: "codex_submit_tool_call", arguments: {
      turn_token: token, submission_id: "corrected", call: { name: "apply_patch", namespace: "functions", input: "EXACT_PATCH" },
    } });
    expect(accepted.isError).not.toBeTrue();
    const ready = broker.beginCompletionFence(token);
    if (!("revision" in ready)) throw Error("Expected ready fence");
    broker.commitCompletionFence(token, ready.revision);
    const owner = new RemoteTurnBroker(broker.socketPath), delivered = await owner.deliverHandoff(token);
    expect(delivered.requests).toHaveLength(1);
    expect(delivered.requests[0]).toMatchObject({ wireName: toolIdentityKey("functions", "apply_patch"), input: "EXACT_PATCH", freeform: true });
    expect((await owner.deliverHandoff(token)).requests).toEqual(delivered.requests);
  } finally {
    logger.mockRestore();
    try { await client.close(); } finally { try { await server.close(); } finally { await broker.close(); f.cleanup(); } }
  }
}, 15_000);

test("legacy synchronous claims and manual starts retain their original response fields", async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  try {
    for (const manual of [false, true]) {
      const nonce = "surface_nonce_legacy_state_0123456789";
      const token = manual ? await broker.registerSafe(environment(f.root), nonce) : await broker.register(environment(f.root));
      if (manual) {
        const start = await callTurnBroker(broker.socketPath, { method: "safe_start", token });
        expect(start).toEqual({ started: true, duplicate: false });
        const duplicate = await callTurnBroker(broker.socketPath, { method: "safe_start", token });
        expect(duplicate).toEqual({ started: true, duplicate: true });
        broker.confirmSafeTurnSent(token, nonce);
      }
      for (let i = 0; i < 2; i++) {
        const claim = await callTurnBroker<{ activityId: string }>(broker.socketPath, { method: "claim", token, contract: manual ? "safe" : "native" });
        expect(Object.keys(claim).sort()).toEqual(["activityId", "bindingId", "environment"]);
        await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claim.activityId });
      }
    }
  } finally { await broker.close(); f.cleanup(); }
});

test("safe_start also rejects a committed legacy round before its initial start", async () => {
  const f = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(f.root));
  try {
    // A legacy idle channel can commit without ever starting; use it to cover the initial-start guard.
    const token = await broker.registerSafe(environment(f.root), "surface_nonce_committed_0123456789");
    const fence = broker.beginCompletionFence(token);
    if (!("revision" in fence)) throw new Error("Expected a ready fence");
    expect(broker.commitCompletionFence(token, fence.revision)).toMatchObject({ state: "committed" });
    await rejects(callTurnBroker(broker.socketPath, { method: "safe_start", token }), /completion is already committed/);
    expect(() => broker.startSafeTurn(token)).toThrow("completion is already committed");
  } finally { await broker.close(); f.cleanup(); }
});
