const { randomUUID } = require("node:crypto");
const { browserOperationError, browserFailureKind } = require("../../shared/browser-operation-error.cjs");

// The browser process owns current proof. A renderer reload does not invalidate it;
// restarting the browser or changing authentication does. Older success remains history.
function createBrowserCheckController({ stateStore, version, publish, logger, now = Date.now }) {
  let epoch = randomUUID(), browserEpoch, authenticated = false, running = false;
  const write = check => {
    const state = stateStore.update({ browserCheck: check, browserSmokePassed: check.status === "passed",
      browserSmokeVersion: check.status === "passed" ? version : null,
      ...(check.status === "passed" ? { lastBrowserCheckSuccess: { at: check.finishedAt, version } } : {}) });
    publish(state);
    if (["passed", "blocked", "failed", "cancelled"].includes(check.status)) logger?.info("browser.check_finished", {
      operationId: check.id, status: check.status, stage: check.connection === "passed" ? "send" : "connection",
      code: check.error?.code, diagnosticRef: check.error?.diagnosticRef,
    });
    return check;
  };
  const invalidate = () => {
    epoch = randomUUID();
    write({ status: "not_run", version, connection: "not_run", dispatch: "not_run" });
  };
  invalidate();
  return {
    invalidate,
    observe(browser) {
      if ((authenticated && !browser.authenticated) || (browserEpoch && browser.sessionEpoch && browserEpoch !== browser.sessionEpoch)) invalidate();
      authenticated = browser.authenticated === true;
      browserEpoch = browser.sessionEpoch;
    },
    async run(action) {
      if (running) throw new Error("A browser check is already running");
      running = true;
      const owner = epoch;
      let check = { id: randomUUID(), status: "running", version, startedAt: now(), connection: "running", dispatch: "not_run" };
      const progress = phase => {
        if (owner !== epoch) return;
        check = { ...check, connection: "passed", dispatch: phase === "dispatch" ? "running" : "not_run" };
        write(check);
      };
      try {
        write(check);
        const result = await action(progress);
        if (owner !== epoch) return { ok: false, check: stateStore.read().browserCheck };
        if (result?.ok !== true || check.connection !== "passed") throw new Error("Browser check completed without verified evidence");
        check = { ...check, status: "passed", connection: "passed", dispatch: "passed", finishedAt: now() };
        write(check);
        return { ...result, ok: true, check };
      } catch (error) {
        if (owner !== epoch) return { ok: false, check: stateStore.read().browserCheck };
        const status = browserFailureKind(error);
        check = { ...check, status, finishedAt: now(), error: browserOperationError(error),
          ...(check.connection !== "passed" ? { connection: status, dispatch: "not_run" } : { dispatch: status }) };
        write(check);
        return { ok: false, check };
      } finally { running = false; }
    },
  };
}
module.exports = { createBrowserCheckController };
