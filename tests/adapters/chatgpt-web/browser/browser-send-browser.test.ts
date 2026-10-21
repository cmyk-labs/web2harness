import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { ChatGptBrowserWorker, browserStageTimeouts } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { observeSendInput } from "../../../../src/adapters/chatgpt-web/browser/send-input-probe";
import { createDiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";

// Real button activation and shared submission DOM observation in a fresh local browser.
// Preparation/model selection and the queue endpoint are fixtures, not authenticated Web sends.
for (const outcome of ["accepted", "enabled-late", "unchanged", "cleared", "covered", "covered-enter", "late-covered", "modal-covered", "disabled-covered", "late-modal"] as const) {
  test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`real browser send ${outcome} is classified without a duplicate input`, async () => {
    const root = mkdtempSync(join(tmpdir(), "web2harness-send-browser-"));
    const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
    const fixtureLimits = browserStageTimeouts as { send: number; sendEnable: number };
    const sendTimeout = fixtureLimits.send, enableTimeout = fixtureLimits.sendEnable;
    try {
      const page = await browser.newPage();
      await page.route("**/*", route => route.abort());
      await page.setContent(`<form><textarea id="prompt-textarea">Synthetic input</textarea>
        <button type="submit" data-testid="send-button">Send</button></form><main></main>
        <script>
        window.submissions=0;window.enterKeys=0;
        // The client may reserve Enter for composer shortcuts, including when a button is focused.
        document.addEventListener('keydown',e=>{if(e.key==='Enter'){
          window.enterKeys++;
          if (${JSON.stringify(outcome)}!=='covered-enter')e.preventDefault();
        }},true);
        document.querySelector('form').onsubmit=e=>{
          e.preventDefault();window.submissions++;
          if (${JSON.stringify(outcome)}!=='unchanged') document.querySelector('textarea').value='';
          if (['accepted','enabled-late','covered-enter'].includes(${JSON.stringify(outcome)})) setTimeout(()=>{
            const turn=document.createElement('article');
            turn.dataset.turnKey='fixture-user';
            const bubble=document.createElement('div');bubble.dataset.userMessageBubble='';bubble.textContent='Synthetic input';
            turn.append(bubble);document.querySelector('main').append(turn);
          },75);
        };
        </script>`);
      const blocked = !["accepted", "enabled-late", "unchanged", "cleared"].includes(outcome);
      const accepted = outcome === "accepted" || outcome === "enabled-late" || outcome === "covered-enter";
      const unsent = outcome === "modal-covered" || outcome === "disabled-covered" || outcome === "late-modal";
      if (blocked) {
        fixtureLimits.send = 250;
        fixtureLimits.sendEnable = 250;
        await page.evaluate(mode => {
          const cover = () => {
            if (document.querySelector("[data-fixture-cover]")) return;
            const overlay = document.createElement("div"); overlay.dataset.fixtureCover = "";
            overlay.style.cssText = "position:fixed;inset:0;z-index:999;background:transparent";
            if (mode === "modal-covered") { overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); }
            document.body.append(overlay);
          };
          if (mode === "disabled-covered") document.querySelector("button")!.disabled = true;
          // Trial checks can move the pointer. Arm a late-input fault only after the trial.
          if (mode !== "late-covered") cover();
        }, outcome);
      }
      const worker: any = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: `browser://${root}`,
        chatgptWeb: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false,
          storageStatePath: join(root, "auth.json"), browserDiagnosticsPath: join(root, "diagnostics") } });
      const settlements: any[] = [], stages: string[] = [];
      let activated = 0, released = 0, permits = 0;
      worker.prepareChatSurface = async () => page.locator("#prompt-textarea");
      worker.selectModelAndEffort = async () => ({ effort: "xhigh", localTools: false });
      worker.assertSelectedEffort = async () => {};
      worker.attachPromptWithCompactionRetry = worker.attachFiles = async () => {};
      worker.requestQueueTarget = async () => ({ request: async (action: string, body: any) => {
        if (action === "send-begin") {
          permits++;
          if (outcome === "late-covered") {
            await page.mouse.move(0, 0);
            await page.evaluate(() => document.querySelector("button")!.addEventListener("pointermove", () => {
              const overlay = document.createElement("div"); overlay.dataset.fixtureCover = "";
              overlay.style.cssText = "position:fixed;inset:0;z-index:999;background:transparent";
              document.body.append(overlay);
            }, { once: true }));
          }
          if (outcome === "late-modal") await page.evaluate(() => {
            const modal = document.createElement("div"); modal.setAttribute("role", "dialog"); modal.textContent = "Modal";
            document.body.append(modal);
          });
          return { allowed: true, permit: "fixture-permit" };
        }
        if (action === "send-end") settlements.push(body);
        return {};
      } });
      const afterAccepted = new Error("fixture stops after confirmed send");
      worker.waitForNewAssistantTurn = async () => { throw afterAccepted; };
      const realStage = worker.runStage.bind(worker);
      worker.runStage = async (trace: string, stage: string, ms: number, ...rest: any[]) => {
        stages.push(stage);
        if (stage === "send_preflight" && outcome === "enabled-late") {
          fixtureLimits.send = 250; fixtureLimits.sendEnable = 1_200;
          await page.evaluate(() => {
            const button = document.querySelector("button")!; button.disabled = true;
            setTimeout(() => { button.disabled = false; }, 650);
          });
        }
        if (stage === "send_acknowledgement") {
          expect(await page.evaluate(() => (window as any).__w2hSendInput === undefined)).toBe(true);
        }
        // Match production orchestration: only acknowledgement has a shortened fixture budget.
        return realStage(trace, stage, stage === "send_acknowledgement" ? 750 : ms, ...rest);
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
      if (accepted) expect(error).toBe(afterAccepted);
      else if (unsent) {
        expect(error).toBeInstanceOf(Error);
        if (outcome !== "late-modal") expect(error).toMatchObject({ code: "chatgpt_send_control_unavailable", retryable: false });
        else expect((error as Error).message).toContain("no Enter was dispatched");
      }
      else {
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ code: "chatgpt_send_outcome_unknown", retryable: false });
      }
      expect(await page.evaluate(() => (window as any).submissions)).toBe(accepted || !blocked ? 1 : 0);
      expect(await page.evaluate(() => (window as any).enterKeys)).toBe(outcome === "covered" || outcome === "covered-enter" ? 1 : 0);
      if (blocked && !unsent) {
        const diagnostic = join(root, "diagnostics", readdirSync(join(root, "diagnostics")).find(name => name.startsWith(`real-send-${outcome}-`))!);
        const ready = JSON.parse(readFileSync(join(diagnostic, readdirSync(diagnostic).find(name => name.endsWith("send-ready.json"))!), "utf8"));
        expect(ready.state.sendControls[0]).toMatchObject({ enabled: true, rendered: true, inViewport: true, receivesPointer: outcome === "late-covered" });
        expect(ready.state.visibility).toMatchObject({ hidden: false });
        if (outcome === "late-covered") {
          expect((error as any).cause).toBeInstanceOf(AggregateError);
          expect((error as any).cause.errors[0].message).toContain("intercepts pointer events");
        }
      }
      expect(activated).toBe(unsent ? 0 : 1);
      expect(permits).toBe(unsent && outcome !== "late-modal" ? 0 : 1);
      expect(stages).toContain("send_preflight");
      expect(settlements).toEqual(unsent && outcome !== "late-modal" ? [] : [{ id: "owned-task", secret: "fixture-secret", permit: "fixture-permit",
        outcome: accepted ? "confirmed" : unsent ? "not-sent" : "unknown" }]);
      expect(released).toBe(1);
    } finally {
      fixtureLimits.send = sendTimeout;
      fixtureLimits.sendEnable = enableTimeout;
      await browser.close();
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("web2harness-send-browser-")) {
        throw new Error("Unexpected send fixture directory");
      }
      rmSync(root, { recursive: true, force: true });
    }
  // Preserve the shared 30s read-only reconciliation budget.
  }, 45_000);
}

for (const interrupted of ["focus", "cancel"] as const) {
  test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`Enter fallback cannot activate after ${interrupted} changes during readiness`, async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
    try {
      const page = await browser.newPage();
      await page.route("**/*", route => route.abort());
      await page.setContent('<form><textarea id="prompt-textarea">Synthetic input</textarea><button type="submit" data-testid="send-button">Send</button></form>');
      await page.evaluate(() => {
        (window as any).enterKeys = 0;
        document.addEventListener("keydown", e => { if (e.key === "Enter") (window as any).enterKeys++; });
        document.querySelector("form")!.onsubmit = e => e.preventDefault();
      });
      const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
      const controller = new AbortController();
      const attempt = worker.sendAttachedPrompt(page, {}, undefined, controller.signal, undefined, {
        onSendActivated: async () => {
          if (interrupted === "cancel") controller.abort();
          else await page.locator("textarea").focus();
        },
      }, undefined, undefined, undefined, "enter");
      if (interrupted === "cancel") await expect(attempt).rejects.toMatchObject({ name: "AbortError" });
      else await expect(attempt).rejects.toThrow("no Enter was dispatched");
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(await page.evaluate(() => (window as any).enterKeys)).toBe(0);
    } finally { await browser.close(); }
  }, 20_000);
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
    expect(await finish()).toEqual({ available: false, reason: "missing" });
  } finally { await browser.close(); }
});
