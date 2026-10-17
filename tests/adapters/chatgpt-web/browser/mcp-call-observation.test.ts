import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ChatGptMcpCallObservation, observeMcpCompletion } from "../../../../src/adapters/chatgpt-web/browser/mcp-call-observation";
import { ChatGptStreamProjection } from "../../../../src/adapters/chatgpt-web/browser/stream-evidence";
import { CompletionFenceWait } from "../../../../src/adapters/chatgpt-web/tools/completion-fence";
import { TurnBroker, callTurnBroker } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";
import { defaultBrokerEndpoint } from "../../../../src/config";
import { bridgeToResponsesSSE } from "../../../../src/responses/stream";
import { ChatGptBrowserWorker, type BrowserTurn } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { ChatGptWebAdapterError } from "../../../../src/adapters/chatgpt-web/adapter-error";
import { StandaloneRequestQueue } from "../../../../src/browser/standalone-request-queue";
import { createChatGptWebAdapter } from "../../../../src/adapters/chatgpt-web/adapter";
import type { AdapterEvent, CodexParsedRequest, CodexProviderConfig } from "../../../../src/types";

const binding = "turn_fixture_current_secret_0123456789";
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const call = (id = "call-1", token = binding) => ({ id, author: { role: "assistant" }, recipient: "api_tool.call_tool",
  content: { content_type: "code", text: "PRIVATE_COMMAND" },
  metadata: { connector_tool_payload: JSON.stringify({ turn_token: token, submission_id: "read", call: { name: "read_fixture", arguments: { private: "PRIVATE_ARGUMENT" } } }) } });
function send(stream: ChatGptStreamProjection, ...frames: unknown[]) {
  const bytes = Buffer.from(frames.map(v => `data: ${JSON.stringify(v)}\n\n`).join(""));
  for (let i=0; i<bytes.length; i+=7) stream.push(bytes.subarray(i,i+7).toString("base64"));
}

test("current-binding connector evidence excludes old rounds, other tools, prose and pre-send traffic", () => {
  const observation = new ChatGptMcpCallObservation(fingerprint(binding));
  const stream = new ChatGptStreamProjection(observation);
  send(stream, { message: call("before-send") });
  expect(observation.snapshot().boundCalls).toBe(0);
  observation.activate();
  send(stream, { v: { message: call("foreign", "turn_fixture_previous_secret_0123456789") } },
    { message: { ...call("other"), recipient: "python" } },
    { message: { id:"prose", author:{role:"assistant"}, channel:"final", content:{content_type:"text",parts:[JSON.stringify(call())]} } },
    { v: { message: call() } }, { v: { message: call() } });
  expect(observation.snapshot()).toMatchObject({ active:true, boundCalls:1, foreignBindings:1, matchedResults:0 });
  observation.observe({...call("checkpoint"),metadata:{connector_tool_payload:JSON.stringify({turn_token:binding,wire_name:"_codex_context_checkpoint",arguments:{}})}});
  expect(observation.snapshot().boundCalls).toBe(1);
  send(stream, { message:{id:"unrelated-result",author:{role:"tool"},metadata:{parent_id:"other"},content:{content_type:"text",parts:["PRIVATE_RESULT"]}} });
  expect(observation.snapshot().matchedResults).toBe(0);
  send(stream, { message:{id:"result",author:{role:"tool"},metadata:{parent_id:"call-1"},content:{content_type:"text",parts:["PRIVATE_RESULT"]}} });
  expect(observation.snapshot().matchedResults).toBe(1);
  expect(JSON.stringify({stream:stream.facts,mcp:observation.snapshot()})).not.toMatch(/PRIVATE|turn_fixture|call-1/);
});

test("metadata replacement envelopes and bounded malformed payloads never invent a binding", () => {
  const observation = new ChatGptMcpCallObservation(fingerprint(binding)); observation.activate();
  const stream = new ChatGptStreamProjection(observation), message=call();
  send(stream, { v:{message:{...message,metadata:{}}} }, { p:"/message/metadata/connector_tool_payload",o:"replace",v:message.metadata.connector_tool_payload });
  expect(observation.snapshot().boundCalls).toBe(1);
  for(const payload of ["{}", "{", "A".repeat(512_001)]) observation.observe({...call("invalid-"+payload.length), metadata:{connector_tool_payload:payload}});
  expect(observation.snapshot().invalidPayloads).toBe(3);
  observation.observe(call("invalid-1"));
  expect(observation.snapshot()).toMatchObject({boundCalls:2,invalidPayloads:2});
  for(let i=0;i<200;i++) observation.observe(call("bounded-"+i));
  expect(observation.snapshot().boundCalls).toBeLessThanOrEqual(128);
  expect(observation.snapshot().truncated).toBeTrue();
});

async function brokerFixture(run:(broker:TurnBroker, token:string, root:string)=>Promise<void>) {
  const parent=resolve(tmpdir()),root=mkdtempSync(join(parent,"w2h-unreceived-"));
  const broker=TurnBroker.forSocket(defaultBrokerEndpoint(root));
  broker.configureHandoffJournal(join(root,"receipts"));
  try {
    const token=await broker.registerHandoff({cwd:root,roots:[root],writableRoots:[],sandboxPolicy:{type:"readOnly",networkAccess:false},tools:[{name:"read_fixture",description:"Read",parameters:{type:"object"}}]}, {allowBrowserReply:true});
    await run(broker,token,root);
  } finally { await broker.close(); if(dirname(resolve(root))!==parent||!root.startsWith(join(parent,"w2h-unreceived-")))throw Error("Fixture ownership mismatch"); rmSync(root,{recursive:true}); }
}

test("an issued but unreceived call cannot become a successful ordinary reply; Responses preserves the terminal error", () => brokerFixture(async(broker,token)=>{
  const observation=new ChatGptMcpCallObservation(fingerprint(token)); observation.activate();
  const stream=new ChatGptStreamProjection(observation);
  send(stream,{message:call("call-1",token)},{message:{id:"final",author:{role:"assistant"},channel:"final",content:{content_type:"text",parts:["The operation was not executed; the cause is unconfirmed."]}}});
  stream.push(Buffer.from("data: [DONE]\n\n").toString("base64"));
  const wait=new CompletionFenceWait();
  expect(observeMcpCompletion(broker.beginCompletionFence(token),observation.snapshot(),wait,100,1000).state).toBe("awaiting_intent");
  expect(observeMcpCompletion(broker.beginCompletionFence(token),observation.snapshot(),wait,1099,1000).state).toBe("awaiting_intent");
  let failure:any;
  try { observeMcpCompletion(broker.beginCompletionFence(token),observation.snapshot(),wait,1100,1000); } catch(error){failure=error}
  expect(failure).toMatchObject({code:"mcp_handoff_not_received",status:502,retryable:false});
  expect(()=>broker.confirmHandoffPhysicalSettlement(token)).toThrow("fence");
  const body=await new Response(bridgeToResponsesSSE((async function*(){yield {type:"error" as const,message:failure.message,status:failure.status,code:failure.code,errorType:failure.errorType,retryable:failure.retryable}})(),"gpt-6-sol")).text();
  expect(body).toContain('"code":"mcp_handoff_not_received"'); expect(body).not.toContain('"type":"response.completed"');
}));

test("a real late receipt settles inside the same fence budget; ordinary answers need no MCP call", () => brokerFixture(async(broker,token)=>{
  const observation=new ChatGptMcpCallObservation(fingerprint(token)); observation.activate();
  const wait=new CompletionFenceWait();
  expect(observeMcpCompletion(broker.beginCompletionFence(token),observation.snapshot(),wait,0,1000).state).toBe("ready");
  observation.observe(call("late",token));
  expect(observeMcpCompletion(broker.beginCompletionFence(token),observation.snapshot(),wait,10,1000).state).toBe("awaiting_intent");
  const claim=await callTurnBroker<{activityId:string;bindingId:string}>(broker.socketPath,{method:"claim",token,protocol:"web2harness-handoff-v1"});
  expect(observeMcpCompletion(broker.beginCompletionFence(token),observation.snapshot(),wait,200,1000).state).toBe("activity_in_flight");
  await callTurnBroker(broker.socketPath,{method:"handoff_submit",bindingId:claim.bindingId,activityId:claim.activityId,protocol:"web2harness-handoff-v1",submissionId:"read",calls:[{name:"read_fixture",arguments:{}}],sealOnSubmit:true});
  await callTurnBroker(broker.socketPath,{method:"activity_complete",token,activityId:claim.activityId});
  const fence=observeMcpCompletion(broker.beginCompletionFence(token),observation.snapshot(),wait,1009,1000);
  expect(fence.state).toBe("ready"); if(!("revision"in fence))throw Error("Expected ready");
  expect(broker.commitCompletionFence(token,fence.revision,"Submitted.")).toMatchObject({state:"committed",awaitingToolResults:true});
  expect((await broker.deliverHandoff(token)).requests).toHaveLength(1);
}));

test("waiting for delivery cannot reset the existing deadline when local activity starts", () => {
  const wait=new CompletionFenceWait(),observation=new ChatGptMcpCallObservation(fingerprint(binding)); observation.activate(); observation.observe(call());
  observeMcpCompletion({state:"ready",revision:0},observation.snapshot(),wait,0,1000);
  expect(()=>observeMcpCompletion({state:"activity_in_flight",activities:1,invocations:0,sealed:false},observation.snapshot(),wait,1000,1000)).toThrow("still unsettled");
});

const remote429 = { kind: "rate_limit", source: "probe", status: 429 } as const;
const resultMessage = (parent = "call-1", text = "MCP SSE probe returned 429 from openai.org PRIVATE_SECRET") => ({
  id: "result-" + parent, author: { role: "tool", name: "api_tool.call_tool" }, metadata: { parent_id: parent },
  content: { content_type: "text", parts: [text] },
});
test("remote failures require the current binding and real tool author, including streamed results", () => {
  const observation = new ChatGptMcpCallObservation(fingerprint(binding)); observation.activate();
  const stream = new ChatGptStreamProjection(observation);
  send(stream, { message: call("foreign", "old-token") }, { message: resultMessage("foreign") },
    { message: { ...resultMessage(), author: { role: "assistant" } } });
  expect(observation.snapshot().remoteFailure).toBeUndefined();
  send(stream, { message: call() }, { message: resultMessage("call-1", "") },
    { p: "/message/content/parts/0", o: "append", v: "MCP SSE probe returned 429 from " },
    { o: "append", v: "openai.org PRIVATE_SECRET" });
  expect(observation.snapshot().remoteFailure).toEqual(remote429);
  expect(JSON.stringify({ facts: stream.facts, observation: observation.snapshot() })).not.toMatch(/PRIVATE|turn_fixture/);
  expect(() => observeMcpCompletion({ state: "ready", revision: 0 }, observation.snapshot(), new CompletionFenceWait(), 0, 1000))
    .toThrow("rate limited");
  expect(observeMcpCompletion({ state: "ready", revision: 2 }, observation.snapshot(), new CompletionFenceWait(), 0, 1000)).toEqual({ state: "ready", revision: 2 });
});

test("atomic retirement rejects late claims and cannot retire even completed prior activity", () => brokerFixture(async (broker, token) => {
  expect(broker.retireUnreceivedHandoff(token)).toBe(true);
  expect(broker.retireUnreceivedHandoff(token)).toBe(false);
  await expect(callTurnBroker(broker.socketPath, { method: "claim", token, protocol: "web2harness-handoff-v1" })).rejects.toBeDefined();
}));
test("a claimed binding never authorizes recovery even when the activity later ends", () => brokerFixture(async (broker, token) => {
  const claim = await callTurnBroker<{ activityId: string }>(broker.socketPath, { method: "claim", token, protocol: "web2harness-handoff-v1" });
  expect(broker.retireUnreceivedHandoff(token)).toBe(false);
  await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claim.activityId });
  expect(broker.retireUnreceivedHandoff(token)).toBe(false);
}));

test.each(["safe", "activity", "cleanup-failed", "cancelled", "long-wait", "quota"])(
  "worker recovery requires settled resources and broker authority: %s", scenario => brokerFixture(async (broker, token, root) => {
    const queue = await StandaloneRequestQueue.open(join(root, "state.json"));
    let released = false, authorizations = 0;
    const abort = new AbortController();
    if (scenario === "activity") await callTurnBroker(broker.socketPath, { method: "claim", token, protocol: "web2harness-handoff-v1" });
    const original = new ChatGptWebAdapterError("Remote MCP rate limited", { status: 502, errorType: "server_error", code: "mcp_remote_rate_limited", retryable: false,
      mcpRemote: scenario === "quota" ? { ...remote429, kind: "quota" } : { ...remote429, ...(scenario === "long-wait" ? { retryAfterMs: 121000 } : {}) } });
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
      config: { browserHost: "managed-chrome" }, activeRuns: new Map(), preparationBudgets: new Map(), requestQueueTarget: async () => queue,
      runExclusive: async (current: BrowserTurn) => {
        await queue.holdResource(current.queueTicket!, () => released);
        released = true;
        if (scenario === "cancelled") abort.abort();
        if (scenario === "cleanup-failed") throw new AggregateError([original], "Physical cleanup uncertain");
        throw original;
      },
    }) as ChatGptBrowserWorker;
    const key = fingerprint(root);
    const turn: BrowserTurn = { traceId: "recovery-" + scenario, modelId: "gpt-6-sol", abortSignal: abort.signal,
      scheduling: { id: key, groupId: "test", model: "gpt-6-sol", mode: "mcp-bridge", bytes: 1,
        mcpScope: fingerprint("isolated-tunnel"), connectorName: "Fixture DEV", retryAttempt: 0 },
      capabilities: { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "test", images: [], release() {} }), onTextDelta() {},
      authorizeMcpRecovery: async () => { authorizations++; expect(released).toBe(true); return broker.retireUnreceivedHandoff(token); },
    };
    try {
      const error = await worker.run(turn).catch(error => error);
      expect(error.retryable === true).toBe(scenario === "safe");
      expect(authorizations).toBe(["safe", "activity"].includes(scenario) ? 1 : 0);
      expect(queue.snapshot().active).toBe(0);
      if (scenario === "safe") {
        expect(queue.snapshot().mcpStatus[0].lastFailure).toEqual(remote429);
        await queue.close();
        const restored = await StandaloneRequestQueue.open(join(root, "state.json"));
        try { expect(restored.snapshot().mcpStatus[0].lastFailure).toEqual(remote429); }
        finally { await restored.close(); }
      }
    } finally { released = true; await queue.close(); }
  }),
);

test.each(["mcp_remote_error", "mcp_handoff_not_received"])("adapter retirement and amended reconnect preserve cooldown and terminal cause %s", terminalCode => brokerFixture(async (broker, _token, root) => {
  const queue = await StandaloneRequestQueue.open(join(root, "adapter-state.json"));
  const provider: CodexProviderConfig = { adapter: "chatgpt-web", baseUrl: "browser://" + root,
    chatgptWeb: { browserHost: "managed-chrome", storageStatePath: join(root, "adapter-state.json"), appName: "Codex Native2 DEV",
      brokerSocketPath: broker.socketPath, mcpTunnelId: "isolated-fixture", localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true } };
  const worker: any = ChatGptBrowserWorker.forProvider(provider);
  const originalExecute = worker.runExclusive, originalQueue = worker.requestQueueTarget;
  let executions = 0;
  worker.requestQueueTarget = async () => queue;
  worker.runExclusive = async (turn: BrowserTurn) => {
    executions++; const prepared = await turn.prepare(); prepared.release();
    await turn.onSendActivated?.(); await turn.onSubmitted?.();
    throw new ChatGptWebAdapterError("Remote MCP rate limited", { status: 502, errorType: "server_error", code: "mcp_remote_rate_limited", retryable: false, mcpRemote: remote429 });
  };
  const request: CodexParsedRequest = { modelId: "gpt-5.6-sol", stream: true, options: { reasoning: "high" },
    context: { systemPrompt: ["<environment_context><cwd>" + root + "</cwd><sandbox_mode>read-only</sandbox_mode></environment_context>"],
      tools: [{ name: "read_fixture", description: "Read", parameters: { type: "object" } }], messages: [{ role: "user", content: "Read the fixture", timestamp: 1 }] } };
  request._rawBody = { client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_" + fingerprint(root), turn_id: "turn_recovery", sandbox: "read-only", workspaces: { [root]: {} } }) },
    input: [{ type: "message", id: "msg_context", role: "user", content: [{ type: "input_text", text: "<app-context>native app context</app-context>" },
      { type: "input_text", text: "<environment_context><cwd>" + root + "</cwd><filesystem><workspace_roots><root>" + root + "</root></workspace_roots><permission_profile type=\"managed\"><file_system type=\"restricted\"><entry access=\"read\"><special>:root</special></entry></file_system></permission_profile></filesystem></environment_context>" }] },
      { type: "message", id: "msg_active", role: "user", content: [{ type: "input_text", text: "Read the fixture" }] }] };
  try {
    const events: AdapterEvent[] = [];
    await createChatGptWebAdapter(provider, { broker }).runTurn!(request, { headers: new Headers() }, event => events.push(event));
    expect(events.filter(event => event.type === "error")).toMatchObject([{ code: "mcp_remote_rate_limited", retryable: true }]);
    expect(executions).toBe(1);
    const receipts = await import("node:fs/promises").then(fs => fs.readFile(join(queue.directory, "receipts.json"), "utf8")).then(JSON.parse);
    expect(receipts.records).toHaveLength(1);
    expect(receipts.records[0]).toMatchObject({ state: "failed", reason: "mcp_remote_rate_limited" });
    expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0, mcpStatus: [{ lastFailure: remote429 }] });
    expect(queue.snapshot().mcpStatus[0].cooldownUntil! - Date.now()).toBeGreaterThan(29000);
    // Advance only this fixture's clock. The next real adapter attempt ends with 404 after prose;
    // an amended reconnect must retain the terminal error and never enter the worker again.
    const core = (queue as any).core, clock = core.monotonicNow.bind(core);
    core.monotonicNow = () => clock() + 36000;
    worker.runExclusive = async (turn: BrowserTurn) => {
      executions++; const prepared = await turn.prepare(); prepared.release();
      turn.onTextDelta("The connector failed.");
      throw new ChatGptWebAdapterError("Remote MCP returned 404", { status: 502, errorType: "server_error", code: terminalCode, retryable: false,
        ...(terminalCode === "mcp_remote_error" ? { mcpRemote: { kind: "other" as const, source: "probe" as const, status: 404 } } : {}) });
    };
    const permanent: AdapterEvent[] = [];
    await createChatGptWebAdapter(provider, { broker }).runTurn!(request, { headers: new Headers() }, event => permanent.push(event));
    expect(permanent.filter(event => event.type === "error")).toMatchObject([{ code: terminalCode, retryable: false }]);
    const amended = structuredClone(request);
    (amended._rawBody as any).input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: "The connector failed." }] });
    amended.context.messages.push({ role: "assistant", content: [{ type: "text", text: "The connector failed." }], timestamp: 2 });
    const reconnect: AdapterEvent[] = [];
    await createChatGptWebAdapter(provider, { broker }).runTurn!(amended, { headers: new Headers() }, event => reconnect.push(event));
    expect(reconnect.filter(event => event.type === "error")).toMatchObject([{ code: terminalCode, retryable: false }]);
    expect(executions).toBe(2);
  } finally { worker.runExclusive = originalExecute; worker.requestQueueTarget = originalQueue; await queue.close(); }
}));
