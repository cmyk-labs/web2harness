import { expect, test } from "bun:test";
import { ChatGptWebTurnRetryPolicy } from "../../../src/adapters/chatgpt-web/retry-policy";
import { ChatGptWebAdapterError } from "../../../src/adapters/chatgpt-web/adapter-error";
const failure = () => new ChatGptWebAdapterError("fixture retryable failure", { status: 502, errorType: "server_error", code: "native_tool_call_invalid", retryable: true });

test("zero retries is terminal on the first retryable failure", () => {
  const policy = new ChatGptWebTurnRetryPolicy();
  expect(policy.recordRetryableFailure("disabled", failure(), 1, 0).retryable).toBe(false);
  expect(policy.exhaustedError("disabled", 2)?.retryable).toBe(false);
});
test("an existing logical turn keeps its retry limit while new turns use changed settings", () => {
  const policy = new ChatGptWebTurnRetryPolicy();
  expect(policy.recordRetryableFailure("old", failure(), 1, 3).retryable).toBe(true);
  expect(policy.recordRetryableFailure("old", failure(), 2, 0).retryable).toBe(true);
  expect(policy.recordRetryableFailure("old", failure(), 3, 0).retryable).toBe(true);
  expect(policy.recordRetryableFailure("old", failure(), 4, 0).retryable).toBe(false);
  expect(policy.recordRetryableFailure("new", failure(), 4, 0).retryable).toBe(false);
  policy.clear("old");
  expect(policy.exhaustedError("old", 5)).toBeUndefined();
  expect(policy.recordRetryableFailure("old", failure(), 5, 0).retryable).toBe(false);
  expect(() => policy.recordRetryableFailure("invalid", failure(), 1, 4)).toThrow();
});
