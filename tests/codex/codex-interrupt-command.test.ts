import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultConfig } from "../../src/config";
import { codexInterruptHookCommand } from "../../src/codex/interrupt-hook";

test("regular CLI and small interrupt entry enforce the same exact-turn control contract", async () => {
  const home = mkdtempSync(join(tmpdir(), "web2harness-interrupt-entry-"));
  const received: unknown[] = [];
  const controlToken = "a".repeat(64);
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    expect(new URL(request.url).pathname).toBe("/admin/interrupt-turn");
    expect(request.headers.get("authorization")).toBe(`Bearer ${controlToken}`);
    received.push(await request.json());
    return Response.json({ status: "ok", cancelled_http_turns: 0, cancelled_browser_turns: 1 });
  } });
  const configPath = join(home, "config.json");
  writeFileSync(configPath, JSON.stringify({ ...defaultConfig("native-tools"), host: "127.0.0.1", port: server.port, controlToken }));
  const saved = readFileSync(configPath);
  async function invoke(entry: string, input: string) {
    const child = Bun.spawn([process.execPath, resolve(entry), "--home", home, "hook", "interrupt"], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, WEB2HARNESS_HOME: home },
    });
    child.stdin.write(input);child.stdin.end();
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    return { exit, stderr };
  }
  try {
    for (const entry of ["src/cli.ts", "src/codex/interrupt-hook-main.ts"]) {
      expect(await invoke(entry, JSON.stringify({ hook_event_name: "Interrupt", session_id: "owned-thread", turn_id: "owned-turn" })))
        .toEqual({ exit: 0, stderr: "" });
    }
    expect(received).toEqual(Array.from({ length: 2 }, () => ({ threadId: "owned-thread", turnId: "owned-turn" })));
    for (const input of ["null", "not json", JSON.stringify({ hook_event_name: "Interrupt", session_id: "owned-thread" }), "x".repeat(32769)]) {
      const result = await invoke("src/codex/interrupt-hook-main.ts", input);
      expect(result.exit).toBe(1);expect(result.stderr).toContain("Codex Interrupt hook payload");
    }
    expect(received).toHaveLength(2);
    expect(readFileSync(configPath)).toEqual(saved);
    const command = codexInterruptHookCommand({ runtimeCommand: [process.execPath, resolve("src/cli.ts")] }, home);
    expect(command).toContain("interrupt-hook-main.ts");
  } finally {
    await server.stop(true);
    rmSync(configPath);rmdirSync(home);
  }
}, 30_000);
