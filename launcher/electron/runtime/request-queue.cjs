"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { RequestScheduler } = require("../../shared/request-scheduler.cjs");
const { diagnosticReference } = require("../../shared/diagnostic-event.cjs");
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed-out"]);

// One instance in the Launcher that owns the browser partition. No prompt bodies,
// tool arguments, credentials or execution leases are written to the receipt file.
class RequestQueue {
  constructor({ directory, settings, revision = 1, logger, cancelResource, hasResource, isProcessAlive }) {
    this.file = path.join(directory, "request-queue.json");
    this.logger = logger;
    this.cancelResource = cancelResource;
    this.hasResource = hasResource;
    this.isProcessAlive = isProcessAlive ?? (pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } });
    this.owners = new Map();
    this.pages = new Map();
    this.tail = Promise.resolve();
    this.dirty = false;
    this.core = new RequestScheduler({ settings, onEvent: (event, fields) => {
      this.dirty = true;
      this.logger.info(event, { ...fields, ...(fields.groupId ? { groupId: diagnosticReference(fields.groupId) } : {}),
        ...(fields.id ? { requestId: fields.id, traceId: this.owners.get(fields.id)?.traceId } : {}) });
    } });
    this.core.configRevision = revision;
  }

  async start() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (saved.version !== 1 || !Array.isArray(saved.records) || saved.records.length > 4096) throw new Error("Invalid queue receipts");
      this.core.restoreMcpStatus(saved.mcpStatus);
      for (const reason of saved.pauseReasons ?? []) this.core.pause(reason);
      if (saved.pendingSend === true) this.core.pause("send_outcome_unknown");
      this.core.restorePauseSources(saved.pauseSources);
      if (Number.isFinite(saved.lastSendAt)) this.core.lastSendAt = performance.now() - Math.max(0, Date.now() - saved.lastSendAt);
      for (const record of saved.records) {
        if (typeof record.id !== "string" || typeof record.groupId !== "string" || !Number.isFinite(record.queuedAt)
          || !Number.isFinite(record.deadlineAt) || typeof record.model !== "string") throw new Error("Invalid queue receipt");
        const endedAt = record.endedAt ?? Date.now();
        if (Date.now() - endedAt >= this.core.receiptTtlMs) continue;
        this.core.jobs.set(record.id, { ...record, bytes: 0,
          state: TERMINAL.has(record.state) ? record.state : "failed",
          reason: TERMINAL.has(record.state) ? record.reason : "runtime_restarted_outcome_unknown",
          endedAt, endedMonotonic: performance.now() - Math.max(0, Date.now() - endedAt),
          queuedMonotonic: performance.now() - Math.max(0, Date.now() - record.queuedAt),
          ...(record.startedAt ? { startedMonotonic: performance.now() - Math.max(0, Date.now() - record.startedAt) } : {}),
        });
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.dirty = true;
    await this.persist();
    this.timer = setInterval(() => { void this.serial(async () => {
      this.core.tick();
      for (const [id, owner] of this.owners) {
        const job = this.core.get(id);
        if (!job) { this.owners.delete(id); continue; }
        if (TERMINAL.has(job.state)) continue;
        if (!this.isProcessAlive(owner.pid) || Date.now() - owner.seenAt > 45_000) {
          this.core.cancel(id);
          if (this.hasResource(owner.traceId)) this.stopResource(owner);
          if (!this.hasResource(owner.traceId) && this.core.lease(id)) this.core.settle(id, this.core.lease(id), "cancelled", "owner_disconnected");
        }
      }
      await this.persist();
    }).catch(error => { this.core.pause("browser_unavailable"); this.logger.error("queue.host_failed", { message: String(error) }); }); }, 1000);
    this.timer.unref?.();
    return this;
  }

  serial(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  async whileIdle(operation) {
    await this.serial(() => {
      const snapshot = this.snapshot();
      if (this.admissionBlocked || snapshot.active || snapshot.waiting) {
        throw new Error("Retry when tasks are idle (no active or queued tasks) / 请等待执行与排队任务结束后重试");
      }
      this.admissionBlocked = true;
    });
    try { return await operation(); }
    finally { await this.serial(() => { this.admissionBlocked = false; }); }
  }
  stopResource(owner) {
    if (owner.stoppingResource) return;
    owner.stoppingResource = true;
    // Cleanup may call queue.settle. Never await it while holding the queue mutation lock.
    void Promise.resolve().then(() => this.cancelResource(owner.traceId)).catch(error => {
      this.logger.error("queue.cancel_resource_failed", { traceId: owner.traceId, message: String(error) });
      owner.stoppingResource = false;
    });
  }
  async persist() {
    if (!this.dirty) return;
    const text = JSON.stringify({ version: 1, pauseReasons: [...this.core.pauseReasons],
      pauseSources: [...this.core.pauseSources].map(([reason, requestId]) => ({ reason, requestId })), pendingSend: Boolean(this.core.sendOwner),
      mcpStatus: this.core.mcpStatus(),
      lastSendAt: this.core.lastSendAt === undefined ? undefined : Date.now() - (performance.now() - this.core.lastSendAt),
      records: [...this.core.jobs.values()].map(job => this.core.view(job)) });
    this.dirty = false;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.file);
    } catch (error) { this.dirty = true; this.core.pause("browser_unavailable"); throw error; }
  }

  request(action, input) { return this.serial(async () => {
    if (!input || typeof input !== "object") throw new Error("Invalid queue request");
    let result;
    if (action === "enqueue") {
      if (this.admissionBlocked) throw Object.assign(new Error("Context budgets are being updated / 正在更新上下文预算，请稍后重试"), { code: "queue_configuration_busy" });
      if (!Number.isSafeInteger(input.pid) || input.pid < 1 || !/^[A-Za-z0-9_-]{6,128}$/.test(input.traceId)) throw new Error("Invalid queue owner");
      if (!/^[a-f0-9]{64}$/.test(input.job?.id)) throw new Error("Invalid request identity");
      const existing = this.core.get(input.job.id);
      const previous = this.owners.get(input.job.id);
      if (existing && (!previous || previous.pid !== input.pid || previous.traceId !== input.traceId)) {
        throw Object.assign(new Error("This request already has a receipt; it cannot be submitted again"), { code: "queue_request_replayed" });
      }
      const record = this.core.enqueue(input.job);
      const owner = previous ?? { pid: input.pid, traceId: input.traceId, secret: randomUUID(), seenAt: Date.now() };
      this.owners.set(input.job.id, owner);
      if (!previous) this.logger.info("queue.owner_registered", { requestId: input.job.id, traceId: owner.traceId, groupId: diagnosticReference(input.job.groupId) });
      result = { record, secret: owner.secret };
    } else {
      const owner = this.owners.get(input.id);
      if (!owner || typeof input.secret !== "string" || input.secret !== owner.secret) throw new Error("Queue owner is unavailable");
      owner.seenAt = Date.now();
      const lease = this.core.lease(input.id);
      if (action === "poll") result = { record: this.core.get(input.id) };
      else if (action === "cancel") result = this.core.cancel(input.id);
      else if (action === "phase") result = this.core.setPhase(input.id, lease, input.phase);
      else if (action === "send-begin") result = this.core.beginSend(input.id, lease);
      else if (action === "send-end") result = this.core.endSend(input.id, lease, input.permit, input.outcome) ?? { acknowledged: true };
      else if (action === "settle") {
        if (this.hasResource(owner.traceId)) throw new Error("Browser resources have not been released");
        if (input.reason === "rate_limit_exceeded") this.core.pause("account_rate_limited", input.id);
        result = lease ? this.core.settle(input.id, lease, input.outcome, input.reason, input.remote) : this.core.cancel(input.id);
      } else throw new Error("Unknown queue action");
    }
    await this.persist();
    return result;
  }); }

  snapshot() { return { ...this.core.snapshot(), groups: [...new Set([...this.core.jobs.values()].map(job => job.groupId))] }; }
  assertAdmission(traceId) {
    const admitted = [...this.owners].some(([id, owner]) => owner.traceId === traceId
      && ["preparing", "running", "waiting-user", "waiting-tools"].includes(this.core.get(id)?.state));
    if (!admitted) throw Object.assign(new Error("Browser turn has no active queue admission"), { code: "queue_admission_required" });
  }
  query(input = {}) {
    const { snapshotId, ...query } = input;
    const key = JSON.stringify({ ...query, offset: 0 });
    let page = snapshotId ? this.pages.get(snapshotId) : null;
    if (snapshotId && (!page || page.key !== key || Date.now() - page.at > 300_000)) throw new Error("Queue view expired; refresh the list");
    if (!page) {
      const initial = this.core.query({ ...query, limit: query.limit ?? 50, offset: 0 });
      const items = [];
      for (let offset = 0; offset < initial.total; offset += 100) items.push(...this.core.query({ ...query, limit: 100, offset }).items);
      page = { key, at: Date.now(), items, groups: initial.groups, id: randomUUID() };
      this.pages.set(page.id, page);
      while (this.pages.size > 16) this.pages.delete(this.pages.keys().next().value);
    }
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    this.core.query({ ...query, limit, offset }); // validate even when replaying a snapshot
    return { items: page.items.slice(offset, offset + limit).map(row => this.core.get(row.id) ?? row),
      total: page.items.length, groups: page.groups, limit, offset, snapshotId: page.id };
  }
  updateSettings(settings, revision) { return this.serial(async () => {
    this.core.updateSettings(settings); this.core.configRevision = revision; await this.persist(); return this.snapshot();
  }); }
  control(action, id) { return this.serial(async () => {
    if (action === "pause") this.core.pause();
    else if (action === "resume") this.core.resume();
    else if (action === "recover") {
      if (this.core.active().length || [...this.owners.values()].some(owner => this.hasResource(owner.traceId))) {
        throw new Error("Stop active tasks and release their browser resources before confirming recovery");
      }
      // Explicit operator confirmation never replays old receipts or changes their outcomes.
      for (const reason of [...this.core.pauseReasons]) this.core.resume(reason);
    }
    else if (action === "cancel" || action === "cancel-waiting" || action === "cancel-all") {
      const ids = action === "cancel" ? [id] : [...this.core.jobs.values()]
        .filter(job => action === "cancel-all" ? !TERMINAL.has(job.state) : job.state === "queued").map(job => job.id);
      for (const jobId of ids) {
        this.core.cancel(jobId);
        const owner = this.owners.get(jobId);
        if (owner && this.hasResource(owner.traceId)) this.stopResource(owner);
      }
    } else throw new Error("Invalid queue operation");
    await this.persist(); return this.snapshot();
  }); }
  async close() { clearInterval(this.timer); return this.serial(async () => { this.core.close(); await this.persist(); }); }
}
module.exports = { RequestQueue };
