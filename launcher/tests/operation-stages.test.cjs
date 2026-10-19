const test = require("node:test");
const assert = require("node:assert/strict");
const { createOperationStageWatchdog, OPERATION_STAGE_TIMEOUTS } = require("../shared/operation-stages.cjs");

function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  t.mock.method(performance, "now", () => Date.now());
  const errors = [];
  const watchdog = createOperationStageWatchdog(error => errors.push(error.message));
  t.after(() => watchdog.stop());
  return { errors, begin: (id, stage, parentId) => watchdog.accept({ type: "stage", event: "begin", id, stage, parentId }),
    end: id => watchdog.accept({ type: "stage", event: "end", id }), watchdog };
}

test("configuration pauses for each owned download and verification, beyond the former ten-minute cap", t => {
  const f = fixture(t);
  f.begin(1, "config");
  t.mock.timers.tick(59_000);
  for (const id of [2, 3]) {
    f.begin(id, "download", 1);
    t.mock.timers.tick(299_000);
    f.end(id);
  }
  f.begin(4, "verification", 1);
  t.mock.timers.tick(119_000);
  f.end(4);
  assert.deepEqual(f.errors, []);
  t.mock.timers.tick(999);
  assert.deepEqual(f.errors, []);
  t.mock.timers.tick(1);
  assert.match(f.errors[0], /config stage timed out after 60000ms/);
});

test("concurrent owners expire independently and completed siblings cannot extend a stalled stage", t => {
  const f = fixture(t);
  f.begin(1, "download");
  t.mock.timers.tick(250_000);
  f.begin(2, "verification");
  t.mock.timers.tick(49_999);
  f.end(2);
  t.mock.timers.tick(1);
  assert.match(f.errors[0], /download stage timed out after 300000ms/);
});

test("human login leaves fresh startup, page-load and verification budgets", t => {
  const f = fixture(t);
  let id = 0;
  for (const stage of ["human-login", "browser-startup", "page-load", "verification"]) {
    f.begin(++id, stage);
    t.mock.timers.tick(OPERATION_STAGE_TIMEOUTS[stage] - 1);
    f.end(id);
  }
  assert.deepEqual(f.errors, []);
  f.watchdog.stop();
  t.mock.timers.tick(1_000_000);
  assert.deepEqual(f.errors, []);
});

test("stage ownership rejects replay, nonexistent parents and premature parent completion", t => {
  const f = fixture(t);
  f.begin(1, "config");
  f.begin(2, "download", 1);
  assert.throws(() => f.begin(2, "download", 1), /Invalid operation stage start/);
  assert.throws(() => f.begin(3, "verification", 99), /parent is not active/);
  assert.throws(() => f.end(1), /exclusive ownership/);
  f.end(2);
  f.end(1);
  assert.throws(() => f.end(1), /exclusive ownership/);
});
