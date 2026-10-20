import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ChatGptResponseStream } from "../../../../src/adapters/chatgpt-web/browser/response-stream";
import { responseSourceBlocksFallback } from "../../../../src/adapters/chatgpt-web/browser/response-source";
import { replayChatGptResponseEvidence } from "../../../../src/adapters/chatgpt-web/browser/response-replay";
import { safeDetail } from "../../../../launcher/shared/diagnostic-event.cjs";
import { chatGptResponseDeliveryEvidence } from "../../../../src/adapters/chatgpt-web/browser/response-delivery-evidence";

const input = { id: "input-current", author: { role: "user" }, content: { content_type: "text", parts: ["test prompt"] } };
const frames = ["v1", { type: "input_message", input_message: input, conversation_id: "current" },
  { p: "", o: "add", v: { conversation_id: "current", message: { id: "answer", author: { role: "assistant" }, channel: "final", recipient: "all",
    status: "finished_successfully", end_turn: true, content: { content_type: "text", parts: ["Exact **answer**\n\nRepeated\n\nRepeated"] },
    metadata: { parent_id: input.id, is_complete: true, finish_details: { type: "stop" } } } } },
  { type: "message_stream_complete", conversation_id: "current" }, "[DONE]"];
const wire = (values: unknown[]) => Buffer.from(values.map(v => `data: ${v === "[DONE]" ? v : JSON.stringify(v)}\n\n`).join(""));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
class Session extends EventEmitter {
  calls: string[] = [];
  streaming: () => Promise<{ bufferedData: string }> = async () => ({ bufferedData: "" });
  async send(method: string) {
    this.calls.push(method);
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "owned-frame" } } };
    if (method === "Network.streamResourceContent") return this.streaming();
    if (method === "Network.getResponseBody") return { body: wire(frames).toString(), base64Encoded: false };
    return {};
  }
  async detach() {}
  request(frameId = "owned-frame", requestId = "owned-request", prompt = "test prompt") {
    this.emit("Network.requestWillBeSent", { frameId, requestId, request: { method: "POST", url: "https://chatgpt.com/backend-api/f/conversation",
      postData: JSON.stringify({ action: "next", conversation_id: "current", messages: [{ ...input, content: { parts: [prompt] } }] }) } });
  }
  response(status = 200) { this.emit("Network.responseReceived", { requestId: "owned-request", response: { status, mimeType: "text/event-stream" } }); }
  data(bytes: Buffer, requestId = "owned-request") { this.emit("Network.dataReceived", { requestId, data: bytes.toString("base64") }); }
  async complete(failed = false) { this.emit(failed ? "Network.loadingFailed" : "Network.loadingFinished", { requestId: "owned-request", canceled: failed }); await flush(); }
}
const page = (session: Session): any => Object.assign(new EventEmitter(), { context: () => ({ newCDPSession: async () => session }) });

test("automatic resume uses a fresh transport cursor and a known message snapshot without duplicate body", async () => {
  const session = new Session(), source = new ChatGptResponseStream({ captureEvidence: true });
  await source.attach(page(session)); source.activate("test prompt", "current");
  session.request(); session.response(); await flush();
  const partial = structuredClone(frames.slice(0, 3));
  (partial[2] as any).v.message.status = "in_progress";
  (partial[2] as any).v.message.end_turn = false;
  (partial[2] as any).v.message.content.parts = ["Draft"];
  session.data(wire(partial)); await session.complete(true);
  session.emit("Network.requestWillBeSent", { frameId: "owned-frame", requestId: "resume", request: {
    method: "GET", url: "https://chatgpt.com/backend-api/f/conversation/resume" } });
  session.emit("Network.responseReceived", { requestId: "resume", response: { status: 200, mimeType: "text/event-stream" } });
  await flush();
  session.data(wire(["v1", ...frames.slice(2)]), "resume");
  await session.complete(true); // Late termination from the previous physical request is ignored.
  expect(source.result()).toMatchObject({ state: "complete", text: "Exact **answer**\n\nRepeated\n\nRepeated" });
  expect(source.snapshot()).toMatchObject({ matchedRequests: 1, resumed: 1 });
  expect(session.calls).not.toContain("Network.getResponseBody");
  const delivery = chatGptResponseDeliveryEvidence({ traceId: "delivery-resume", selectedSource: "response",
    delivered: "Exact **answer**\n\nRepeated\n\nRepeated", source });
  expect(delivery.observation.resumed).toBe(1);
  expect(delivery.source).toMatchObject({ state: "complete", messageId: "answer", text: delivery.delivered.text });
  expect(delivery.dom).toEqual({ state: "unobserved" });
  expect(delivery.events!.summary.framingIncomplete).toBeTrue(); // Never claim a complete physical stream.
  expect(delivery.events!.records.length).toBeGreaterThan(frames.length);
  expect(delivery.delivered.sha256).toHaveLength(64);
  await source.detach();
});

test("delivery diagnostics preserve differing public renderings without authorizing, repairing or logging private DOM", async () => {
  const session = new Session(), source = new ChatGptResponseStream({ captureEvidence: true });
  await source.attach(page(session)); source.activate("test prompt", "current");
  session.request(); session.response(); await flush(); session.data(wire(frames));
  const delivery = chatGptResponseDeliveryEvidence({ traceId: "delivery-dom", selectedSource: "dom", delivered: "Actual DOM answer",
    source, dom: { responsePresent: true, contentState: "complete", messageId: "answer", visibleText: "Actual DOM answer",
      fullHtml: "hidden HTML must not persist", traceBlocks: [{ kind: "status", text: "private trace must not persist" }],
      markdownSegments: [{ key: "private-key", tag: "p", html: "private HTML", text: "Actual DOM answer", streamable: false }],
      completionActionVisible: true, stoppedThinkingVisible: false } });
  expect(delivery.delivered.text).toBe("Actual DOM answer");
  expect(delivery.source).toMatchObject({ text: "Exact **answer**\n\nRepeated\n\nRepeated" });
  expect(delivery.dom).toMatchObject({ visible: { text: "Actual DOM answer" }, segments: [{ tag: "p", text: "Actual DOM answer" }] });
  expect(JSON.stringify(delivery)).not.toContain("private");
  expect(JSON.stringify(delivery)).not.toContain("hidden HTML");
  await source.detach();
});

test("resume route and frame alone cannot authorize an unrelated answer or unbound append", async () => {
  for (const continuation of [{ p: "/message/content/parts/0", o: "append", v: "foreign" },
    { ...(frames[2] as any), v: { ...(frames[2] as any).v, message: { ...(frames[2] as any).v.message, id: "foreign" } } }]) {
    const session = new Session(), source = new ChatGptResponseStream();
    await source.attach(page(session)); source.activate("test prompt", "current");
    session.request(); session.response(); await flush(); session.data(wire(frames.slice(0, 3))); await session.complete(true);
    session.emit("Network.requestWillBeSent", { frameId: "owned-frame", requestId: "resume", request: {
      method: "GET", url: "https://chatgpt.com/backend-api/f/conversation/resume" } });
    session.emit("Network.responseReceived", { requestId: "resume", response: { status: 200, mimeType: "text/event-stream" } });
    await flush(); session.data(wire(["v1", continuation, ...frames.slice(3)]), "resume");
    expect(source.result().state).toBe("rejected");
    expect(responseSourceBlocksFallback(source.result())).toBeTrue();
    expect(source.snapshot().matchedRequests).toBe(1);
    await source.detach();
  }
});

test("resume after a logical DONE without a complete message fails without throwing from the event listener", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  await source.attach(page(session)); source.activate("test prompt", "current");
  session.request(); session.response(); await flush();
  session.data(wire([...frames.slice(0, 3), "[DONE]"])); await session.complete(true);
  expect(() => session.emit("Network.requestWillBeSent", {
    frameId: "owned-frame", requestId: "resume",
    request: { method: "GET", url: "https://chatgpt.com/backend-api/f/conversation/resume" },
  })).not.toThrow();
  expect(source.result()).toMatchObject({ state: "rejected", kind: "invalid", reason: "response_after_termination" });
  await source.detach();
});

test("request binding shares exact composer space equivalence and reports payload-free rejection reasons", async () => {
  for (const observed of ["test  prompt", "test \u00a0prompt", "test\u00a0 prompt"]) {
    const session = new Session(), source = new ChatGptResponseStream();
    await source.attach(page(session));source.activate("test  prompt", "current");session.request("owned-frame", "owned-request", observed);
    expect(source.snapshot().matchedRequests).toBe(1);await source.detach();
  }
  for (const [expected, observed] of [["test prompt", "test\u00a0prompt"], ["test  prompt", "test\t prompt"],
    ["test\u00a0 prompt", "test  prompt"], ["test  prompt", "test prompt"], ["test  prompt", "different"]]) {
    const session = new Session(), source = new ChatGptResponseStream();
    await source.attach(page(session));source.activate(expected!, "current");session.request("owned-frame", "owned-request", observed!);
    expect(source.snapshot().matchedRequests).toBe(0);
    expect(source.snapshot().traffic).toEqual([{ method: "POST", endpoint: "generation", bound: false, reason: "request_prompt_unmatched" }]);
    expect(safeDetail({ traffic: source.snapshot().traffic })).toEqual({ traffic: source.snapshot().traffic });
    await source.detach();
  }
});

test("request binding recognizes one Markdown serialization layer without losing literal content", async () => {
  const samples = [
    ["<context_json>\n{\"path\":\"C:\\\\fixture\\\\a_b.txt\",\"value\":\"**bold**\"}\n</context_json>",
      String.raw`\<context\_json>` + "\n" + String.raw`{"path":"C:\\\\fixture\\\\a\_b.txt","value":"\*\*bold\*\*"}` + "\n" + String.raw`\</context\_json>`],
    ["[item](https://example.invalid/a_b)", String.raw`\[item\]([https://example.invalid/a_b](https://example.invalid/a_b))`],
    ["https://example.invalid/a\\\\", String.raw`[https://example.invalid/a\\\\](https://example.invalid/a\\\\)`],
  ];
  for (const [expected, submitted] of samples) {
    const session = new Session(), source = new ChatGptResponseStream();
    await source.attach(page(session));source.activate(expected!, "current");session.request("owned-frame", "owned-request", submitted!);
    expect(source.snapshot().matchedRequests).toBe(1);await source.detach();
  }
  for (const [expected, submitted] of [
    ["https://example.invalid/a", "[https://example.invalid/a](https://different.invalid/a)"],
    [String.raw`C:\\fixture\a_b`, String.raw`C:\fixture\a_b`],
    ["a_b", String.raw`a\\_b`],
    ["<context>\nkeep  spaces", String.raw`\<context>` + "\nkeep spaces"],
    ["<context>\nkeep\tspace", String.raw`\<context>` + "\nkeep space"],
    ["<context>\noriginal", String.raw`\<context>` + "\nchanged"],
  ]) {
    const session = new Session(), source = new ChatGptResponseStream();
    await source.attach(page(session));source.activate(expected!, "current");session.request("owned-frame", "owned-request", submitted!);
    expect(source.snapshot().matchedRequests).toBe(0);await source.detach();
  }
});

test("CDP preserves buffered/live chunk order and accepts application completion before fetch cancellation", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  let activate!: (value: { bufferedData: string }) => void;
  session.streaming = () => new Promise(resolve => { activate = resolve; });
  await source.attach(page(session)); source.activate("test prompt", "current");
  session.request(); session.response();
  expect(source.submissionAccepted()).toBe(false); // HTTP 200 alone is insufficient.
  const bytes = wire(frames), split = Math.floor(bytes.length / 2);
  session.data(bytes.subarray(split));
  activate({ bufferedData: bytes.subarray(0, split).toString("base64") });
  await session.complete(true);
  expect(source.result()).toMatchObject({ state: "complete", text: "Exact **answer**\n\nRepeated\n\nRepeated" });
  expect(source.submissionAccepted()).toBe(true);
  expect(session.calls).not.toContain("Network.getResponseBody");
  await source.detach();
});

test("short completed responses can use getResponseBody on the same request without resending", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  session.streaming = async () => { throw Error("already completed"); };
  await source.attach(page(session)); source.activate("test prompt", "current");
  session.request(); session.response(); await session.complete();
  expect(source.result()).toMatchObject({ state: "complete" });
  expect(session.calls.filter(c => c === "Network.getResponseBody")).toHaveLength(1);
  expect(session.calls.every(c => ["Page.getFrameTree", "Network.enable", "Network.streamResourceContent", "Network.getResponseBody"].includes(c))).toBe(true);
  await source.detach();
});

test("a normally finished request recovers missed live chunks from its own body once", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  await source.attach(page(session)); source.activate("test prompt", "current");
  session.request(); session.response(); await flush();
  session.data(wire(frames.slice(0, 2))); await session.complete(); await session.complete();
  expect(source.result()).toMatchObject({ state: "complete", text: "Exact **answer**\n\nRepeated\n\nRepeated" });
  expect(session.calls.filter(c => c === "Network.getResponseBody")).toHaveLength(1);
  expect(source.snapshot()).toMatchObject({ matchedRequests: 1, bodyRecoveryAttempted: true });
  await source.detach();
});

test("completed framing plus unsupported semantics is not mislabeled as network truncation", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  await source.attach(page(session)); source.activate("test prompt");
  session.request(); session.response(); await flush();
  session.data(wire([...frames.slice(0, 3), { type: "unknown-control" }, ...frames.slice(3)]));
  await session.complete(true);
  expect(source.result()).toEqual({ state: "rejected", reason: "response_event_unsupported" });
  expect(source.snapshot()).toMatchObject({ transportFailed: true, projection: { observedDone: true, observedStreamComplete: true } });
  expect(session.calls).not.toContain("Network.getResponseBody");
  await source.detach();
});

test("foreign frames, old responses and unmatched prompts cannot acknowledge this send", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  await source.attach(page(session)); session.request(); // Before activation.
  source.activate("test prompt", "current");
  session.request("other-frame"); session.request("owned-frame", "old", "old prompt");
  session.response(); session.data(wire(frames), "old");
  expect(source.submissionAccepted()).toBe(false); expect(source.snapshot().matchedRequests).toBe(0);
  session.request(); session.response(); await flush(); session.data(wire(frames));
  session.request("owned-frame", "duplicate");
  expect(responseSourceBlocksFallback(source.result())).toBe(true);
  expect(source.result()).toMatchObject({ reason: "response_request_ambiguous" });
  await source.detach();
});

test("a canceled partial response is incomplete even after a server input acknowledgement", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  await source.attach(page(session)); source.activate("test prompt"); session.request(); session.response(); await flush();
  session.data(wire(frames.slice(0, 3))); await session.complete(true);
  expect(source.submissionAccepted()).toBe(true);
  expect(source.result()).toEqual({ state: "rejected", reason: "response_transport_incomplete", kind: "unavailable" });
  await source.detach();
});

test("late events from a detached session cannot become the new page's answer", async () => {
  const session = new Session(), other = new Session(), source = new ChatGptResponseStream();
  await source.attach(page(session)); source.activate("test prompt"); session.request(); session.response();
  await source.attach(page(other)); session.data(wire(frames)); await session.complete();
  expect(source.result()).toEqual({ state: "rejected", reason: "response_observation_rebound", kind: "unavailable" });
  expect(source.submissionAccepted()).toBe(false);
  await source.detach();
});

test("normal source completion does not wait for HTTP close; observed post-DONE data is still rejected", async () => {
  const session = new Session(), source = new ChatGptResponseStream();
  await source.attach(page(session)); source.activate("test prompt");
  session.request(); session.response(); await flush(); session.data(wire(frames));
  expect(source.result()).toMatchObject({ state: "complete", text: "Exact **answer**\n\nRepeated\n\nRepeated" });
  session.data(Buffer.from('data: {"secret":"late'));
  await session.complete();
  expect(source.result()).toEqual({ state: "rejected", reason: "response_after_termination" });
  expect(responseSourceBlocksFallback(source.result())).toBe(true);
  await source.detach();
});

test("send diagnostics are bounded, classified and detached without retaining private content", async () => {
  const session = new Session(), source = new ChatGptResponseStream(), ownedPage = page(session);
  await source.attach(ownedPage);
  ownedPage.emit("pageerror", Error("before activation"));
  source.activate("test prompt");
  for (let i = 0; i < 35; i++) session.emit("Network.requestWillBeSent", {
    frameId: "owned-frame", requestId: `private-${i}`, request: { method: "GET",
      url: "https://chatgpt.com/backend-api/conversation/private-id?token=private-token", postData: "private-body" },
  });
  session.emit("Network.responseReceived", { requestId: "private-0", response: { status: 403 } });
  session.emit("Network.loadingFailed", { requestId: "private-1", errorText: "private-failure" });
  ownedPage.emit("pageerror", Error("private-exception"));
  const snapshot = source.snapshot();
  expect(snapshot.traffic).toHaveLength(32);
  expect(snapshot.droppedTraffic).toBe(3);
  expect(snapshot.traffic[0]).toEqual({ method: "GET", endpoint: "conversation", bound: false, status: 403 });
  expect(snapshot.traffic[1]?.failed).toBe(true);
  expect(snapshot.pageExceptions).toBe(1);
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(source.submissionAccepted()).toBe(false);
  await source.detach();
  ownedPage.emit("pageerror", Error("after detach"));
  expect(source.snapshot().pageExceptions).toBe(1);
  expect(ownedPage.listenerCount("pageerror")).toBe(0);
});

test("private evidence is opt-in, bound to this response, and exported once before detach", async () => {
  const session = new Session(), source = new ChatGptResponseStream({ captureEvidence: true });
  try {
    await source.attach(page(session)); source.activate("test prompt", "current");
    session.request(); session.response(); await flush();
    session.data(Buffer.from('data: {"foreign":"SECRET_FOREIGN"}\n\n'), "foreign-request");
    const incomplete = structuredClone(frames);
    (incomplete[2] as any).v.message.metadata.is_complete = false;
    session.data(wire(incomplete)); await session.complete(true);
    expect(source.result()).toEqual({ state: "rejected", reason: "response_message_incomplete" });
    const artifact = source.takeEvidence()!;
    expect(artifact.observation).toMatchObject({ accepted: true, finished: true, matchedRequests: 1 });
    expect(artifact.bodyFallback).toBe(false);
    expect(JSON.stringify(artifact)).not.toContain("test prompt");
    expect(JSON.stringify(artifact)).not.toContain("SECRET_FOREIGN");
    expect(JSON.stringify(source.snapshot())).not.toContain("Exact **answer**");
    expect(replayChatGptResponseEvidence(artifact)).toMatchObject({ state: "replayed", fidelity: "privacy-projected", result: source.result() });
    expect(source.takeEvidence()).toBeUndefined();
  } finally { await source.detach(); }
});

test("detach discards unexported evidence and the default observer never exports body content", async () => {
  for (const captureEvidence of [false, true]) {
    const session = new Session(), source = new ChatGptResponseStream({ captureEvidence });
    try {
      await source.attach(page(session)); source.activate("test prompt", "current");
      session.request(); session.response(); await flush(); session.data(wire(frames)); await session.complete();
      expect(source.result().state).toBe("complete");
      if (!captureEvidence) expect(source.takeEvidence()).toBeUndefined();
    } finally { await source.detach(); }
    expect(source.takeEvidence()).toBeUndefined();
  }
});

test("same-response body fallback exports one coherent replay, not a concatenated partial attempt", async () => {
  const session = new Session(), source = new ChatGptResponseStream({ captureEvidence: true });
  session.streaming = async () => { throw Error("unavailable"); };
  try {
    await source.attach(page(session)); source.activate("test prompt", "current");
    session.request(); session.response(); session.data(wire(frames.slice(0, 2))); await session.complete();
    const artifact = source.takeEvidence()!;
    expect(artifact.bodyFallback).toBe(true);
    expect(artifact.summary.events).toBe(frames.length);
    expect(replayChatGptResponseEvidence(artifact)).toMatchObject({ state: "replayed", result: source.result() });
    expect(session.calls.filter(c => c === "Network.getResponseBody")).toHaveLength(1);
  } finally { await source.detach(); }
});

test("a hung stream activation is bounded and a late activation cannot replay the completed body", async () => {
  const session = new Session(), source = new ChatGptResponseStream({ captureEvidence: true, operationTimeoutMs: 30 });
  let lateActivation!: (value: { bufferedData: string }) => void;
  session.streaming = () => new Promise(resolve => { lateActivation = resolve; });
  try {
    await source.attach(page(session)); source.activate("test prompt", "current");
    session.request(); session.response(); await session.complete();
    expect(source.result().state).toBe("collecting");
    await Bun.sleep(60);
    expect(source.result().state).toBe("complete");
    expect(session.calls.filter(c => c === "Network.getResponseBody")).toHaveLength(1);
    lateActivation({ bufferedData: wire(frames).toString("base64") }); await flush();
    expect(source.result().state).toBe("complete");
    const artifact = source.takeEvidence()!;
    expect(artifact.bodyFallback).toBe(true);
    expect(artifact.summary.events).toBe(frames.length);
  } finally { await source.detach(); }
}, 5000);
