import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { ChatGptBrowserWorker } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { observeSendInput } from "../../../../src/adapters/chatgpt-web/browser/send-input-probe";
import { createDiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";

// Real button activation and shared submission DOM observation in a fresh local browser.
// Preparation/model selection and the queue endpoint are fixtures, not authenticated Web sends.
for (const outcome of ["accepted", "unchanged", "cleared"] as const) {
  test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`real browser send ${outcome} is classified without a duplicate input`, async () => {
    const root = mkdtempSync(join(tmpdir(), "web2harness-send-browser-"));
    const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
    try {
      const page = await browser.newPage();
      await page.route("**/*", route => route.abort());
      await page.setContent(`<form><textarea id="prompt-textarea">Synthetic input</textarea>
        <button type="submit" data-testid="send-button">Send</button></form><main></main>
        <script>
        window.submissions=0;
        // The client may reserve Enter for composer shortcuts, including when a button is focused.
        document.addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault()},true);
        document.querySelector('form').onsubmit=e=>{
          e.preventDefault();window.submissions++;
          if (${JSON.stringify(outcome)}!=='unchanged') document.querySelector('textarea').value='';
          if (${JSON.stringify(outcome)}==='accepted') setTimeout(()=>{
            const turn=document.createElement('article');
            turn.dataset.turnKey='fixture-user';
            const bubble=document.createElement('div');bubble.dataset.userMessageBubble='';bubble.textContent='Synthetic input';
            turn.append(bubble);document.querySelector('main').append(turn);
          },75);
        };
        </script>`);
      const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: `browser://${root}`,
        chatgptWeb: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false,
          storageStatePath: join(root, "auth.json"), browserDiagnosticsPath: join(root, "diagnostics") } });
      const settlements: any[] = [], stages: string[] = [];
      let activated = 0, released = 0;
      worker.prepareChatSurface = async () => page.locator("#prompt-textarea");
      worker.selectModelAndEffort = async () => ({ effort: "xhigh", localTools: false });
      worker.assertSelectedEffort = async () => {};
      worker.attachPromptWithCompactionRetry = worker.attachFiles = async () => {};
      worker.requestQueueTarget = async () => ({ request: async (action: string, body: any) => {
        if (action === "send-begin") return { allowed: true, permit: "fixture-permit" };
        if (action === "send-end") settlements.push(body);
        return {};
      } });
      const afterAccepted = new Error("fixture stops after confirmed send");
      worker.waitForNewAssistantTurn = async () => { throw afterAccepted; };
      const realStage = worker.runStage.bind(worker);
      worker.runStage = (trace: string, stage: string, ms: number, ...rest: any[]) => {
        stages.push(stage);
        return realStage(trace, stage, stage === "send" ? 2_000 : ms, ...rest);
      };
      let error: unknown;
      try {
        await worker.runBrowserTurnObserved({ traceId: `real-send-${outcome}`, modelId: "gpt-5.6-sol", reasoning: "xhigh",
          capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false },
          queueTicket: { id: "owned-task", secret: "fixture-secret" },
          prepare: async () => ({ text: "Synthetic input", images: [], release() { released++; } }),
          onSendActivated: async () => { activated++; },
        }, undefined, page);
      } catch (caught) { error = caught; }
      if (outcome === "accepted") expect(error).toBe(afterAccepted);
      else {
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ code: "chatgpt_send_outcome_unknown", retryable: false });
      }
      expect(await page.evaluate(() => (window as any).submissions)).toBe(1);
      expect(activated).toBe(1);
      expect(stages).toContain("send_preflight");
      expect(settlements).toEqual([{ id: "owned-task", secret: "fixture-secret", permit: "fixture-permit",
        outcome: outcome === "accepted" ? "confirmed" : "unknown" }]);
      expect(released).toBe(1);
    } finally {
      await browser.close();
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-send-browser-")) {
        throw new Error("Unexpected send fixture directory");
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
}

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("input probe observes native Enter and prevented submission without recording prompt text", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<form><textarea>PRIVATE_PROMPT</textarea><button type="submit" data-testid="send-button">Send</button></form>');
    await page.evaluate(() => document.querySelector("form")!.addEventListener("submit", event => {
      event.preventDefault(); (window as any).submissionPrevented = event.defaultPrevented;
    }));
    const finish = await observeSendInput(page, '[data-testid="send-button"]');
    await page.locator("button").press("Enter");
    expect(await page.evaluate(() => (window as any).submissionPrevented)).toBe(true);
    const evidence: any = await finish();
    expect(evidence.available).toBe(true);
    expect(evidence.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "keydown", trusted: true, sendTarget: true, focused: true }),
      expect.objectContaining({ type: "submit", trusted: true, prevented: true }),
    ]));
    expect(JSON.stringify(evidence)).not.toContain("PRIVATE");
    const record = createDiagnosticRecord("info", "browser.send_input_evidence", { activation: evidence, input: "PRIVATE_PROMPT" });
    expect((record.detail as any).activation).toEqual(evidence);
    expect(JSON.stringify(record)).not.toContain("PRIVATE");
    expect(await finish()).toEqual({ available: false });
  } finally { await browser.close(); }
});
