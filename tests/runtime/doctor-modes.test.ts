import { expect, test } from "bun:test";
import { join } from "node:path";

test("doctor distinguishes native tools from browser-only without requiring a tunnel", async () => {
  const result = Bun.spawn([process.execPath, join(import.meta.dir, "../fixtures/doctor-modes.ts")], {
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited,
  ]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("doctor modes verified");
}, 15_000);
