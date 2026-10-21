"use strict";

// Resource-owner scheduler. No Electron, browser, model or approval policy lives here.
// The host must acknowledge physical settlement before returning an execution lease.
const { randomUUID } = require("node:crypto");
const { validMcpRemoteFailure, mcpRemoteErrorInfo } = require("./mcp-remote-error.cjs");

const { requestScheduling } = require("./runtime-parameter-options.json");
const DEFAULT_REQUEST_SCHEDULING = Object.freeze(requestScheduling.defaults);
const QUEUE_TIMEOUT_CHOICES = Object.freeze(requestScheduling.queueTimeoutChoices);
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed-out"]);
const PHASES = new Set(["preparing", "running", "waiting-user", "waiting-tools"]);
const SEND_PROGRESS = ["preflight", "waiting_permit", "sending", "awaiting_ack", "reconciling"];

function schedulingError(code, message) {
  return Object.assign(new Error(message), { code, retryable: false });
}

function validateRequestScheduling(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw schedulingError("invalid_scheduling_settings", "Request scheduling settings must be an object");
  }
  const { maxConcurrent, queueTimeoutMinutes, minSendIntervalSeconds } = value;
  if (Object.keys(value).some(key => !Object.hasOwn(DEFAULT_REQUEST_SCHEDULING, key))
    || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 5
    || !QUEUE_TIMEOUT_CHOICES.includes(queueTimeoutMinutes)
    || !Number.isInteger(minSendIntervalSeconds) || minSendIntervalSeconds < 1 || minSendIntervalSeconds > 60) {
    throw schedulingError("invalid_scheduling_settings", "Invalid concurrency, queue timeout or minimum send interval");
  }
  return { maxConcurrent, queueTimeoutMinutes, minSendIntervalSeconds };
}

class RequestScheduler {
  constructor(options = {}) {
    this.settings = validateRequestScheduling(options.settings ?? DEFAULT_REQUEST_SCHEDULING);
    this.configRevision = 1;
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.onEvent = options.onEvent ?? (() => {});
    this.maxWaiting = options.maxWaiting ?? 64;
    this.maxWaitingBytes = options.maxWaitingBytes ?? 256 * 1024 * 1024;
    this.maxRecords = options.maxRecords ?? 4096;
    this.receiptTtlMs = options.receiptTtlMs ?? 24 * 60 * 60_000;
    for (const value of [this.maxWaiting, this.maxWaitingBytes, this.maxRecords, this.receiptTtlMs]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid scheduler resource budget");
    }
    this.jobs = new Map();
    this.mcpScopes = new Map();
    this.random = options.random ?? Math.random;
    this.lastServed = new Map();
    this.serviceOrder = 0;
    this.pauseReasons = new Set();
    this.pauseSources = new Map();
    this.pauseEvidence = new Map();
    this.recoveryToken = randomUUID();
    this.lastSendAt = undefined;
    this.sendOwner = null;
    this.closed = false;
    this.pumping = false;
  }

  // Call on a host-owned timer as well as arrivals. Does not depend on any UI polling.
  tick() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const now = this.monotonicNow();
      for (const [id, job] of this.jobs) {
        if (TERMINAL.has(job.state) && now - job.endedMonotonic >= this.receiptTtlMs) {
          for (const [reason, requestId] of this.pauseSources) {
            if (requestId === id) this.capturePauseEvidence(reason, job);
          }
          this.jobs.delete(id);
          this.event("queue.receipt_expired");
        } else if (job.state === "queued" && this.pausedReason && this.pausedReason !== "user") {
          const reason = this.pausedReason;
          job.blockedBy = { reason, ...(this.pauseSources.has(reason) ? { requestId: this.pauseSources.get(reason) } : {}) };
          this.terminal(job, "failed", `queue_blocked_${reason}`);
        } else if (job.state === "queued" && now >= job.deadlineMonotonic) {
          this.terminal(job, "timed-out", "queue_wait_timeout");
        }
      }
      const liveGroups = new Set([...this.jobs.values()].map(job => job.groupId));
      for (const group of this.lastServed.keys()) if (!liveGroups.has(group)) this.lastServed.delete(group);
      while (!this.closed && !this.pausedReason && this.active().length < this.settings.maxConcurrent) {
        const candidates = this.waiting().filter(job => !this.mcpWait(job)
          && !(this.mcpScopes.get(job.mcpScope)?.cooldownUntil && this.active().some(active => active.mcpScope === job.mcpScope)));
        if (!candidates.length) break;
        // A task waiting for 60s may take the next free slot ahead of round-robin.
        const aged = candidates.find(job => now - job.queuedMonotonic >= 60_000);
        let next;
        if (aged) next = aged;
        else {
          next = candidates.reduce((best, candidate) =>
            (this.lastServed.get(candidate.groupId) ?? 0) < (this.lastServed.get(best.groupId) ?? 0)
              ? candidate : best);
        }
        if (!next) break;
        next.state = "preparing";
        next.lease = randomUUID();
        next.startedAt = this.now();
        next.startedMonotonic = now;
        this.lastServed.set(next.groupId, ++this.serviceOrder);
        this.event("queue.dispatched", next);
      }
    } finally {
      this.pumping = false;
    }
  }

  enqueue(input) {
    if (this.closed) throw schedulingError("scheduler_closed", "Request scheduler is closed");
    this.tick();
    if (!input || typeof input !== "object") throw new Error("Invalid queue request");
    for (const key of ["id", "groupId", "model", "mode"]) {
      if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 256) {
        throw new Error(`Invalid queue ${key}`);
      }
    }
    if (input.effort !== undefined && (typeof input.effort !== "string" || !input.effort.trim() || input.effort.length > 256)) {
      throw new Error("Invalid queue effort");
    }
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) throw new Error("Invalid queue payload size");
    if (input.mcpScope !== undefined && (!/^[a-f0-9]{64}$/.test(input.mcpScope) || input.mode !== "mcp-bridge"
      || typeof input.connectorName !== "string" || !input.connectorName.trim() || input.connectorName.length > 256
      || !Number.isInteger(input.retryAttempt) || input.retryAttempt < 0 || input.retryAttempt > 2)) throw new Error("Invalid MCP queue scope");
    const existing = this.jobs.get(input.id);
    if (existing) {
      // bytes accounts for the first admission, not semantic identity. The caller's stable
      // request ID already covers input/authority; transport/runtime metadata can change the
      // serialized size on an exact reconnect. Keep the original reservation and receipt.
      if (["groupId", "model", "mode", "effort", "mcpScope", "connectorName", "retryAttempt"].some(key => existing[key] !== input[key])) {
        throw schedulingError("queue_identity_conflict", "Queued request identity conflicts with its original request");
      }
      return this.view(existing);
    }
    const waiting = this.waiting();
    if (this.jobs.size >= this.maxRecords || waiting.length >= this.maxWaiting
      || input.bytes > this.maxWaitingBytes - waiting.reduce((sum, job) => sum + job.bytes, 0)) {
      throw schedulingError("scheduler_overloaded", "Request queue capacity has been reached");
    }
    const queuedAt = this.now();
    const queuedMonotonic = this.monotonicNow();
    const timeoutMs = this.settings.queueTimeoutMinutes * 60_000;
    const job = {
      id: input.id, groupId: input.groupId, model: input.model, mode: input.mode,
      bytes: input.bytes, ...(input.effort === undefined ? {} : { effort: input.effort }),
      ...(input.mcpScope ? { mcpScope: input.mcpScope, connectorName: input.connectorName, retryAttempt: input.retryAttempt } : {}),
      state: "queued", queuedAt, queuedMonotonic,
      deadlineAt: queuedAt + timeoutMs, deadlineMonotonic: queuedMonotonic + timeoutMs,
      configRevision: this.configRevision,
    };
    this.jobs.set(job.id, job);
    this.event("queue.enqueued", job);
    this.tick();
    return this.view(job);
  }

  active() { return [...this.jobs.values()].filter(job => job.state !== "queued" && !TERMINAL.has(job.state)); }
  waiting() { return [...this.jobs.values()].filter(job => job.state === "queued"); }
  get pausedReason() {
    return ["send_outcome_unknown", "browser_unavailable", "account_rate_limited", "user"]
      .find(reason => this.pauseReasons.has(reason)) ?? null;
  }

  // Internal resource-owner API. Never expose leases in renderer snapshots.
  lease(id) { this.tick(); return this.jobs.get(id)?.lease; }

  owned(id, lease) {
    const job = this.jobs.get(id);
    if (!job || !lease || job.lease !== lease || TERMINAL.has(job.state) || job.state === "queued") {
      throw schedulingError("queue_lease_invalid", "Execution lease is stale or unavailable");
    }
    return job;
  }

  setPhase(id, lease, phase) {
    if (!PHASES.has(phase)) throw new Error("Invalid execution phase");
    const job = this.owned(id, lease);
    if (job.state === "stopping") throw schedulingError("queue_cancelled", "Task is stopping");
    job.state = phase;
    this.event("queue.phase_changed", job);
    return this.view(job);
  }

  beginSend(id, lease) {
    this.tick();
    const job = this.owned(id, lease);
    if (job.state === "stopping") throw schedulingError("queue_cancelled", "Task is stopping");
    const mcpWait = this.mcpWait(job);
    if (mcpWait) return { allowed: false, reason: "mcp_cooldown", retryAfterMs: mcpWait };
    if (this.sendOwner) return { allowed: false, reason: "send_in_progress" };
    if (this.pausedReason && this.pausedReason !== "user") return { allowed: false, reason: this.pausedReason };
    const interval = this.settings.minSendIntervalSeconds * 1000;
    const retryAfterMs = this.lastSendAt === undefined ? 0 : Math.max(0, this.lastSendAt + interval - this.monotonicNow());
    if (retryAfterMs > 0) return { allowed: false, reason: "send_interval", retryAfterMs };
    const permit = randomUUID();
    this.sendOwner = { id, lease, permit };
    job.sendAttemptedAt = this.now();
    this.event("queue.send_permit_granted", job);
    return { allowed: true, permit };
  }

  // Display-only progress. It cannot grant input authority, release a permit or confirm a send.
  setSendProgress(id, lease, progress) {
    if (!SEND_PROGRESS.includes(progress)) throw new Error("Invalid send progress");
    const job = this.owned(id, lease);
    if (job.state !== "preparing" || ["confirmed", "not-sent", "unknown"].includes(job.sendProgress)
      || SEND_PROGRESS.indexOf(progress) < SEND_PROGRESS.indexOf(job.sendProgress)) {
      throw new Error("Send progress is retired");
    }
    if (job.sendProgress !== progress) {
      job.sendProgress = progress;
      this.event("queue.send_progress", job);
    }
    return this.view(job);
  }

  // Hold the permit across the actual send. Unknown outcomes must stop dispatch until
  // the host reconciles/terminates the owned browser; never expire this lock blindly.
  endSend(id, lease, permit, outcome) {
    const job = this.owned(id, lease);
    if (!this.sendOwner || this.sendOwner.id !== id || this.sendOwner.lease !== lease || this.sendOwner.permit !== permit) {
      throw schedulingError("send_permit_invalid", "Send permit is stale or unavailable");
    }
    if (!["confirmed", "not-sent", "unknown"].includes(outcome)) throw new Error("Invalid send outcome");
    this.sendOwner = null;
    job.sendProgress = outcome;
    if (outcome !== "not-sent") this.lastSendAt = this.monotonicNow();
    if (outcome === "confirmed") job.sendConfirmedAt = this.now();
    if (outcome === "unknown") this.pause("send_outcome_unknown", job.id);
    this.event(`queue.send_${outcome.replaceAll("-", "_")}`, job);
  }

  cancel(id) {
    this.tick();
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.state === "queued") this.terminal(job, "cancelled", "client_cancelled");
    else if (!TERMINAL.has(job.state) && job.state !== "stopping") {
      job.state = "stopping";
      job.reason = "client_cancelled";
      this.event("queue.stopping", job);
    }
    this.tick();
    return this.view(job);
  }

  settle(id, lease, outcome, reason, remote) {
    if (!["succeeded", "failed", "cancelled"].includes(outcome)) throw new Error("Invalid terminal outcome");
    const job = this.jobs.get(id);
    // Idempotent acknowledgement of the same lease, not a different job or generation.
    if (job?.lease === lease && lease && TERMINAL.has(job.state)) return this.view(job);
    this.owned(id, lease);
    // Record before dispatching another job, and only after host-confirmed physical release.
    if (job.mcpScope && job.state !== "stopping" && outcome !== "cancelled") this.recordMcp(job, outcome, remote);
    if (this.sendOwner?.id === id) {
      this.sendOwner = null;
      job.sendProgress = "unknown";
      this.lastSendAt = this.monotonicNow();
      this.pause("send_outcome_unknown", job.id);
    }
    this.terminal(job, job.state === "stopping" ? "cancelled" : outcome, reason ?? job.reason);
    this.tick();
    return this.view(job);
  }

  mcpWait(job) {
    return Math.max(0, (this.mcpScopes.get(job.mcpScope)?.cooldownMonotonic ?? 0) - this.monotonicNow());
  }

  recordMcp(job, outcome, remote) {
    if (!remote) return;
    if (remote.failure !== undefined && !validMcpRemoteFailure(remote.failure)) throw new Error("Invalid MCP outcome");
    if (!remote.failure && !(outcome === "succeeded" && remote.verified === true)) return;
    const previous = this.mcpScopes.get(job.mcpScope);
    const status = { ...previous, scope: job.mcpScope, connectorName: job.connectorName };
    if (remote.failure) {
      status.lastFailure = { ...remote.failure };
      status.lastFailureAt = this.now();
      status.retryAttempt = job.retryAttempt;
      if (mcpRemoteErrorInfo(remote.failure).retryCandidate) {
        const wait = remote.failure.retryAfterMs ?? (job.retryAttempt === 0 ? 30_000 : 60_000) + Math.floor(this.random() * 5000);
        status.cooldownUntil = Math.max(previous?.cooldownUntil ?? 0, this.now() + wait);
        status.cooldownMonotonic = Math.max(previous?.cooldownMonotonic ?? 0, this.monotonicNow() + wait);
      }
    } else {
      status.lastVerifiedAt = this.now();
      delete status.cooldownUntil;
      delete status.cooldownMonotonic;
    }
    this.mcpScopes.delete(job.mcpScope);
    this.mcpScopes.set(job.mcpScope, status);
    // Never evict a live cooldown. Bounded by the existing queue receipt budget.
    for (const [scope, value] of this.mcpScopes) {
      if (this.mcpScopes.size <= this.maxRecords) break;
      if ((value.cooldownMonotonic ?? 0) <= this.monotonicNow()) this.mcpScopes.delete(scope);
    }
    this.event("queue.mcp_status_changed", job);
  }

  mcpStatus() {
    return [...this.mcpScopes.values()].map(({ cooldownMonotonic, ...status }) => ({ ...status }));
  }

  restoreMcpStatus(values = []) {
    if (!Array.isArray(values) || values.length > this.maxRecords) throw new Error("Invalid saved MCP status");
    for (const value of values) {
      if (!value || !/^[a-f0-9]{64}$/.test(value.scope) || typeof value.connectorName !== "string" || value.connectorName.length > 256
        || value.lastFailure !== undefined && !validMcpRemoteFailure(value.lastFailure)
        || [value.lastFailureAt, value.lastVerifiedAt, value.cooldownUntil].some(at => at !== undefined && (!Number.isSafeInteger(at) || at < 0))
        || value.retryAttempt !== undefined && ![0, 1, 2].includes(value.retryAttempt)) throw new Error("Invalid saved MCP status");
      this.mcpScopes.set(value.scope, { scope: value.scope, connectorName: value.connectorName,
        lastFailure: value.lastFailure, lastFailureAt: value.lastFailureAt, lastVerifiedAt: value.lastVerifiedAt,
        retryAttempt: value.retryAttempt, cooldownUntil: value.cooldownUntil,
        cooldownMonotonic: this.monotonicNow() + Math.max(0, (value.cooldownUntil ?? 0) - this.now()) });
    }
  }

  terminal(job, state, reason) {
    job.state = state;
    job.reason = reason;
    job.endedAt = this.now();
    job.endedMonotonic = this.monotonicNow();
    this.event(`queue.${state.replaceAll("-", "_")}`, job);
  }

  updateSettings(settings) {
    this.settings = validateRequestScheduling(settings);
    this.configRevision += 1;
    this.event("queue.settings_applied");
    this.tick();
    return { settings: { ...this.settings }, configRevision: this.configRevision };
  }

  pause(reason = "user", requestId) {
    if (!["user", "account_rate_limited", "browser_unavailable", "send_outcome_unknown"].includes(reason)) {
      throw new Error("Invalid scheduler pause reason");
    }
    this.pauseReasons.add(reason);
    this.recoveryToken = randomUUID();
    if (requestId && this.jobs.has(requestId)) {
      this.pauseSources.set(reason, requestId);
      this.pauseEvidence.set(reason, { at: this.now() });
      this.capturePauseEvidence(reason, this.jobs.get(requestId));
    }
    this.event("queue.paused");
  }

  resume(expectedReason = "user") {
    if (!this.pauseReasons.has(expectedReason)) throw schedulingError("queue_pause_changed", "Pause reason changed; reconcile it before resuming");
    this.pauseReasons.delete(expectedReason);
    this.pauseSources.delete(expectedReason);
    this.pauseEvidence.delete(expectedReason);
    this.recoveryToken = randomUUID();
    this.event("queue.resumed");
    this.tick();
  }

  close() {
    this.closed = true;
    for (const job of this.jobs.values()) this.cancel(job.id);
    return this.active().map(job => this.view(job));
  }

  view(job) {
    const end = job.endedMonotonic ?? this.monotonicNow();
    return {
      id: job.id, groupId: job.groupId, model: job.model, mode: job.mode, effort: job.effort,
      ...(job.mcpScope ? { mcpScope: job.mcpScope, connectorName: job.connectorName, retryAttempt: job.retryAttempt,
        cooldownUntil: !TERMINAL.has(job.state) && this.mcpWait(job) ? this.now() + this.mcpWait(job) : undefined } : {}),
      state: job.state, reason: job.reason, configRevision: job.configRevision,
      ...(job.blockedBy ? { blockedBy: { ...job.blockedBy } } : {}),
      queuedAt: job.queuedAt, deadlineAt: job.deadlineAt, startedAt: job.startedAt, endedAt: job.endedAt,
      sendAttemptedAt: job.sendAttemptedAt, sendConfirmedAt: job.sendConfirmedAt,
      ...(job.sendProgress ? { sendProgress: job.sendProgress } : {}),
      waitMs: Math.max(0, (job.startedMonotonic ?? end) - job.queuedMonotonic),
      runMs: job.startedMonotonic === undefined ? null : Math.max(0, end - job.startedMonotonic),
    };
  }

  get(id) { this.tick(); const job = this.jobs.get(id); return job ? this.view(job) : null; }

  snapshot() {
    this.tick();
    return {
      settings: { ...this.settings }, configRevision: this.configRevision, pausedReason: this.pausedReason,
      pauseReasons: [...this.pauseReasons],
      recoveryToken: this.recoveryToken,
      pauseSources: this.pauseSourceSnapshot(),
      mcpStatus: this.mcpStatus(),
      active: this.active().length, waiting: this.waiting().length,
      waitingBytes: this.waiting().reduce((sum, job) => sum + job.bytes, 0), closed: this.closed,
    };
  }

  query({ state = "active", groupId, search = "", limit = 50, offset = 0 } = {}) {
    if (![25, 50, 100].includes(limit) || !Number.isSafeInteger(offset) || offset < 0
      || !["active", "queued", "running", "ended", ...TERMINAL].includes(state)
      || typeof search !== "string" || search.length > 256) throw new Error("Invalid queue query");
    this.tick();
    const term = search.toLowerCase();
    const jobs = [...this.jobs.values()].filter(job => {
      const matches = state === "active" ? !TERMINAL.has(job.state)
        : state === "ended" ? TERMINAL.has(job.state)
        : state === "running" ? job.state !== "queued" && !TERMINAL.has(job.state) : job.state === state;
      return matches
        && (!term || [job.id, job.groupId, job.model, job.effort].some(value => value?.toLowerCase().includes(term)));
    });
    // Session choices cover the entire state/search result, before session or paging.
    const groups = [...new Set(jobs.map(job => job.groupId))];
    const selected = groupId ? jobs.filter(job => job.groupId === groupId) : jobs;
    return { items: selected.slice(offset, offset + limit).map(job => this.view(job)), total: selected.length, offset, limit, groups };
  }

  event(name, job) {
    // Observability is not a durable receipt store. A host requiring durable send
    // receipts must persist them before calling beginSend, and fail closed on errors.
    try { this.onEvent(name, { ...(job ? this.view(job) : {}), configRevision: this.configRevision, pausedReason: this.pausedReason }); }
    catch { /* A diagnostic sink must not corrupt the resource ledger. */ }
  }

  capturePauseEvidence(reason, record) {
    const summary = { ...this.pauseEvidence.get(reason) };
    if (!Number.isFinite(summary.at) && Number.isFinite(record.endedAt ?? record.sendAttemptedAt ?? record.queuedAt)) {
      summary.at = record.endedAt ?? record.sendAttemptedAt ?? record.queuedAt;
    }
    if ([...SEND_PROGRESS, "confirmed", "not-sent", "unknown"].includes(record.sendProgress)) summary.sendProgress = record.sendProgress;
    this.pauseEvidence.set(reason, summary);
  }

  pauseSourceSnapshot() {
    return [...this.pauseSources].map(([reason, requestId]) => {
      const record = this.jobs.get(requestId);
      if (record) this.capturePauseEvidence(reason, record);
      return { reason, requestId, ...this.pauseEvidence.get(reason) };
    });
  }

  restorePauseSources(sources = [], records = []) {
    if (!Array.isArray(sources) || sources.length > 4) throw new Error("Invalid queue pause sources");
    for (const source of sources) {
      if (!source || !this.pauseReasons.has(source.reason) || typeof source.requestId !== "string"
        || !source.requestId || source.requestId.length > 256) throw new Error("Invalid queue pause source");
      this.pauseSources.set(source.reason, source.requestId);
      const summary = {};
      if (Number.isFinite(source.at) && source.at >= 0) summary.at = source.at;
      if ([...SEND_PROGRESS, "confirmed", "not-sent", "unknown"].includes(source.sendProgress)) summary.sendProgress = source.sendProgress;
      this.pauseEvidence.set(source.reason, summary);
      const record = records.find(record => record.id === source.requestId);
      if (record) this.capturePauseEvidence(source.reason, record);
    }
  }
}

module.exports = { DEFAULT_REQUEST_SCHEDULING, QUEUE_TIMEOUT_CHOICES, validateRequestScheduling, RequestScheduler };
