import { expect, test } from "bun:test";
import { diagnosticContext, diagnosticEvent } from "../src/diagnostics";
import { parseDiagnosticLine, type DiagnosticRecord } from "../launcher/shared/diagnostic-event.cjs";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser/browser-worker";

async function capture(run: () => Promise<void>) {
  const records: DiagnosticRecord[] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => { const record = parseDiagnosticLine(String(values[0])); if (record) records.push(record); };
  try { await run(); return records; } finally { console.error = original; }
}
test("concurrent request diagnostics preserve their own context and do not emit content", async () => {
  const records = await capture(async () => {
    await Promise.all(["trace-first", "trace-second"].map((traceId, i) => diagnosticContext.run({ traceId }, async () => {
      await new Promise(resolve => setTimeout(resolve, i ? 1 : 5));
      diagnosticEvent("warning", "browser.connection_failed", { errorCode: "ETIMEDOUT", errorDescription: "Connection timed out", password: "PRIVATE_SECRET", prompt: "PRIVATE_PROMPT" });
    })));
  });
  expect(new Set(records.map(record => record.detail.traceId))).toEqual(new Set(["trace-first", "trace-second"]));
  expect(new Set(records.map(record => record.eventId)).size).toBe(2);
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE_SECRET|PRIVATE_PROMPT/);
  expect(records[0]!.detail.errorDescription).toBe("Connection timed out");
});
test("model selection failure records the attempt and never claims verification or submission", async () => {
  const select = (ChatGptBrowserWorker.prototype as any).selectModelAndEffort;
  const records = await capture(async () => {
    await expect(diagnosticContext.run({ traceId: "trace-model" }, () => select.call({
      activeComposer: async () => { throw Object.assign(new Error("Composer control missing"), { code: "CONTROL_MISSING" }); },
    }, {}, "gpt-5.6-sol", "high", { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true }, undefined, false, "5.6"))).rejects.toThrow("Composer control missing");
  });
  expect(records.map(record => record.event)).toEqual(["browser.model_selection_started", "browser.model_selection_failed"]);
  expect(records[1]!.detail).toMatchObject({ traceId: "trace-model", submission: "not-sent", verifiedModel: "unknown", requestedModel: "gpt-5.6-sol" });
  expect(records[0]!.detail.operationId).toBe(records[1]!.detail.operationId);
});
test("stage cancellation is informational and log transport failure does not change execution", async () => {
  const stage = (ChatGptBrowserWorker.prototype as any).runStage;
  const records = await capture(async () => {
    await expect(stage.call({}, "trace-abort", "prompt_attachment", 1000, async () => { throw new DOMException("User cancelled", "AbortError"); })).rejects.toThrow("User cancelled");
  });
  expect(records.at(-1)!).toMatchObject({ level: "info", event: "browser.stage_failed", detail: { outcome: "cancelled" } });
  const original = console.error;
  console.error = () => { throw new Error("Closed log pipe"); };
  try { expect(await stage.call({}, "trace-result", "browser_page", 1000, async () => 42)).toBe(42); }
  finally { console.error = original; }
});
