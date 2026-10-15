import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { withQueuedRequest } from "../../../../src/browser/request-queue-client";
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../../../../src/browser/launcher-client";

const require = createRequire(import.meta.url);
const { RequestQueue } = require("../../../../launcher/electron/runtime/request-queue.cjs");
const { BrowserControlServer } = require("../../../../launcher/electron/control-server.cjs");

test("50 independent HTTP queue clients share four slots, and a cancelled waiter never executes", async () => {
  const root = await mkdtemp(join(tmpdir(), "w2h-http-queue-"));
  const logger = { info() {}, warn() {}, error() {} }, resources = new Set<string>();
  const queue = await new RequestQueue({ directory: root, logger, hasResource: (trace: string) => resources.has(trace),
    cancelResource: async () => {}, settings: { maxConcurrent: 4, queueTimeoutMinutes: 5, minSendIntervalSeconds: 1 } }).start();
  const server = await new BrowserControlServer({ logger, getBrowserHost: () => null, getRequestQueue: () => queue,
    getPreferences: () => ({}), assertLicensed: async () => {} }).start();
  const descriptorPath = join(root, "launcher.json");
  try {
    await writeFile(descriptorPath, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND,
      profile: "development", pid: process.pid, endpoint: server.descriptor().endpoint, control: server.descriptor(),
      helper: { executable: process.execPath, script: import.meta.path }, partition: "persist:web2harness-dev-chatgpt",
      idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: "launcher_surface_id_0123456789AB", createdAt: new Date().toISOString(),
      surfaceTargets: { launcher_surface_id_0123456789AB: "fixture-target" } }), { mode: 0o600 });
    let active = 0, peak = 0, completed = 0;
    const runs = Array.from({ length: 50 }, (_, index) => {
      const traceId = `trace_http_${index}`;
      return withQueuedRequest({ descriptorPath, traceId,
        job: { id: createHash("sha256").update(traceId).digest("hex"), groupId: `session_${index % 7}`,
          model: "gpt-6", mode: "native-tools", bytes: 128 },
        execute: async () => {
          queue.assertAdmission(traceId); resources.add(traceId); active++; peak = Math.max(peak, active);
          try { await delay(30); completed++; return index; }
          finally { active--; resources.delete(traceId); }
        },
      });
    });
    expect(await Promise.all(runs)).toHaveLength(50);
    expect(completed).toBe(50); expect(peak).toBe(4); expect(queue.snapshot().active).toBe(0);
    await queue.control("pause");
    const abort = new AbortController(); let executed = false;
    const waiting = withQueuedRequest({ descriptorPath, traceId: "trace_cancelled_waiter", signal: abort.signal,
      job: { id: createHash("sha256").update("cancelled").digest("hex"), groupId: "cancelled", model: "gpt-6", mode: "native-tools", bytes: 10 },
      execute: async () => { executed = true; },
    });
    const cancelTimer = setTimeout(() => abort.abort(), 30);
    try { await expect(waiting).rejects.toBeDefined(); }
    finally { clearTimeout(cancelTimer); }
    await queue.control("resume");
    expect(executed).toBe(false); expect(queue.snapshot().active).toBe(0);
    expect(queue.query({ state: "ended", limit: 100 }).total).toBe(51);
  } finally {
    await server.close(); await queue.close();
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("w2h-http-queue-")) throw new Error("Unexpected fixture path");
    await rm(root, { recursive: true });
  }
}, 30000);
