const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTunnelTransportHealth: inspect, probeTunnelTransport } = require("../shared/tunnel-transport-health.cjs");
const now = Date.parse("2026-10-17T10:00:00Z");
const metric = value => `commands_poll_last_successful_timestamp_seconds{otel_scope_name="controlplane"} ${value}\n`;
const pollError = (status, at = now - 1000) => ({ time: new Date(at).toISOString(), message: "poll failed; backing off",
  attrs: { status_code: status, error_code: "token_invalidated", error_message: "sk-secret-must-not-appear" } });

test("startup requires an actual completed poll; absent or malformed evidence is unknown", () => {
  assert.equal(inspect([], metric(0), now).ok, false);
  for (const metrics of ["", "ready", metric("NaN"), metric(-1), metric(now / 1000 + 60), metric(1) + metric(2)]) {
    assert.deepEqual({ ok: inspect([], metrics, now).ok, observed: inspect([], metrics, now).observed }, { ok: false, observed: false });
  }
});

test("401 and 403 need credential or permission repair, even if metrics are missing", () => {
  for (const status of [401, 403]) for (const metrics of ["", metric(0), metric(now / 1000 - 2)]) {
    const result = inspect([pollError(status)], metrics, now);
    assert.equal(result.ok, false);assert.equal(result.fatal, true);assert.equal(result.retryable, false);
    assert.equal(result.code, status === 401 ? "tunnel_authentication_failed" : "tunnel_permission_denied");
    assert.doesNotMatch(result.detail, /sk-secret/);
  }
});

test("time alone does not clear authentication failure; a later completed poll does", () => {
  const error = pollError(401, now - 600_000);
  assert.equal(inspect([error], metric(0), now).retryable, false);
  assert.equal(inspect([error], metric(now / 1000 - 10), now).ok, true);
});

test("idle long polls or backpressure do not turn older successful evidence into an outage", () => {
  assert.equal(inspect([], metric(now / 1000 - 600), now).ok, true);
  assert.equal(inspect([pollError(429)], metric(now / 1000 - 600), now).fatal, false);
});

test("unrelated error text and future timestamps cannot impersonate poll authentication failures", () => {
  for (const event of [{ ...pollError(401), message: "user text" }, pollError(401, now + 600_000),
    { ...pollError(401), time: "invalid" }, { ...pollError(401), attrs: { status_code: "401" } }]) {
    assert.equal(inspect([event], metric(now / 1000), now).ok, true);
  }
});

test("existing internal MCP failure evidence still wins over liveness and successful polling", () => {
  const failure = { time: new Date(now - 1000).toISOString(),
    message: "dispatcher received MCP upstream error; posted error response to control plane",
    attrs: { failure_source: "client_internal", status_code: 502, upstream_response_received: false, rpc_method: "tools/call" } };
  assert.equal(inspect([failure], metric(now / 1000), now).fatal, true);
  assert.equal(inspect([failure], metric(now / 1000), now).retryable, undefined);
});

test("health probes do not contact non-loopback or credential-bearing URLs", async () => {
  for (const url of ["https://example.com", "http://user:password@127.0.0.1:2222"]) {
    assert.equal((await probeTunnelTransport(url)).observed, false);
  }
});
