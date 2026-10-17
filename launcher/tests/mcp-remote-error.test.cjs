const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseMcpRemoteFailure: parse, validMcpRemoteFailure, mcpRemoteErrorInfo } = require("../shared/mcp-remote-error.cjs");
const content = value => ({ content_type: "text", parts: [typeof value === "string" ? value : JSON.stringify(value)] });
test("remote error classification is bounded, fixed and separates quota/auth from transient errors", () => {
  const rate = parse(content("Error: MCP SSE probe returned 429 from openai.org PRIVATE_TOKEN"));
  assert.deepEqual(rate, { kind: "rate_limit", source: "probe", status: 429 });
  assert.equal(mcpRemoteErrorInfo(rate).retryCandidate, true);
  for (const [code, kind] of [["insufficient_quota", "quota"], ["authentication_error", "authentication"], ["permission_denied", "permission"]]) {
    const error = parse(content({ error: { code, message: "PRIVATE_SECRET" } }));
    assert.equal(error.kind, kind); assert.equal(mcpRemoteErrorInfo(error).retryCandidate, false);
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
  }
  for (const value of ["The model thinks there was a 429", "McpServerError unavailable", "x".repeat(16385), "{", { error: { code: "unknown" } }]) assert.equal(parse(content(value)), undefined);
  assert.equal(validMcpRemoteFailure({ ...rate, token: "secret" }), false);
});
test("Retry-After seconds/date are used only when explicitly present", () => {
  assert.equal(parse(content({ error: { code: "rate_limit_exceeded", retry_after: 75 } })).retryAfterMs, 75000);
  assert.equal(parse(content({ error: { code: "service_unavailable" }, headers: { "retry-after": "Wed, 01 Jan 2025 00:02:00 GMT" } }), Date.UTC(2025, 0, 1)).retryAfterMs, 120000);
  assert.equal(parse(content({ error: { code: "rate_limit_exceeded", message: "retry after 5 seconds" } })).retryAfterMs, undefined);
});
