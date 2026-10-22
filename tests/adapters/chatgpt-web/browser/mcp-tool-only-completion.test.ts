import { expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { defaultBrokerEndpoint } from "../../../../src/config";
import { ChatGptBrowserWorker } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { callTurnBroker, RemoteTurnBroker, TurnBroker } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";
import { ChatGptExternalTurnProgress } from "../../../../src/adapters/chatgpt-web/tools/turn-progress";

// Real broker/owner transport with deterministic browser observations. A tool-only Web
// response is valid only for this binding's sealed batch; this is not live acceptance.
for (const scenario of ["tools", "late-batch", "late-activity", "plain-empty", "unsealed", "unsettled", "partial", "unsupported", "interrupted"]) {
  test(`MCP completion preserves the broker and fresh DOM fences for ${scenario}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "w2h-tool-only-"));
    const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
    const owner = new RemoteTurnBroker(broker.socketPath);
    let clockRestore: (() => void) | undefined;
    const cancel = new AbortController();
    try {
      const protocol = "web2harness-handoff-v1" as const;
      const token = await broker.registerHandoff({ cwd: root, roots: [root], writableRoots: [],
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        tools: [{ name: "read_fixture", description: "Read", parameters: { type: "object" } }],
      }, { allowBrowserReply: true });
      const submit = async () => {
        const claim = await callTurnBroker<{ activityId: string; bindingId: string }>(broker.socketPath,
          { method: "claim", token, protocol });
        await callTurnBroker(broker.socketPath, { method: "handoff_submit", ...claim, protocol,
          submissionId: "only-batch", calls: [{ name: "read_fixture", arguments: {} }], sealOnSubmit: scenario !== "unsealed" });
        if (scenario !== "unsettled") await callTurnBroker(broker.socketPath,
          { method: "activity_complete", token, activityId: claim.activityId });
      };
      if (scenario !== "plain-empty" && scenario !== "late-batch") await submit();
      const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: `browser://${root}`,
        chatgptWeb: { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: false,
          storageStatePath: join(root, "auth.json"), browserDiagnosticsPath: join(root, "diagnostics") } });
      const absent: any = { filter() { return this; }, last() { return this; }, getByText() { return this; },
        getByTestId() { return this; }, isVisible: async () => false };
      const page: any = Object.assign(new EventEmitter(), { isClosed: () => false,
        url: () => "https://chatgpt.com/", locator: () => absent,
        evaluate: async () => ({ complete: scenario !== "interrupted", revision: 1 }),
        context: () => ({ newCDPSession: async () => { throw Error("Synthetic DOM observation only"); } }) });
      worker.activeComposer = worker.prepareChatSurface = async () => ({});
      worker.selectModelAndEffort = async () => ({ effort: "high", localTools: true });
      worker.captureSubmissionBaseline = async () => ({});
      worker.attachPromptWithCompactionRetry = worker.attachFiles = worker.assertSelectedEffort = async () => {};
      worker.prepareSendMethod = async () => "click";
      worker.sendAttachedPrompt = async (...args: any[]) => { await args[5].onSendActivated(); await args[5].onSubmitted(); return "user_turn"; };
      worker.waitForNewAssistantTurn = async () => ({ identity: "owned", locator: absent, acceptedTurnIdentities: [] });
      let reads = 0, begins = 0, commits = 0, successfulCommits = 0, firstFenceRead = 0;
      worker.responseDomSnapshot = async () => {
        reads++;
        if (scenario === "late-batch" && reads === 2) await submit();
        if (reads === 7) {
          if (scenario === "interrupted") cancel.abort();
          else {
            const now = Date.now.bind(Date), clock = spyOn(Date, "now").mockImplementation(() => now() + 120_001);
            clockRestore = () => clock.mockRestore();
          }
        }
        return { responsePresent: true, contentState: scenario === "partial" ? "partial" : scenario === "unsupported" ? "unsupported" : "absent",
          visibleText: "", fullHtml: "<div>Analyzed</div>", markdownSegments: [], traceBlocks: [],
          completionActionVisible: true, stoppedThinkingVisible: false };
      };
      const deltas: string[] = [];
      const attempt = worker.runBrowserTurnObserved({ traceId: `mcp-${scenario}`, modelId: "gpt-5.6-sol", reasoning: "high",
        capabilities: { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: false },
        abortSignal: cancel.signal, prepare: async () => ({ text: "input", images: [], release() {} }),
        onTextDelta: (delta: string) => deltas.push(delta), externalProgress: new ChatGptExternalTurnProgress(),
        completionFence: {
          begin: async () => { begins++; firstFenceRead ||= reads; return owner.beginCompletionFence(token); },
          commit: async (revision: number, reply: string) => {
            commits++; expect(reads).toBeGreaterThan(firstFenceRead);
            if (scenario === "late-activity" && commits === 1) {
              const late = await callTurnBroker<{ activityId: string }>(broker.socketPath, { method: "claim", token, protocol });
              await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: late.activityId });
            }
            const result = await owner.commitCompletionFence(token, revision, reply);
            if (result.state === "committed") successfulCommits++;
            return result;
          },
        },
      }, undefined, page);
      if (scenario === "tools" || scenario === "late-batch" || scenario === "late-activity") {
        expect(await attempt).toBe("");
        expect(commits).toBe(scenario === "late-activity" ? 2 : 1);
        expect(successfulCommits).toBe(1);
        expect(() => broker.takeHandoffBatch(token, () => {})).toThrow("not physically settled");
        broker.confirmHandoffPhysicalSettlement(token);
        expect(() => broker.takeHandoffBatch(token, () => { throw Error("fixture journal unavailable"); })).toThrow("fixture journal unavailable");
        expect(broker.takeHandoffBatch(token, () => {})).toHaveLength(1);
      } else {
        await expect(attempt).rejects.toThrow();
        expect(successfulCommits).toBe(0);
        expect(() => broker.confirmHandoffPhysicalSettlement(token)).toThrow("fence");
        if (scenario === "interrupted") expect(begins).toBe(0);
      }
      expect(deltas).toEqual([]);
    } finally {
      clockRestore?.();
      await broker.close();
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("w2h-tool-only-")) throw Error("Fixture ownership mismatch");
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
}
