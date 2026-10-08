const fs = require("node:fs");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");
const { EFFORTS, PURPOSES } = require("../../shared/usage-receipts.cjs");
const policy = require("./limits-policy.json");

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * DAY_MS;
const SOURCE_URL = policy.sourceUrl;
const SOURCE_DATE = policy.checkedOn;
const STORE_BOUNDS = Object.freeze({ maxAccounts: 64, maxEvents: 20_000, maxIdBytes: 256, maxFileBytes: 16 * 1024 * 1024 });

// Legacy rolling statistics only. Published policy counts are separate references;
// unknown account periods must not become quotas or trigger remaining-usage alerts.
const OFFICIAL_LIMITS = Object.freeze({
  pro_100: Object.freeze([
    Object.freeze({ id: "shared-7d", label: "Both Pro models · rolling last 7 days", model: "shared", durationMs: RETENTION_MS, limit: null }),
  ]),
  pro_200: Object.freeze([
    Object.freeze({ id: "gpt-6-pro-7d", label: "GPT-6 Pro · rolling last 7 days", model: "gpt-6-pro", durationMs: RETENTION_MS, limit: null }),
    Object.freeze({ id: "gpt-5.6-pro-24h", label: "GPT-5.6 Pro · rolling last 24 hours", model: "gpt-5.6-pro", durationMs: DAY_MS, limit: null }),
    Object.freeze({ id: "shared-24h", label: "Both Pro models · rolling last 24 hours", model: "shared", durationMs: DAY_MS, limit: null }),
  ]),
  unsupported: Object.freeze([]),
});
const PLANS = new Set(Object.keys(OFFICIAL_LIMITS));
const MODELS = new Set(["gpt-6-pro", "gpt-5.6-pro", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-luna", "pro-unknown", "other"]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isTime = value => Number.isSafeInteger(value) && value >= 0;
const isAccountKey = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const isId = value => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= STORE_BOUNDS.maxIdBytes;
const hasKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

class LimitsStoreError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "LimitsStoreError";
    this.code = code;
  }
}

function assertState(state) {
  const corrupt = () => { throw new LimitsStoreError("LIMITS_CORRUPT_STATE", "Invalid limits store data; the file was not changed."); };
  if (!isObject(state) || !Object.hasOwn(state, "version")) corrupt();
  if (![1, 2, 3].includes(state.version)) throw new LimitsStoreError("LIMITS_UNSUPPORTED_VERSION", "Unsupported limits store version; the file was not changed.");
  if (!hasKeys(state, state.version === 1 ? ["version", "activeAccountKey", "accounts"] : ["version", "activeAccountKey", "accounts", "gapAt"])
    || !isObject(state.accounts) || (state.version >= 2 && state.gapAt !== null && !isTime(state.gapAt))) corrupt();
  const entries = Object.entries(state.accounts);
  if (entries.length > STORE_BOUNDS.maxAccounts) corrupt();
  if (state.activeAccountKey === null ? entries.length !== 0
    : !isAccountKey(state.activeAccountKey) || state.activeAccountKey !== state.activeAccountKey.toLowerCase()
      || !Object.hasOwn(state.accounts, state.activeAccountKey)) corrupt();
  let count = 0;
  for (const [key, account] of entries) {
    if (!isAccountKey(key) || key !== key.toLowerCase()
      || !hasKeys(account, ["plan", "initializedAt", "checkedAt", "events"])
      || !PLANS.has(account.plan) || !isTime(account.checkedAt) || !Array.isArray(account.events)
      || !(account.initializedAt === null ? account.plan === "unsupported" && account.events.length === 0 : isTime(account.initializedAt))) corrupt();
    count += account.events.length;
    if (count > STORE_BOUNDS.maxEvents) corrupt();
    const ids = new Set();
    for (const event of account.events) {
      if (!hasKeys(event, state.version < 3 ? ["id", "model", "at"] : ["id", "model", "at", "effort", "purpose"])
        || (state.version >= 3 && (!EFFORTS.has(event.effort) || !PURPOSES.has(event.purpose))) || !isId(event.id) || !MODELS.has(event.model)
        || !isTime(event.at) || event.at < account.initializedAt || ids.has(event.id)) corrupt();
      ids.add(event.id);
    }
  }
}

function readState(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (cause) {
    if (cause.code === "ENOENT") return { version: 3, activeAccountKey: null, accounts: {}, gapAt: null };
    throw new LimitsStoreError("LIMITS_READ_FAILED", "Could not read the limits store.", { cause });
  }
  if (!stat.isFile() || stat.size > STORE_BOUNDS.maxFileBytes) {
    throw new LimitsStoreError("LIMITS_CORRUPT_STATE", "Limits store is not a bounded regular file; it was not changed.");
  }
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new LimitsStoreError("LIMITS_READ_FAILED", "Could not read the limits store.", { cause });
  }
  let state;
  try {
    state = JSON.parse(content);
  } catch {
    throw new LimitsStoreError("LIMITS_CORRUPT_STATE", "Limits store is not valid JSON; the file was not changed.");
  }
  assertState(state);
  // Validate before migrating; never replace corrupt or future data.
  return { ...state, version: 3, gapAt: state.gapAt ?? null, accounts: Object.fromEntries(
    Object.entries(state.accounts).map(([key, account]) => [key, { ...account, events: account.events.map(event => ({ ...event, effort: event.effort ?? "unknown", purpose: event.purpose ?? "unknown" })) }])) };
}

function retainHistory(state, now) {
  const accounts = { ...state.accounts };
  let changed = false;
  for (const [key, account] of Object.entries(accounts)) {
    const events = account.events.filter(event => event.at > now - RETENTION_MS);
    if (events.length !== account.events.length) {
      accounts[key] = { ...account, events };
      changed = true;
    }
  }
  const gapAt = state.gapAt !== null && state.gapAt <= now - RETENTION_MS ? null : state.gapAt;
  return changed || gapAt !== state.gapAt ? { ...state, accounts, gapAt } : state;
}

function snapshotAt(state, now) {
  const account = state.accounts[state.activeAccountKey];
  const plan = account?.plan ?? null;
  const events = (account?.events ?? []).filter(event => event.at > now - RETENTION_MS && event.at <= now);
  const unknownProMessages = events.filter(event => event.model === "pro-unknown").length;
  return {
    enabled: true,
    plan,
    trackingSince: account?.initializedAt ?? null,
    checkedAt: account?.checkedAt ?? null,
    lastRecordedAt: events.length ? Math.max(...events.map(event => event.at)) : null,
    details: [...new Set(events.map(event => `${event.model}|${event.effort}|${event.purpose}`))].map(key => {
      const [model, effort, purpose] = key.split("|");
      const matching = events.filter(event => event.model === model && event.effort === effort && event.purpose === purpose);
      return { model, effort, purpose, last24Hours: matching.filter(event => event.at > now - DAY_MS).length, last7Days: matching.length };
    }),
    totalMessages: events.length, // All models in the rolling last 7 days, not a lifetime counter.
    unknownProMessages,
    // Missing identity cannot safely be assigned to an account. Keep a profile
    // warning for seven days, including across account checks and restarts.
    incomplete: unknownProMessages > 0 || events.some(event => event.model === "other") || state.gapAt !== null,
    gapAt: state.gapAt,
    models: [...MODELS].filter(model => ["gpt-6-pro", "gpt-5.6-pro", "gpt-6-sol", "gpt-5.6-sol"].includes(model)
      || events.some(event => event.model === model)).map(model => ({
      model,
      last24Hours: events.filter(event => event.model === model && event.at > now - DAY_MS).length,
      last7Days: events.filter(event => event.model === model).length,
    })),
    windows: (OFFICIAL_LIMITS[plan] ?? []).map(window => {
      const recent = events.filter(event => event.at > now - window.durationMs
        && ["gpt-6-pro", "gpt-5.6-pro", "pro-unknown"].includes(event.model));
      return {
        ...window,
        used: recent.filter(event => window.model === "shared" || event.model === window.model).length,
        // In family windows these may belong to that family, but are excluded from used.
        // In shared windows these are already included in used, not additional usage.
        uncertainUsed: recent.filter(event => event.model === "pro-unknown").length,
      };
    }),
  };
}

// One store instance per file, called synchronously by the launcher main process.
// Account checks select a view; accepted sends automatically initialize tracking.
class LimitsStore {
  #filePath;
  #now;
  #state;

  constructor(filePath, { now = () => Date.now() } = {}) {
    if (typeof filePath !== "string" || !filePath || typeof now !== "function") {
      throw new LimitsStoreError("LIMITS_INVALID_CONFIG", "A file path and clock function are required.");
    }
    this.#filePath = filePath;
    this.#now = now;
    this.#state = readState(filePath);
  }

  #time() {
    const now = this.#now();
    if (!isTime(now)) throw new LimitsStoreError("LIMITS_INVALID_CLOCK", "The limits clock must return a nonnegative safe integer timestamp.");
    return now;
  }

  #commit(state) {
    if (state === this.#state) return;
    const content = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(content) > STORE_BOUNDS.maxFileBytes) {
      throw new LimitsStoreError("LIMITS_CAPACITY_EXCEEDED", "Limits store file capacity reached; no history was discarded.");
    }
    try {
      writePrivateFileAtomic(this.#filePath, content);
    } catch (cause) {
      throw new LimitsStoreError("LIMITS_WRITE_FAILED", "Could not save the limits store.", { cause });
    }
    this.#state = state;
  }

  configure(config) {
    if (!isObject(config) || !isAccountKey(config.accountKey) || !PLANS.has(config.plan)) {
      throw new LimitsStoreError("LIMITS_INVALID_CONFIG", "Expected a 64-hex accountKey and plan pro_100, pro_200, or unsupported.");
    }
    const now = this.#time();
    const accountKey = config.accountKey.toLowerCase();
    const state = retainHistory(this.#state, now);
    const previous = state.accounts[accountKey];
    if (!previous && Object.keys(state.accounts).length >= STORE_BOUNDS.maxAccounts) {
      throw new LimitsStoreError("LIMITS_CAPACITY_EXCEEDED", "Limits account capacity reached; no accounts were discarded.");
    }
    this.#commit({ ...state, activeAccountKey: accountKey, accounts: {
      ...state.accounts,
      [accountKey]: {
        plan: config.plan,
        initializedAt: previous?.initializedAt ?? now,
        checkedAt: now,
        events: previous?.events ?? [],
      },
    } });
    return snapshotAt(this.#state, now);
  }

  matchesAccount(accountKey) {
    return isAccountKey(accountKey) && accountKey.toLowerCase() === this.#state.activeAccountKey;
  }

  hasReceipt(accountKey, id) {
    return this.#state.accounts[accountKey.toLowerCase()]?.events.some(event => event.id === id) === true;
  }

  markGap() {
    const now = this.#time();
    this.#commit({ ...retainHistory(this.#state, now), gapAt: now });
  }

  // Verified helper receipts select/create their account atomically. Legacy
  // receipts without plan metadata require a previously checked account.
  record(event) {
    const now = this.#time();
    if (!isObject(event) || !isAccountKey(event.accountKey) || !isId(event.id)
      || !MODELS.has(event.model) || !isTime(event.at)
      || (event.plan !== undefined && !PLANS.has(event.plan))
      || (event.effort !== undefined && !EFFORTS.has(event.effort))
      || (event.purpose !== undefined && !PURPOSES.has(event.purpose))) {
      throw new LimitsStoreError("LIMITS_INVALID_EVENT", "Expected a bounded receipt id, 64-hex accountKey, supported model, and nonnegative integer timestamp.");
    }
    // Receipts use the helper's local wall clock. Never silently clamp a skewed
    // timestamp or manufacture usage in a different rolling window.
    if (event.at > now) {
      throw new LimitsStoreError("LIMITS_CLOCK_SKEW", "Receipt time is ahead of the local clock; the message was not recorded.");
    }
    const accountKey = event.accountKey.toLowerCase();
    let state = retainHistory(this.#state, now);
    if (event.at <= now - RETENTION_MS) return false;
    let account = state.accounts[accountKey];
    if (event.plan !== undefined) {
      if (!account && Object.keys(state.accounts).length >= STORE_BOUNDS.maxAccounts) {
        throw new LimitsStoreError("LIMITS_CAPACITY_EXCEEDED", "Limits account capacity reached; no accounts were discarded.");
      }
      account = { plan: event.plan, initializedAt: account?.initializedAt === null || account?.initializedAt === undefined ? event.at : Math.min(account.initializedAt, event.at),
        checkedAt: Math.max(account?.checkedAt ?? 0, event.at), events: account?.events ?? [] };
      const active = state.accounts[state.activeAccountKey];
      const activeAccountKey = !active || event.at >= active.checkedAt ? accountKey : state.activeAccountKey;
      state = { ...state, activeAccountKey, accounts: { ...state.accounts, [accountKey]: account } };
    }
    if (accountKey === state.activeAccountKey && account && now < account.initializedAt) {
      throw new LimitsStoreError("LIMITS_CLOCK_SKEW", "The local clock is before tracking began; the message was not recorded.");
    }
    const accepted = (event.plan !== undefined || accountKey === state.activeAccountKey) && !!account
      && event.at >= account.initializedAt && event.at > now - RETENTION_MS
      && !account.events.some(existing => existing.id === event.id);
    if (accepted) {
      const count = Object.values(state.accounts).reduce((sum, value) => sum + value.events.length, 0);
      if (count >= STORE_BOUNDS.maxEvents) {
        throw new LimitsStoreError("LIMITS_CAPACITY_EXCEEDED", "Limits receipt capacity reached; no recent history was discarded.");
      }
      state = { ...state, accounts: { ...state.accounts, [accountKey]: {
        ...account, events: [...account.events, { id: event.id, model: event.model, at: event.at, effort: event.effort ?? "unknown", purpose: event.purpose ?? "unknown" }],
      } } };
    }
    this.#commit(state);
    return accepted;
  }

  snapshot() {
    const now = this.#time();
    this.#commit(retainHistory(this.#state, now));
    return snapshotAt(this.#state, now);
  }
}

module.exports = { LimitsStore, LimitsStoreError, OFFICIAL_LIMITS, SOURCE_URL, SOURCE_DATE, DAY_MS, RETENTION_MS, STORE_BOUNDS };
