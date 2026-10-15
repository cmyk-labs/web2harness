import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ChatGptWebAdapterError } from "../adapters/chatgpt-web/adapter-error";

export interface StandaloneQueueDescriptor {
  version: 1; pid: number; generation: string; endpoint?: string; token: string;
}
export interface StandaloneQueuePeer { pid: number; clientId: string }
export function queueTransportError(code: string, message: string): Error {
  return new ChatGptWebAdapterError(message, { status: 503, errorType: "server_error", code, retryable: false });
}
export function queueProfileId(directory: string): string { return createHash("sha256").update(directory).digest("hex"); }

/** Owner-only loopback transport. This endpoint accepts scheduling metadata, never prompts or commands. */
export async function startStandaloneQueueBridge(options: {
  directory: string; owner: StandaloneQueueDescriptor;
  request(action: string, body: unknown, peer: StandaloneQueuePeer): Promise<unknown>;
}): Promise<{ server: Server; endpoint: string }> {
  const server = createServer(async (request, response) => {
    try {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${options.owner.token}`);
      if (request.method !== "POST" || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        response.writeHead(403, { connection: "close" }).end(); return;
      }
      if (Number(request.headers["content-length"] ?? 0) > 8192) throw new Error("Queue control body is too large");
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) throw new Error("Queue control body is too large");
        chunks.push(Buffer.from(chunk));
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        generation: string; profileId: string; pid: number; clientId: string; body: unknown;
      };
      if (input.generation !== options.owner.generation || input.profileId !== queueProfileId(options.directory)
        || !Number.isSafeInteger(input.pid) || input.pid < 1 || !/^[a-f0-9-]{36}$/.test(input.clientId)) throw new Error("Invalid queue owner identity");
      const action = request.url?.match(/^\/v1\/queue\/([a-z-]+)$/)?.[1];
      if (!action) throw new Error("Invalid queue control action");
      const result = action === "hello" ? { generation: options.owner.generation, profileId: input.profileId, pid: options.owner.pid }
        : await options.request(action, input.body, { pid: input.pid, clientId: input.clientId });
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json", connection: "close" }).end(JSON.stringify({
        error: error instanceof Error ? error.message : "Standalone queue unavailable",
        code: (error as { code?: string }).code ?? "queue_unavailable",
      }));
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Standalone queue failed to bind loopback");
  server.unref();
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

export async function readStandaloneQueueDescriptor(directory: string): Promise<StandaloneQueueDescriptor> {
  const deadline = Date.now() + 5000;
  for (;;) {
    let owner: StandaloneQueueDescriptor | undefined;
    try { owner = JSON.parse(await readFile(join(directory, "owner.json"), "utf8")); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (owner?.version === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.generation
      && /^[a-f0-9-]{36}$/.test(owner.token) && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(owner.endpoint ?? "")) return owner;
    if (Date.now() >= deadline) throw queueTransportError("queue_host_conflict", "Standalone queue owner descriptor is incomplete; verify its runtime before recovery");
    await delay(25);
  }
}

export async function standaloneQueueCall<T>(owner: StandaloneQueueDescriptor, directory: string, clientId: string, action: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${owner.endpoint}/v1/queue/${action}`, {
      method: "POST", redirect: "error", headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ generation: owner.generation, profileId: queueProfileId(directory), pid: process.pid, clientId, body }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { throw queueTransportError("queue_owner_unavailable", "The standalone queue owner is unreachable; no replacement execution was started. Recover only after its runtime and owned browsers have stopped."); }
  const result = await response.json() as { code?: string; error?: string };
  if (!response.ok) throw queueTransportError(result.code ?? "queue_unavailable", result.error ?? "Standalone queue unavailable");
  return result as T;
}
