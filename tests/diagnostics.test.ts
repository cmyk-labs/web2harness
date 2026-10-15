import { expect, test } from "bun:test";
import { diagnosticContext, diagnosticEvent } from "../src/diagnostics";
import { parseDiagnosticLine, safeDetail, type DiagnosticRecord } from "../launcher/shared/diagnostic-event.cjs";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser/browser-worker";
import { handoffRejectionDiagnostics } from "../src/adapters/chatgpt-web/tools/handoff-validation";

test("completion diagnostics retain only validated content-independent references", () => {
  expect(safeDetail({ sourceId: "a".repeat(64), roundRef: `diag-${"b".repeat(24)}`, state: "activity_in_flight", sealed: true }))
    .toEqual({ sourceId: "a".repeat(64), roundRef: `diag-${"b".repeat(24)}`, state: "activity_in_flight", sealed: true });
  const redacted = safeDetail({ sourceId: "PRIVATE_SOURCE", roundRef: "PRIVATE_ROUND", state: "PRIVATE_STATE" });
  expect(JSON.stringify(redacted)).not.toContain("PRIVATE");
});

test("handoff comparison logs only declared identities, including for identifier-shaped private input", () => {
  const tools = [{ name: "apply_patch", namespace: "functions", description: "Patch", parameters: {}, freeform: true }];
  const diagnostic = safeDetail(handoffRejectionDiagnostics(tools, [
    { name: "PRIVATE_IDENTIFIER_SECRET", namespace: "PRIVATE_NAMESPACE", input: "PRIVATE_PATCH", arguments: { cmd: "PRIVATE_COMMAND" } },
    { name: "apply_patch", namespace: "PRIVATE_NAMESPACE", input: "PRIVATE_PATCH", scope: { toString: "PRIVATE_SCOPE" } },
    { name: "functions.apply_patch", input: "PRIVATE_PATCH" },
  ]));
  expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE");
  expect(diagnostic).toMatchObject({ declaredToolCount: 1, omittedCallCount: 0, diagnosticCalls: [
    { exactIdentityMatch: false, candidateCount: 0, namespaceSupplied: true, hasInput: true, hasArguments: true },
    { handoffScope: "invalid", candidates: [{ toolName: "functions.apply_patch", nameMatched: true, namespaceMatched: false }] },
    { handoffScope: "top_level", candidates: [{ toolName: "functions.apply_patch", nameMatched: false, qualifiedNameMatched: true }] },
  ] });
  expect(safeDetail({ handoffScope: "PRIVATE_SCOPE" })).toEqual({ handoffScope: "[text removed]" });
});

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
