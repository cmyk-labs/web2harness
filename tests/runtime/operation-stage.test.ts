import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

test("Bun reports nested and concurrent stage owners over the launcher's dedicated pipe", async () => {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, "web2harness-stage-pipe-"));
  const script = join(root, "fixture.ts");
  writeFileSync(script, `
    import { operationStage, operationStageSync } from ${JSON.stringify(new URL("../../src/runtime/operation-stage.ts", import.meta.url).href)};
    await operationStage("config", () => Promise.all([
      operationStage("download", async () => { await Bun.sleep(10); }),
      operationStage("verification", async () => {}),
    ]));
    operationStageSync("config", () => {});
  `);
  try {
    const child = spawn(process.execPath, [script], { cwd: root,
      env: { ...process.env, WEB2HARNESS_STAGE_PIPE: "1" }, stdio: ["ignore", "pipe", "pipe", "pipe"], windowsHide: true });
    let output = "", errors = "";
    child.stdio[3]!.on("data", chunk => { output += chunk; });
    child.stderr!.on("data", chunk => { errors += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    expect(errors).toBe("");
    expect(code).toBe(0);
    const events = output.trim().split("\n").map(line => JSON.parse(line));
    expect(events).toEqual([
      { type: "stage", event: "begin", id: 1, stage: "config" },
      { type: "stage", event: "begin", id: 2, parentId: 1, stage: "download" },
      { type: "stage", event: "begin", id: 3, parentId: 1, stage: "verification" },
      { type: "stage", event: "end", id: 3 }, { type: "stage", event: "end", id: 2 }, { type: "stage", event: "end", id: 1 },
      { type: "stage", event: "begin", id: 4, stage: "config" }, { type: "stage", event: "end", id: 4 },
    ]);
  } finally {
    expect(dirname(root)).toBe(parent);
    expect(root.split(/[\\/]/).at(-1)).toMatch(/^web2harness-stage-pipe-/);
    rmSync(root, { recursive: true, force: true });
  }
});
