import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ChatGptBrowserWorker, browserStageTimeouts } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { ChatGptWebAdapterError } from "../../../../src/adapters/chatgpt-web/adapter-error";

// Exercise the complete worker's send boundary with deterministic page/queue transports.
// Browser readiness and answer extraction have their own DOM tests; these are not live sends.
test.each(["preflight-failed", "ready-changed", "unknown", "confirmed"])(
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
        press: async () => { inputs++; order.push("input"); } };
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
      const realStage = worker.runStage.bind(worker);
      worker.runStage = async (trace: string, stage: string, ms: number, ...rest: any[]) => {
        stages.push([stage, ms]); return realStage(trace, stage, ms, ...rest);
      };
      await expect(worker.runBrowserTurnObserved({ traceId: `send-${scenario}`, modelId: "gpt-5.6-sol",
        reasoning: "xhigh", capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false },
        queueTicket: { id: "owned-task", secret: "fixture-secret" },
        prepare: async () => ({ text: "Synthetic input", images: [], release() { released++; } }),
        onSendActivated: async () => { activated++; order.push("activated"); },
      }, undefined, page)).rejects.toBe(
        scenario === "preflight-failed" || scenario === "ready-changed" ? selectionFailure
          : scenario === "unknown" ? unknown : extractionBoundary);
      const unsent = scenario === "preflight-failed" || scenario === "ready-changed";
      expect(inputs).toBe(unsent ? 0 : 1);
      expect(activated).toBe(unsent ? 0 : 1);
      expect(settlements).toEqual([{ id: "owned-task", secret: "fixture-secret", permit: "owned-permit",
        outcome: unsent ? "not-sent" : scenario }]);
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
