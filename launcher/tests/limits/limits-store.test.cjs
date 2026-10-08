const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  LimitsStore, LimitsStoreError, OFFICIAL_LIMITS, SOURCE_URL, SOURCE_DATE, DAY_MS, RETENTION_MS, STORE_BOUNDS,
} = require("../../electron/limits/limits-store.cjs");

const A = "a".repeat(64);
const B = "b".repeat(64);
const START = Date.UTC(2026, 8, 19);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-limits-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "limits.json");
  let time = START;
  const now = () => time;
  return { root, file, now, setTime(value) { time = value; }, store: new LimitsStore(file, { now }) };
}
const receipt = (id, model = "gpt-6-pro", at = START, accountKey = A) => ({ id, model, at, accountKey });
const counts = snapshot => snapshot.windows.map(({ id, durationMs, limit, used, uncertainUsed }) => ({ id, durationMs, limit, used, uncertainUsed }));

test("first accepted send counts automatically for every plan and account, with independent rolling model totals", t => {
  const { store, file, now, setTime } = fixture(t);
  assert.equal(store.snapshot().enabled, true);
  assert.equal(store.record({ ...receipt("sol", "gpt-5.6-sol"), plan: "unsupported" }), true);
  assert.equal(store.snapshot().trackingSince, START);
  setTime(START + DAY_MS - 1);
  assert.equal(store.record({ ...receipt("pro", "gpt-6-pro", now()), plan: "pro_200" }), true);
  assert.equal(store.record({ ...receipt("sol", "gpt-5.6-sol", now()), plan: "pro_200" }), false);
  setTime(START + DAY_MS);
  const restarted = new LimitsStore(file, { now });
  assert.deepEqual(restarted.snapshot().models.find(row => row.model === "gpt-5.6-sol"), {
    model: "gpt-5.6-sol", last24Hours: 0, last7Days: 1,
  });
  assert.deepEqual(restarted.snapshot().models.find(row => row.model === "gpt-6-pro"), {
    model: "gpt-6-pro", last24Hours: 1, last7Days: 1,
  });
  assert.equal(restarted.record({ ...receipt("sol", "gpt-5.6-pro", now(), B), plan: "unsupported" }), true);
  assert.equal(restarted.snapshot().totalMessages, 1);
  assert.equal(restarted.configure({ accountKey: A, plan: "unsupported" }).totalMessages, 2);
  setTime(START + RETENTION_MS);
  assert.equal(restarted.snapshot().totalMessages, 1);
  assert.equal(restarted.snapshot().models.find(row => row.model === "gpt-5.6-sol").last7Days, 0);
});

test("version 1 migrates without losing receipts, account isolation, or deduplication", t => {
  const { file, now } = fixture(t);
  const legacy = { version: 1, activeAccountKey: A, accounts: {
    [A]: { plan: "pro_200", initializedAt: START, checkedAt: START,
      events: [{ id: "legacy", model: "other", at: START }] },
    [B]: { plan: "unsupported", initializedAt: null, checkedAt: START, events: [] },
  } };
  fs.writeFileSync(file, JSON.stringify(legacy));
  const restored = new LimitsStore(file, { now });
  assert.equal(restored.snapshot().totalMessages, 1);
  assert.equal(restored.record({ ...receipt("legacy"), plan: "pro_200" }), false);
  assert.equal(restored.record({ ...receipt("first", "gpt-5.6-sol", START, B), plan: "unsupported" }), true);
  assert.equal(restored.snapshot().totalMessages, 1);
  assert.equal(restored.snapshot().trackingSince, START);
  assert.equal(restored.configure({ accountKey: A, plan: "pro_200" }).totalMessages, 1);
  const migrated = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.accounts[A].events, legacy.accounts[A].events.map(event => ({ ...event, effort: "unknown", purpose: "unknown" })));
});

test("always-on, private atomic persistence, restart dedup, and receipt-only storage", t => {
  const { root, file, now, store, setTime } = fixture(t);
  assert.deepEqual(store.snapshot(), {
    enabled: true, plan: null, trackingSince: null, checkedAt: null, lastRecordedAt: null, details: [],
    totalMessages: 0, unknownProMessages: 0, incomplete: false, gapAt: null, models: ["gpt-6-pro", "gpt-5.6-pro", "gpt-6-sol", "gpt-5.6-sol"].map(model => ({ model, last24Hours: 0, last7Days: 0 })), windows: [],
  });
  assert.equal(store.matchesAccount(A), false);
  assert.equal(store.record(receipt("before-opt-in")), false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(store.configure({ accountKey: A.toUpperCase(), plan: "pro_200" }).enabled, true);
  assert.equal(store.record({ ...receipt("first"), prompt: "private-prompt", email: "private-email", cookies: "private-cookie" }), true);
  assert.equal(store.record(receipt("non-pro", "other")), true);
  setTime(START + 100);
  const restarted = new LimitsStore(file, { now });
  assert.equal(restarted.matchesAccount(A.toUpperCase()), true);
  assert.equal(restarted.matchesAccount(B), false);
  assert.equal(restarted.matchesAccount(null), false);
  assert.equal(restarted.record(receipt("first", "pro-unknown", now())), false);
  const snapshot = restarted.configure({ accountKey: A, plan: "pro_200" });
  assert.equal(snapshot.trackingSince, START);
  assert.equal(snapshot.checkedAt, now());
  assert.equal(snapshot.totalMessages, 2);
  assert.equal(snapshot.unknownProMessages, 0);
  assert.equal(snapshot.windows[2].used, 1);
  snapshot.windows[0].limit = 999;
  assert.equal(restarted.snapshot().windows[0].limit, null);
  const persisted = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(persisted, /private-prompt|private-email|private-cookie|prompt|email|cookies/);
  assert.deepEqual(Object.keys(JSON.parse(persisted).accounts), [A]);
  assert.deepEqual(fs.readdirSync(root), ["limits.json"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  }
});

test("local rolling windows stay separate from published caps and unknown models stay unassigned", t => {
  const { store } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_200" });
  for (const [id, model] of [["six", "gpt-6-pro"], ["five", "gpt-5.6-pro"], ["unknown", "pro-unknown"], ["other", "other"]]) {
    assert.equal(store.record(receipt(id, model)), true);
  }
  const snapshot = store.snapshot();
  assert.equal(snapshot.totalMessages, 4);
  assert.equal(snapshot.unknownProMessages, 1);
  assert.equal(snapshot.incomplete, true);
  assert.deepEqual(counts(snapshot), [
    { id: "gpt-6-pro-7d", durationMs: RETENTION_MS, limit: null, used: 1, uncertainUsed: 1 },
    { id: "gpt-5.6-pro-24h", durationMs: DAY_MS, limit: null, used: 1, uncertainUsed: 1 },
    { id: "shared-24h", durationMs: DAY_MS, limit: null, used: 3, uncertainUsed: 1 },
  ]);
  store.configure({ accountKey: A, plan: "pro_100" });
  for (let index = 0; index < 48; index += 1) assert.equal(store.record(receipt(`extra-${index}`)), true);
  assert.deepEqual(counts(store.snapshot()), [
    { id: "shared-7d", durationMs: RETENTION_MS, limit: null, used: 51, uncertainUsed: 1 },
  ]);
  assert.match(OFFICIAL_LIMITS.pro_100[0].label, /rolling last 7 days/);
  assert.match(OFFICIAL_LIMITS.pro_200[1].label, /rolling last 24 hours/);
  assert.equal(SOURCE_DATE, "2026-10-05");
  assert.equal(new URL(SOURCE_URL).hostname, "help.openai.com");
  assert.equal("remaining" in snapshot.windows[0], false);
  assert.equal("resetAt" in snapshot.windows[0], false);
});

test("rolling boundaries expire independently and prune receipts without losing retained dedup", t => {
  const { store, file, now, setTime } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_200" });
  store.record(receipt("old"));
  setTime(START + DAY_MS - 1);
  store.record(receipt("later", "gpt-5.6-pro", now()));
  store.record(receipt("unknown", "pro-unknown", now()));
  assert.equal(store.snapshot().windows[2].used, 3);
  setTime(START + DAY_MS);
  assert.deepEqual(store.snapshot().windows.map(window => window.used), [1, 1, 2]);
  setTime(START + RETENTION_MS);
  assert.equal(store.snapshot().totalMessages, 2);
  assert.deepEqual(store.snapshot().windows.map(window => window.used), [0, 0, 0]);
  assert.equal(store.snapshot().windows[0].uncertainUsed, 1);
  assert.equal(store.record(receipt("old")), false);
  assert.equal(store.record(receipt("later", "gpt-6-pro", now())), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).accounts[A].events.map(event => event.id), ["later", "unknown"]);
  setTime(START + RETENTION_MS + DAY_MS - 1);
  const restarted = new LimitsStore(file, { now });
  assert.equal(restarted.snapshot().totalMessages, 0);
  assert.equal(restarted.snapshot().incomplete, false);
  assert.equal(restarted.snapshot().trackingSince, START);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).accounts[A].events, []);
  assert.equal(restarted.record(receipt("later", "gpt-6-pro", now())), true);
});

test("account isolation, unsupported plans, and invalid configuration cannot pollute usage", t => {
  const { store, file, now, setTime } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_100" });
  assert.equal(store.record(receipt("same-id")), true);
  setTime(START + 10);
  const second = store.configure({ accountKey: B, plan: "pro_200" });
  assert.equal(second.totalMessages, 0);
  assert.equal(second.trackingSince, now());
  assert.equal(store.record(receipt("wrong-account", "pro-unknown", now())), false);
  assert.equal(store.record(receipt("pre-opt-in", "gpt-6-pro", START, B)), false);
  assert.equal(store.record(receipt("same-id", "gpt-5.6-pro", now(), B)), true);
  assert.equal(store.configure({ accountKey: A, plan: "pro_200" }).trackingSince, START);
  assert.equal(store.snapshot().windows[0].used, 1);
  const disabled = store.configure({ accountKey: A, plan: "unsupported" });
  assert.equal(disabled.enabled, true);
  assert.equal(disabled.plan, "unsupported");
  assert.equal(disabled.totalMessages, 1);
  assert.deepEqual(disabled.windows, []);
  assert.equal(store.record(receipt("still-tracked", "gpt-6-pro", now())), true);
  const before = fs.readFileSync(file, "utf8");
  for (const config of [{ accountKey: A, plan: "business" }, { accountKey: "email@example.com", plan: "pro_100" }, null]) {
    assert.throws(() => store.configure(config), { code: "LIMITS_INVALID_CONFIG" });
  }
  for (const event of [receipt("bad-model", "gpt-6"), receipt("", "other"), receipt("negative", "other", -1)]) {
    assert.throws(() => store.record(event), { code: "LIMITS_INVALID_EVENT" });
  }
  assert.equal(fs.readFileSync(file, "utf8"), before);
  setTime(NaN);
  assert.throws(() => store.snapshot(), { code: "LIMITS_INVALID_CLOCK" });
  setTime(START + 10);
  const C = "c".repeat(64);
  assert.equal(store.configure({ accountKey: C, plan: "unsupported" }).trackingSince, now());
  setTime(now() + 10);
  assert.equal(store.configure({ accountKey: C, plan: "pro_100" }).trackingSince, now() - 10);
  assert.equal(new LimitsStore(file, { now }).configure({ accountKey: B, plan: "pro_200" }).windows[1].used, 1);
});

test("clock skew rejects new receipts without clamping or discarding existing history", t => {
  const { store, file, now, setTime } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_200" });
  setTime(START + 100);
  store.record(receipt("recorded", "gpt-6-pro", now()));
  const before = fs.readFileSync(file, "utf8");
  setTime(START + 50);
  assert.throws(() => store.record(receipt("future", "gpt-6-pro", START + 100)), { code: "LIMITS_CLOCK_SKEW" });
  assert.equal(store.snapshot().totalMessages, 0);
  assert.equal(store.record(receipt("recorded", "gpt-6-pro", now())), false);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  setTime(START - 1);
  assert.throws(() => store.record(receipt("before-clock", "gpt-6-pro", now())), { code: "LIMITS_CLOCK_SKEW" });
  setTime(START + 100);
  assert.equal(store.snapshot().totalMessages, 1);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("corrupt and unsupported persisted data throws specific errors and remains untouched", t => {
  const { store, file, now } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_200" });
  store.record(receipt("valid"));
  const valid = fs.readFileSync(file, "utf8");
  const mutations = [
    state => { state.accounts[A].plan = "business"; },
    state => { state.activeAccountKey = B; },
    state => { state.activeAccountKey = [A]; },
    state => { state.accounts[A].initializedAt = "bad-time"; },
    state => { state.accounts[A].events.push(state.accounts[A].events[0]); },
    state => { state.accounts[A].events[0].model = "unknown-model"; },
    state => { state.accounts[A].events[0].at = -1; },
    state => { state.accounts[A].events[0].prompt = "must-not-be-preserved"; },
  ];
  const cases = [
    ["{broken", "LIMITS_CORRUPT_STATE"], ["null", "LIMITS_CORRUPT_STATE"],
    [JSON.stringify({ ...JSON.parse(valid), version: 999 }), "LIMITS_UNSUPPORTED_VERSION"],
    ...mutations.map(mutate => { const state = JSON.parse(valid); mutate(state); return [JSON.stringify(state), "LIMITS_CORRUPT_STATE"]; }),
  ];
  for (const [content, code] of cases) {
    fs.writeFileSync(file, content);
    assert.throws(() => new LimitsStore(file, { now }), error => error instanceof LimitsStoreError && error.code === code);
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
  fs.truncateSync(file, STORE_BOUNDS.maxFileBytes + 1);
  assert.throws(() => new LimitsStore(file, { now }), { code: "LIMITS_CORRUPT_STATE" });
  assert.equal(fs.statSync(file).size, STORE_BOUNDS.maxFileBytes + 1);
});

test("failed atomic persistence does not advance in-memory counts or dedup state", t => {
  const { store, root, file } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_200" });
  const before = fs.readFileSync(file, "utf8");
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.throws(() => store.record(receipt("retry")), { code: "LIMITS_WRITE_FAILED" });
  assert.equal(store.snapshot().totalMessages, 0);
  assert.deepEqual(fs.readdirSync(root), ["limits.json"]);
  fs.rmdirSync(file);
  fs.writeFileSync(file, before);
  assert.equal(store.record(receipt("retry")), true);
  assert.equal(store.snapshot().totalMessages, 1);
});

test("capacity fails explicitly without evicting recent receipts or account history", t => {
  const { store, file, now, setTime } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_200" });
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.accounts[A].events = Array.from({ length: STORE_BOUNDS.maxEvents }, (_, index) => ({ id: `receipt-${index}`, model: "gpt-6-pro", at: START, effort: "unknown", purpose: "unknown" }));
  for (let index = 1; index < STORE_BOUNDS.maxAccounts; index += 1) {
    state.accounts[index.toString(16).padStart(64, "0")] = { plan: "unsupported", initializedAt: null, checkedAt: START, events: [] };
  }
  fs.writeFileSync(file, JSON.stringify(state));
  const bounded = new LimitsStore(file, { now });
  assert.equal(bounded.record(receipt("receipt-0")), false);
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => bounded.record(receipt("one-too-many")), { code: "LIMITS_CAPACITY_EXCEEDED" });
  assert.throws(() => bounded.configure({ accountKey: B, plan: "pro_100" }), { code: "LIMITS_CAPACITY_EXCEEDED" });
  assert.equal(fs.readFileSync(file, "utf8"), before);
  setTime(START + RETENTION_MS);
  assert.equal(bounded.record(receipt("one-too-many", "pro-unknown", now())), true);
  assert.equal(bounded.snapshot().totalMessages, 1);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).accounts).length, STORE_BOUNDS.maxAccounts);
});


test("ordinary GPT-6 receipts persist separately and do not consume Pro counters", t => {
  const { store, file, now } = fixture(t);
  store.configure({ accountKey: A, plan: "pro_200" });
  store.record(receipt("6-medium", "gpt-6-sol"));
  store.record(receipt("56-high", "gpt-5.6-sol"));
  const restarted = new LimitsStore(file, { now });
  assert.equal(restarted.record(receipt("6-medium", "gpt-6-sol")), false);
  assert.equal(restarted.snapshot().totalMessages, 2);
  assert.deepEqual(restarted.snapshot().models.find(row => row.model === "gpt-6-sol"), {
    model: "gpt-6-sol", last24Hours: 1, last7Days: 1,
  });
  assert.ok(restarted.snapshot().windows.every(row => row.used === 0 && row.uncertainUsed === 0));
});
