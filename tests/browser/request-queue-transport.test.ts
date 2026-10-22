import { test, expect, spyOn } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { queueRequest } from "../../src/browser/request-queue-client";
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../../src/browser/launcher-client";

async function fixture(run: (descriptor: string, requests: Array<{ path: string; body: string }>, setFailure: (kind: string) => void) => Promise<void>) {
  const root = resolve(await mkdtemp(join(tmpdir(), "w2h-poll-transport-")));
  const requests: Array<{ path: string; body: string }> = [];
  let failure = "reset-once";
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url!, body: Buffer.concat(chunks).toString("utf8") });
    if (failure === "reset-always" || failure === "reset-once" && requests.length === 1) { request.socket.destroy(); return; }
    if (failure === "denied") { response.writeHead(403); response.end(JSON.stringify({ error: "Wrong owner", code: "queue_lease_invalid" })); return; }
    if (failure === "invalid-json") { response.writeHead(200); response.end("incomplete{"); return; }
    response.writeHead(200); response.end(JSON.stringify({ record: { state: "running" } }));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const descriptor = join(root, "launcher.json");
  await writeFile(descriptor, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND,
    profile: "development", pid: process.pid, endpoint, control: { endpoint, token: "PRIVATE_TOKEN_".repeat(5) },
    helper: { executable: process.execPath, script: import.meta.path }, partition: "persist:web2harness-dev-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: "launcher_surface_id_0123456789AB", createdAt: new Date().toISOString(),
    surfaceTargets: { launcher_surface_id_0123456789AB: "fixture-target" } }), { mode: 0o600 });
  try { await run(descriptor, requests, kind => { failure = kind; }); }
  finally {
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("w2h-poll-transport-")) throw new Error("Unexpected poll fixture");
    await rm(root, { recursive: true });
  }
}

test("a reset queue poll retries the same owner once without exposing its ticket", async () => {
  const logs: string[] = [], log = spyOn(console, "error").mockImplementation(line => { logs.push(String(line)); });
  try { await fixture(async (descriptor, requests) => {
    const ticket = { id: "owned-job", secret: "PRIVATE_TICKET" };
    expect(await queueRequest<{ record: { state: string } }>(descriptor, "poll", ticket)).toEqual({ record: { state: "running" } });
    expect(requests).toEqual([{ path: "/v1/queue/poll", body: JSON.stringify(ticket) }, { path: "/v1/queue/poll", body: JSON.stringify(ticket) }]);
    expect(logs.join("\n")).toContain("browser.queue_poll_transport_retry");
    expect(logs.join("\n")).not.toContain("PRIVATE");
  }); } finally { log.mockRestore(); }
});

test.each(["send-begin", "send-end", "enqueue", "settle"])("an ambiguous %s transport failure is never replayed", async action => {
  await fixture(async (descriptor, requests) => {
    await expect(queueRequest(descriptor, action, { id: "owned-job", secret: "PRIVATE_TICKET" })).rejects.toBeDefined();
    expect(requests).toHaveLength(1);
  });
});

test.each(["reset-always", "denied", "invalid-json"])("queue poll %s remains a failure with a bounded retry budget", async kind => {
  await fixture(async (descriptor, requests, setFailure) => {
    setFailure(kind);
    const attempt = queueRequest(descriptor, "poll", { id: "owned-job", secret: "PRIVATE_TICKET" });
    if (kind === "denied") await expect(attempt).rejects.toMatchObject({ code: "queue_lease_invalid", retryable: false });
    else await expect(attempt).rejects.toBeDefined();
    expect(requests).toHaveLength(kind === "reset-always" ? 2 : 1);
  });
});
