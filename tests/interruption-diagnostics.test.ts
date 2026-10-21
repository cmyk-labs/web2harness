import { expect, spyOn, test } from "bun:test";
import { abortWithDiagnostic, attachInterruption, correlationContext, observeInterruption, parseInterruption, readInterruption } from "../src/interruption-diagnostics";
import { parseDiagnosticLine, safeDetail, type DiagnosticRecord } from "../launcher/shared/diagnostic-event.cjs";

test("first interruption survives propagation and repeated aborts without replacing original reasons", () => {
  const rows: DiagnosticRecord[] = [];
  const log = spyOn(console, "error").mockImplementation(line => { const row = parseDiagnosticLine(String(line)); if (row) rows.push(row); });
  try {
    const first = new AbortController(), second = new AbortController(), original = new Error("fixture");
    const requestId = crypto.randomUUID();
    abortWithDiagnostic(first, "queue_interrupt", original, { requestId });
    const root = readInterruption(first.signal)!;
    expect(first.signal.reason).toBe(original);
    expect(rows[0]!.eventId).toBe(root.firstEventId);
    const received = parseInterruption(JSON.parse(JSON.stringify(root)))!;
    abortWithDiagnostic(second, "helper_local_abort", undefined, { requestId }, received);
    expect(second.signal.reason).toBeInstanceOf(DOMException);
    expect(second.signal.reason.name).toBe("AbortError");
    const propagated = readInterruption(second.signal)!;
    expect(propagated).toMatchObject({ firstEventId: root.eventId, parentEventId: root.eventId });
    abortWithDiagnostic(second, "helper_shutdown_requested", new Error("later"));
    expect(readInterruption(second.signal)).toBe(propagated);
    expect(rows).toHaveLength(2);
    const error = new Error("independent");
    expect(readInterruption(error)).toBeUndefined();
    attachInterruption(error, propagated); attachInterruption(error, root);
    expect(readInterruption(error)).toBe(propagated);
  } finally { log.mockRestore(); }
});

test("diagnostic sink failure cannot prevent cancellation and invalid IPC metadata has no authority", () => {
  const log = spyOn(console, "error").mockImplementation(() => { throw new Error("sink closed"); });
  try {
    const controller = new AbortController();
    abortWithDiagnostic(controller, "http_client_abort", "original");
    expect(controller.signal.reason).toBe("original");
    expect(parseInterruption({ origin: "PRIVATE", eventId: "PRIVATE" })).toBeUndefined();
    const requestId = crypto.randomUUID(), queueId = "a".repeat(64);
    expect(correlationContext({ requestId, queueId, attemptId: "PRIVATE", prompt: "PRIVATE" })).toEqual({ requestId, queueId });
    expect(correlationContext(null)).toEqual({});
    expect(safeDetail({ queueId, firstEventId: requestId, controlId: requestId })).toEqual({ queueId, firstEventId: requestId, controlId: requestId });
    const target = {};
    expect(observeInterruption(target, "helper_exit")).toBe(observeInterruption(target, "http_shutdown"));
  } finally { log.mockRestore(); }
});
