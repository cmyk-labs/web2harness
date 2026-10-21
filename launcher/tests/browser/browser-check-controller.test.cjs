const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrowserCheckController } = require("../../electron/browser/browser-check-controller.cjs");

function fixture(saved = {}) {
  let state = saved;
  const events = [];
  const controller = createBrowserCheckController({ version: "2.5.2", now: () => 123,
    stateStore: { read: () => state, update: patch => state = { ...state, ...patch } }, publish: state => events.push(state) });
  controller.observe({ authenticated: true, sessionEpoch: "account-a" });
  return { controller, events, state: () => state };
}
const success = async progress => { progress("connection"); progress("dispatch"); return { ok: true, response: "WEB2HARNESS READY" }; };

test("latest failure replaces a success while preserving its historical date", async () => {
  const f = fixture({ browserSmokePassed: true, browserSmokeVersion: "old" });
  assert.equal(f.state().browserSmokePassed, false);
  await f.controller.run(success);
  assert.equal(f.state().browserSmokePassed, true);
  const result = await f.controller.run(async progress => {
    progress("connection");
    throw Object.assign(new Error("queue paused"), { code: "queue_blocked_send_outcome_unknown", retryable: false });
  });
  assert.equal(result.ok, false);
  assert.equal(result.check.connection, "passed");
  assert.equal(result.check.dispatch, "blocked");
  assert.equal(f.state().browserSmokePassed, false);
  assert.deepEqual(f.state().lastBrowserCheckSuccess, { at: 123, version: "2.5.2" });
  assert.equal(result.check.error.code, "queue_blocked_send_outcome_unknown");
});

test("connection failure and cancellation do not claim send verification", async () => {
  const f = fixture();
  for (const [error, status] of [[new Error("connection failed"), "failed"], [new DOMException("cancelled", "AbortError"), "cancelled"]]) {
    const result = await f.controller.run(async () => { throw error; });
    assert.equal(result.check.status, status);
    assert.equal(result.check.connection, status);
    assert.equal(result.check.dispatch, "not_run");
  }
});

test("state persistence failure never strands the check lock", async () => {
  let fail = false, state;
  const controller = createBrowserCheckController({ version: "2.5.2", publish() {},
    stateStore: { read: () => state, update: patch => { if (fail) throw new Error("fixture storage unavailable"); return state = patch; } } });
  fail = true;
  await assert.rejects(controller.run(success), /storage unavailable/);
  fail = false;
  assert.equal((await controller.run(success)).ok, true);
});

test("authentication loss or changed account invalidates proof and retires late results", async () => {
  for (const browser of [{ authenticated: false, sessionEpoch: "account-a" }, { authenticated: true, sessionEpoch: "account-b" }]) {
    const f = fixture();
    await f.controller.run(success);
    let release;
    const pending = f.controller.run(async () => { await new Promise(resolve => { release = resolve; }); return { ok: true }; });
    await assert.rejects(f.controller.run(success), /already running/);
    f.controller.observe(browser);
    release();
    assert.equal((await pending).ok, false);
    assert.equal(f.state().browserSmokePassed, false);
    assert.equal(f.state().browserCheck.status, "not_run");
    assert.equal((await f.controller.run(success)).ok, true);
  }
});
