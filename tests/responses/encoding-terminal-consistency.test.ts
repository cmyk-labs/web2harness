import { expect, test } from "bun:test";
import type { AdapterEvent } from "../../src/types";
import { buildResponseJSON } from "../../src/responses/json";
import { bridgeToResponsesSSE } from "../../src/responses/stream";
import { decodeCompactionSummary } from "../../src/responses/compaction";

const usage = { inputTokens: 13, outputTokens: 5 };
type Fixture = { name: string; terminal?: AdapterEvent; status: string; details?: Record<string, unknown> };
const fixtures: Fixture[] = [
  { name: "stop", terminal: { type: "done", stopReason: "stop", endTurn: true, usage }, status: "completed" },
  { name: "tool_use", terminal: { type: "done", stopReason: "tool_use", endTurn: false, usage }, status: "completed" },
  { name: "unspecified stop", terminal: { type: "done", usage }, status: "completed" },
  { name: "token limit", terminal: { type: "done", stopReason: "max_tokens", usage }, status: "incomplete", details: { reason: "max_output_tokens" } },
  { name: "content filter", terminal: { type: "done", stopReason: "content_filter", usage }, status: "incomplete", details: { reason: "content_filter" } },
  { name: "explicit incomplete", terminal: { type: "incomplete", reason: "fixture_limit", message: "Partial", retryable: false, usage },
    status: "incomplete", details: { reason: "fixture_limit", message: "Partial", retryable: false } },
  { name: "error", terminal: { type: "error", message: "Fixture error", status: 502, code: "fixture_failure", usage }, status: "failed" },
  { name: "EOF", status: "incomplete", details: { reason: "adapter_eof" } },
];

async function encodeStream(events: AdapterEvent[], compaction: boolean) {
  async function* source() { yield* events; }
  const cached: Record<string, unknown>[] = [];
  const statuses: string[] = [];
  const stream = bridgeToResponsesSSE(source(), "fixture", undefined, undefined, undefined, undefined, 60_000, {
    compaction, onTerminal: status => statuses.push(status), onCompletedResponse: response => cached.push(response),
  });
  const text = await new Response(stream).text();
  const frames = text.split("\n\n").flatMap(frame => {
    const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
    return data && data !== "[DONE]" ? [JSON.parse(data)] : [];
  });
  const terminal = frames.filter(frame => ["response.completed", "response.incomplete", "response.failed"].includes(frame.type));
  expect(terminal).toHaveLength(1);
  return { response: terminal[0].response, frames, cached, statuses };
}

for (const compaction of [false, true]) for (const fixture of fixtures) {
  test(`JSON/SSE terminal semantics agree for ${fixture.name}, compaction=${compaction}`, async () => {
    const events: AdapterEvent[] = [{ type: "text_delta", text: "Fixture summary" }, ...(fixture.terminal ? [fixture.terminal] : [])];
    const json = buildResponseJSON(events, "fixture", { compaction });
    const sse = await encodeStream(events, compaction);
    for (const response of [json, sse.response]) {
      expect(response.status).toBe(fixture.status);
      expect(response.incomplete_details).toEqual(fixture.details);
      const output = response.output as Array<Record<string, unknown>>;
      const compactItems = output.filter(item => item.type === "compaction");
      expect(compactItems).toHaveLength(compaction && fixture.status === "completed" ? 1 : 0);
      if (compactItems.length) expect(decodeCompactionSummary(compactItems[0]!.encrypted_content as string)).toBe("Fixture summary");
      if (compaction && fixture.status !== "completed") expect(output).toEqual([]);
    }
    expect(sse.response.usage).toEqual(json.usage);
    expect(sse.response.end_turn).toEqual(json.end_turn);
    expect(sse.response.error).toEqual(json.error);
    expect(sse.statuses).toEqual([fixture.status]);
    if (fixture.status !== "completed") {
      expect(sse.frames.filter(frame => frame.item?.type === "compaction")).toEqual([]);
      expect(sse.cached.flatMap(response => response.output as unknown[])).not.toContainEqual(expect.objectContaining({ type: "compaction" }));
    }
  });
}

test("the first terminal event is authoritative for both encoders", async () => {
  const events: AdapterEvent[] = [
    { type: "text_delta", text: "Partial" }, { type: "done", stopReason: "content_filter", usage },
    { type: "text_delta", text: "Must not replace history" }, { type: "done", stopReason: "stop", usage },
  ];
  const json = buildResponseJSON(events, "fixture", { compaction: true });
  const sse = await encodeStream(events, true);
  expect(json.status).toBe("incomplete");
  expect(json.incomplete_details).toEqual(sse.response.incomplete_details);
  expect(json.output).toEqual([]);
});
