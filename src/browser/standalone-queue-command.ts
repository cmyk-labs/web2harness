import { validateRequestScheduling } from "../../launcher/shared/request-scheduler.cjs";
import { inspectStandaloneRequestQueue, recoverStandaloneRequestQueue, StandaloneRequestQueue } from "./standalone-request-queue";

/** Offline commands share the resource lock; they never interrupt another runtime. */
export async function standaloneQueueCommand(storageStatePath: string, args: string[]): Promise<unknown> {
  const [action, ...options] = args;
  if (action === "status" && options.length === 0) return inspectStandaloneRequestQueue(storageStatePath);
  if (action === "recover" && options.length === 1 && options[0] === "--confirm-browser-stopped") {
    await recoverStandaloneRequestQueue(storageStatePath, true);
    return { recovered: true, replayed: false };
  }
  if (action === "configure") {
    const fields = new Map([
      ["--concurrency", "maxConcurrent"], ["--timeout-minutes", "queueTimeoutMinutes"],
      ["--send-interval-seconds", "minSendIntervalSeconds"],
    ]);
    const settings: Record<string, number> = {};
    for (let index = 0; index < options.length; index += 2) {
      const field = fields.get(options[index]!);
      const value = options[index + 1];
      if (!field || field in settings || !value || !/^\d+$/.test(value)) throw new Error("Specify each queue setting exactly once as an integer");
      settings[field] = Number(value);
    }
    const validated = validateRequestScheduling(settings);
    const host = await StandaloneRequestQueue.open(storageStatePath);
    try {
      await host.updateSettings(validated);
      return { saved: true, appliesTo: "next standalone runtime", settings: validated };
    } finally { await host.close(); }
  }
  throw new Error("Browser queue command must be status, configure --concurrency N --timeout-minutes N --send-interval-seconds N, or recover --confirm-browser-stopped (only after the old runtime and its browser have stopped)");
}
