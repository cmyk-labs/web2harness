import { expect, spyOn, test } from "bun:test";
import { ChatGptPublicTextEvidence } from "../../../../src/adapters/chatgpt-web/public-text-evidence";
import { ChatGptVisibleTraceTracker } from "../../../../src/adapters/chatgpt-web/browser/response-dom";
import { diagnosticContext, diagnosticReference } from "../../../../src/diagnostics";
import { parseDiagnosticLine, type DiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";

function capture(run: () => void): DiagnosticRecord[] {
  const records: DiagnosticRecord[] = [];
  const log = spyOn(console, "error").mockImplementation((line: unknown) => {
    const record = parseDiagnosticLine(String(line));
    if (record) records.push(record);
  });
  try { diagnosticContext.run({ traceId: "owned-progress" }, run); return records; }
  finally { log.mockRestore(); }
}

test("public commentary evidence explains normalization and continuation without changing delivery", () => {
  const source = "  PRIVATE 我已抽查\t主要代码\r\n ";
  const records = capture(() => {
    const tracker = new ChatGptVisibleTraceTracker(0);
    expect(tracker.observe([{ kind: "commentary", key: "PRIVATE_SLOT", text: source, complete: false }], false)).toEqual([]);
    expect(tracker.observe([{ kind: "commentary", key: "PRIVATE_SLOT", text: source, complete: true }], false))
      .toEqual([{ kind: "commentary", text: "PRIVATE 我已抽查 主要代码" }]);
    expect(tracker.observe([{ kind: "commentary", key: "PRIVATE_SLOT", text: `${source.trim()}\n继续核对。`, complete: true }], false))
      .toEqual([{ kind: "commentary", text: "\n继续核对。", continuation: true }]);
    expect(tracker.observe([{ kind: "commentary", key: "PRIVATE_SLOT", text: "改正后的完整进度。", complete: true }], false))
      .toEqual([{ kind: "commentary", text: "改正后的完整进度。" }]);
  });
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  const projections = records.filter(record => record.detail.stage === "projected");
  expect(projections).toHaveLength(3);
  expect(projections.every(record => record.detail.matches === true)).toBeTrue();
  expect(projections[1]?.detail).toMatchObject({
    continuation: true, clientAcknowledged: false, traceId: "owned-progress",
    fragmentEvidence: { diagnosticRef: diagnosticReference("\n继续核对。") },
  });
});

test("an observed short source is preserved and a real projection mismatch is distinguishable", () => {
  const records = capture(() => {
    const tracker = new ChatGptVisibleTraceTracker(0);
    expect(tracker.observe([{ kind: "commentary", text: "我已抽查主要代码", complete: true }], true))
      .toEqual([{ kind: "commentary", text: "我已抽查主要代码" }]);
    const evidence = new ChatGptPublicTextEvidence();
    evidence.record("projected", { source: "native_reply", expectedText: "我已抽查主要代码，完成验证。",
      actualText: "我已抽查主要代码", transformation: "native_tool_blocks_v1" });
  });
  const projections = records.filter(record => record.detail.stage === "projected");
  expect(projections.map(record => record.detail.matches)).toEqual([true, false]);
  expect(projections[1]?.level).toBe("warning");
});

test("successful completion preserves a growing commentary tail after its DOM root disappears", () => {
  const records = capture(() => {
    const tracker = new ChatGptVisibleTraceTracker(250);
    const block = { kind: "commentary" as const, key: "owned", text: "三个子 Agent 已启动，", complete: true };
    expect(tracker.observe([block], false, 1_000)).toEqual([]);
    expect(tracker.observe([block], false, 1_300)).toEqual([{ kind: "commentary", text: block.text }]);
    const tail = "现在继续核对执行证据。";
    for (let i = 1; i <= tail.length; i++) {
      expect(tracker.observe([{ ...block, text: block.text + tail.slice(0, i) }], false, 1_300 + i * 100)).toEqual([]);
    }
    expect(tracker.observe([], true, 5_000)).toEqual([]);
    expect(tracker.finish()).toEqual([{ kind: "commentary", text: tail, continuation: true }]);
    expect(tracker.finish()).toEqual([]);
    expect(tracker.observe([{ ...block, text: block.text + tail }], true, 6_000)).toEqual([]);
  });
  const projections = records.filter(record => record.detail.stage === "projected");
  expect(projections).toHaveLength(2);
  expect(projections[1]?.detail).toMatchObject({ complete: true, matches: true, continuation: true });
});

test("completion flush excludes answers, statuses and unproven drafts and retains latest completion evidence", () => {
  const tracker = new ChatGptVisibleTraceTracker(250);
  tracker.observe([
    { kind: "answer", text: "final" }, { kind: "status", text: "Thinking" },
    { kind: "commentary", key: "draft", text: "unfinished", complete: false },
    { kind: "commentary", key: "unknown", text: "unknown" },
    { kind: "commentary", key: "revised", text: "revised", complete: true },
    { kind: "commentary", key: "same", text: "completed without text change", complete: false },
  ], false, 1_000);
  tracker.observe([
    { kind: "commentary", key: "revised", text: "revised", complete: false },
    { kind: "commentary", key: "same", text: "completed without text change", complete: true },
  ], false, 1_100);
  expect(tracker.finish()).toEqual([{ kind: "commentary", text: "completed without text change" }]);
});

test("diagnostic budgets are separate from delivery and cannot consume the final projection allowance", () => {
  const records = capture(() => {
    const evidence = new ChatGptPublicTextEvidence();
    for (let index = 0; index < 100; index++) evidence.record("observed", {
      source: "dom_commentary", sourceText: `PRIVATE_${index}`,
    });
    evidence.record("projected", { source: "dom_commentary", expectedText: "Done", actualText: "Done" });
  });
  expect(records.filter(record => record.detail.stage === "observed")).toHaveLength(65);
  expect(records.filter(record => record.detail.stage === "projected")).toHaveLength(1);
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  const log = spyOn(console, "error").mockImplementation(() => { throw new Error("diagnostic sink offline"); });
  try {
    const tracker = new ChatGptVisibleTraceTracker(0);
    expect(tracker.observe([{ kind: "commentary", text: "仍然交付", complete: true }], true))
      .toEqual([{ kind: "commentary", text: "仍然交付" }]);
  } finally { log.mockRestore(); }
});
