const fs = require("node:fs");
const path = require("node:path");
const { writePrivateFileAtomic } = require("../electron/common/atomic-file.cjs");
const RETENTION_MS = 7 * 86400000;
const MAX_ENTRIES = 2000;
const MODELS = new Set(["gpt-6-pro", "gpt-5.6-pro", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-luna", "pro-unknown", "other"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "unknown"]);
const PURPOSES = new Set(["task", "tool-result", "compaction", "unknown"]);
const PLANS = new Set(["pro_100", "pro_200", "unsupported"]);
const isTime = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
function validReceipt(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof value.id === "string" && value.id.length > 0 && Buffer.byteLength(value.id) <= 256
    && /^[a-f0-9]{64}$/i.test(value.accountKey) && MODELS.has(value.model) && isTime(value.at)
    && (value.plan === undefined || PLANS.has(value.plan))
    && (value.effort === undefined || EFFORTS.has(value.effort))
    && (value.purpose === undefined || PURPOSES.has(value.purpose));
}
function receiptFields(value) {
  if (!validReceipt(value)) throw new Error("Invalid usage receipt");
  return { id: value.id, accountKey: value.accountKey.toLowerCase(), model: value.model, at: value.at,
    ...(value.plan !== undefined ? { plan: value.plan } : {}),
    effort: value.effort ?? "unknown", purpose: value.purpose ?? "unknown" };
}
function usageOutboxDirectory(descriptorPath) { return path.join(path.dirname(path.resolve(descriptorPath)), "usage-outbox"); }
// One immutable owner/id per file; state advances pending -> accepted. No prompts or credentials.
class UsageOutbox {
  constructor(directory) { this.directory = path.resolve(directory); }
  file(id) { if (!validId(id)) throw new Error("Invalid usage outbox id"); return path.join(this.directory, id + ".json"); }
  ensure() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(this.directory).isDirectory() || fs.lstatSync(this.directory).isSymbolicLink()) throw new Error("Unsafe usage outbox directory");
  }
  write(entry) {
    this.ensure();
    const file = this.file(entry.id);
    if (fs.existsSync(file)) {
      const existing = this.read(entry.id);
      if (existing.state === "accepted" && entry.state !== "accepted") throw new Error("Usage receipt cannot move backwards");
    } else if (fs.readdirSync(this.directory).filter(name => name.endsWith(".json")).length >= MAX_ENTRIES) {
      throw new Error("Usage outbox capacity reached");
    }
    const safe = { version: 1, id: entry.id, state: entry.state, at: entry.at,
      ...(entry.receipt ? { receipt: receiptFields(entry.receipt) } : {}),
      ...(entry.trackingError ? { trackingError: entry.trackingError } : {}) };
    this.validate(safe);
    writePrivateFileAtomic(file, JSON.stringify(safe) + "\n");
  }
  validate(entry) {
    if (!entry || entry.version !== 1 || !validId(entry.id) || !isTime(entry.at)
      || !["pending", "accepted"].includes(entry.state)
      || (entry.receipt !== undefined && (!validReceipt(entry.receipt) || entry.receipt.id !== entry.id))
      || (entry.trackingError !== undefined && entry.trackingError !== "account-unavailable")
      || (entry.state === "accepted" && ((entry.receipt !== undefined) === (entry.trackingError !== undefined)))) throw new Error("Invalid usage outbox entry");
  }
  read(id) {
    const file = this.file(id), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error("Unsafe usage outbox entry");
    const entry = JSON.parse(fs.readFileSync(file, "utf8")); this.validate(entry);
    if (entry.id !== id) throw new Error("Usage outbox identity mismatch");
    return entry;
  }
  entries() {
    if (!fs.existsSync(this.directory)) return { entries: [], errors: 0 };
    this.ensure();
    const names = fs.readdirSync(this.directory).filter(name => name.endsWith(".json"));
    if (names.length > MAX_ENTRIES) throw new Error("Usage outbox capacity exceeded");
    const entries = []; let errors = 0;
    for (const name of names) {
      try { entries.push(this.read(name.slice(0, -5))); } catch { errors++; }
    }
    return { entries: entries.sort((a, b) => a.at - b.at), errors };
  }
  remove(id) {
    try { this.read(id); fs.unlinkSync(this.file(id)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
module.exports = { UsageOutbox, usageOutboxDirectory, validReceipt, receiptFields, EFFORTS, PURPOSES, RETENTION_MS };
