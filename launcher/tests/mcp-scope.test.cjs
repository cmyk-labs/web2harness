const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mcpScope, currentMcpScope } = require("../shared/mcp-scope.cjs");

test("invalid runtime configuration cannot hide local queued work", () => {
  const source = require("node:fs").readFileSync(require.resolve("../electron/main.cjs"), "utf8");
  let handler;
  require("node:vm").runInNewContext(source.slice(source.indexOf('handle("launcher:queue-status"'), source.indexOf('handle("launcher:queue-query"')), {
    handle: (_name, callback) => { handler = callback; }, currentMcpScope,
    runtimeHost: { runtimeConfigSnapshot() { throw new Error("Invalid config"); } },
    requestQueue: { snapshot: () => ({ active: 1, waiting: 2 }) },
    stateStore: { read: () => ({ requestScheduling: {}, requestSchedulingRevision: 1 }) },
  });
  const status = handler();
  assert.equal(status.status, "ready");
  assert.equal(status.scheduler.active, 1);
  assert.equal(status.scheduler.waiting, 2);
  assert.equal(status.currentMcpScope, null);
});

test("current MCP status matches the admission scope exactly and hides unrelated histories", () => {
  const config = { mode: "mcp-bridge", browserInteractionMode: "automatic", tunnel: { tunnelId: "dev-tunnel" }, automaticAppName: "DEV" };
  const expected = createHash("sha256").update(JSON.stringify(["dev-tunnel", "DEV"])).digest("hex");
  assert.equal(mcpScope("dev-tunnel", "DEV"), expected, "existing persisted scopes remain valid");
  assert.equal(currentMcpScope(config), expected);
  for (const patch of [{ mode: "native-tools" }, { browserInteractionMode: "manual" }, { tunnel: undefined }, { automaticAppName: undefined }])
    assert.equal(currentMcpScope({ ...config, ...patch }), null);
  assert.notEqual(currentMcpScope({ ...config, automaticAppName: "OTHER" }), expected);
  assert.notEqual(currentMcpScope({ ...config, tunnel: { tunnelId: "other" } }), expected);
});
