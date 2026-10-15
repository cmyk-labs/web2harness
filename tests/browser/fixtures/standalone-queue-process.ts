import { createHash } from "node:crypto";
import { StandaloneRequestQueue, getStandaloneRequestQueue, closeStandaloneRequestQueues } from "../../../src/browser/standalone-request-queue";
import { withQueuedRequest, waitForSendPermit } from "../../../src/browser/request-queue-client";
import { setTimeout as delay } from "node:timers/promises";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const [profile, action] = process.argv.slice(2);
try {
  if (action === "join" || action === "join-crash") {
    const queue = await getStandaloneRequestQueue(profile!);
    await withQueuedRequest({ descriptorPath: queue, traceId: `remote_${process.pid}`,
      job: { id: createHash("sha256").update(`remote-${process.pid}`).digest("hex"), groupId: `remote-${process.pid}`,
        model: "gpt-6-pro", effort: "max", mode: "native-tools", bytes: 64 },
      execute: async (ticket) => {
        let released = false;
        await queue.holdResource(ticket, () => released);
        const permit = await waitForSendPermit(queue, ticket);
        if (action === "join-crash") process.exit(0);
        await appendFile(join(profile!, "..", "events.jsonl"), `${JSON.stringify({ event: "send", pid: process.pid, at: Date.now() })}\n`);
        await queue.request("send-end", { ...ticket, permit, outcome: "confirmed" });
        await delay(100);
        await appendFile(join(profile!, "..", "events.jsonl"), `${JSON.stringify({ event: "release", pid: process.pid, at: Date.now() })}\n`);
        released = true;
        return "done";
      },
    });
    await closeStandaloneRequestQueues();
    process.stdout.write("joined\n");
    process.exit(0);
  }
  const queue = await StandaloneRequestQueue.open(profile!);
  if (action === "crash") {
    const id = createHash("sha256").update("crashed-request").digest("hex");
    const { secret } = await queue.request<{ secret: string }>("enqueue", {
      pid: process.pid, traceId: "crashed_trace", job: { id, groupId: "crash-group", model: "gpt-6", mode: "native-tools", bytes: 10 },
    });
    await queue.request("send-begin", { id, secret });
    // Deliberately exit only this fixture process without shutdown, leaving durable evidence.
    process.exit(0);
  }
  await queue.close();
  process.stdout.write("opened\n");
} catch (error) {
  process.stdout.write(`${(error as { code?: string }).code ?? "unexpected_error"}\n`);
  process.exitCode = 1;
}
