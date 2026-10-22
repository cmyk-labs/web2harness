import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseContextResyncReply, contextResyncProgress, contextResyncError } from "../../../../src/adapters/chatgpt-web/conversation/context-resync";
import { createChatGptWebAdapter, chatGptWebExecutionNamespace } from "../../../../src/adapters/chatgpt-web/adapter";
import { ChatGptBrowserWorker, type BrowserTurn } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { chatGptConversationKey, rememberRetainedConversationSource, retainedConversationResumeRequest } from "../../../../src/adapters/chatgpt-web/conversation/conversation-key";
import { chatGptTurnSessions } from "../../../../src/adapters/chatgpt-web/tools/turn-execution";
import { ChatGptWebAdapterError } from "../../../../src/adapters/chatgpt-web/adapter-error";
import { parseRequest } from "../../../../src/responses/parser";
import { encodeCompactionSummary } from "../../../../src/responses/compaction";
import { withQueuedRequest } from "../../../../src/browser/request-queue-client";
import { StandaloneRequestQueue } from "../../../../src/browser/standalone-request-queue";
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../../../../src/browser/launcher-client";
import type { AdapterEvent, CodexProviderConfig } from "../../../../src/types";

const root = mkdtempSync(join(tmpdir(), "w2h-resync-"));
afterAll(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("w2h-resync-")) throw new Error("Fixture ownership mismatch");
  rmSync(root, { recursive: true, force: true });
});
const id = "current-attempt";
const signal = (request_id = id, reason = "missing_prefix") => `\`\`\`codex_context_resync\n${JSON.stringify({ request_id, reason })}\n\`\`\``;
const call = '\n```codex_tool_calls\n{"calls":[{"name":"exec_command","arguments":{"cmd":"echo fixture"}}]}\n```';

test("resync accepts only a standalone bound signal, including actual DOM label extraction", () => {
  for (const reason of ["missing_prefix", "unreadable_attachment", "incomplete_context"] as const) {
    expect(parseContextResyncReply(signal(id, reason), id)).toBe(reason);
    expect(parseContextResyncReply(signal(id, reason).replace("```codex_context_resync", "codex\\_context\\_resync\n\n```"), id)).toBe(reason);
  }
  for (const text of [signal("stale"), signal(id, "retry_tool"), signal() + call, call + "\n" + signal(),
    signal() + "\n" + signal(), signal().slice(0, -3), "Please resync.\n" + signal(),
    signal().replace('"reason"', '"extra":true,"reason"'), "codex_context_resync", "```codex_context_resync\n[]\n```",
  ]) expect(() => parseContextResyncReply(text, id)).toThrow();
  for (const text of ["Please provide complete context", "> " + signal().replaceAll("\n", "\n> "),
    "````markdown\n" + signal() + "\n````", '```json\n{"quoted":"codex_context_resync"}\n```', call,
  ]) expect(parseContextResyncReply(text, id)).toBeUndefined();
});

test("progress and terminal errors have Chinese and English copy and no ordinary retry", () => {
  expect(contextResyncProgress("zh-CN")).toContain("重新同步");
  expect(contextResyncProgress("en")).toContain("Resynchronizing");
  expect(contextResyncError("context_resync_failed", "zh-CN")).toMatchObject({ retryable: false, message: expect.stringContaining("本轮未交付工具调用") });
  expect(contextResyncError("context_resync_invalid", "en")).toMatchObject({ retryable: false, message: expect.stringContaining("invalid") });
});

function request(thread = randomUUID(), input: unknown[] = [{ role: "user", content: "Read the fixture" }]) {
  input = input.map(item => item && typeof item === "object" && "role" in item && item.role === "user"
    ? { ...item, type: "message", internal_chat_message_metadata_passthrough: { turn_id: thread } } : item);
  return parseRequest({ model: "gpt-5.6-sol", stream: true, instructions: "Keep fixture permissions", input,
    tools: [{ type: "function", name: "exec_command", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } }],
    parallel_tool_calls: false, reasoning: { effort: "high" },
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: thread, turn_id: thread }) },
  });
}

type Reply = string | ((turn: BrowserTurn, prompt: string) => string | Promise<string>);
async function fixture(replies: Reply[], language: "en" | "zh-CN" = "en") {
  const released: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body = await req.json() as { conversationKey: string };
    released.push(body.conversationKey);
    return Response.json({ ok: true, released: 1 });
  } });
  const descriptorPath = join(root, `${randomUUID()}.json`);
  writeFileSync(descriptorPath, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND, profile: "development", pid: process.pid,
    endpoint: `http://127.0.0.1:${server.port}`, control: { endpoint: `http://127.0.0.1:${server.port}`, token: "fixture-control-token-0123456789abcdefghijklmnop" },
    helper: { executable: process.execPath, script: import.meta.path }, partition: "persist:web2harness-dev-chatgpt", idleUrl: LAUNCHER_BROWSER_IDLE_URL,
    surfaceId: "launcher_surface_id_0123456789AB", surfaceTargets: { launcher_surface_id_0123456789AB: "fixture" }, createdAt: new Date().toISOString(), language,
  }), { mode: 0o600 });
  const queueProfile = join(root, `${randomUUID()}.json`);
  writeFileSync(queueProfile, "{}");
  const queue = await StandaloneRequestQueue.open(queueProfile);
  const provider: CodexProviderConfig = { adapter: "chatgpt-web", baseUrl: `browser://resync-${randomUUID()}`, chatgptWeb: {
    nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
    browserHost: "launcher", browserHostDescriptorPath: descriptorPath, experimentalContextFiles: true,
  } };
  const worker = ChatGptBrowserWorker.forProvider(provider);
  const original = worker.run;
  const turns: BrowserTurn[] = [], envelopes: Record<string, any>[] = [], prompts: string[] = [];
  worker.run = turn => withQueuedRequest({ descriptorPath: queue, job: turn.scheduling!, traceId: turn.traceId, signal: turn.abortSignal,
    execute: async () => {
      turns.push(turn);
      const prepared = await (turn.prepareResume ?? turn.prepare)();
      prompts.push(prepared.text);
      envelopes.push(JSON.parse(prepared.contextFile?.text ?? prepared.text.split("<codex_context_json>\n")[1]!.split("\n</codex_context_json>")[0]!));
      const next = replies.shift();
      if (next === undefined) throw new Error("Unexpected browser submission");
      turn.onSendActivated?.(); turn.onSubmitted?.();
      const answer = typeof next === "function" ? await next(turn, prepared.text) : next;
      turn.onTextDelta(answer);
      return answer;
    },
  });
  const adapter = createChatGptWebAdapter(provider);
  return { provider, turns, envelopes, prompts, released,
    run: async (parsed: ReturnType<typeof request>, abortSignal?: AbortSignal) => {
      const events: AdapterEvent[] = [];
      await adapter.runTurn!(parsed, { headers: new Headers(), abortSignal }, event => events.push(event));
      return events;
    },
    async close() { worker.run = original; await queue.close(); server.stop(true); },
  };
}
const requestResync: Reply = (_turn, prompt) => {
  const requestId = /"request_id":"([a-f0-9]{48})","reason":"missing_prefix"/.exec(prompt)?.[1];
  expect(requestId).toBeDefined();
  return signal(requestId);
};
function withProgress(parsed: ReturnType<typeof request>, language: "en" | "zh-CN" = "en") {
  return parseRequest({ ...(parsed._rawBody as Record<string, unknown>), input: [
    ...parsed.context.source!.input as unknown[],
    { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: contextResyncProgress(language) }] },
  ] });
}

test("append recovery uses the full unmodified native source, new page, same controls, one delivery and replay", async () => {
  const f = await fixture([requestResync, call, "Continued."], "zh-CN");
  try {
    const thread = randomUUID();
    const input = [{ role: "user", content: [{ type: "input_text", text: "x".repeat(34_000) },
      { type: "input_image", image_url: "data:image/png;base64,aA==" },
      { type: "input_file", filename: "fixture.txt", file_data: Buffer.from("fixture").toString("base64") }] }];
    const previous = request(thread, input);
    const ns = chatGptWebExecutionNamespace(f.provider);
    const key = chatGptConversationKey(previous, ns)!;
    rememberRetainedConversationSource(previous, ns, key);
    const next = request(thread, [...input, { role: "assistant", content: "Earlier reply" }, { role: "user", content: "Continue" }]);
    const before = structuredClone(next);
    const events = await f.run(next);
    expect(next).toEqual(before);
    expect(f.envelopes.map(e => e.transport_context.mode)).toEqual(["append", "complete"]);
    expect(f.envelopes[1]!.input).toHaveLength(3);
    expect(f.envelopes[1]!.input[0].content[1]).toMatchObject({ type: "input_image", attachment_ref: expect.any(String) });
    expect(f.prompts.join("\n")).not.toContain("prefix_sha256");
    expect(f.released).toEqual([key]);
    expect(f.turns[1]!.conversationKey).not.toBe(key);
    expect(f.turns[1]!.prepareResume).toBeUndefined();
    expect(f.turns[1]!.allowPreparationRecovery).toBe(false);
    expect(f.turns[1]!.scheduling!.id).not.toBe(f.turns[0]!.scheduling!.id);
    for (const field of ["modelId", "reasoning", "modelFamily", "capabilities", "nativeToolDefinitions", "traceId"] as const) expect(f.turns[1]![field]).toEqual(f.turns[0]![field]);
    expect(f.envelopes[1]!.tools).toEqual(next.context.source!.tools);
    expect(f.envelopes[1]!.controls).toEqual(next.context.source!.controls);
    expect(events.filter(e => e.type === "tool_call_start")).toHaveLength(1);
    expect(events.filter(e => e.type === "done")).toHaveLength(1);
    expect(JSON.stringify(events)).toContain("正在重新同步");
    expect(JSON.stringify(events)).not.toContain("codex_context_resync");
    const replay = await f.run(structuredClone(next));
    expect(replay).toEqual(events);
    expect(f.turns).toHaveLength(2);
    const followup = request(thread, [...before.context.source!.input as unknown[], { role: "assistant", content: "Confirmed" }, { role: "user", content: "Next" }]);
    await f.run(followup);
    expect(f.turns[2]!.conversationKey).toBe(f.turns[1]!.conversationKey);
    expect(f.envelopes[2]!.transport_context.mode).toBe("append");
  } finally { await f.close(); }
// This multi-turn integration case includes large-context preparation, persisted
// queue/journal operations and replay; five seconds is not its latency contract.
}, 30_000);

test.each(["repeat", "mixed", "invalid-tool", "worker-failure"])("recovery %s is terminal, delivers no tools, reconnect does not resend", async failure => {
  const f = await fixture([requestResync, failure === "repeat" ? requestResync : failure === "mixed"
    ? async (turn, prompt) => `${await (requestResync as Function)(turn, prompt)}${call}`
    : failure === "invalid-tool" ? call.replace("exec_command", "missing")
    : () => { throw new ChatGptWebAdapterError("fixture", { status: 502, code: "fixture", errorType: "server_error", retryable: true }); }]);
  try {
    const parsed = request();
    const events = await f.run(parsed);
    expect(events.find(e => e.type === "error")).toMatchObject({ retryable: false, code: failure === "mixed" ? "context_resync_invalid" : "context_resync_failed" });
    expect(events.some(e => e.type === "tool_call_start" || e.type === "done" || (e.type === "text_delta" && e.phase !== "commentary"))).toBe(false);
    expect(await f.run(parsed)).toEqual(events);
    expect(await f.run(withProgress(parsed))).toEqual(events);
    expect(f.turns).toHaveLength(2);
  } finally { await f.close(); }
});

test("a stale binding or mixed decision never initiates recovery or delivers a tool", async () => {
  for (const reply of [signal("stale"), async (t: BrowserTurn, p: string) => `${await (requestResync as Function)(t, p)}${call}`]) {
    const f = await fixture([reply]);
    try {
      const parsed = request();
      const events = await f.run(parsed);
      expect(events.find(e => e.type === "error")).toMatchObject({ code: "context_resync_invalid", retryable: false });
      expect(events.some(e => e.type === "tool_call_start" || e.type === "done")).toBe(false);
      expect(f.turns).toHaveLength(1);
      expect(retainedConversationResumeRequest(parsed, chatGptConversationKey(parsed, chatGptWebExecutionNamespace(f.provider)))).toBe(parsed);
    } finally { await f.close(); }
  }
});

test("HTTP disconnect during recovery rejoins the same physical attempt", async () => {
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { finish = r; });
  const f = await fixture([requestResync, async () => { entered(); await gate; return call; }]);
  try {
    const parsed = request(), observer = new AbortController();
    const first = f.run(parsed, observer.signal).catch(e => e);
    await ready; observer.abort();
    expect((await first).name).toBe("AbortError");
    const reconnectInput = withProgress(parsed), before = structuredClone(reconnectInput);
    const reconnect = f.run(reconnectInput);
    finish();
    const events = await reconnect;
    expect(events.filter(e => e.type === "tool_call_start")).toHaveLength(1);
    expect(f.turns).toHaveLength(2);
    expect(reconnectInput).toEqual(before);
    const head = chatGptTurnSessions.findConversationHead(f.turns[1]!.conversationKey!);
    expect(head?.conversationKey()).toBe(f.turns[1]!.conversationKey);
    expect(await chatGptTurnSessions.retireConversationAndWait(f.turns[1]!.conversationKey!)).toBe(1);
    expect(f.released).toContain(f.turns[1]!.conversationKey!);
  } finally { finish(); await f.close(); }
});

test("explicit task cancellation waits for the old physical owner and prevents recovery", async () => {
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { finish = r; });
  const f = await fixture([async (turn, prompt) => { entered(); await gate; return (requestResync as Function)(turn, prompt); }]);
  try {
    const parsed = request();
    const pending = f.run(parsed);
    await ready;
    const reason = new ChatGptWebAdapterError("Fixture cancellation", { status: 499, errorType: "client_closed_request", code: "client_cancelled", retryable: false });
    const cancellation = chatGptTurnSessions.beginCancelTrace(f.turns[0]!.traceId, reason);
    expect(cancellation.cancelled).toBe(1);
    finish();
    expect((await pending).find(e => e.type === "error")).toMatchObject({ code: "client_cancelled" });
    await cancellation.settlement;
    expect(f.turns).toHaveLength(1);
    await expect(f.run(withProgress(parsed))).rejects.toThrow("Fixture cancellation");
    expect(f.turns).toHaveLength(1);
  } finally { finish(); await f.close(); }
});

test("a progress-looking suffix cannot alias a resync after controls change", async () => {
  const f = await fixture([requestResync, call, "Changed controls accepted."]);
  try {
    const parsed = request(); await f.run(parsed);
    const changed = withProgress(parsed);
    changed.options.parallelToolCalls = true;
    await f.run(changed);
    expect(f.turns).toHaveLength(3);
  } finally { await f.close(); }
});

test("two compaction epochs each rebuild then resume without changing the native input", () => {
  const thread = randomUUID(), ns = randomUUID();
  let oldKey: string | undefined;
  for (const summary of ["first summary", "second summary"]) {
    const compacted = [{ type: "compaction", encrypted_content: encodeCompactionSummary(summary) }, { role: "user", content: "Continue" }];
    const parsed = request(thread, compacted), before = structuredClone(parsed);
    const key = chatGptConversationKey(parsed, ns)!;
    expect(key).not.toBe(oldKey);
    expect(retainedConversationResumeRequest(parsed, key)).toBe(parsed);
    rememberRetainedConversationSource(parsed, ns, key);
    const next = request(thread, [...compacted, { role: "assistant", content: "ok" }, { role: "user", content: "Continue again" }]);
    expect(retainedConversationResumeRequest(next, key)!.context.sourceContinuation?.prefixItems).toBe(2);
    expect(parsed).toEqual(before); oldKey = key;
  }
});

test("parallel tasks each recover only their own conversation and retain distinct bindings", async () => {
  const attempts = new Map<string, number>();
  const reply: Reply = (turn, prompt) => {
    const group = turn.scheduling!.groupId;
    const count = attempts.get(group) ?? 0;
    attempts.set(group, count + 1);
    return count === 0 ? (requestResync as (turn: BrowserTurn, prompt: string) => string)(turn, prompt) : call;
  };
  const f = await fixture([reply, reply, reply, reply]);
  try {
    const results = await Promise.all([f.run(request()), f.run(request())]);
    expect(results.every(events => events.filter(e => e.type === "tool_call_start").length === 1)).toBe(true);
    expect([...attempts.values()]).toEqual([2, 2]);
    expect(new Set(f.turns.map(t => t.conversationKey)).size).toBe(4);
    expect(new Set(f.released).size).toBe(2);
    expect(new Set(f.prompts.map(p => /"request_id":"([a-f0-9]{48})"/.exec(p)?.[1])).size).toBe(4);
  } finally { await f.close(); }
});
