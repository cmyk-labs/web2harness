import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HandoffDeliveryReceipt } from "./tool-batch-handoff";

/** Task-owned private storage, supplied by the runtime owner, never by an MCP argument. */
export class HandoffDeliveryJournal {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }

  record(receipt: HandoffDeliveryReceipt): void {
    if (!/^round_[0-9a-f-]{36}$/.test(receipt.roundId)) throw new Error("Invalid handoff journal round id");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `${receipt.roundId}.json`);
    const serialized = JSON.stringify(receipt);
    let descriptor: number;
    try { descriptor = openSync(path, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A crash may leave a partial record. Never overwrite it or assume no calls ran.
      if (!existsSync(path) || readFileSync(path, "utf8") !== serialized) throw new Error("Handoff delivery receipt conflicts or is incomplete; execution state is unknown");
      // An earlier full write could still have failed its flush. Retry the flush before
      // treating the receipt as durable; matching bytes alone are not sufficient.
      const existing = openSync(path, "r+");
      try { fsyncSync(existing); } finally { closeSync(existing); }
      this.flushDirectory();
      return;
    }
    try {
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    this.flushDirectory();
    // A record is an intent to deliver, not evidence that Codex executed anything.
    // Recovery must report uncertainty; it must never resubmit commands from this journal.
  }

  private flushDirectory(): void {
    if (process.platform === "win32") return; // Windows does not expose directory fsync via Node.
    const descriptor = openSync(this.directory, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
}
