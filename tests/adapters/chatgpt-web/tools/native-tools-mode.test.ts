import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { parseDiagnosticLine, type DiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint, defaultConfig, loadConfig, loadConfigForSetup, providerConfig } from "../../../../src/config";
import { augmentNativeModelCatalog } from "../../../../src/models/model-catalog";
import {
  CHATGPT_WEB_LUNA_MODEL_ID,
  CHATGPT_WEB_MODEL_ID,
  resolveChatGptWebModelMode,
} from "../../../../src/adapters/chatgpt-web/model";
import { chatGptReadOnlyContextWarning, compileChatGptWebPrompt } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import { CODEX_TOOL_CALLS_FENCE } from "../../../../src/adapters/chatgpt-web/tools/native-tool-call-block";
import { ChatGptBrowserWorker, type BrowserTurn } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { createChatGptWebAdapter } from "../../../../src/adapters/chatgpt-web/adapter";
import { TurnBroker } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";
import { StandaloneRequestQueue } from "../../../../src/browser/standalone-request-queue";
import { DEFAULT_RUNTIME_PARAMETERS } from "../../../../launcher/shared/runtime-parameters.cjs";
import { withQueuedRequest } from "../../../../src/browser/request-queue-client";
import { bridgeToResponsesSSE } from "../../../../src/responses/stream";
import { toolIdentityKey, type AdapterEvent, type CodexParsedRequest, type CodexProviderConfig, type CodexTool } from "../../../../src/types";

const tempRoot = join(tmpdir(), `web2harness-native-tools-${process.pid}-${Date.now()}`);
mkdirSync(tempRoot, { recursive: true });
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

const nativeCapabilities = { localToolsEnabled: false, nativeToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true };
const browserOnlyCapabilities = { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true };

const tools: CodexTool[] = [
  { name: "exec_command", description: "Run command", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } },
  { name: "apply_patch", description: "Patch files", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] }, freeform: true },
  { name: "search_openai_docs", namespace: "mcp__openaiDeveloperDocs", description: "Search docs", parameters: { type: "object" } },
];

function parsedRequest(toolsList: CodexTool[] | undefined): CodexParsedRequest {
  return {
    modelId: CHATGPT_WEB_MODEL_ID,
    stream: true,
    context: {
      ...(toolsList ? { tools: toolsList } : {}),
      messages: [{ role: "user", content: "Inspect the project", timestamp: 2 }],
    },
    options: { reasoning: "high" },
  };
}

describe("native-tools runtime mode", () => {
  test("defaults new configurations to native-tools at config version 5", () => {
    const config = defaultConfig();
    expect(config.version).toBe(5);
    expect(config.mode).toBe("native-tools");
  });

  test("provider capabilities split the broker connector from the native relay", () => {
    expect(providerConfig({ ...defaultConfig("native-tools"), solAvailable: true }).chatgptWeb).toMatchObject({
      localToolsEnabled: false,
      nativeToolsEnabled: true,
    });
    expect(providerConfig({ ...defaultConfig("mcp-bridge"), solAvailable: true }).chatgptWeb).toMatchObject({
      localToolsEnabled: true,
      nativeToolsEnabled: false,
    });
    expect(providerConfig({ ...defaultConfig("browser-only"), solAvailable: true }).chatgptWeb).toMatchObject({
      localToolsEnabled: false,
      nativeToolsEnabled: false,
    });
  });

  test("loading a v3 browser-only config upgrades it in memory to native-tools", () => {
    const root = join(tempRoot, "v3-upgrade");
    mkdirSync(root, { recursive: true });
    const previousHome = process.env.WEB2HARNESS_HOME;
    process.env.WEB2HARNESS_HOME = root;
    try {
      const v3 = { ...defaultConfig("browser-only"), version: 3 };
      writeFileSync(join(root, "config.json"), `${JSON.stringify(v3)}\n`);
      expect(loadConfig()).toMatchObject({ mode: "native-tools" });
      expect(loadConfigForSetup()).toMatchObject({ mode: "native-tools" });

      const v3McpBridge = {
        ...defaultConfig("mcp-bridge"),
        version: 3,
        tunnel: {
          binaryPath: process.execPath,
          tunnelId: `tunnel_${"a".repeat(32)}`,
          runtimeKeyFile: join(root, "runtime.key"),
          profileDir: join(root, "tunnel-profile"),
          profileName: "native-test",
          alias: "native-test",
        },
      };
      writeFileSync(join(root, "config.json"), `${JSON.stringify(v3McpBridge)}\n`);
      expect(loadConfig()).toMatchObject({ mode: "mcp-bridge" });

      // A v4 file records an explicit later choice and is never re-flipped.
      const v4BrowserOnly = { ...defaultConfig("browser-only"), version: 4 };
      writeFileSync(join(root, "config.json"), `${JSON.stringify(v4BrowserOnly)}\n`);
      expect(loadConfig()).toMatchObject({ mode: "browser-only", version: 5 });
    } finally {
      if (previousHome === undefined) delete process.env.WEB2HARNESS_HOME;
      else process.env.WEB2HARNESS_HOME = previousHome;
    }
  });

  test("the model catalog requires a tool-capable template behind routed native-tools rows", () => {
    const config = defaultConfig("native-tools");
    const template: Record<string, unknown> = {
      slug: "gpt-5.6-sol",
      display_name: "gpt-5.6-sol",
      visibility: "list",
      supported_reasoning_levels: ["low", "medium", "high"],
      tool_mode: "chat",
      context_window: 272_000,
    };
    const catalog = augmentNativeModelCatalog({ models: [structuredClone(template)] }, config);
    const models = catalog.models as Array<Record<string, unknown>>;
    expect(models.map(model => model.slug)).toContain("chatgpt-web/gpt-5.6-sol");

    const withoutToolMode = structuredClone(template);
    delete withoutToolMode.tool_mode;
    expect(() => augmentNativeModelCatalog({ models: [withoutToolMode] }, config))
      .toThrow("no list-visible, tool-capable model");
    // Browser-only keeps accepting non-tool templates.
    expect(() => augmentNativeModelCatalog({ models: [withoutToolMode] }, defaultConfig("browser-only")))
      .not.toThrow();
  });

  test("routed rows defer MCP tools behind tool_search only in native-tools mode", () => {
    const template = {
      slug: "gpt-5.6-sol",
      display_name: "gpt-5.6-sol",
      visibility: "list",
      supported_reasoning_levels: ["low", "medium", "high"].map(effort => ({ effort, description: effort })),
      tool_mode: "chat",
      context_window: 272_000,
    };
    const nativeRows = (augmentNativeModelCatalog({ models: [structuredClone(template)] }, defaultConfig("native-tools"))
      .models as Array<Record<string, unknown>>).filter(model => typeof model.slug === "string" && (model.slug as string).startsWith("chatgpt-web/"));
    expect(nativeRows.length).toBeGreaterThan(0);
    expect(nativeRows.every(model => model.supports_search_tool === true)).toBe(true);

    // MCP Bridge and browser-only keep the catalog shape their working relay paths were built on.
    for (const mode of ["mcp-bridge", "browser-only"] as const) {
      const rows = (augmentNativeModelCatalog({ models: [structuredClone(template)] }, defaultConfig(mode))
        .models as Array<Record<string, unknown>>).filter(model => typeof model.slug === "string" && (model.slug as string).startsWith("chatgpt-web/"));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(model => model.supports_search_tool === undefined)).toBe(true);
    }
  });
});

describe("native-tools model mode and prompt contract", () => {
  test("sol models expose the native relay only when the capability is attached", () => {
    expect(resolveChatGptWebModelMode(CHATGPT_WEB_MODEL_ID, "high", nativeCapabilities))
      .toMatchObject({ localTools: false, nativeTools: true });
    expect(resolveChatGptWebModelMode(CHATGPT_WEB_MODEL_ID, "high", browserOnlyCapabilities))
      .toMatchObject({ localTools: false, nativeTools: false });
    // Luna stays read-only in v1 of the native relay.
    expect(resolveChatGptWebModelMode(CHATGPT_WEB_LUNA_MODEL_ID, "low", {
      localToolsEnabled: false,
      nativeToolsEnabled: true,
      solAvailable: false,
      extraHighAvailable: false,
      proAvailable: false,
    })).toMatchObject({ nativeTools: false });
  });

  test("the native prompt carries the tool catalog and call contract without read-only guidance", () => {
    const request = parsedRequest(tools);
    const compiled = compileChatGptWebPrompt(request, nativeCapabilities);
    expect(compiled.text).toContain(CODEX_TOOL_CALLS_FENCE);
    expect(compiled.text).toContain("original namespace trees");
    expect(compiled.text).toContain('"namespace":"mcp__openaiDeveloperDocs"');
    expect(compiled.text).not.toContain("no Codex Native bridge");
    expect(chatGptReadOnlyContextWarning(request, nativeCapabilities)).toBeUndefined();

    const envelope = JSON.parse(compiled.text.split("<codex_context_json>")[1]!.split("</codex_context_json>")[0]!);
    expect(envelope.version).toBe(6);
    expect(envelope.tools).toEqual([
      { type: "function", name: "exec_command", description: "Run command", parameters: tools[0]!.parameters },
      { type: "custom", name: "apply_patch", description: "Patch files" },
      { type: "function", namespace: "mcp__openaiDeveloperDocs", name: "search_openai_docs", description: "Search docs", parameters: tools[2]!.parameters },
    ]);

    const browserOnly = compileChatGptWebPrompt(parsedRequest(tools), browserOnlyCapabilities);
    const browserEnvelope = JSON.parse(browserOnly.text.split("<codex_context_json>")[1]!.split("</codex_context_json>")[0]!);
    expect(browserEnvelope.version).toBe(6);
    expect(browserEnvelope.tools).toBeUndefined();
  });

  test("corrective feedback is appended to the retried native prompt only", () => {
    const correction = "<codex_tool_call_correction>\nbroken\n</codex_tool_call_correction>";
    const compiled = compileChatGptWebPrompt(parsedRequest(tools), nativeCapabilities, undefined, {
      nativeToolCallCorrection: correction,
    });
    expect(compiled.text).toContain(correction);
    expect(compiled.text.indexOf(correction)).toBeGreaterThan(compiled.text.indexOf(CODEX_TOOL_CALLS_FENCE));

    const browserOnly = compileChatGptWebPrompt(parsedRequest(tools), browserOnlyCapabilities, undefined, {
      nativeToolCallCorrection: correction,
    });
    expect(browserOnly.text).not.toContain(correction);
  });

  test("compaction requests stay plain summaries even under the native capability", () => {
    const request = parsedRequest(tools);
    request._compactionRequest = true;
    const compiled = compileChatGptWebPrompt(request, nativeCapabilities);
    expect(compiled.text).not.toContain(CODEX_TOOL_CALLS_FENCE);
    const envelope = JSON.parse(compiled.text.split("<codex_context_json>")[1]!.split("</codex_context_json>")[0]!);
    expect(envelope.version).toBe(6);
    expect(envelope.tools).toBeUndefined();
  });
});

describe("native-tools adapter emission", () => {
  function nativeProvider(): CodexProviderConfig {
    return {
      adapter: "chatgpt-web",
      baseUrl: "browser://native-tools-test",
      chatgptWeb: {
        nativeToolsEnabled: true,
        localToolsEnabled: false,
        solAvailable: true,
        extraHighAvailable: true,
        proAvailable: true,
      },
    };
  }

  function wireRequest(turnId: string): CodexParsedRequest {
    const request = parsedRequest(tools);
    request._rawBody = {
      prompt_cache_key: `thread_${turnId}`,
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ thread_id: `thread_${turnId}`, turn_id: turnId }),
      },
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Inspect the project" }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
      ],
    };
    return request;
  }

  async function withFakeWorker(
    provider: CodexProviderConfig,
    replies: string[],
    turnId = `turn_native_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    queue?: StandaloneRequestQueue,
  ): Promise<{ events: AdapterEvent[]; prompts: string[] }> {
    const worker = ChatGptBrowserWorker.forProvider(provider);
    const originalRun = worker.run.bind(worker);
    const prompts: string[] = [];
    (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = async turn => {
      const execute = async () => {
        expect(turn.textDelivery).toBe("buffered");
        expect(turn.uiLanguage).toBe(provider.chatgptWeb?.uiLanguage ?? "en");
        const prepared = await turn.prepare();
        prompts.push(prepared.text);
        const answer = replies.shift() ?? "Done.";
        turn.onTextDelta(answer);
        return answer;
      };
      return queue ? withQueuedRequest({ descriptorPath: queue, job: turn.scheduling!,
        traceId: turn.traceId, signal: turn.abortSignal, execute }) : execute();
    };
    const events: AdapterEvent[] = [];
    try {
      await createChatGptWebAdapter(provider).runTurn!(
        wireRequest(turnId),
        { headers: new Headers() },
        event => events.push(event),
      );
    } finally {
      (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = originalRun;
    }
    return { events, prompts };
  }

  test("a fenced decision relays as tool_call events and never streams the block body", async () => {
    const answer = "Checking the tree.\n"
      + "```" + CODEX_TOOL_CALLS_FENCE + "\n"
      + '{"calls":[{"name":"exec_command","arguments":{"cmd":"echo ok"}}]}\n'
      + "```";
    const { events } = await withFakeWorker(nativeProvider(), [answer]);

    const textDeltas = events.filter(event => event.type === "text_delta");
    expect(textDeltas).toEqual([{ type: "text_delta", text: "Checking the tree.", phase: "commentary" }]);
    expect(events.filter(event => event.type !== "heartbeat").map(event => event.type)).toEqual([
      "text_delta", "tool_call_start", "tool_call_delta", "tool_call_end", "done",
    ]);
    const streamedText = textDeltas.map(event => event.type === "text_delta" ? event.text : "").join("");
    expect(streamedText).not.toContain(CODEX_TOOL_CALLS_FENCE);
    expect(streamedText).toContain("Checking the tree.");

    const starts = events.filter(event => event.type === "tool_call_start");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ name: toolIdentityKey(undefined, "exec_command") });
    expect(typeof starts[0]!.id).toBe("string");
    expect((starts[0] as { id: string }).id).toMatch(/^callw_[0-9a-f]{32}$/);

    const delta = events.find(event => event.type === "tool_call_delta");
    expect(delta).toMatchObject({ arguments: '{"cmd":"echo ok"}' });

    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "tool_use", endTurn: false });
  });

  test("a reply without a block completes as a plain final answer", async () => {
    const { events } = await withFakeWorker(nativeProvider(), ["The project has three modules."]);
    expect(events.filter(event => event.type === "text_delta")).toEqual([
      { type: "text_delta", text: "The project has three modules.", phase: "final_answer" },
    ]);
    expect(events.filter(event => event.type !== "heartbeat").map(event => event.type)).toEqual(["text_delta", "done"]);
    const streamedText = events
      .filter(event => event.type === "text_delta")
      .map(event => event.type === "text_delta" ? event.text : "")
      .join("");
    expect(streamedText).toBe("The project has three modules.");
    expect(events.filter(event => event.type === "tool_call_start")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "stop", endTurn: true });
  });

  test("native prose evidence covers projection, journal and emitter without exposing source or tool arguments", async () => {
    const records: DiagnosticRecord[] = [];
    const log = spyOn(console, "error").mockImplementation((line: unknown) => {
      const record = parseDiagnosticLine(String(line));
      if (record?.event === "browser.public_text_evidence") records.push(record);
    });
    try {
      const answer = "PRIVATE_PROGRESS 已读取输入。\n```" + CODEX_TOOL_CALLS_FENCE
        + '\n{"calls":[{"name":"exec_command","arguments":{"cmd":"echo PRIVATE_TOOL"}}]}\n```';
      const { events } = await withFakeWorker(nativeProvider(), [answer]);
      expect(events.filter(event => event.type === "text_delta")).toEqual([
        { type: "text_delta", text: "PRIVATE_PROGRESS 已读取输入。", phase: "commentary" },
      ]);
      expect(records.map(record => record.detail.stage)).toEqual(["projected", "journaled", "emitter_returned"]);
      expect(records.filter(record => record.detail.stage !== "emitter_returned").every(record => record.detail.matches === true)).toBeTrue();
      expect(records.every(record => record.detail.clientAcknowledged === false)).toBeTrue();
      expect(JSON.stringify(records)).not.toContain("PRIVATE");
    } finally { log.mockRestore(); }
  });

  test.each([true, false])("Responses SSE preserves native phase and exact reconnects without duplication, tools=%s", async withTools => {
    const provider = nativeProvider();
    const turnId = `turn_native_phase_${withTools}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const visibleText = withTools ? "Checking the tree." : "The project has three modules.";
    const answer = withTools
      ? visibleText + "\n```" + CODEX_TOOL_CALLS_FENCE + '\n{"calls":[{"name":"exec_command","arguments":{"cmd":"echo ok"}}]}\n```'
      : visibleText;
    const first = await withFakeWorker(provider, [answer], turnId);
    expect(first.prompts).toHaveLength(1);
    const expectedEvents = first.events.filter(event => event.type !== "heartbeat");
    const phase = withTools ? "commentary" : "final_answer";

    for (let attempt = 0; attempt < 3; attempt++) {
      const result = attempt === 0 ? first : await withFakeWorker(provider, ["must not send"], turnId);
      if (attempt > 0) expect(result.prompts).toHaveLength(0);
      expect(result.events.filter(event => event.type !== "heartbeat")).toEqual(expectedEvents);
      expect(result.events.filter(event => event.type === "text_delta")).toEqual([
        { type: "text_delta", text: visibleText, phase },
      ]);
      expect(result.events.filter(event => event.type === "tool_call_start")).toHaveLength(withTools ? 1 : 0);
      expect(result.events.filter(event => event.type === "done")).toHaveLength(1);

      // Exercise the shared Responses encoder with actual adapter events, including replay.
      async function* source() { yield* result.events; }
      const text = await new Response(bridgeToResponsesSSE(source(), CHATGPT_WEB_MODEL_ID)).text();
      const frames = text.split("\n\n").flatMap(frame => {
        const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
        return data && data !== "[DONE]" ? [JSON.parse(data)] : [];
      });
      const itemFrames = frames.filter(frame => ["response.output_item.added", "response.output_item.done"].includes(frame.type));
      expect(itemFrames.map(frame => [frame.type, frame.item.type])).toEqual([
        ["response.output_item.added", "message"],
        ["response.output_item.done", "message"],
        ...(withTools ? [["response.output_item.added", "function_call"], ["response.output_item.done", "function_call"]] : []),
      ]);
      for (const frame of itemFrames.filter(frame => frame.item.type === "message")) {
        expect(frame.item).toMatchObject({ role: "assistant", phase });
      }
      expect(frames.filter(frame => frame.type === "response.output_text.delta").map(frame => frame.delta).join(""))
        .toBe(visibleText);
      const doneItems = frames.filter(frame => frame.type === "response.output_item.done").map(frame => frame.item);
      expect(doneItems[0].content).toEqual([{ type: "output_text", text: visibleText, annotations: [] }]);
      const completed = frames.filter(frame => frame.type === "response.completed");
      expect(completed).toHaveLength(1);
      expect(completed[0].response.output).toEqual(doneItems);
      expect(completed[0].response.end_turn).toBe(!withTools);
    }
  });

  test.each(["plain-text", "tool-prose", "tool-call"])("disconnect during validated native emission replays one committed reply: %s", async point => {
    const provider = nativeProvider(), turnId = `atomic_native_${point}_${Date.now()}`;
    const worker = ChatGptBrowserWorker.forProvider(provider), originalRun = worker.run.bind(worker);
    const withTools = point !== "plain-text", visible = "One visible reply.";
    const answer = visible + (withTools ? '\n```codex_tool_calls\n{"calls":[{"name":"exec_command","arguments":{"cmd":"echo once"}}]}\n```' : "");
    let starts = 0;
    (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = async turn => {
      starts++; await turn.prepare(); turn.onTextDelta(answer); return answer;
    };
    const disconnect = new AbortController(), first: AdapterEvent[] = [];
    try {
      const attempt = createChatGptWebAdapter(provider).runTurn!(wireRequest(turnId),
        { headers: new Headers(), abortSignal: disconnect.signal }, event => {
          first.push(event);
          if (event.type === (point === "tool-call" ? "tool_call_start" : "text_delta")) {
            disconnect.abort(); throw new DOMException("observer detached", "AbortError");
          }
        });
      await expect(attempt).rejects.toMatchObject({ name: "AbortError" });
      const replay: AdapterEvent[] = [];
      await createChatGptWebAdapter(provider).runTurn!(wireRequest(turnId), { headers: new Headers() }, event => replay.push(event));
      expect(starts).toBe(1);
      expect(replay.filter(e => e.type === "text_delta")).toEqual([{ type: "text_delta", text: visible, phase: withTools ? "commentary" : "final_answer" }]);
      expect(replay.filter(e => e.type === "tool_call_start")).toHaveLength(withTools ? 1 : 0);
      expect(replay.filter(e => e.type === "done")).toHaveLength(1);
      if (point === "tool-call") expect(replay.find(e => e.type === "tool_call_start")).toEqual(first.find(e => e.type === "tool_call_start"));
      expect(replay.some(e => e.type === "error")).toBe(false);
      const again: AdapterEvent[] = [];
      await createChatGptWebAdapter(provider).runTurn!(wireRequest(turnId), { headers: new Headers() }, event => again.push(event));
      expect(again).toEqual(replay); expect(starts).toBe(1);
    } finally { (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = originalRun; }
  });

  test("an unusable block fails retryably and the retry prompt carries corrective feedback", async () => {
    const provider = nativeProvider();
    const broken = "Checking an unvalidated call.\n```" + CODEX_TOOL_CALLS_FENCE + "\n"
      + '{"calls":[{"name":"shell","arguments":{"cmd":"ls"}}]}\n'
      + "```";
    // Codex retries the same request (same turn identity) after a retryable adapter error.
    const retryTurnId = `turn_native_retry_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const first = await withFakeWorker(provider, [broken], retryTurnId);
    const firstError = first.events.find(event => event.type === "error");
    expect(firstError).toMatchObject({
      type: "error",
      code: "native_tool_call_invalid",
      retryable: true,
    });

    const retry = await withFakeWorker(provider, [broken], retryTurnId);
    // The retried browser prompt quotes the failed block and its problem; the malformed
    // text still never streams to Codex as an answer.
    expect(retry.prompts[0]).toContain("<codex_tool_call_correction>");
    expect(retry.prompts[0]).toContain("<previous_tool_call_block>");
    expect(retry.prompts[0]).toContain("unknown tool");
    expect(retry.events.some(event => event.type === "error")).toBe(true);
    for (const attempt of [first, retry]) {
      expect(attempt.events.filter(event => ["text_delta", "tool_call_start", "tool_call_delta", "tool_call_end", "done"].includes(event.type)))
        .toEqual([]);
    }
  });

  test("queue admits a corrective attempt but replays its successful reconnect without resending", async () => {
    const profile = join(tempRoot, "corrective-queue.json");
    writeFileSync(profile, "{}");
    const queue = await StandaloneRequestQueue.open(profile);
    const provider = nativeProvider();
    const turnId = `queue_retry_${Date.now()}`;
    const broken = "```" + CODEX_TOOL_CALLS_FENCE + '\n{"calls":[{"name":"missing","arguments":{}}]}\n```';
    try {
      const first = await withFakeWorker(provider, [broken], turnId, queue);
      expect(first.events.find(e => e.type === "error")).toMatchObject({ code: "native_tool_call_invalid", retryable: true });
      expect(first.events.some(e => e.type === "tool_call_start")).toBe(false);
      const corrected = "```" + CODEX_TOOL_CALLS_FENCE + '\n{"calls":[{"name":"exec_command","arguments":{"cmd":"echo ok"}}]}\n```';
      const retry = await withFakeWorker(provider, [corrected], turnId, queue);
      expect(retry.prompts).toHaveLength(1);
      expect(retry.prompts[0]).toContain("<codex_tool_call_correction>");
      expect(retry.events.some(e => e.type === "error")).toBe(false);
      const call = retry.events.find(e => e.type === "tool_call_start");
      expect(call).toBeDefined();
      const reconnect = await withFakeWorker(provider, ["must not send"], turnId, queue);
      expect(reconnect.prompts).toHaveLength(0);
      expect(reconnect.events.find(e => e.type === "tool_call_start")).toEqual(call);
    } finally { await queue.close(); }
  });

  test("queued corrective attempts retain the bounded retry budget", async () => {
    const profile = join(tempRoot, "exhausted-queue.json");
    writeFileSync(profile, "{}");
    const queue = await StandaloneRequestQueue.open(profile);
    const provider = nativeProvider();
    const turnId = `queue_exhausted_${Date.now()}`;
    const broken = "```" + CODEX_TOOL_CALLS_FENCE + '\n{"calls":[{"name":"missing","arguments":{}}]}\n```';
    try {
      for (let i = 0; i < 4; i++) {
        const attempt = await withFakeWorker(provider, [broken], turnId, queue);
        expect(attempt.prompts).toHaveLength(1);
        expect(attempt.events.find(e => e.type === "error")).toMatchObject({ code: "native_tool_call_invalid", retryable: i < 3 });
      }
      const exhausted = await withFakeWorker(provider, ["must not send"], turnId, queue);
      expect(exhausted.prompts).toHaveLength(0);
      expect(exhausted.events.find(e => e.type === "error")).toMatchObject({ code: "native_tool_call_invalid", retryable: false });
    } finally { await queue.close(); }
  });

  test("a tool-result round starts a new browser turn instead of replaying round 1", async () => {
    // Live P5 finding: Codex resends the full history each round (store:false) under the SAME
    // thread+turn identity. Session keyed by thread+turn replayed round 1's settled reply, so
    // the model re-issued the same call forever. Round 2 must submit a fresh browser turn that
    // carries the function_call_output back to the model.
    const provider = nativeProvider();
    const turnId = `turn_native_rounds_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const request = wireRequest(turnId);
    const input = (request._rawBody as { input: Array<Record<string, unknown>> }).input;
    const replies = [
      "Checking.\n"
        + "```" + CODEX_TOOL_CALLS_FENCE + "\n"
        + '{"calls":[{"name":"exec_command","arguments":{"cmd":"echo ok"}}]}\n'
        + "```",
      "The command printed ok. Done.",
    ];
    const worker = ChatGptBrowserWorker.forProvider(provider);
    const originalRun = worker.run.bind(worker);
    const prompts: string[] = [];
    (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = async turn => {
      const prepared = await turn.prepare();
      prompts.push(prepared.text);
      const answer = replies.shift() ?? "Done.";
      turn.onTextDelta(answer);
      return answer;
    };
    const roundEvents: AdapterEvent[][] = [];
    try {
      const adapter = createChatGptWebAdapter(provider);
      const collect = (index: number) => (event: AdapterEvent) => {
        (roundEvents[index] ??= []).push(event);
      };
      await adapter.runTurn!(request, { headers: new Headers() }, collect(0));

      const callId = roundEvents[0]!.find(event => event.type === "tool_call_start");
      expect(callId).toMatchObject({ type: "tool_call_start", name: toolIdentityKey(undefined, "exec_command") });
      const callIdValue = (callId as { id: string }).id;
      input.push(
        { type: "function_call", call_id: callIdValue, name: "exec_command", arguments: '{"cmd":"echo ok"}' },
        { type: "function_call_output", call_id: callIdValue, output: "ok" },
      );
      // The server parser folds the wire items into context messages; mirror that shape so the
      // envelope carries the tool round exactly as a live continuation request would.
      request.context.messages.push(
        {
          role: "assistant",
          content: [{ type: "toolCall", id: callIdValue, name: "exec_command", arguments: { cmd: "echo ok" } }],
          timestamp: 3,
        },
        { role: "toolResult", toolCallId: callIdValue, toolName: "exec_command", content: "ok", isError: false, timestamp: 4 },
      );
      await adapter.runTurn!(request, { headers: new Headers() }, collect(1));
    } finally {
      (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = originalRun;
    }

    expect(prompts).toHaveLength(2);
    // The tool result reached the model as context; round 2 is a real continuation.
    expect(prompts[1]).toContain("ok");
    const streamedRound2 = roundEvents[1]!
      .filter(event => event.type === "text_delta")
      .map(event => event.type === "text_delta" ? event.text : "")
      .join("");
    expect(streamedRound2).toBe("The command printed ok. Done.");
    expect(roundEvents[1]!.filter(event => event.type === "tool_call_start")).toHaveLength(0);
    expect(roundEvents[1]!.at(-1)).toMatchObject({ type: "done", stopReason: "stop", endTurn: true });
  });

  test.each([false, true])("native tool rounds and follow-up messages honor fresh conversation=%s", async fresh => {
    const provider = nativeProvider();
    const socketHome = join(tempRoot, `retention-${fresh}`);
    // Keep the Unix endpoint below macOS's 103-byte limit, including its long TMPDIR.
    const socketId = createHash("sha256").update(socketHome).digest("hex").slice(0, 24);
    const socketPath = process.platform === "win32"
      ? defaultBrokerEndpoint(socketHome)
      : join(tmpdir(), `w2h-${socketId}.sock`);
    provider.baseUrl += `/retention-${fresh}-${Date.now()}`;
    Object.assign(provider.chatgptWeb!, {
      browserHost: "launcher",
      browserHostDescriptorPath: join(tempRoot, `retention-${fresh}.json`),
      runtimeParameters: DEFAULT_RUNTIME_PARAMETERS,
      brokerSocketPath: socketPath,
      experimentalFreshConversationPerTurn: fresh,
      useSavedChats: true,
    });
    const turnId = `turn_retention_${fresh}_${Date.now()}`;
    const request = wireRequest(turnId);
    const raw = request._rawBody as { input: Array<Record<string, unknown>>; client_metadata: Record<string, string> };
    const worker = ChatGptBrowserWorker.forProvider(provider);
    const originalRun = worker.run.bind(worker);
    const prompts: string[] = [];
    const keys: Array<string | undefined> = [];
    (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = async turn => {
      expect(turn.retainConversation === true).toBe(!fresh);
      expect(turn.savedChat?.kind).toBe("dialogue");
      expect(turn.savedChat?.taskKey).toMatch(/^[a-f0-9]{64}$/);
      keys.push(turn.conversationKey);
      const prepared = !fresh && prompts.length > 0 ? await turn.prepareResume!() : await turn.prepare();
      prompts.push(prepared.text);
      expect(prepared.text).not.toMatch(/turn_token turn_/);
      const answer = prompts.length <= 2
        ? `\`\`\`${CODEX_TOOL_CALLS_FENCE}\n{"calls":[{"name":"exec_command","arguments":{"cmd":"echo round${prompts.length}"}}]}\n\`\`\``
        : `Finished ${prompts.length}`;
      turn.onTextDelta(answer);
      return answer;
    };
    try {
      const adapter = createChatGptWebAdapter(provider);
      for (let round = 0; round < 3; round++) {
        const events: AdapterEvent[] = [];
        await adapter.runTurn!(structuredClone(request), { headers: new Headers() }, event => events.push(event));
        expect(events.at(-1)).toMatchObject({ type: "done", stopReason: round < 2 ? "tool_use" : "stop" });
        // Reconnecting the exact request replays its journal without submitting again.
        const replay: AdapterEvent[] = [];
        await adapter.runTurn!(structuredClone(request), { headers: new Headers() }, event => replay.push(event));
        expect(replay).toEqual(events);
        expect(prompts).toHaveLength(round + 1);
        if (round < 2) {
          const call = events.find(event => event.type === "tool_call_start") as { id: string };
          const result = `native-result-${round}`;
          raw.input.push(
            { type: "function_call", name: "exec_command", call_id: call.id, arguments: JSON.stringify({ cmd: `echo round${round + 1}` }) },
            { type: "function_call_output", call_id: call.id, output: result },
          );
          request.context.messages.push(
            { role: "assistant", content: [{ type: "toolCall", id: call.id, name: "exec_command", arguments: { cmd: `echo round${round + 1}` } }], timestamp: round + 3 },
            { role: "toolResult", toolCallId: call.id, toolName: "exec_command", content: result, isError: false, timestamp: round + 4 },
          );
        }
      }
      const followup = "Continue with the completed work";
      raw.client_metadata["x-codex-turn-metadata"] = JSON.stringify({ thread_id: `thread_${turnId}`, turn_id: `${turnId}_next` });
      raw.input.push(
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Finished 3" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: followup }], internal_chat_message_metadata_passthrough: { turn_id: `${turnId}_next` } },
      );
      request.context.messages.push(
        { role: "assistant", content: [{ type: "text", text: "Finished 3" }], timestamp: 10 },
        { role: "user", content: followup, timestamp: 11 },
      );
      const final: AdapterEvent[] = [];
      await adapter.runTurn!(request, { headers: new Headers() }, event => final.push(event));
      expect(final.at(-1)).toMatchObject({ type: "done", stopReason: "stop" });
      expect(prompts).toHaveLength(4);
      expect(prompts[1]).toContain("native-result-0");
      expect(prompts[2]).toContain("native-result-1");
      expect(prompts[3]).toContain(followup);
      if (fresh) {
        expect(keys.every(key => key === undefined)).toBe(true);
        expect(prompts[3]).toContain("Inspect the project");
      } else {
        expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
        expect(new Set(keys).size).toBe(1);
        expect(prompts[2]).not.toContain("native-result-0");
        expect(prompts[3]).not.toContain("Inspect the project");
      }
    } finally {
      (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = originalRun;
      await TurnBroker.forSocket(socketPath).close();
    }
  });
});
