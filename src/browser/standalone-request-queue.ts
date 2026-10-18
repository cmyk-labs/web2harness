import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_REQUEST_SCHEDULING, RequestScheduler, validateRequestScheduling,
  type QueueInput, type QueuePhase, type QueueRecord, type QueuePauseReason,
  type RequestSchedulingSettings, type McpQueueStatus, type McpQueueOutcome,
} from "../../launcher/shared/request-scheduler.cjs";
import { ChatGptWebAdapterError } from "../adapters/chatgpt-web/adapter-error";
import type { QueueTicket, RequestQueueTransport } from "./request-queue-client";
import type { Server } from "node:http";
import { startStandaloneQueueBridge, readStandaloneQueueDescriptor, standaloneQueueCall, queueProfileId,
  type StandaloneQueueDescriptor, type StandaloneQueuePeer } from "./standalone-queue-transport";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed-out"]);
const RECEIPT_TTL_MS = 24 * 60 * 60_000;
const hosts = new Map<string, Promise<StandaloneRequestQueue | StandaloneQueueClient>>();
type Outcome = "succeeded" | "failed" | "cancelled";
type Owner = StandaloneQueueDescriptor;
interface Receipts {
  version: 1;
  settings: RequestSchedulingSettings;
  pauseReasons: QueuePauseReason[];
  pauseSources?: Array<{ reason: QueuePauseReason; requestId: string }>;
  lastSendAt?: number;
  pendingSend: boolean;
  records: QueueRecord[];
  mcpStatus?: McpQueueStatus[];
}

function failure(code: string, message: string): Error {
  return new ChatGptWebAdapterError(message, { status: 503, errorType: "server_error", code, retryable: false });
}

/** Real paths prevent aliases/junctions and Windows path casing from creating new pools. */
export function standaloneQueueDirectory(storageStatePath: string): string {
  const absolute = resolve(storageStatePath);
  const canonical = existsSync(absolute) ? realpathSync.native(absolute)
    : join(realpathSync.native(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
  return `${process.platform === "win32" ? canonical.toLowerCase() : canonical}.request-queue`;
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  // Keep failed write evidence; never replace an existing receipt with a partial file.
  await rename(temporary, file);
}

async function readReceipts(directory: string): Promise<Receipts> {
  let text: string;
  try {
    const handle = await open(join(directory, "receipts.json"), "r");
    try {
      if ((await handle.stat()).size > 8 * 1024 * 1024) throw new Error("Queue receipts exceed their size bound");
      text = await handle.readFile("utf8");
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {
      version: 1, settings: { ...DEFAULT_REQUEST_SCHEDULING }, pauseReasons: [], pendingSend: false, records: [],
    };
    throw error;
  }
  const value = JSON.parse(text) as Receipts;
  if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 4096
    || !Array.isArray(value.pauseReasons) || typeof value.pendingSend !== "boolean"
    || (value.lastSendAt !== undefined && !Number.isFinite(value.lastSendAt))) throw new Error("Invalid queue receipts");
  validateRequestScheduling(value.settings);
  for (const reason of value.pauseReasons) {
    if (!["user", "account_rate_limited", "browser_unavailable", "send_outcome_unknown"].includes(reason)) throw new Error("Invalid queue pause reason");
  }
  const ids = new Set<string>();
  for (const row of value.records) {
    if (!row || !/^[a-f0-9]{64}$/.test(row.id) || ids.has(row.id)
      || !["queued", "preparing", "running", "waiting-user", "waiting-tools", "stopping", ...TERMINAL].includes(row.state)
      || !Number.isFinite(row.queuedAt) || !Number.isFinite(row.deadlineAt)
      || (row.endedAt !== undefined && !Number.isFinite(row.endedAt))
      || [row.groupId, row.model, row.mode].some(field => typeof field !== "string" || field.length > 256)) throw new Error("Invalid queue receipt");
    ids.add(row.id);
  }
  return value;
}

/** One resource ledger for every managed worker using this profile, including remote CLI processes.
 * Other processes join the owner over authenticated loopback; they never launch a second scheduler.
 * A stale lock is never expired by PID/heartbeat alone: Chrome may outlive its owner.
 */
export class StandaloneRequestQueue implements RequestQueueTransport {
  readonly directory: string;
  private readonly owner: Owner;
  private readonly core: RequestScheduler;
  private readonly records = new Map<string, QueueRecord>();
  private readonly tickets = new Map<string, { secret: string; traceId: string; pid: number; clientId?: string; seenAt: number; remoteResource?: boolean }>();
  private readonly resources = new Map<string, Set<() => boolean>>();
  private tail: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private server?: Server;
  private dirty = true;
  private mutationVersion = 0;
  private closed = false;
  private lastSendAt?: number;
  private lastSendMonotonic?: number;
  private pendingSend = false;

  private constructor(directory: string, saved: Receipts, owner: Owner) {
    this.directory = directory;
    this.owner = owner;
    for (const row of saved.records) {
      if (!TERMINAL.has(row.state)) throw failure("queue_recovery_required", "Unfinished standalone receipts require explicit browser queue recovery");
      if (Date.now() - (row.endedAt ?? row.queuedAt) < RECEIPT_TTL_MS) this.records.set(row.id, row);
    }
    this.lastSendAt = saved.lastSendAt;
    if (saved.lastSendAt !== undefined) this.lastSendMonotonic = performance.now() - Math.max(0, Date.now() - saved.lastSendAt);
    this.pendingSend = saved.pendingSend;
    this.core = new RequestScheduler({ settings: saved.settings, onEvent: (_event, fields) => {
      this.dirty = true; this.mutationVersion++;
      if (fields.id) {
        const { pausedReason: _pause, ...record } = fields;
        this.records.set(fields.id, record as QueueRecord);
      }
    } });
    this.core.restoreMcpStatus(saved.mcpStatus);
    for (const reason of saved.pauseReasons) this.core.pause(reason);
    if (saved.pendingSend) this.core.pause("send_outcome_unknown");
    this.core.restorePauseSources(saved.pauseSources);
  }

  static async open(storageStatePath: string): Promise<StandaloneRequestQueue> {
    const directory = standaloneQueueDirectory(storageStatePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (existsSync(join(directory, "recovery.lock"))) throw failure("queue_recovery_in_progress", "Standalone queue recovery is in progress");
    let lock;
    try { lock = await open(join(directory, "owner.json"), "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw failure("queue_host_conflict", "This managed Chrome profile already has a queue owner. Stop its runtime normally; after a crash, stop its owned browser and use browser queue recover --confirm-browser-stopped.");
    }
    const owner: Owner = { version: 1, pid: process.pid, generation: randomUUID(), token: randomUUID() };
    let bridge: Awaited<ReturnType<typeof startStandaloneQueueBridge>> | undefined;
    try {
      await lock.writeFile(JSON.stringify(owner)); await lock.sync();
      if (existsSync(join(directory, "recovery.lock"))) throw failure("queue_recovery_in_progress", "Standalone queue recovery is in progress");
      const host = new StandaloneRequestQueue(directory, await readReceipts(directory), owner);
      bridge = await startStandaloneQueueBridge({ directory, owner,
        request: (action, body, peer) => host.request(action, body, peer),
      });
      host.server = bridge.server;
      owner.endpoint = bridge.endpoint;
      await host.persist();
      await lock.truncate(0); await lock.write(JSON.stringify(owner), 0, "utf8"); await lock.sync();
      host.timer = setInterval(() => { void host.serial(async () => {
        host.core.tick();
        for (const [id, ticket] of host.tickets) {
          if (!ticket.clientId || TERMINAL.has(host.core.get(id)?.state ?? "failed")) continue;
          if (!processAlive(ticket.pid) || Date.now() - ticket.seenAt > 45_000) {
            // A dead client can leave Chrome running. Fence dispatch and retain its physical lease.
            if (ticket.remoteResource) host.core.pause("browser_unavailable");
            host.core.cancel(id);
            const lease = host.core.lease(id);
            if (lease && !ticket.remoteResource) host.core.settle(id, lease, "cancelled", "owner_disconnected");
          }
        }
        await host.persist();
      }).catch(() => { host.core.pause("browser_unavailable"); }); }, 500);
      host.timer.unref?.();
      return host;
    } catch (error) {
      bridge?.server.close();
      // No resource or ticket can exist before open returns. Release only our own startup lock.
      await lock.close();
      const observed = JSON.parse(await readFile(join(directory, "owner.json"), "utf8")) as Owner;
      if (observed.generation === owner.generation) await unlink(join(directory, "owner.json"));
      throw error;
    } finally { await lock.close(); }
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action); this.tail = next.catch(() => {}); return next;
  }

  private prune(): void {
    for (const [id, record] of this.records) {
      if (TERMINAL.has(record.state) && Date.now() - (record.endedAt ?? record.queuedAt) >= RECEIPT_TTL_MS) {
        this.records.delete(id); this.tickets.delete(id); this.resources.delete(id); this.dirty = true; this.mutationVersion++;
      }
    }
  }

  private async persist(): Promise<void> {
    this.prune();
    if (!this.dirty) return;
    const snapshot = this.core.snapshot();
    const version = this.mutationVersion;
    try {
      await atomicJson(join(this.directory, "receipts.json"), {
        version: 1, settings: snapshot.settings, pauseReasons: snapshot.pauseReasons,
        pauseSources: snapshot.pauseSources,
        mcpStatus: snapshot.mcpStatus,
        lastSendAt: this.lastSendAt, pendingSend: this.pendingSend, records: [...this.records.values()],
      } satisfies Receipts);
      this.dirty = this.mutationVersion !== version;
    } catch (error) { this.core.pause("browser_unavailable"); throw error; }
  }

  private authenticate(ticket: QueueTicket, peer?: StandaloneQueuePeer): void {
    if (!ticket || this.closed || this.tickets.get(ticket.id)?.secret !== ticket.secret || !ticket.secret) {
      throw failure("queue_owner_unavailable", "Standalone queue ticket is stale or unavailable");
    }
    const owner = this.tickets.get(ticket.id)!;
    if (owner.clientId !== peer?.clientId || (peer && owner.pid !== peer.pid)) throw failure("queue_owner_unavailable", "Standalone queue ticket belongs to another process");
    owner.seenAt = Date.now();
  }

  /** Claim before asynchronous page acquisition; the guard remains until physical release. */
  async holdResource(ticket: QueueTicket, isReleased: () => boolean): Promise<void> {
    this.authenticate(ticket);
    if (!["preparing", "running", "waiting-user", "waiting-tools"].includes(this.core.get(ticket.id)?.state ?? "")) {
      throw failure("queue_admission_required", "Managed browser resource has no active queue admission");
    }
    const guards = this.resources.get(ticket.id) ?? new Set();
    guards.add(isReleased); this.resources.set(ticket.id, guards);
  }

  private hasResource(id: string): boolean {
    return this.tickets.get(id)?.remoteResource === true || [...(this.resources.get(id) ?? [])].some(released => !released());
  }

  request<T>(action: string, body: unknown, peer?: StandaloneQueuePeer): Promise<T> { return this.serial(async () => {
    if (this.closed || !body || typeof body !== "object") throw failure("queue_unavailable", "Standalone queue is unavailable");
    const input = body as QueueTicket & { job: QueueInput; pid: number; traceId: string; phase: QueuePhase;
      permit: string; outcome: Outcome | "confirmed" | "not-sent" | "unknown"; reason?: string; resourcesReleased?: boolean; remote?: McpQueueOutcome };
    let result: unknown;
    if (action === "cancel-client" && peer) {
      for (const [id, owner] of this.tickets) if (owner.clientId === peer.clientId && owner.pid === peer.pid) this.core.cancel(id);
      await this.persist(); return { acknowledged: true } as T;
    }
    if (action === "enqueue") {
      this.prune();
      if (input.pid !== (peer?.pid ?? process.pid) || !/^[A-Za-z0-9_-]{6,128}$/.test(input.traceId)
        || !/^[a-f0-9]{64}$/.test(input.job?.id)) throw new Error("Invalid standalone queue owner");
      if (this.records.has(input.job.id)) throw failure("queue_request_replayed", "This request already has a standalone queue receipt; it cannot execute again");
      if (this.records.size >= 4096) throw failure("scheduler_overloaded", "Standalone queue receipt capacity has been reached");
      const record = this.core.enqueue(input.job);
      const secret = randomUUID(); this.tickets.set(input.job.id, { secret, traceId: input.traceId,
        pid: input.pid, clientId: peer?.clientId, seenAt: Date.now() });
      result = { record, secret };
    } else {
      this.authenticate(input, peer);
      const lease = this.core.lease(input.id)!;
      if (action === "poll") result = { record: this.core.get(input.id) };
      else if (action === "cancel") result = this.core.cancel(input.id);
      else if (action === "resource-acquire" && peer) {
        if (!["preparing", "running", "waiting-user", "waiting-tools"].includes(this.core.get(input.id)?.state ?? "")) {
          throw failure("queue_admission_required", "Managed browser resource has no active queue admission");
        }
        this.tickets.get(input.id)!.remoteResource = true; result = { acknowledged: true };
      } else if (action === "resource-release-failed" && peer) {
        this.core.pause("browser_unavailable"); result = { acknowledged: true };
      }
      else if (action === "phase") result = this.core.setPhase(input.id, lease, input.phase);
      else if (action === "send-begin") {
        const interval = this.core.snapshot().settings.minSendIntervalSeconds * 1000;
        const remaining = this.lastSendMonotonic === undefined ? 0 : this.lastSendMonotonic + interval - performance.now();
        result = remaining > 0 ? { allowed: false, reason: "send_interval", retryAfterMs: remaining }
          : this.core.beginSend(input.id, lease);
        if ((result as { allowed: boolean }).allowed) { this.pendingSend = true; this.dirty = true; }
      } else if (action === "send-end") {
        this.core.endSend(input.id, lease, input.permit, input.outcome as "confirmed" | "not-sent" | "unknown");
        this.pendingSend = false;
        if (input.outcome !== "not-sent") { this.lastSendAt = Date.now(); this.lastSendMonotonic = performance.now(); }
        result = { acknowledged: true };
      } else if (action === "settle") {
        if (peer && input.resourcesReleased === true) this.tickets.get(input.id)!.remoteResource = false;
        if (this.hasResource(input.id)) {
          this.core.pause("browser_unavailable"); await this.persist();
          throw failure("queue_resource_not_released", "Managed browser resources have not been physically released");
        }
        if (input.reason === "rate_limit_exceeded") this.core.pause("account_rate_limited", input.id);
        if (this.pendingSend && this.core.get(input.id)?.sendAttemptedAt && !this.core.get(input.id)?.sendConfirmedAt) {
          this.lastSendAt = Date.now(); this.lastSendMonotonic = performance.now();
        }
        result = lease ? this.core.settle(input.id, lease, input.outcome as Outcome, input.reason, input.remote) : this.core.cancel(input.id);
        // If settlement found an unacknowledged send, keep the durable uncertainty marker.
        this.resources.delete(input.id);
      } else throw new Error("Unknown standalone queue action");
    }
    await this.persist();
    return result as T;
  }); }

  snapshot() { return this.core.snapshot(); }
  cancelAll(): Promise<void> { return this.serial(async () => {
    this.core.close(); await this.persist();
  }); }
  updateSettings(settings: RequestSchedulingSettings): Promise<void> { return this.serial(async () => {
    this.core.updateSettings(settings); await this.persist();
  }); }
  async close(): Promise<void> {
    let closeTransport = false;
    await this.serial(async () => {
      if (this.closed) return;
      this.core.close();
      for (const [id] of this.tickets) {
        if (this.hasResource(id)) { await this.persist(); throw failure("queue_resource_not_released", "Standalone browser owner cannot close before physical resource release"); }
        const lease = this.core.lease(id);
        if (lease) this.core.settle(id, lease, "cancelled", "owner_closed");
      }
      await this.persist();
      const owner = JSON.parse(await readFile(join(this.directory, "owner.json"), "utf8")) as Owner;
      if (owner.generation !== this.owner.generation) throw failure("queue_host_conflict", "Standalone queue ownership changed");
      this.closed = true; closeTransport = true; clearInterval(this.timer);
    });
    if (!closeTransport) return;
    // Drain HTTP outside the mutation lock: an in-flight poll may itself need that lock.
    if (this.server) await new Promise<void>((resolve, reject) => {
      this.server!.close(error => error ? reject(error) : resolve());
      this.server!.closeIdleConnections();
    });
    const owner = JSON.parse(await readFile(join(this.directory, "owner.json"), "utf8")) as Owner;
    if (owner.generation !== this.owner.generation) throw failure("queue_host_conflict", "Standalone queue ownership changed during shutdown");
    await unlink(join(this.directory, "owner.json"));
  }
}

/** A joined process retains guards until its pages are physically closed. The owner's
 * remote resource claim is cleared only by this acknowledgement, never by heartbeat expiry.
 */
export class StandaloneQueueClient implements RequestQueueTransport {
  private readonly clientId = randomUUID();
  private readonly guards = new Map<string, { ticket: QueueTicket; released: Set<() => boolean> }>();
  private closed = false;
  private constructor(readonly directory: string, private readonly owner: Owner) {}
  static async connect(directory: string): Promise<StandaloneQueueClient> {
    const owner = await readStandaloneQueueDescriptor(directory);
    if (!processAlive(owner.pid)) throw failure("queue_recovery_required", "The standalone queue owner exited; stop its owned browsers before explicit recovery");
    const client = new StandaloneQueueClient(directory, owner);
    const reply = await client.call<{ generation: string; profileId: string; pid: number }>("hello", {});
    if (reply.generation !== owner.generation || reply.profileId !== queueProfileId(directory) || reply.pid !== owner.pid) {
      throw failure("queue_host_conflict", "Standalone queue resource-owner identity does not match this profile");
    }
    return client;
  }
  private call<T>(action: string, body: unknown): Promise<T> {
    if (this.closed) return Promise.reject(failure("queue_owner_unavailable", "Standalone queue client is closed"));
    return standaloneQueueCall(this.owner, this.directory, this.clientId, action, body);
  }
  async request<T>(action: string, body: unknown): Promise<T> {
    if (action === "settle") {
      const ticket = body as QueueTicket;
      if ([...(this.guards.get(ticket.id)?.released ?? [])].some(released => !released())) {
        await this.call("resource-release-failed", ticket);
        throw failure("queue_resource_not_released", "Managed browser resources have not been physically released");
      }
      const result = await this.call<T>(action, { ...ticket, resourcesReleased: true });
      this.guards.delete(ticket.id); return result;
    }
    return this.call<T>(action, body);
  }
  async holdResource(ticket: QueueTicket, isReleased: () => boolean): Promise<void> {
    const resource = this.guards.get(ticket.id) ?? { ticket, released: new Set<() => boolean>() };
    resource.released.add(isReleased); this.guards.set(ticket.id, resource);
    await this.call("resource-acquire", ticket);
  }
  async cancelAll(): Promise<void> { await this.call("cancel-client", {}); }
  async close(): Promise<void> {
    if (this.closed) return;
    await this.cancelAll();
    for (const { ticket } of this.guards.values()) await this.request("settle", { ...ticket, outcome: "cancelled", reason: "owner_closed" });
    this.closed = true;
  }
}

export function getStandaloneRequestQueue(storageStatePath: string): Promise<StandaloneRequestQueue | StandaloneQueueClient> {
  const key = standaloneQueueDirectory(storageStatePath);
  let host = hosts.get(key);
  if (!host) {
    host = StandaloneRequestQueue.open(storageStatePath).catch(async error => {
      if ((error as { code?: string }).code !== "queue_host_conflict") throw error;
      return StandaloneQueueClient.connect(key);
    });
    hosts.set(key, host);
    void host.catch(() => { if (hosts.get(key) === host) hosts.delete(key); });
  }
  return host;
}

export async function cancelStandaloneRequests(): Promise<void> {
  await Promise.all([...hosts.values()].map(async host => (await host).cancelAll()));
}
export async function closeStandaloneRequestQueues(): Promise<void> {
  const results = await Promise.allSettled([...hosts].map(async ([key, opening]) => {
    const host = await opening; await host.close(); if (hosts.get(key) === opening) hosts.delete(key);
  }));
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(r => r.reason);
  if (errors.length) throw new AggregateError(errors, "Standalone request queue shutdown failed");
}

/** Offline recovery is deliberate: PID death cannot prove that a browser stopped.
 * No process is killed; the operator must stop the previously owned browser first.
 */
export async function recoverStandaloneRequestQueue(storageStatePath: string, confirmedBrowserStopped: boolean): Promise<void> {
  if (!confirmedBrowserStopped) throw new Error("Confirm the previous runtime and its managed browser are stopped with --confirm-browser-stopped");
  const directory = standaloneQueueDirectory(storageStatePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const recovery = await open(join(directory, "recovery.lock"), "wx", 0o600);
  try {
    let owner: Owner | undefined;
    try { owner = JSON.parse(await readFile(join(directory, "owner.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (owner && (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || processAlive(owner.pid))) {
      throw failure("queue_host_conflict", "The standalone queue owner is alive or cannot be verified; stop it normally before recovery");
    }
    const saved = await readReceipts(directory);
    saved.records = saved.records.map(row => TERMINAL.has(row.state) ? row : {
      ...row, state: "failed", reason: "runtime_restarted_outcome_unknown", endedAt: Date.now(),
    });
    saved.pendingSend = false; saved.pauseReasons = []; saved.pauseSources = [];
    await atomicJson(join(directory, "receipts.json"), saved);
    if (owner) await unlink(join(directory, "owner.json"));
  } finally { await recovery.close(); await unlink(join(directory, "recovery.lock")); }
}

export async function inspectStandaloneRequestQueue(storageStatePath: string) {
  const directory = standaloneQueueDirectory(storageStatePath);
  return { source: "persisted-receipts", ownerPresent: existsSync(join(directory, "owner.json")), ...await readReceipts(directory) };
}
