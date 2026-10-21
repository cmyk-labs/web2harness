import { expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ChatGptBrowserWorker, browserStageTimeouts } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { ChatGptWebAdapterError } from "../../../../src/adapters/chatgpt-web/adapter-error";

// Exercise the complete worker's send boundary with deterministic page/queue transports.
// Browser readiness and answer extraction have their own DOM tests; these are not live sends.
test.each(["preflight-failed", "ready-changed", "unknown", "confirmed", "duplicate-ack", "click-failed", "click-failed-accepted"])(
  "send lifecycle keeps model verification outside acknowledgement and settles %s accurately", async scenario => {
    const root = mkdtempSync(join(tmpdir(), "web2harness-send-lifecycle-"));
    try {
      const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web",
        baseUrl: `browser://${root}`, chatgptWeb: { localToolsEnabled: false, solAvailable: true,
          extraHighAvailable: true, proAvailable: false, storageStatePath: join(root, "auth.json"),
          browserDiagnosticsPath: join(root, "diagnostics") } });
      const order: string[] = [], settlements: any[] = [], stages: Array<[string, number | undefined]> = [];
      let inputs = 0, activated = 0, released = 0;
      const absent: any = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
      const page: any = Object.assign(new EventEmitter(), { isClosed: () => false,
        url: () => "https://chatgpt.com/?temporary-chat=true", evaluate: async () => ({}),
        locator: () => absent, context: () => ({ newCDPSession: async () => { throw Error("fixture has no CDP"); } }) });
      const clickFailure = new Error("fixture click failed after possible input");
      const button = { waitFor: async () => {}, isEnabled: async () => true,
        click: async (options: { trial?: boolean }) => {
          if (options.trial) { order.push("trial"); return; }
          inputs++; order.push("input"); if (scenario.startsWith("click-failed")) throw clickFailure;
        } };
      const composer = { locator: () => ({ locator: () => button }) };
      worker.activeComposer = async () => composer;
      worker.prepareChatSurface = async () => composer;
      worker.selectModelAndEffort = async () => ({ effort: "xhigh", localTools: false });
      worker.captureSubmissionBaseline = async () => ({});
      worker.attachPromptWithCompactionRetry = worker.attachFiles = async () => {};
      worker.requestQueueTarget = async () => ({ request: async (action: string, body: any) => {
        if (action === "send-begin") { order.push("permit"); return { allowed: true, permit: "owned-permit" }; }
        if (action === "send-end") settlements.push(body);
        return {};
      } });
      const selectionFailure = new ChatGptWebAdapterError("requested selection unavailable", {
        status: 502, errorType: "server_error", code: "chatgpt_model_control_unavailable", retryable: false });
      worker.assertSelectedEffort = async (_page: unknown, _mode: unknown, family = true) => {
        order.push(family ? "family" : "ready");
        if (scenario === "preflight-failed" && family || scenario === "ready-changed" && !family) throw selectionFailure;
      };
      const unknown = new Error("submission not confirmed");
      worker.waitForSubmissionAcceptedWithRecovery = async () => {
        if (scenario === "unknown" || scenario === "click-failed") throw unknown;
        order.push("accepted"); return "user_turn";
      };
      const extractionBoundary = new Error("fixture stops after confirmed send");
      worker.waitForNewAssistantTurn = async () => { throw extractionBoundary; };
      if (scenario === "duplicate-ack") worker.sendAttachedPrompt = async (...args: any[]) => {
        await args[5].onSendActivated(); inputs++; order.push("input");
        await Promise.all([args[5].onSubmitted(), args[5].onSubmitted()]);
        return "user_turn";
      };
      const realStage = worker.runStage.bind(worker);
      worker.runStage = async (trace: string, stage: string, ms: number, ...rest: any[]) => {
        stages.push([stage, ms]); return realStage(trace, stage, ms, ...rest);
      };
      const attempt = worker.runBrowserTurnObserved({ traceId: `send-${scenario}`, modelId: "gpt-5.6-sol",
        reasoning: "xhigh", capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false },
        queueTicket: { id: "owned-task", secret: "fixture-secret" },
        prepare: async () => ({ text: "Synthetic input", images: [], release() { released++; } }),
        onSendActivated: async () => { activated++; order.push("activated"); },
      }, undefined, page);
      if (scenario === "unknown" || scenario === "click-failed") {
        await expect(attempt).rejects.toMatchObject({ code: "chatgpt_send_outcome_unknown", retryable: false });
        if (scenario === "click-failed") {
          const failure = await attempt.catch((error: any) => error);
          expect(failure.cause).toBeInstanceOf(AggregateError);
          expect(failure.cause.errors).toEqual([clickFailure, unknown]);
        }
      }
      else await expect(attempt).rejects.toBe(
        scenario === "preflight-failed" || scenario === "ready-changed" ? selectionFailure
          : extractionBoundary);
      const unsent = scenario === "preflight-failed" || scenario === "ready-changed";
      expect(inputs).toBe(unsent ? 0 : 1);
      expect(activated).toBe(unsent ? 0 : 1);
      expect(settlements).toEqual(scenario === "preflight-failed" ? [] : [{ id: "owned-task", secret: "fixture-secret", permit: "owned-permit",
        outcome: unsent ? "not-sent" : ["unknown", "click-failed"].includes(scenario) ? "unknown" : "confirmed" }]);
      expect(stages).toContainEqual(["send_preflight", undefined]);
      if (scenario !== "preflight-failed") expect(stages).toContainEqual(["send", undefined]);
      if (!unsent) expect(order.slice(0, 6)).toEqual(["family", "trial", "permit", "ready", "activated", "input"]);
      if (scenario === "preflight-failed") expect(order).not.toContain("permit");
      expect(released).toBe(1);
    } finally {
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-send-lifecycle-")) {
        throw new Error("Unexpected send fixture directory");
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test.each(["complete", "incomplete", "late-accepted", "late-timeout", "duplicate-request", "cancelled", "disconnected", "delayed-source", "delayed-cancel", "consumer-failed", "complete-dom", "foreign-dom", "delayed-dom-source", "partial-dom", "no-final", "saved-no-final", "saved-recovered", "progress-source", "progress-dom", "progress-cancel", "progress-consumer"])("worker handles an identity-bound %s source without relying on a rendered answer", async state => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-source-worker-"));
  let acceptanceTimer: ReturnType<typeof setTimeout> | undefined;
  let clockRestore: (() => void) | undefined;
  try {
    const saved = state.startsWith("saved-"), noFinal = state === "no-final" || saved;
    const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: `browser://${root}`,
      chatgptWeb: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false,
        useSavedChats: saved, storageStatePath: join(root, "auth.json"), browserDiagnosticsPath: join(root, "diagnostics") } });
    const progress = state.startsWith("progress-");
    const domFallback = state === "complete-dom" || state === "foreign-dom" || state === "partial-dom" || state === "progress-dom";
    const text = domFallback ? "Complete DOM answer." : "| Name | Value |\n| --- | --- |\n| Alpha | beta_code |\n\n```ps1\n'Literal *text*'\n```\n\nSame\n\nSame";
    const user = { id: "current-user", author: { role: "user" }, content: { content_type: "text", parts: ["input"] } };
    const frames = ["v1", { type: "input_message", conversation_id: "current", input_message: user },
      { p: "", o: "add", v: { conversation_id: "current", message: { id: "answer", author: { role: "assistant" }, channel: "final", recipient: "all",
        content: { content_type: "text", parts: [text] }, status: state !== "incomplete" ? "finished_successfully" : "finished_partial", end_turn: true,
        metadata: { parent_id: user.id, is_complete: true, finish_details: { type: "stop" } } } } },
      { type: "message_stream_complete", conversation_id: "current" }, "[DONE]"];
    if (domFallback) (frames[2] as any).v.message.metadata.model_dil_v2 = {
      fallbackMarkdownVersion: 2, fallbackMarkdown: text,
    };
    const encoded = (values: unknown[]) => Buffer.from(values.map(v => `data: ${v === "[DONE]" ? v : JSON.stringify(v)}\n\n`).join("")).toString("base64");
    const delayed = state === "delayed-source" || state === "delayed-cancel" || state === "delayed-dom-source" || progress && !domFallback;
    const body = encoded(noFinal ? [...frames.slice(0, 2), ...frames.slice(3)] : delayed ? frames.slice(0, 3) : frames);
    const turnIds = { turn_exchange_id: "exchange", working_turn_id: "working" };
    const final = (frames[2] as any).v.message;
    const savedBody = JSON.stringify({ conversation_id: "current", current_node: state === "saved-recovered" ? "answer" : user.id,
      messages: [{ ...user, metadata: turnIds }, ...(state === "saved-recovered" ? [{ ...final, metadata: { ...final.metadata, ...turnIds } }] : [])] });
    let bindingRetired = false, bindingStarted = false, domReadStarted = false;
    const beforeTerminal: number[] = [];
    const consumerFailure = new TypeError("consumer callback failed after one delivery");
    const commentary: string[] = [], deliveryOrder: string[] = [];
    let lastProgress = "", progressReads = 0;
    const sessions: EventEmitter[] = [];
    const cancel = new AbortController();
    const receipts: any[] = [];
    let disconnected = false, reloads = 0;
    const absent: any = { filter() { return this; }, last() { return this; }, getByText() { return this; }, getByTestId() { return this; }, isVisible: async () => false };
    const page: any = Object.assign(new EventEmitter(), { isClosed: () => disconnected,
      url: () => saved ? "https://chatgpt.com/c/current" : "https://chatgpt.com/?temporary-chat=true",
      reload: async () => {
        reloads++;
        for (const session of sessions) {
          session.emit("Network.requestWillBeSent", { frameId: "owned", requestId: "saved-readback",
            request: { method: "GET", url: "https://chatgpt.com/backend-api/conversations/current?num_turns=20" } });
          session.emit("Network.responseReceived", { requestId: "saved-readback", response: { status: 200, mimeType: "application/json" } });
          session.emit("Network.loadingFinished", { requestId: "saved-readback" });
        }
      },
      evaluate: async () => ({}), locator: () => absent, context: () => ({ newCDPSession: async () => {
        const session = Object.assign(new EventEmitter(), { detach: async () => {}, send: async (method: string) =>
          method === "Page.getFrameTree" ? { frameTree: { frame: { id: "owned" } } }
            : method === "Network.streamResourceContent" ? { bufferedData: body }
              : method === "Network.getResponseBody" ? { body: savedBody, base64Encoded: false } : {} });
        sessions.push(session); return session;
      } }) });
    let prompt = "", presses = 0;
    const composer = { locator: () => ({ locator: () => ({ waitFor: async () => {}, isEnabled: async () => true, click: async (options: { trial?: boolean }) => {
      if (options.trial) return;
      presses++;
      const emitAcceptance = () => { for (const session of sessions) {
        session.emit("Network.requestWillBeSent", { frameId: "owned", requestId: "response", request: { method: "POST", url: "https://chatgpt.com/backend-api/f/conversation",
          postData: JSON.stringify({ action: "next", messages: [{ ...user, content: { parts: [prompt] } }] }) } });
        session.emit("Network.responseReceived", { requestId: "response", response: { status: 200, mimeType: "text/event-stream", url: "https://chatgpt.com/backend-api/f/conversation" } });
        if (!delayed) session.emit("Network.loadingFinished", { requestId: "response" });
        if (noFinal && state !== "saved-recovered" && session === sessions.at(-1)) acceptanceTimer = setTimeout(() => {
          beforeTerminal.push(deltas.length, completedResponses);
          const now = Date.now.bind(Date);
          const clock = spyOn(Date, "now").mockImplementation(() => now() + 120_001);
          clockRestore = () => clock.mockRestore();
        }, 1_500);
        if (delayed && session === sessions.at(-1)) acceptanceTimer = setTimeout(() => {
          beforeTerminal.push(deltas.length, completedResponses);
          if (state === "delayed-cancel" || state === "progress-cancel") cancel.abort();
          else {
            session.emit("Network.dataReceived", { requestId: "response", data: encoded(frames.slice(3)) });
            // Deliberately leave HTTP open; application completion is the terminal evidence.
          }
        }, 600);
        if (state === "duplicate-request") session.emit("Network.requestWillBeSent", { frameId: "owned", requestId: "second-response", request: { method: "POST", url: "https://chatgpt.com/backend-api/f/conversation",
          postData: JSON.stringify({ action: "next", messages: [{ ...user, id: "second-user", content: { parts: [prompt] } }] }) } });
      } };
      if (["late-accepted", "late-timeout", "cancelled", "disconnected"].includes(state)) {
        acceptanceTimer = setTimeout(() => {
          if (state === "cancelled") cancel.abort();
          if (state === "disconnected") disconnected = true;
          emitAcceptance();
        }, state === "late-timeout" ? 100 : 25);
      } else emitAcceptance();
    } }) }) };
    worker.activeComposer = worker.prepareChatSurface = async () => composer;
    worker.selectModelAndEffort = async () => ({ effort: "xhigh", localTools: false });
    worker.captureSubmissionBaseline = async () => ({});
    worker.attachPromptWithCompactionRetry = async (_page: unknown, value: string) => { prompt = value; };
    worker.attachFiles = worker.assertSelectedEffort = async () => {};
    worker.waitForSubmissionAcceptedWithRecovery = async (_page: unknown, _baseline: unknown, signal?: AbortSignal) => {
      if (state === "late-timeout") return new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(new DOMException("stage expired", "AbortError"));
        else signal?.addEventListener("abort", () => reject(new DOMException("stage expired", "AbortError")), { once: true });
      });
      if (["late-accepted", "duplicate-request", "cancelled", "disconnected"].includes(state)) throw Error("initial acceptance observation failed");
      return "response_stream";
    };
    if (state === "late-timeout") {
      const realStage = worker.runStage.bind(worker);
      worker.runStage = (trace: string, stage: string, ms: number | undefined, ...rest: any[]) => realStage(trace, stage, stage === "send_acknowledgement" ? 300 : ms, ...rest);
    }
    worker.requestQueueTarget = async () => ({ request: async (action: string, body: any) => {
      if (action === "send-begin") return { allowed: true, permit: "source-permit" };
      if (action === "send-end") receipts.push(body);
      return {};
    } });
    worker.submissionDomState = async () => { throw Error("DOM unavailable: source must supply completion"); };
    if (delayed || noFinal) worker.waitForNewAssistantTurn = async (_page: unknown, _baseline: unknown, _deadline: unknown, signal: AbortSignal) => {
      bindingStarted = true;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        bindingRetired = true; reject(new DOMException("observation retired", "AbortError"));
      }, { once: true }));
    };
    if (domFallback || state === "delayed-dom-source" || progress) {
      worker.waitForNewAssistantTurn = async () => ({ identity: "owned", locator: absent, acceptedTurnIdentities: [] });
      worker.responseDomSnapshot = async () => {
        domReadStarted = true;
        if (state === "delayed-dom-source") return new Promise(() => {});
        if (state === "partial-dom" && !acceptanceTimer) {
          acceptanceTimer = setTimeout(() => {
            const now = Date.now.bind(Date);
            const clock = spyOn(Date, "now").mockImplementation(() => now() + 120_001);
            clockRestore = () => clock.mockRestore();
          }, 600);
        }
        if (progress) lastProgress = `Pending public commentary ${++progressReads}`;
        return { responsePresent: true, contentState: state === "partial-dom" ? "partial" : "complete",
          messageId: state === "foreign-dom" ? "foreign" : "answer",
          visibleText: text, fullHtml: "<p>" + text + "</p>",
          markdownSegments: [{ key: "final", html: "<p>" + text + "</p>", text, streamable: false }],
          completionActionVisible: false, traceBlocks: progress
            ? [{ kind: "commentary", key: "progress", text: lastProgress, complete: true }] : [], stoppedThinkingVisible: false };
      };
    }
    const deltas: string[] = [];
    let completedResponses = 0;
    const result = worker.runBrowserTurnObserved({ traceId: `source-${state}`, modelId: "gpt-5.6-sol", reasoning: "xhigh",
      capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false },
      queueTicket: { id: "source-task", secret: "source-secret" }, abortSignal: cancel.signal,
      prepare: async () => ({ text: "input", images: [], release() {} }), onTextDelta: (delta: string) => { deliveryOrder.push("answer"); deltas.push(delta); if (state === "consumer-failed") throw consumerFailure; },
      onCommentary: (delta: string) => { deliveryOrder.push("commentary"); commentary.push(delta); if (state === "progress-consumer") throw consumerFailure; },
      onResponseCompleted: () => { completedResponses++; },
    }, undefined, page);
    if (progress) {
      if (state === "progress-cancel") { await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(commentary).toEqual([]); expect(deltas).toEqual([]); }
      else {
        if (state === "progress-consumer") { await expect(result).rejects.toBe(consumerFailure); expect(deltas).toEqual([]); }
        else { expect(await result).toBe(text); expect(deltas).toEqual([text]); expect(deliveryOrder).toEqual(["commentary", "answer"]); }
        expect(commentary).toEqual([lastProgress]);
      }
      expect(progressReads).toBeGreaterThan(0);
    }
    else if (["complete", "late-accepted", "late-timeout", "delayed-source", "complete-dom", "delayed-dom-source", "saved-recovered"].includes(state)) { expect(await result).toBe(text); expect(deltas).toEqual([text]); }
    else if (state === "partial-dom") {
      await expect(result).rejects.toMatchObject({ code: "browser_stream_inconsistent",
        cause: { code: "chatgpt_response_extraction_timeout" } });
      expect(deltas).toEqual([]);
      expect(domReadStarted).toBeTrue();
    }
    else if (state === "foreign-dom") { await expect(result).rejects.toMatchObject({ code: "browser_stream_inconsistent" }); expect(deltas).toEqual([]); }
    else if (noFinal) {
      await expect(result).rejects.toMatchObject({ code: "chatgpt_public_answer_missing", retryable: false });
      expect(deltas).toEqual([]); expect(beforeTerminal).toEqual([0, 0]); expect(bindingRetired).toBeTrue();
    }
    else if (state === "consumer-failed") { await expect(result).rejects.toBe(consumerFailure); expect(deltas).toEqual([text]); }
    else if (state === "delayed-cancel") { await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(deltas).toEqual([]); }
    else if (state === "incomplete") { await expect(result).rejects.toMatchObject({ code: "chatgpt_response_source_invalid" }); expect(deltas).toEqual([]); }
    else if (state === "cancelled") { await expect(result).rejects.toThrow(); expect(deltas).toEqual([]); }
    else { await expect(result).rejects.toMatchObject({ code: "chatgpt_send_outcome_unknown" }); expect(deltas).toEqual([]); }
    expect(presses).toBe(1);
    expect(reloads).toBe(saved ? 1 : 0);
    expect(completedResponses).toBe(["complete", "late-accepted", "late-timeout", "delayed-source", "consumer-failed", "complete-dom", "foreign-dom", "delayed-dom-source", "partial-dom", "saved-recovered", "progress-source", "progress-dom", "progress-consumer"].includes(state) ? 1 : 0);
    if (delayed) {
      expect(beforeTerminal).toEqual([0, 0]);
      if (state === "delayed-dom-source" || progress) expect(domReadStarted).toBeTrue();
      else { expect(bindingStarted).toBeTrue(); expect(bindingRetired).toBeTrue(); }
    }
    expect(receipts).toEqual([{ id: "source-task", secret: "source-secret", permit: "source-permit",
      outcome: progress || ["complete", "incomplete", "late-accepted", "late-timeout", "delayed-source", "delayed-cancel", "consumer-failed", "complete-dom", "foreign-dom", "delayed-dom-source", "partial-dom", "no-final", "saved-no-final", "saved-recovered"].includes(state) ? "confirmed" : "unknown" }]);
    const archives = readdirSync(join(root, "diagnostics")).filter(name => name.startsWith("response-source-"));
    const artifacts = archives.filter(name => existsSync(join(root, "diagnostics", name, "response-source.private.json")));
    if (state === "cancelled") expect(archives).toEqual([]);
    if (["incomplete", "duplicate-request", "disconnected", "consumer-failed", "foreign-dom", "partial-dom", "no-final", "saved-no-final", "progress-consumer"].includes(state)) {
      expect(artifacts).toHaveLength(1);
      const artifact = JSON.parse(readFileSync(join(root, "diagnostics", artifacts[0]!, "response-source.private.json"), "utf8"));
      expect(artifact.format).toBe("chatgpt-public-response-events");
      expect(artifact.binding.userMessageId).toBe("current-user");
      expect(artifact.summary.retained).toBeGreaterThan(0);
      expect(JSON.stringify(artifact)).not.toContain("Synthetic input");
    } else expect(artifacts).toEqual([]);
  } finally {
    clearTimeout(acceptanceTimer);
    clockRestore?.();
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-source-worker-")) throw Error("Unexpected fixture directory");
    rmSync(root, { recursive: true, force: true });
  }
});

test("cancelling during send activation never releases a delayed click", async () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-send-cancel-"));
  try {
    const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: `browser://${root}` });
    const cancel = new AbortController();
    let clicks = 0;
    const button = { waitFor: async () => {}, isEnabled: async () => true, click: async () => { clicks++; } };
    const absent: any = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
    const page = { isClosed: () => false, locator: () => absent, evaluate: async () => ({}) };
    worker.activeComposer = async () => ({ locator: () => ({ locator: () => button }) });
    await expect(worker.sendAttachedPrompt(page, {}, undefined, cancel.signal, undefined,
      { onSendActivated: async () => { cancel.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(clicks).toBe(0);
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-send-cancel-")) throw Error("Unexpected fixture directory");
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing send activation acknowledgement times out without a late click", async () => {
  let clicks = 0;
  let acknowledge!: () => void;
  const acknowledgement = new Promise<void>(resolve => { acknowledge = resolve; });
  const button = { waitFor: async () => {}, isEnabled: async () => true, click: async () => { clicks++; } };
  const absent: any = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
  const page = { isClosed: () => false, locator: () => absent, evaluate: async () => ({}) };
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    activeComposer: async () => ({ locator: () => ({ locator: () => button }) }),
  });
  const originalTimeout = globalThis.setTimeout;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: any[]) => void, ms: number, ...args: any[]) =>
    originalTimeout(fn, ms === 60_000 ? 10 : ms, ...args)) as typeof setTimeout);
  try {
    const send = (ChatGptBrowserWorker.prototype as any).sendAttachedPrompt.call(worker, page, {},
      undefined, undefined, undefined, { onSendActivated: () => acknowledgement });
    await expect(send).rejects.toMatchObject({ name: "ChatGptBrowserObservationTimeoutError" });
    acknowledge();
    await new Promise(resolve => originalTimeout(resolve, 0));
    expect(clicks).toBe(0);
  } finally { timer.mockRestore(); }
});
