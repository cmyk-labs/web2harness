import { describe, expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../../../src/adapters/chatgpt-web/adapter-error";
import { createChatGptStructuredOutputValidator } from "../../../src/adapters/chatgpt-web/output-validation";

describe("json_object delivery validation", () => {
  const validate = createChatGptStructuredOutputValidator({ type: "json_object" })!;

  test("accepts a complete object without inventing schema constraints", () => {
    for (const answer of ["{}", ' \r\n {"answer":42,"nested":[null,true,{"中文":"回答"}]} \t ']) {
      expect(() => validate(answer)).not.toThrow();
    }
  });

  test("rejects partial, fenced, multiple or decorated JSON without repairing it", () => {
    for (const answer of ["", " ", '{"ok":', '```json\n{"ok":true}\n```',
      'Answer: {"ok":true}', '{"ok":true} trailing', '{}\n{}', '{"ok":true,}']) {
      expect(() => validate(answer)).toThrow(ChatGptWebAdapterError);
    }
  });

  test("requires an object instead of an array or scalar", () => {
    for (const answer of ["null", "[]", '[{"ok":true}]', "true", "123", '"answer"']) {
      expect(() => validate(answer)).toThrow("did not return a JSON object");
    }
  });

  test("reports a non-retryable upstream failure without leaking the answer", () => {
    try {
      validate("private answer fragment");
      throw new Error("validation should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatGptWebAdapterError);
      expect(error).toMatchObject({
        status: 502, errorType: "server_error", code: "structured_output_validation_failed", retryable: false,
      });
      expect((error as Error).message).not.toContain("private answer fragment");
    }
  });
});

describe("strict JSON schema behavior", () => {
  test("keeps defaults, coercion and removal disabled", () => {
    const validate = createChatGptStructuredOutputValidator({
      type: "json_schema", name: "record", strict: true,
      schema: { type: "object", properties: { count: { type: "integer", default: 1 } },
        required: ["count"], additionalProperties: false },
    })!;
    expect(() => validate('{"count":1}')).not.toThrow();
    for (const answer of ['{"count":"1"}', "{}", '{"count":1,"extra":true}']) {
      expect(() => validate(answer)).toThrow(ChatGptWebAdapterError);
    }
  });

  test("retains format validation", () => {
    const validate = createChatGptStructuredOutputValidator({
      type: "json_schema", name: "email", strict: true, schema: { type: "string", format: "email" },
    })!;
    expect(() => validate('"a@example.com"')).not.toThrow();
    expect(() => validate('"not-an-email"')).toThrow(ChatGptWebAdapterError);
  });

  test("does not apply the json_object root constraint to JSON schema", () => {
    const validate = createChatGptStructuredOutputValidator({
      type: "json_schema", name: "array", strict: true, schema: { type: "array", items: { type: "number" } },
    })!;
    expect(() => validate("[1,2]")).not.toThrow();
  });

  test("invalid strict schema remains a non-retryable client error before generation", () => {
    expect(() => createChatGptStructuredOutputValidator({
      type: "json_schema", name: "invalid", strict: true, schema: { type: "not-a-type" },
    })).toThrow(expect.objectContaining({
      status: 400, errorType: "invalid_request_error", code: "invalid_output_schema", retryable: false,
    }));
  });

  test("missing and non-strict formats keep existing behavior", () => {
    expect(createChatGptStructuredOutputValidator(undefined)).toBeUndefined();
    expect(createChatGptStructuredOutputValidator({
      type: "json_schema", name: "loose", strict: false, schema: { type: "not-a-type" },
    })).toBeUndefined();
  });
});
