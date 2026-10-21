import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, basename, join } from "node:path";
import { parseDiagnosticLine, type DiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";

test.each(["shutdown", "eof", "abort", "output"])("real helper IPC records %s before diagnostic shutdown and preserves correlation", async action => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "w2h-helper-causality-"));
  const script = join(root, "helper.ts");
  writeFileSync(script, `
    import { ChatGptBrowserWorker } from ${JSON.stringify(new URL("../../../../src/adapters/chatgpt-web/browser/browser-worker.ts", import.meta.url).href)};
    ChatGptBrowserWorker.prototype.run = async function(turn) {
      turn.onHeartbeat();
      return await new Promise((resolve,reject) => turn.abortSignal.addEventListener("abort", () => reject(turn.abortSignal.reason), {once:true}));
    };
    await import(${JSON.stringify(new URL("../../../../src/adapters/chatgpt-web/browser/browser-helper-main.ts", import.meta.url).href)});
  `);
  const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const rows: DiagnosticRecord[] = [], messages: any[] = [];
  createInterface({ input: child.stderr }).on("line", line => { const row = parseDiagnosticLine(line); if (row) rows.push(row); });
  createInterface({ input: child.stdout }).on("line", line => { try { messages.push(JSON.parse(line)); } catch {} });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 500; i++) { if (predicate()) return; if (child.exitCode !== null) break; await Bun.sleep(10); }
    throw new Error(`Fixture helper did not reach expected ${action} state`);
  };
  const requestId = crypto.randomUUID(), attemptId = crypto.randomUUID(), firstEventId = crypto.randomUUID();
  try {
    await wait(() => messages.some(m => m.type === "ready"));
    child.stdin.write(JSON.stringify({ type: "run", id: "causality_fixture", diagnostics: { requestId, attemptId, prompt: "PRIVATE" },
      config: { appName: "Codex DEV", browserHostDescriptorPath: join(root, "unused.json"), turnTimeoutMs: 60000, autoApproveToolCalls: false },
      turn: { traceId: "causality_fixture", modelId: "gpt-6-sol", reasoning: "xhigh", capabilities: { localToolsEnabled: false, solAvailable: true } } }) + "\n");
    await wait(() => messages.some(m => m.event === "heartbeat"));
    if (action === "eof") child.stdin.end();
    else if (action === "shutdown") child.stdin.write('{"type":"shutdown"}\n');
    else if (action === "output") {
      child.stdout.destroy();
      child.stdin.write('{"type":"unsupported","id":"causality_fixture"}\n');
    }
    else {
      child.stdin.write(JSON.stringify({ type: "abort", id: "causality_fixture", interruption: { eventId: firstEventId, firstEventId, origin: "queue_interrupt", at: new Date().toISOString() } }) + "\n");
      await wait(() => messages.some(m => m.type === "error"));
      expect(messages.find(m => m.type === "error").interruption).toMatchObject({ firstEventId, parentEventId: firstEventId });
      child.stdin.write('{"type":"shutdown"}\n');
    }
    await exited;
    // readline close can trail the exit event; wait for the final stderr bytes.
    await Bun.sleep(20);
    expect(rows.find(row => row.event === "browser.helper_turn_bound")?.detail).toMatchObject({ requestId, attemptId });
    const interruption = rows.find(row => row.event === "runtime.interruption_observed")!;
    expect(interruption.detail).toMatchObject({ requestId, attemptId, interruption: {
      origin: action === "eof" ? "helper_input_closed" : action === "shutdown" ? "helper_shutdown_requested"
        : action === "output" ? "helper_output_failure" : "helper_local_abort",
    } });
    if (action === "abort") expect((interruption.detail.interruption as any).firstEventId).toBe(firstEventId);
    if (action === "output") expect(rows.find(row => row.event === "browser.helper_shutdown")?.detail).toMatchObject({
      origin: "helper_output_failure", channel: "protocol", outputFailed: true,
    });
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    expect(child.exitCode).toBe(0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
    expect(dirname(root)).toBe(realpathSync(tmpdir())); expect(basename(root).startsWith("w2h-helper-causality-")).toBe(true);
    rmSync(root, { recursive: true });
  }
}, 15_000);
