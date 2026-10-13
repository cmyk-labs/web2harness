const test = require("node:test");
const assert = require("node:assert/strict");
const { guardLicensedIpc } = require("../../electron/license-access.cjs");
const { BrowserControlServer } = require("../../electron/control-server.cjs");

test("direct IPC cannot start or configure features without a current valid license", async () => {
  let state = "active", effects = 0, checks = 0;
  const controller = { async assertActive() { checks++; if (state !== "active") throw new Error(`license: ${state}`); } };
  const actions = ["setup-core", "setup-mcp", "complete-onboarding", "browser-show", "browser-login",
    "browser-navigate", "browser-smoke", "tool-mode", "skill-attachments", "fresh-conversation-per-turn",
    "use-saved-chats", "zero-risk-pro", "autostart", "manual-prompt-sent", "limits-setup", "future-feature"];
  for (const action of actions) {
    const execute = guardLicensedIpc(controller, `launcher:${action}`, () => ++effects);
    for (state of ["missing", "invalid", "wrong-device", "expired", "clock-error"]) {
      await assert.rejects(execute({}, true), /license:/);
    }
    assert.equal(effects, 0);
  }
  const show = guardLicensedIpc(controller, "launcher:browser-surface-active", () => ++effects);
  await assert.rejects(show({}, true), /license:/);
  await assert.rejects(show({}, "false"), /license:/);
  state = "active";
  assert.equal(await show({}, true), 1);
  state = "expired";
  await assert.rejects(show({}, true), /license: expired/);
  assert.equal(effects, 1, "an earlier successful call grants no persistent permission");
  assert.ok(checks > actions.length);
});

test("activation, read-only previews, window hiding and cancellation remain accessible", async () => {
  const controller = { async assertActive() { throw new Error("license: expired"); } };
  for (const action of ["license-status", "license-import", "snapshot", "workspace-status", "limits", "query-logs", "cancel-turns", "browser-tab-close", "window-state", "browser-bounds"]) {
    assert.equal(await guardLicensedIpc(controller, `launcher:${action}`, () => "allowed")({}), "allowed");
  }
  assert.equal(await guardLicensedIpc(controller, "launcher:browser-surface-active", (_, active) => active)({}, false), false);
});

test("control token cannot bypass license admission; existing work may finish or cancel", async () => {
  let allowed = false, admitted = 0, finished = 0;
  const server = await new BrowserControlServer({
    logger: { info() {}, error() {}, warn() {} }, getPreferences: () => ({}),
    assertLicensed: async () => { if (!allowed) throw new Error("license: expired"); },
    getBrowserHost: () => ({
      browserInteractionMode: () => "automatic",
      inspectSession: async () => { admitted++; return { authenticated: true }; },
      endTurn: () => { finished++; },
    }),
  }).start();
  const { endpoint, token } = server.descriptor();
  const post = route => fetch(endpoint + route, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ traceId: "fixture-turn", helperPid: process.pid, status: "completed" }) });
  try {
    for (const route of ["/v1/turn/start", "/v1/manual/start", "/v1/session/inspect", "/v1/network/resolve-proxy"]) {
      const response = await post(route);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, "license_required");
    }
    assert.equal(admitted, 0);
    allowed = true;
    assert.equal((await post("/v1/session/inspect")).status, 200);
    assert.equal(admitted, 1);
    allowed = false;
    assert.equal((await post("/v1/session/inspect")).status, 403);
    assert.equal((await post("/v1/turn/end")).status, 200);
    assert.equal(finished, 1);
  } finally { await server.close(); }
});

test("browser control fails closed if its verifier is not configured", async () => {
  const server = await new BrowserControlServer({ logger: { info() {}, error() {} },
    getBrowserHost: () => { throw new Error("must not reach browser"); }, getPreferences: () => ({}) }).start();
  try {
    const { endpoint, token } = server.descriptor();
    const response = await fetch(endpoint + "/v1/turn/start", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
    assert.equal(response.status, 403);
  } finally { await server.close(); }
});
