const { LimitsStore } = require("./limits-store.cjs");

const { UsageOutbox, RETENTION_MS } = require("../../shared/usage-receipts.cjs");

const HISTORY_WARNING = "Local history may be incomplete. Missed sends cannot be recovered by checking the account again.";
const emptySnapshot = () => ({
  enabled: false, plan: null, trackingSince: null, checkedAt: null,
  totalMessages: 0, unknownProMessages: 0, incomplete: true, gapAt: null, models: [], windows: [],
});
const describe = cause => cause instanceof Error ? cause.message : "Unknown Limits error.";

class LimitsController {
  #filePath;
  #getInteractionMode;
  #now;
  #store = null;
  #error = null;
  #settingUp = false;
  #outbox;

  constructor(filePath, { getInteractionMode, now, outboxDirectory } = {}) {
    this.#filePath = filePath;
    this.#getInteractionMode = getInteractionMode;
    this.#now = now;
    this.#outbox = outboxDirectory ? new UsageOutbox(outboxDirectory) : null;
  }

  #mode() {
    const mode = this.#getInteractionMode();
    if (mode !== "automatic" && mode !== "manual") throw new Error("Limits requires a valid browser interaction mode.");
    return mode;
  }

  #getStore() {
    // A corrupt optional store must not prevent launcher startup. A failed read
    // leaves this null, so a later explicit repair can be checked without a restart.
    this.#store ??= new LimitsStore(this.#filePath, { now: this.#now });
    return this.#store;
  }

  snapshot() {
    let disabledReason = null;
    try {
      disabledReason = this.#mode() === "manual" ? "zero-risk" : null;
      const delivery = this.#reconcile();
      const snapshot = this.#getStore().snapshot();
      return { ...snapshot, ...delivery, incomplete: snapshot.incomplete || delivery.pendingMessages > 0 || delivery.pendingReceipts > 0 || delivery.deliveryErrors > 0, enabled: snapshot.enabled && disabledReason === null, disabledReason, error: this.#error };
    } catch (cause) {
      this.#error = `Limits tracking is unavailable. ${describe(cause)} ${HISTORY_WARNING}`;
      return { ...emptySnapshot(), disabledReason, error: this.#error };
    }
  }

  #reconcile() {
    const status = { pendingMessages: 0, pendingReceipts: 0, deliveryErrors: 0 };
    if (!this.#outbox) return status;
    const { entries, errors } = this.#outbox.entries(); status.deliveryErrors = errors;
    const now = this.#now ? this.#now() : Date.now();
    for (const entry of entries) {
      if (entry.at > now) { status.deliveryErrors++; continue; }
      if (entry.at <= now - RETENTION_MS) { this.#outbox.remove(entry.id); continue; }
      if (entry.state === "pending") { status.pendingMessages++; continue; }
      if (this.#mode() !== "automatic") { status.pendingReceipts++; continue; }
      const result = this.recordAcknowledged(entry);
      if (["recorded", "duplicate", "gap-recorded"].includes(result.status)) this.#outbox.remove(entry.id);
      else status.pendingReceipts++;
    }
    return status;
  }

  recordAcknowledged(payload) {
    if (this.#mode() !== "automatic") return { recorded: false, status: "rejected", reason: "manual-mode" };
    if (payload?.receipt && this.#getStore().hasReceipt(payload.receipt.accountKey, payload.receipt.id)) {
      return { recorded: false, status: "duplicate" };
    }
    if (payload?.trackingError === "account-unavailable" && payload.receipt === undefined) {
      try {
        this.#getStore().markGap();
        this.#error = `The ChatGPT account could not be identified for a sent message. ${HISTORY_WARNING}`;
        return { recorded: false, status: "gap-recorded" };
      } catch { return { recorded: false, status: "rejected", reason: "gap-not-persisted" }; }
    }
    const recorded = this.record(payload);
    if (recorded) return { recorded: true, status: "recorded" };
    return { recorded: false, status: "rejected", reason: "receipt-not-recorded" };
  }

  enabled() {
    return this.snapshot().enabled;
  }

  #requireAutomatic() {
    if (this.#mode() !== "automatic") throw new Error("Limits is unavailable in Zero Risk mode. Switch to Automatic to check your plan.");
  }

  async setup(detectPlan) {
    if (this.#settingUp) throw new Error("A Limits plan check is already running.");
    this.#settingUp = true;
    try {
      this.#requireAutomatic();
      const store = this.#getStore();
      const config = await detectPlan();
      // The mode may have changed while the browser detector was running.
      this.#requireAutomatic();
      const snapshot = store.configure(config);
      this.#error = null;
      return { ...snapshot, disabledReason: null, error: null };
    } catch (cause) {
      this.#error = `Could not check the ChatGPT plan. ${describe(cause)} ${HISTORY_WARNING}`;
      throw new Error(this.#error, { cause });
    } finally {
      this.#settingUp = false;
    }
  }

  // Optional accounting must never fail generation. Gaps survive account checks
  // and restarts for the retained seven-day window.
  record({ receipt, trackingError } = {}) {
    try {
      if (this.#mode() !== "automatic") return false;
      const store = this.#getStore();
      if ((receipt !== undefined) === (trackingError !== undefined)) {
        throw new Error("Expected exactly one submission receipt or tracking error.");
      }
      if (trackingError === "account-unavailable") {
        store.markGap();
        this.#error = `The ChatGPT account could not be identified for a sent message. ${HISTORY_WARNING}`;
        return false;
      }
      if (trackingError !== undefined) throw new Error("Unrecognized Limits tracking error.");
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("Invalid Limits submission receipt.");
      if (receipt.plan === undefined && !store.matchesAccount(receipt.accountKey)) {
        store.markGap();
        this.#error = `The ChatGPT account does not match the checked account. This message was not counted. ${HISTORY_WARNING}`;
        return false;
      }
      return store.record(receipt);
    } catch (cause) {
      try { this.#getStore().markGap(); } catch { /* Preserve the original persistence failure. */ }
      this.#error = `Could not record launcher usage. ${describe(cause)} ${HISTORY_WARNING}`;
      return false;
    }
  }
}

module.exports = { LimitsController };
