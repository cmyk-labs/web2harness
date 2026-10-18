import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ChatGptBrowserWorker, browserStageTimeouts } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { ChatGptWebAdapterError } from "../../../../src/adapters/chatgpt-web/adapter-error";

// Exercise the complete worker's send boundary with deterministic page/queue transports.
// Browser readiness and answer extraction have their own DOM tests; these are not live sends.
test.each(["preflight-failed", "ready-changed", "unknown", "confirmed", "duplicate-ack"])(
  "send lifecycle keeps model verification outside acknowledgement and settles %s accurately", async scenario => {
    const root = mkdtempSync(join(tmpdir(), "web2harness-send-lifecycle-"));
    try {
      const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web",
        baseUrl: `browser://${root}`, chatgptWeb: { localToolsEnabled: false, solAvailable: true,
          extraHighAvailable: true, proAvailable: false, storageStatePath: join(root, "auth.json"),
          browserDiagnosticsPath: join(root, "diagnostics") } });
      const order: string[] = [], settlements: any[] = [], stages: Array<[string, number]> = [];
      let inputs = 0, activated = 0, released = 0;
      const absent: any = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
      const page: any = Object.assign(new EventEmitter(), { isClosed: () => false,
        url: () => "https://chatgpt.com/?temporary-chat=true", evaluate: async () => ({}),
        locator: () => absent, context: () => ({ newCDPSession: async () => { throw Error("fixture has no CDP"); } }) });
      const button = { waitFor: async () => {}, isEnabled: async () => true,
        click: async () => { inputs++; order.push("input"); } };
      const composer = { locator: () => ({ locator: () => button }) };
      worker.activeComposer = async () => composer;
      worker.prepareChatSurface = async () => composer;
      worker.selectModelAndEffort = async () => ({ effort: "xhigh", localTools: false });
      worker.captureSubmissionBaseline = async () => ({});
      worker.attachPromptWithCompactionRetry = worker.attachFiles = async () => {};
      worker.requestQueueTarget = async () => ({ request: async (action: string, body: any) => {
        if (action === "send-begin") return { allowed: true, permit: "owned-permit" };
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
        if (scenario === "unknown") throw unknown;
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
      if (scenario === "unknown") await expect(attempt).rejects.toMatchObject({ code: "chatgpt_send_outcome_unknown", retryable: false });
      else await expect(attempt).rejects.toBe(
        scenario === "preflight-failed" || scenario === "ready-changed" ? selectionFailure
          : extractionBoundary);
      const unsent = scenario === "preflight-failed" || scenario === "ready-changed";
      expect(inputs).toBe(unsent ? 0 : 1);
      expect(activated).toBe(unsent ? 0 : 1);
      expect(settlements).toEqual([{ id: "owned-task", secret: "fixture-secret", permit: "owned-permit",
        outcome: unsent ? "not-sent" : scenario === "duplicate-ack" ? "confirmed" : scenario }]);
      expect(stages).toContainEqual(["send_preflight", browserStageTimeouts.effortSelection]);
      if (scenario !== "preflight-failed") expect(stages).toContainEqual(["send", browserStageTimeouts.send]);
      if (!unsent) expect(order.slice(0, 4)).toEqual(["family", "ready", "activated", "input"]);
      expect(released).toBe(1);
    } finally {
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-send-lifecycle-")) {
        throw new Error("Unexpected send fixture directory");
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test.each(["complete", "incomplete", "late-accepted", "late-timeout", "duplicate-request", "cancelled", "disconnected"])("worker handles an identity-bound %s source without relying on a rendered answer", async state => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-source-worker-"));
  let acceptanceTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: `browser://${root}`,
      chatgptWeb: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false,
        storageStatePath: join(root, "auth.json"), browserDiagnosticsPath: join(root, "diagnostics") } });
    const text = "| Name | Value |\n| --- | --- |\n| Alpha | beta_code |\n\n```ps1\n'Literal *text*'\n```\n\nSame\n\nSame";
    const user = { id: "current-user", author: { role: "user" }, content: { content_type: "text", parts: ["input"] } };
    const frames = ["v1", { type: "input_message", conversation_id: "current", input_message: user },
      { p: "", o: "add", v: { conversation_id: "current", message: { id: "answer", author: { role: "assistant" }, channel: "final", recipient: "all",
        content: { content_type: "text", parts: [text] }, status: state !== "incomplete" ? "finished_successfully" : "finished_partial", end_turn: true,
        metadata: { parent_id: user.id, is_complete: true, finish_details: { type: "stop" } } } } },
      { type: "message_stream_complete", conversation_id: "current" }, "[DONE]"];
    const body = Buffer.from(frames.map(v => `data: ${v === "[DONE]" ? v : JSON.stringify(v)}\n\n`).join("")).toString("base64");
    const sessions: EventEmitter[] = [];
    const cancel = new AbortController();
    const receipts: any[] = [];
    let disconnected = false;
    const absent: any = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
    const page: any = Object.assign(new EventEmitter(), { isClosed: () => disconnected, url: () => "https://chatgpt.com/?temporary-chat=true",
      evaluate: async () => ({}), locator: () => absent, context: () => ({ newCDPSession: async () => {
        const session = Object.assign(new EventEmitter(), { detach: async () => {}, send: async (method: string) =>
          method === "Page.getFrameTree" ? { frameTree: { frame: { id: "owned" } } }
            : method === "Network.streamResourceContent" ? { bufferedData: body } : {} });
        sessions.push(session); return session;
      } }) });
    let prompt = "", presses = 0;
    const composer = { locator: () => ({ locator: () => ({ waitFor: async () => {}, isEnabled: async () => true, click: async () => {
      presses++;
      const emitAcceptance = () => { for (const session of sessions) {
        session.emit("Network.requestWillBeSent", { frameId: "owned", requestId: "response", request: { method: "POST", url: "https://chatgpt.com/backend-api/f/conversation",
          postData: JSON.stringify({ action: "next", messages: [{ ...user, content: { parts: [prompt] } }] }) } });
        session.emit("Network.responseReceived", { requestId: "response", response: { status: 200, mimeType: "text/event-stream", url: "https://chatgpt.com/backend-api/f/conversation" } });
        session.emit("Network.loadingFinished", { requestId: "response" });
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
      worker.runStage = (trace: string, stage: string, ms: number, ...rest: any[]) => realStage(trace, stage, stage === "send" ? 300 : ms, ...rest);
    }
    worker.requestQueueTarget = async () => ({ request: async (action: string, body: any) => {
      if (action === "send-begin") return { allowed: true, permit: "source-permit" };
      if (action === "send-end") receipts.push(body);
      return {};
    } });
    worker.submissionDomState = async () => { throw Error("DOM unavailable: source must supply completion"); };
    const deltas: string[] = [];
    const result = worker.runBrowserTurnObserved({ traceId: `source-${state}`, modelId: "gpt-5.6-sol", reasoning: "xhigh",
      capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false },
      queueTicket: { id: "source-task", secret: "source-secret" }, abortSignal: cancel.signal,
      prepare: async () => ({ text: "input", images: [], release() {} }), onTextDelta: (delta: string) => deltas.push(delta),
    }, undefined, page);
    if (["complete", "late-accepted", "late-timeout"].includes(state)) { expect(await result).toBe(text); expect(deltas).toEqual([text]); }
    else if (state === "incomplete") { await expect(result).rejects.toMatchObject({ code: "chatgpt_response_source_invalid" }); expect(deltas).toEqual([]); }
    else if (state === "cancelled") { await expect(result).rejects.toThrow(); expect(deltas).toEqual([]); }
    else { await expect(result).rejects.toMatchObject({ code: "chatgpt_send_outcome_unknown" }); expect(deltas).toEqual([]); }
    expect(presses).toBe(1);
    expect(receipts).toEqual([{ id: "source-task", secret: "source-secret", permit: "source-permit",
      outcome: ["complete", "incomplete", "late-accepted", "late-timeout"].includes(state) ? "confirmed" : "unknown" }]);
    const artifacts = readdirSync(join(root, "diagnostics")).filter(name => name.startsWith("response-source-"));
    if (["incomplete", "duplicate-request", "disconnected"].includes(state)) {
      expect(artifacts).toHaveLength(1);
      const artifact = JSON.parse(readFileSync(join(root, "diagnostics", artifacts[0]!, "response-source.private.json"), "utf8"));
      expect(artifact.format).toBe("chatgpt-public-response-events");
      expect(artifact.binding.userMessageId).toBe("current-user");
      expect(artifact.summary.retained).toBeGreaterThan(0);
      expect(JSON.stringify(artifact)).not.toContain("Synthetic input");
    } else expect(artifacts).toEqual([]);
  } finally {
    clearTimeout(acceptanceTimer);
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
