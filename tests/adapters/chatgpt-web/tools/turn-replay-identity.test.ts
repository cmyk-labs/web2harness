import { describe, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { parseRequest } from "../../../../src/responses/parser";
import type { AdapterEvent, CodexParsedRequest } from "../../../../src/types";
import {
  ChatGptTextFeed,
  ChatGptTraceFeed,
  ChatGptTurnSessions,
  chatGptInstructionLineage,
  chatGptThreadOwnershipKey,
  chatGptTurnExecutionKey,
  chatGptTurnRetryKey,
  chatGptTurnRoundKey,
  type ChatGptTurnRuntime,
} from "../../../../src/adapters/chatgpt-web/tools/turn-execution";

const tool = {
  type: "function", name: "read_fixture", description: "Read a fixture",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  strict: true,
};

function request(overrides: Record<string, unknown> = {}): CodexParsedRequest {
  return parseRequest(structuredClone({
    model: "gpt-5.6", instructions: "Only inspect the fixture.",
    input: [{ type: "message", role: "user", id: "instruction-replay",
      content: [{ type: "input_text", text: "Inspect the fixture" }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn-replay" } }],
    tools: [tool], tool_choice: "auto", parallel_tool_calls: true,
    reasoning: { effort: "high", summary: "auto" },
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread-replay", turn_id: "turn-replay" }) },
    ...overrides,
  }));
}

function runtime(answer: string): ChatGptTurnRuntime {
  return { mode: "read-only", browser: Promise.resolve(answer), physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(), cancel: () => {} };
}

function admit(sessions: ChatGptTurnSessions, parsed: CodexParsedRequest, start: () => ChatGptTurnRuntime,
  signal?: AbortSignal) {
  return sessions.getOrCreateAfterOwnerRetirement(
    chatGptTurnRoundKey(parsed), chatGptThreadOwnershipKey(parsed), start, "trace-replay", signal,
    "turn-replay", "thread-replay", chatGptInstructionLineage(parsed),
  );
}

const changes: [string, Record<string, unknown>][] = [
  ["instructions", { instructions: "Do not read any fixture; answer from existing context." }],
  ["removed tools", { tools: [] }],
  ["tool schema", { tools: [{ ...tool, parameters: { type: "object", properties: {}, additionalProperties: false } }] }],
  ["tool guidance", { tools: [{ ...tool, description: "Read only public fixtures" }] }],
  ["tool namespace", { tools: [{ ...tool, namespace: "restricted" }] }],
  ["tool strictness", { tools: [{ ...tool, strict: false }] }],
  ["tool_choice none", { tool_choice: "none" }],
  ["tool_choice required", { tool_choice: "required" }],
  ["named tool_choice", { tool_choice: { type: "function", name: "read_fixture" } }],
  ["allowed tool_choice", { tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "read_fixture" }] } }],
  ["parallel_tool_calls", { parallel_tool_calls: false }],
  ["verbosity", { text: { verbosity: "low" } }],
  ["output schema", { text: { format: { type: "json_schema", name: "answer", strict: true,
    schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } } }],
  ["reasoning summary", { reasoning: { effort: "high", summary: "none" } }],
  ["lossless reasoning controls", { reasoning: { effort: "high", summary: "auto", fixture_control: "changed" } }],
  ["max_output_tokens", { max_output_tokens: 64 }],
  ["temperature", { temperature: 0.2 }],
  ["top_p", { top_p: 0.5 }],
  ["stop", { stop: ["STOP"] }],
  ["presence_penalty", { presence_penalty: 0.5 }],
  ["frequency_penalty", { frequency_penalty: 0.5 }],
  ["service_tier", { service_tier: "priority" }],
];

describe("ChatGPT request replay identity", () => {
  test("recursive object field reordering replays the existing session and call IDs", async () => {
    const original = request();
    function reorder(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === "object") return Object.fromEntries(
        Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
      return value;
    }
    const retry = parseRequest(reorder(original._rawBody));
    const sessions = new ChatGptTurnSessions();
    const first = await admit(sessions, original, () => runtime("done"));
    const key = chatGptTurnRoundKey(original);
    const events: AdapterEvent[] = [{ type: "tool_call_start", id: "call-stable", name: "read_fixture" },
      { type: "tool_call_delta", arguments: '{"path":"fixture.txt"}' }, { type: "tool_call_end" }, { type: "done" }];
    first.appendRoundEvents(key, events);
    first.completeRound(key);
    expect(chatGptTurnRoundKey(retry)).toBe(key);
    const replay = await admit(sessions, retry, () => { throw new Error("semantic retry started a second runtime"); });
    expect(replay).toBe(first);
    expect(replay.roundEvents(chatGptTurnRoundKey(retry))).toEqual(events);
  });

  test("array order and raw program bytes are not normalized", () => {
    const withOrder = (values: string[]) => request({ tools: [{ ...tool,
      parameters: { type: "object", required: values } }] });
    expect(chatGptTurnRoundKey(withOrder(["a", "b"]))).not.toBe(chatGptTurnRoundKey(withOrder(["b", "a"])));
    const withProgram = (input: string) => request({ input: [
      { role: "user", content: "Inspect the fixture" },
      { type: "custom_tool_call", call_id: "raw-program", name: "exec", input },
    ] });
    expect(chatGptTurnRoundKey(withProgram("await tools.read({path:'a'});")))
      .not.toBe(chatGptTurnRoundKey(withProgram("await tools.read({path: 'a'});")));
  });

  test.each(changes)("changed %s cannot replay the prior session or round journal", async (_label, overrides) => {
    const sessions = new ChatGptTurnSessions();
    const original = request();
    const changed = request(overrides);
    const originalKey = chatGptTurnRoundKey(original);
    const changedKey = chatGptTurnRoundKey(changed);
    let starts = 0;
    const first = await admit(sessions, original, () => { starts += 1; return runtime("old authority"); });
    const oldEvents: AdapterEvent[] = [
      { type: "tool_call_start", id: "call-old", name: "read_fixture" },
      { type: "tool_call_delta", arguments: '{"path":"fixture.txt"}' },
      { type: "tool_call_end" }, { type: "done" },
    ];
    first.appendRoundEvents(originalKey, oldEvents);
    first.completeRound(originalKey);
    await first.browserOutcome;
    await first.physicalSettlement;
    const second = await admit(sessions, changed, () => { starts += 1; return runtime("current authority"); });
    // Exercise the actual session cache and journal used by the adapter, without a browser or broker.
    expect(second.roundEvents(changedKey)).toEqual([]);
    expect(second.roundCompleted(changedKey)).toBeFalse();
    expect(second).not.toBe(first);
    expect(starts).toBe(2);
    expect(await second.browserOutcome).toEqual({ type: "final", answer: "current authority" });
    expect(changedKey).not.toBe(originalKey);
    expect(chatGptTurnExecutionKey(changed)).toBe(chatGptTurnExecutionKey(original));
    expect(chatGptTurnRetryKey(changed)).toBe(chatGptTurnRetryKey(original));
    expect(chatGptThreadOwnershipKey(changed)).toBe(chatGptThreadOwnershipKey(original));
  });

  test("identical separately parsed retries dedupe both active and completed sessions", async () => {
    const sessions = new ChatGptTurnSessions();
    const firstRequest = request();
    const retry = parseRequest(JSON.parse(JSON.stringify(firstRequest._rawBody)));
    // Parser timestamps are runtime indexes, not request identity.
    retry.context.messages.forEach(message => { message.timestamp += 10_000; });
    let finish!: (answer: string) => void;
    let starts = 0;
    const first = await admit(sessions, firstRequest, () => {
      starts += 1;
      const browser = new Promise<string>(resolve => { finish = resolve; });
      return { ...runtime("unused"), browser, physicalSettlement: browser.then(() => {}) };
    });
    const unexpectedStart = () => { throw new Error("identical retry must not start again"); };
    expect(await admit(sessions, retry, unexpectedStart)).toBe(first);
    const events: AdapterEvent[] = [{ type: "text_delta", text: "done" }, { type: "done" }];
    first.appendRoundEvents(chatGptTurnRoundKey(firstRequest), events);
    first.completeRound(chatGptTurnRoundKey(firstRequest));
    finish("done");
    await first.browserOutcome;
    await first.physicalSettlement;
    const replay = await admit(sessions, retry, unexpectedStart);
    expect(replay).toBe(first);
    expect(replay.roundEvents(chatGptTurnRoundKey(retry))).toEqual(events);
    expect(replay.roundCompleted(chatGptTurnRoundKey(retry))).toBeTrue();
    expect(starts).toBe(1);
  });

  test("transport changes do not create another model request", () => {
    expect(chatGptTurnRoundKey(request({ stream: true, store: false, include: ["reasoning.encrypted_content"] })))
      .toBe(chatGptTurnRoundKey(request({ stream: false, store: true })));
  });

  test("current parsed tool registry and options remain part of authority", () => {
    const original = request();
    const removed = structuredClone(original);
    removed.context.tools = [];
    const restricted = structuredClone(original);
    restricted.options.toolChoice = "none";
    expect(chatGptTurnRoundKey(removed)).not.toBe(chatGptTurnRoundKey(original));
    expect(chatGptTurnRoundKey(restricted)).not.toBe(chatGptTurnRoundKey(original));
  });

  test("raw requests without a source snapshot still retain instructions and call controls", () => {
    const original = request();
    const changed = request({ instructions: "No calls", tools: [], tool_choice: "none", parallel_tool_calls: false });
    delete original.context.source;
    delete changed.context.source;
    expect(chatGptTurnRoundKey(changed)).not.toBe(chatGptTurnRoundKey(original));
  });

  test("model, effort, input and compaction purpose still distinguish rounds", () => {
    const original = request();
    for (const changed of [request({ model: "gpt-6" }), request({ reasoning: { effort: "low" } }),
      request({ input: [{ role: "user", content: "Different input" }] }), { ...original, _compactionRequest: true }]) {
      expect(chatGptTurnRoundKey(changed)).not.toBe(chatGptTurnRoundKey(original));
    }
  });

  test("compaction output format and trusted model family distinguish rounds", () => {
    const original = request();
    expect(chatGptTurnRoundKey({ ...original, _chatgptModelFamily: "6" }))
      .not.toBe(chatGptTurnRoundKey({ ...original, _chatgptModelFamily: "5.6" }));
    expect(chatGptTurnRoundKey({ ...original, _compactionRequest: true, _compactionResponseFormat: "message" }))
      .not.toBe(chatGptTurnRoundKey({ ...original, _compactionRequest: true }));
  });

  test("changed authority still waits for physical settlement and permits caller abort", async () => {
    const sessions = new ChatGptTurnSessions();
    let settle!: () => void;
    let cancelled = 0;
    const first = await admit(sessions, request(), () => ({ ...runtime("done"),
      physicalSettlement: new Promise<void>(resolve => { settle = resolve; }), cancel: () => { cancelled += 1; } }));
    await first.browserOutcome;
    let starts = 0;
    const controller = new AbortController();
    const changed = request({ tool_choice: "none" });
    const waiting = admit(sessions, changed, () => { starts += 1; return runtime("new authority"); }, controller.signal);
    controller.abort();
    try {
      await rejects(waiting, { name: "AbortError" });
      expect(starts).toBe(0);
      expect(cancelled).toBe(0);
    } finally { settle(); }
    await first.physicalSettlement;
    const second = await admit(sessions, changed, () => { starts += 1; return runtime("new authority"); });
    expect(second).not.toBe(first);
    expect(starts).toBe(1);
  });

  test("native cancellation retires every request variant owned by the same turn", async () => {
    const sessions = new ChatGptTurnSessions();
    const requests = [request(), request({ parallel_tool_calls: false })];
    for (const parsed of requests) {
      const session = await admit(sessions, parsed, () => runtime("done"));
      await session.browserOutcome;
      await session.physicalSettlement;
    }
    const cancellation = sessions.cancelNativeTurn("thread-replay", "turn-replay", new Error("fixture cancelled"));
    await cancellation.settlement;
    expect(cancellation.cancelled).toBe(2);
    for (const parsed of requests) expect(sessions.find(chatGptTurnRoundKey(parsed))).toBeUndefined();
  });

  test("missing native identity or complete input is still rejected", () => {
    expect(() => chatGptTurnRoundKey(request({ client_metadata: {} }))).toThrow("turn_id metadata");
    expect(() => chatGptTurnRoundKey(request({ input: "text-only" }))).toThrow("complete native Codex input");
  });
});
