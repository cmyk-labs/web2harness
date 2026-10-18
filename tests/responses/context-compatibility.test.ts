import { describe, expect, test } from "bun:test";
import { preflightContextCompatibility } from "../../src/responses/context-compatibility";
import { encodeCompactionSummary } from "../../src/responses/compaction";
import { encodeReasoningEnvelope } from "../../src/responses/reasoning-envelope";
import { plaintextCollaborationFields } from "../../src/responses/encoding";
import { encodeSourceContext } from "../../src/adapters/chatgpt-web/prompt/source-context";

function blocked(input: unknown) {
  const result = preflightContextCompatibility(input);
  expect(result.status).toBe("blocked");
  if (result.status !== "blocked") throw new Error("Expected encrypted context blocker");
  expect(result.retryable).toBe(false);
  return result;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("encrypted context preflight", () => {
  test("accepts plaintext V2 agent messages without changing boundaries or routing metadata", () => {
    const input = freeze([
      { type: "agent_message", author: "/root", recipient: "/root/worker", content: [
        { type: "input_text", text: "first part" }, { type: "input_text", text: "second part" },
      ] },
      { type: "agent_message", author: "/root/worker", recipient: "/root", content: "result" },
      { role: "user", content: "Continue" },
    ]);
    const original = JSON.stringify(input);
    expect(preflightContextCompatibility(input)).toEqual({ status: "compatible", issueCount: 0, issuesTruncated: false, issues: [] });
    const encoded = encodeSourceContext({ input, controls: {} }, [], []);
    expect(encoded.input).toEqual(input);
    expect(JSON.stringify(input)).toBe(original);
  });

  for (const withPlaintext of [false, true]) {
    test(`blocks an agent message with ciphertext even when plaintext is ${withPlaintext ? "present" : "absent"}`, () => {
      const result = blocked([{ type: "agent_message", content: [
        ...(withPlaintext ? [{ type: "input_text", text: "Only a routing header, not the task" }] : []),
        { type: "encrypted_content", encrypted_content: "native-ciphertext" },
      ] }]);
      expect(result.issues[0]).toMatchObject({
        code: "encrypted_agent_message", itemIndex: 0, itemType: "agent_message",
        path: `/input/0/content/${withPlaintext ? 1 : 0}/encrypted_content`,
        limitation: "source_backend", nextAction: { code: "require_complete_plaintext_delivery" },
      });
    });
  }

  for (const name of ["spawn_agent", "send_message", "followup_task"]) {
    test(`preserves the supported plaintext ${name} marker but never applies it to adjacent ciphertext`, () => {
      const call = { type: "function_call", namespace: "collaboration", name, call_id: "call_fixture",
        arguments: '{"message":"complete original plaintext"}', ...plaintextCollaborationFields("collaboration", name) };
      expect(call).toHaveProperty("encrypted_function_args", []);
      expect(preflightContextCompatibility([call]).status).toBe("compatible");
      const result = blocked([call, { type: "agent_message", encrypted_function_args: [], content: [
        { type: "encrypted_content", encrypted_content: "native-ciphertext" },
      ] }]);
      expect(result.issues[0]!.path).toBe("/input/1/content/0/encrypted_content");
    });
  }

  test("an opaque reasoning payload remains blocked alongside its visible summary and reasoning text", () => {
    const result = blocked([{ type: "reasoning", summary: [{ type: "summary_text", text: "visible summary" }],
      content: [{ type: "reasoning_text", text: "visible excerpt" }], encrypted_content: "native-reasoning" }]);
    expect(result.issues[0]).toMatchObject({ code: "encrypted_reasoning", path: "/input/0/encrypted_content",
      limitation: "source_backend", nextAction: { code: "require_supported_context_export" } });
  });

  for (const type of ["compaction", "compaction_summary", "context_compaction"]) {
    test(`a preceding transcript and a readable summary do not replace native ${type}`, () => {
      const result = blocked([
        { role: "user", content: "Earlier transcript" },
        { type, encrypted_content: "native-checkpoint", summary: [{ type: "summary_text", text: "summary" }] },
      ]);
      expect(result.issues[0]).toMatchObject({ code: "encrypted_compaction", itemIndex: 1, path: "/input/1/encrypted_content" });
    });
  }

  for (const type of ["function_call_output", "custom_tool_call_output"]) {
    test(`blocks encrypted ${type} without consuming its adjacent readable output`, () => {
      const result = blocked([{ type, call_id: "fixture", output: [
        { type: "input_text", text: "Partial result" }, { type: "encrypted_content", encrypted_content: "native-result" },
      ] }]);
      expect(result.issues[0]).toMatchObject({ code: "encrypted_tool_output", path: "/input/0/output/1/encrypted_content" });
    });
  }

  test("accepts existing reversible envelopes, and the shared encoder preserves their exact values", () => {
    const input = freeze([
      { type: "reasoning", encrypted_content: encodeReasoningEnvelope({ txt: "完整上下文", sig: "fixture-signature", red: ["fixture-redacted"] }) },
      { type: "compaction", encrypted_content: encodeCompactionSummary("保留的摘要\nNext step") },
      { type: "compaction_summary", encrypted_content: encodeCompactionSummary("alias") },
      { type: "context_compaction", encrypted_content: encodeCompactionSummary("local checkpoint") },
      { type: "context_compaction" },
      { type: "context_compaction", encrypted_content: null },
      { type: "reasoning", summary: [], encrypted_content: null },
    ]);
    expect(preflightContextCompatibility(input).status).toBe("compatible");
    const encoded = encodeSourceContext({ input, controls: {} }, [], []);
    expect(encoded.input).toEqual(input);
    expect(encoded.transport_decoded).toEqual([
      { input_index: 0, type: "reasoning", value: { txt: "完整上下文", sig: "fixture-signature", red: ["fixture-redacted"] } },
      { input_index: 1, type: "compaction", value: "保留的摘要\nNext step" },
      { input_index: 2, type: "compaction_summary", value: "alias" },
      { input_index: 3, type: "context_compaction", value: "local checkpoint" },
    ]);
  });

  for (const encrypted_content of ["ocx1:%%%", "ocx1:YQ", "ocx1:/w==", "ocxr1:eyJ0eHQiOiJ4In0="]) {
    test(`rejects malformed or wrong-kind compaction envelopes (${encrypted_content})`, () => {
      expect(blocked([{ type: "compaction", encrypted_content }]).issues[0]).toMatchObject({
        code: "invalid_bridge_envelope", limitation: "request_encoding", nextAction: { code: "restore_original_encoding" },
      });
    });
  }

  for (const envelope of [{}, { txt: "known", future: "must not be silently discarded" }, { txt: "known", red: ["one", 2] }, { txt: 2 }]) {
    test(`rejects unsupported reasoning envelope fields without repairing them: ${JSON.stringify(envelope)}`, () => {
      const encrypted_content = `ocxr1:${Buffer.from(JSON.stringify(envelope)).toString("base64")}`;
      expect(blocked([{ type: "reasoning", encrypted_content }]).issues[0]!.code).toBe("invalid_bridge_envelope");
    });
  }

  for (const value of ["", null, 3, {}]) {
    test(`empty or malformed encrypted agent content is not treated as absent: ${JSON.stringify(value)}`, () => {
      expect(blocked([{ type: "agent_message", content: [{ type: "encrypted_content", encrypted_content: value }] }])
        .issues[0]!.code).toBe("invalid_encrypted_payload");
    });
  }

  test("transparent prefixes do not authorize decrypting encrypted agent or tool-result blocks", () => {
    const encrypted_content = encodeCompactionSummary("not an agent envelope");
    const result = blocked([
      { type: "agent_message", content: [{ type: "encrypted_content", encrypted_content }] },
      { type: "function_call_output", output: [{ type: "encrypted_content", encrypted_content }] },
    ]);
    expect(result.issues.map(issue => issue.code)).toEqual(["encrypted_agent_message", "encrypted_tool_output"]);
  });

  test("reports explicit encrypted function arguments without exposing their field names or values", () => {
    const result = blocked([{ type: "function_call", namespace: "private-tool-namespace", name: "private-tool-name",
      call_id: "private-call-id", encrypted_function_args: ["private-argument-name"], arguments: "private-argument-value" }]);
    expect(result.issues[0]).toMatchObject({ code: "encrypted_function_arguments", path: "/input/0/encrypted_function_args" });
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  test("malformed argument markers never masquerade as the explicit plaintext list", () => {
    for (const encrypted_function_args of ["[]", {}, [null], ["message", 1]]) {
      expect(blocked([{ type: "function_call", encrypted_function_args }]).issues[0]).toMatchObject({
        code: "invalid_encrypted_payload", limitation: "request_encoding", path: "/input/0/encrypted_function_args",
      });
    }
  });

  test("does not guess encryption from user text, argument strings, tool specifications, or missing metadata", () => {
    const input = [
      { role: "user", content: "encrypted_content: native-ciphertext" },
      { type: "function_call", namespace: "collaboration", name: "spawn_agent", arguments: '{"message":"gAAAA-example"}' },
      { type: "function_call_output", output: '{"type":"encrypted_content","encrypted_content":"example code"}' },
      { type: "additional_tools", tools: [{ name: "encrypted_content", parameters: { encrypted_content: "schema" } }] },
    ];
    expect(preflightContextCompatibility(input).status).toBe("compatible");
  });

  test("reports all known encrypted containers using structural paths and no request contents", () => {
    const input = freeze([
      { type: "private-type", id: "private-id", encrypted_content: "private-ciphertext", author: "private-author", recipient: "private-recipient" },
      { type: "reasoning", encrypted_content: "private-reasoning", summary: [{ type: "encrypted_content", encrypted_content: "private-summary" }] },
      { type: "message", content: [{ type: "encrypted_content", encrypted_content: "private-message" }] },
    ]);
    const original = JSON.stringify(input);
    const result = blocked(input);
    expect(result.issueCount).toBe(4);
    expect(result.issues.map(issue => issue.path)).toEqual([
      "/input/0/encrypted_content", "/input/1/encrypted_content", "/input/1/summary/0/encrypted_content", "/input/2/content/0/encrypted_content",
    ]);
    expect(result.issues[0]).toMatchObject({ itemType: "other", limitation: "bridge_protocol", nextAction: { code: "verify_protocol_support" } });
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(JSON.stringify(input)).toBe(original);
  });

  test("caps diagnostics while still counting issues after the report limit", () => {
    const input = Array.from({ length: 100 }, () => ({ type: "reasoning", encrypted_content: "opaque" }));
    const result = blocked(input);
    expect(result.issueCount).toBe(100);
    expect(result.issues.length).toBe(64);
    expect(result.issuesTruncated).toBe(true);
    expect(result.issues.at(-1)!.path).toBe("/input/63/encrypted_content");
  });

  test("checkpoint payload is required, unlike an unencrypted local compaction marker", () => {
    expect(blocked([{ type: "compaction" }, { type: "compaction_summary", encrypted_content: null }]).issueCount).toBe(2);
    expect(preflightContextCompatibility([{ type: "context_compaction" }, { type: "compaction_trigger" }]).status).toBe("compatible");
  });

  test("validates the preflight input boundary without echoing malformed values", () => {
    for (const input of [null, undefined, 123, { input: "wrong caller shape" }, [null, "not an item"]]) {
      const result = blocked(input);
      expect(result.issues[0]!.code).toBe("invalid_context_input");
    }
    expect(preflightContextCompatibility("normal request input").status).toBe("compatible");
    expect(preflightContextCompatibility([]).status).toBe("compatible");
  });
});
