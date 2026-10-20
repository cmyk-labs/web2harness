import { describe, expect, test } from "bun:test";
import { encodeSourceContext } from "../../src/adapters/chatgpt-web/prompt/source-context";
import { preflightContextCompatibility } from "../../src/responses/context-compatibility";
import { decodeReasoningEnvelope, encodeReasoningEnvelope } from "../../src/responses/reasoning-envelope";
import { compactionItemToText, encodeCompactionSummary, SUMMARY_PREFIX } from "../../src/responses/compaction";

describe("transparent context envelope replay", () => {
  for (const envelope of [
    { txt: "", sig: "signature-of-empty-text", red: [] },
    { txt: "" },
    { red: [] },
    { sig: "" },
    { txt: "完整原文\n", red: ["", "opaque-redacted-metadata"], sig: "" },
  ]) {
    test(`preserves explicitly present reasoning fields: ${JSON.stringify(envelope)}`, () => {
      const encrypted_content = encodeReasoningEnvelope(envelope);
      const input = [{
        type: "reasoning", encrypted_content,
        summary: [{ type: "summary_text", text: "A summary is not replacement reasoning" }],
      }];
      const original = structuredClone(input);
      expect(decodeReasoningEnvelope(encrypted_content)).toEqual(envelope);
      expect(preflightContextCompatibility(input).status).toBe("compatible");
      const source = encodeSourceContext({ input, controls: {} }, [], []);
      expect(source.input).toEqual(original);
      expect(source.transport_decoded).toEqual([{ input_index: 0, type: "reasoning", value: envelope }]);
      expect(input).toEqual(original);
    });
  }

  test("an empty transparent compaction summary stays readable and is not labeled native ciphertext", () => {
    const encrypted_content = encodeCompactionSummary("");
    const input = [{ type: "compaction", encrypted_content }];
    expect(preflightContextCompatibility(input).status).toBe("compatible");
    expect(compactionItemToText(encrypted_content)).toBe(`${SUMMARY_PREFIX}\n\n`);
    const source = encodeSourceContext({ input, controls: {} }, [], []);
    expect(source.input).toEqual(input);
    expect(source.transport_decoded).toEqual([{ input_index: 0, type: "compaction", value: "" }]);
  });

  test("transparent replay still cannot substitute for adjacent native encrypted state", () => {
    const input = [
      { type: "reasoning", encrypted_content: encodeReasoningEnvelope({ txt: "", red: [] }) },
      { type: "reasoning", encrypted_content: "native-opaque-state",
        summary: [{ type: "summary_text", text: "Visible summary only" }] },
    ];
    const original = structuredClone(input);
    const result = preflightContextCompatibility(input);
    expect(result.status).toBe("blocked");
    expect(result.issueCount).toBe(1);
    expect(result.issues[0]).toMatchObject({
      code: "encrypted_reasoning", path: "/input/1/encrypted_content",
    });
    expect(input).toEqual(original);
  });
});
