import { stdin } from "node:process";
import { loadConfig } from "../config";
import { interruptActiveTurn } from "../runtime/service";

/** Shared by the regular CLI and the small native Interrupt entry point. */
export async function interruptHookCommand(args: string[]): Promise<void> {
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 32 * 1024) throw new Error("Codex Interrupt hook payload is too large");
    chunks.push(buffer);
  }
  let payload: { hook_event_name?: unknown; session_id?: unknown; turn_id?: unknown };
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Codex Interrupt hook payload is not valid JSON");
  }
  const threadId = typeof payload?.session_id === "string" ? payload.session_id.trim() : "";
  const turnId = typeof payload?.turn_id === "string" ? payload.turn_id.trim() : "";
  if (payload?.hook_event_name !== "Interrupt"
    || !/^[A-Za-z0-9_-]{6,128}$/.test(threadId)
    || !/^[A-Za-z0-9_-]{6,128}$/.test(turnId)) {
    throw new Error("Codex Interrupt hook payload has no valid session_id or turn_id");
  }
  await interruptActiveTurn(loadConfig(), { threadId, turnId });
}
