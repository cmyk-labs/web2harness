import { diagnosticEvent, diagnosticError } from "../../../diagnostics";
import { randomUUID } from "node:crypto";
import { UsageOutbox, usageOutboxDirectory, type UsageReceipt, type UsageOutboxEntry } from "../../../../launcher/shared/usage-receipts.cjs";
import { notifyLauncherTurn, type LauncherTurnActivity } from "../../../browser/launcher-client";

type Identity = Pick<UsageReceipt, "accountKey" | "plan">;
export function createUsageDelivery(options: {
  descriptorPath: string; traceId: string; identity?: Identity;
  model: UsageReceipt["model"]; effort: UsageReceipt["effort"]; purpose: UsageReceipt["purpose"];
  notify?: typeof notifyLauncherTurn; now?: () => number;
}) {
  const id = randomUUID(), outbox = new UsageOutbox(usageOutboxDirectory(options.descriptorPath));
  const now = options.now ?? Date.now, notify = options.notify ?? notifyLauncherTurn;
  const warn = (error?: unknown) => diagnosticEvent("warning", "usage.delivery_gap", { traceId: options.traceId, receiptId: id, message: "Usage receipt could not be confirmed; local accounting may be incomplete", ...(error ? { error: diagnosticError(error) } : {}) });
  let activated = false, submitted = false;
  const persist = (entry: UsageOutboxEntry) => { try { outbox.write(entry); } catch (error) { warn(error); } };
  return {
    activate() {
      if (activated) return;
      activated = true;
      persist({ version: 1, id, state: "pending", at: now() });
    },
    async submitted() {
      if (submitted) return;
      submitted = true;
      const at = now();
      const payload = options.identity ? { receipt: { id, ...options.identity, model: options.model,
        effort: options.effort, purpose: options.purpose, at } } : { trackingError: "account-unavailable" as const };
      persist({ version: 1, id, state: "accepted", at, ...payload });
      diagnosticEvent("info", "usage.submission_accepted", { traceId: options.traceId, receiptId: id, model: options.model, effort: options.effort, purpose: options.purpose, submission: "accepted", accountKnown: Boolean(options.identity) });
      const activity: LauncherTurnActivity = { phase: "usage", traceId: options.traceId, helperPid: process.pid, ...payload };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ack = await notify(options.descriptorPath, activity, 1000);
          if (!["recorded", "duplicate", "gap-recorded"].includes(ack.usageStatus ?? "")) throw new Error("Missing receipt acknowledgement");
          outbox.remove(id);
          diagnosticEvent("info", "usage.receipt_confirmed", { traceId: options.traceId, receiptId: id, receiptStatus: ack.usageStatus, attempt: attempt + 1 });
          return;
        } catch (error) {
          diagnosticEvent("warning", "usage.delivery_retry", { traceId: options.traceId, receiptId: id, attempt: attempt + 1, error: diagnosticError(error) });
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 100));
        }
      }
      // The launcher drains accepted receipts independently of the helper's lifetime/lease.
      warn();
    },
  };
}
