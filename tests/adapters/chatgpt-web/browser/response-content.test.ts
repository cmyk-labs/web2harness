import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ChatGptResponseSource } from "../../../../src/adapters/chatgpt-web/browser/response-source";
import { responseContent } from "../../../../src/adapters/chatgpt-web/browser/response-content";
import { replayChatGptResponseEvidence } from "../../../../src/adapters/chatgpt-web/browser/response-replay";

const archive = JSON.parse(readFileSync(new URL("../../../../docs/investigations/2026-10-19-public-response-replay/public-events.json", import.meta.url), "utf8"));
test("reference array append preserves earlier references and later indexed patches in source and evidence", () => {
  const source = new ChatGptResponseSource(archive.binding, true);
  for (const record of archive.records) {
    const value = structuredClone(record.value);
    if (record.sequence === 18) {
      const index = value.v.findIndex((patch: any) => patch.p.endsWith("content_references"));
      const patch = value.v[index];
      value.v.splice(index, 1, { ...patch, v: patch.v.slice(0, 1) },
        { ...patch, o: "append", v: patch.v.slice(1) });
    }
    source.push(Buffer.from(`event: ${record.event}\ndata: ${value === "[DONE]" ? value : JSON.stringify(value)}\n\n`));
  }
  source.finish();
  expect(source.result()).toMatchObject({ state: "complete" });
  const result = source.result();
  if (result.state !== "complete") throw Error("Expected complete fixture");
  expect(result.text.match(/def add\(a, b\)/g)).toHaveLength(1);
  expect(result.text).toContain("```mermaid");
  expect(replayChatGptResponseEvidence(source.takeEvidence()!)).toMatchObject({ state: "replayed", result });
});
test("private diagnostics replay the archived fallback and late reference patches without renderer code", () => {
  const source = new ChatGptResponseSource(archive.binding, true);
  for (const { event, value } of archive.records) {
    source.push(Buffer.from(`event: ${event}\ndata: ${value === "[DONE]" ? value : JSON.stringify(value)}\n\n`));
  }
  source.finish();
  const artifact = source.takeEvidence()!;
  expect(artifact.summary.replayable).toBe(true);
  expect(replayChatGptResponseEvidence(artifact)).toMatchObject({ state: "replayed", result: source.result() });
  expect(JSON.stringify(artifact)).not.toContain("rendererSource");
});
test("the archived 26-event public projection yields the final fallback with code-point references", () => {
  const wire = Buffer.from(archive.records.map((record: any) => `event: ${record.event}\ndata: ${record.value === "[DONE]" ? record.value : JSON.stringify(record.value)}\n\n`).join(""));
  for (const size of [1, 7, 17, 4096]) {
    const source = new ChatGptResponseSource(archive.binding);
    for (let offset = 0; offset < wire.length; offset += size) source.push(wire.subarray(offset, offset + size));
    source.finish();
    const result = source.result();
    expect(result.state).toBe("complete");
    if (result.state !== "complete") throw Error(JSON.stringify(result));
    expect(result.text.length).toBe(438);
    expect(Array.from(result.text).length).toBe(436);
    expect(Buffer.byteLength(result.text)).toBe(973);
    expect(result.text).toContain("中文🙂𠮷é");
    expect(result.text.match(/def add\(a, b\)/g)).toHaveLength(1);
    expect(result.text).toEndWith("REPLAY-END");
    expect(source.lifecycle().state).toBe("complete");
  }
});

test("unsupported references remain distinct from successful generation and may not be silently dropped", () => {
  const source = new ChatGptResponseSource(archive.binding);
  for (const record of archive.records) {
    const value = structuredClone(record.value);
    if (record.sequence === 18) value.v.find((patch: any) => patch.p.endsWith("content_references")).v[0].category = "unknown_widget";
    source.push(Buffer.from(`event: ${record.event}\ndata: ${value === "[DONE]" ? value : JSON.stringify(value)}\n\n`));
  }
  expect(source.lifecycle().state).toBe("complete");
  expect(source.result()).toMatchObject({ state: "rejected", kind: "unsupported" });
});

test("reference conversion rejects stale code-point ranges and unsupported fallback versions", () => {
  const reference = { type: "client_defined_widget", category: "code_block", start_idx: 2, end_idx: 3, matched_text: "X",
    data: { widget_type: "code_block", language: "python", content: "print(1)" } };
  const message = { parts: ["irrelevant parts"], fallback: { fallbackMarkdown: "🙂𠮷X", fallbackMarkdownVersion: 1 }, references: [reference], citations: [] };
  expect(responseContent(message)).toBe("🙂𠮷```python\nprint(1)\n```");
  expect(() => responseContent({ ...message, references: [{ ...reference, start_idx: 4, end_idx: 5 }] })).toThrow("response_reference_range_invalid");
  expect(() => responseContent({ ...message, fallback: { ...message.fallback, fallbackMarkdownVersion: 2 } })).toThrow("response_content_version_unsupported");
});

test("literal Unicode in code and prose is not mistaken for an unsupported component", () => {
  const text = "Glyph \uF8FF\n\n```python\ns = '\uE000🙂'\n```";
  expect(responseContent({ parts: [text], references: [], citations: [] })).toBe(text);
});
