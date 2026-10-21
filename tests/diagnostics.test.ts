import { expect, test } from "bun:test";
import { diagnosticContext, diagnosticEvent } from "../src/diagnostics";
import { diagnosticError, parseDiagnosticLine, safeDetail, type DiagnosticRecord } from "../launcher/shared/diagnostic-event.cjs";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser/browser-worker";
import { handoffRejectionDiagnostics } from "../src/adapters/chatgpt-web/tools/handoff-validation";

test("completion diagnostics retain only validated content-independent references", () => {
  expect(safeDetail({ sourceId: "a".repeat(64), roundRef: `diag-${"b".repeat(24)}`, state: "activity_in_flight", sealed: true }))
    .toEqual({ sourceId: "a".repeat(64), roundRef: `diag-${"b".repeat(24)}`, state: "activity_in_flight", sealed: true });
  const redacted = safeDetail({ sourceId: "PRIVATE_SOURCE", roundRef: "PRIVATE_ROUND", state: "PRIVATE_STATE" });
  expect(JSON.stringify(redacted)).not.toContain("PRIVATE");
});

test.each([false, true])("Send errors retain actionability reasons without DOM previews (ANSI=%s)", styled => {
  const lines = ['locator.click: Timeout 60000ms exceeded.', 'Call log:', '  - locator resolved to <button title="PRIVATE_ATTRIBUTE">PRIVATE_LABEL</button>',
    '  - <div>PRIVATE_BODY</div> from <section>PRIVATE_ANCESTOR</section> subtree intercepts pointer events', '  2 × <span>PRIVATE_REPEATED</span> intercepts pointer events'];
  const click = new Error(lines.map(line => styled ? `\u001b[2m${line}\u001b[22m` : line).join("\n"));
  const result = diagnosticError(new AggregateError([click, new Error("acceptance timed out")], "Send not confirmed"));
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(JSON.stringify(result)).toContain("intercepts pointer events");
  expect(result).toMatchObject({ errors: [{ category: "timeout" }, { message: "acceptance timed out" }] });
  expect(click.message).toContain("PRIVATE_BODY"); // The original cause is preserved in memory.
});

test("Markdown metadata survives the real logging pipeline without allowing arbitrary content", async () => {
  const records = await capture(async () => {
    diagnosticEvent("error", "browser.markdown_conflict", { delivery: "buffered", emittedChars: 0,
      conflict: { reason: "missing_pending_content", observedTag: "div", committedTag: "p", observedSegments: 2 },
      prompt: "PRIVATE_PROMPT", content: "PRIVATE_ANSWER", cookie: "PRIVATE_COOKIE" });
    diagnosticEvent("info", "browser.markdown_rebuilt", { delivery: "append", rebuilt: true });
    diagnosticEvent("error", "browser.markdown_conflict", { delivery: "PRIVATE_DELIVERY",
      conflict: { observedTag: "PRIVATE_TAG", committedTag: "<p>PRIVATE_BODY</p>" } });
    for (const tag of ["root", "inline", "ol:item", "ul:item"]) {
      diagnosticEvent("error", "browser.markdown_conflict", { conflict: { observedTag: tag, committedTag: tag } });
    }
  });
  expect(records[0]!.detail).toMatchObject({ delivery: "buffered", emittedChars: 0,
    conflict: { reason: "missing_pending_content", observedTag: "div", committedTag: "p", observedSegments: 2 } });
  expect(records[1]!.detail).toMatchObject({ delivery: "append", rebuilt: true });
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  expect(records[2]!.detail.delivery).toBe("[text removed]");
  expect(records.slice(3).map(record => record.detail.conflict)).toEqual(
    ["root", "inline", "ol:item", "ul:item"].map(tag => ({ observedTag: tag, committedTag: tag })),
  );
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
