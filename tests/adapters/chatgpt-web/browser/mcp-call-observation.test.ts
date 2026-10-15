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

async function brokerFixture(run:(broker:TurnBroker, token:string)=>Promise<void>) {
  const parent=resolve(tmpdir()),root=mkdtempSync(join(parent,"w2h-unreceived-"));
  const broker=TurnBroker.forSocket(defaultBrokerEndpoint(root));
  broker.configureHandoffJournal(join(root,"receipts"));
  try {
    const token=await broker.registerHandoff({cwd:root,roots:[root],writableRoots:[],sandboxPolicy:{type:"readOnly",networkAccess:false},tools:[{name:"read_fixture",description:"Read",parameters:{type:"object"}}]}, {allowBrowserReply:true});
    await run(broker,token);
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
