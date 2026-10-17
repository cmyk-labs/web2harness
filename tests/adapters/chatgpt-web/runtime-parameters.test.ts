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

test("remote MCP allows at most two retries, keeps configured zero and preserves diagnosis when exhausted", () => {
  const error = new ChatGptWebAdapterError("remote", { status: 502, errorType: "server_error", code: "mcp_remote_rate_limited", retryable: true,
    mcpRemote: { kind: "rate_limit", source: "probe", status: 429 } });
  const policy = new ChatGptWebTurnRetryPolicy();
  expect(policy.recordRetryableFailure("mcp", error, 1, 3).retryable).toBe(true);
  expect(policy.recordRetryableFailure("mcp", error, 2, 3).retryable).toBe(true);
  expect(policy.recordRetryableFailure("mcp", error, 3, 3)).toMatchObject({ retryable: false, mcpRemote: error.mcpRemote });
  expect(policy.recordRetryableFailure("disabled", error, 1, 0).retryable).toBe(false);
});

test("a permanent remote failure retains its cause and cannot reset a partially consumed native-turn budget", () => {
  const policy = new ChatGptWebTurnRetryPolicy();
  policy.recordRetryableFailure("mixed", failure(), 1, 2);
  const error = new ChatGptWebAdapterError("Remote MCP returned 404", { status: 502, errorType: "server_error", code: "mcp_remote_error", retryable: false,
    mcpRemote: { kind: "other", source: "probe", status: 404 } });
  policy.recordTerminalFailure("mixed", error, 2);
  expect(policy.exhaustedError("mixed", 3)).toMatchObject({ message: error.message, code: error.code, retryable: false, mcpRemote: error.mcpRemote });
  expect(policy.attempt("mixed", 3)).toBe(1);
  expect(policy.exhaustedError("new-native-turn", 3)).toBeUndefined();
});
