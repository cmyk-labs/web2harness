import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageDelivery } from "../../../../src/adapters/chatgpt-web/browser/usage-delivery";
import { UsageOutbox, usageOutboxDirectory } from "../../../../launcher/shared/usage-receipts.cjs";

test("receipt-only retry retains one ID and accepts duplicate ACK without a second submission", async () => {
  const root = mkdtempSync(join(tmpdir(), "w2h-usage-retry-"));
  try {
    const descriptorPath = join(root, "launcher.json"), ids: string[] = [];
    const delivery = createUsageDelivery({ descriptorPath, traceId: "fixture", model: "gpt-6-sol", effort: "high", purpose: "tool-result",
      identity: { accountKey: "a".repeat(64), plan: "unsupported" },
      notify: async (_path, activity) => { if (activity.phase !== "usage") throw new Error("unexpected operation"); ids.push(activity.receipt!.id);
        if (ids.length < 3) throw new Error("ACK lost"); return { usageStatus: "duplicate" }; } });
    delivery.activate(); const queue = new UsageOutbox(usageOutboxDirectory(descriptorPath)); expect(queue.entries().entries[0]!.state).toBe("pending");
    await delivery.submitted(); await delivery.submitted();
    expect(ids.length).toBe(3); expect(new Set(ids).size).toBe(1); expect(queue.entries().entries).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("failed delivery keeps accepted evidence for restart replay and never fabricates identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "w2h-usage-pending-"));
  try {
    const descriptorPath = join(root, "launcher.json");
    const delivery = createUsageDelivery({ descriptorPath, traceId: "fixture", model: "pro-unknown", effort: "max", purpose: "compaction", notify: async () => { throw new Error("offline"); } });
    delivery.activate(); await delivery.submitted();
    const [entry] = new UsageOutbox(usageOutboxDirectory(descriptorPath)).entries().entries;
    expect(entry!.state).toBe("accepted"); expect(entry!.trackingError).toBe("account-unavailable"); expect(entry!.receipt).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
