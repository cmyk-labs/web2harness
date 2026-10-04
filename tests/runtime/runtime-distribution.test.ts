import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pruneRuntimeDevelopmentFiles } from "../../scripts/runtime-distribution";

test("distribution removes declarations and debug metadata while preserving executable resources and licenses", () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-distribution-"));
  const dependencies = join(root, "node_modules", "fixture");
  mkdirSync(dependencies, { recursive: true });
  const retained = ["index.js", "index.cjs", "dynamic.ts", "package.json", "codec.wasm", "encoder.json", "LICENSE.md", "NOTICE.txt", "COPYING", "data.map"];
  const omitted = ["index.d.ts", "index.d.cts", "index.js.map", "index.d.ts.map", "README.md", "CHANGELOG.md"];
  try {
    for (const name of [...retained, ...omitted]) writeFileSync(join(dependencies, name), name);
    expect(pruneRuntimeDevelopmentFiles(join(root, "node_modules")).files).toBe(omitted.length);
    for (const name of retained) expect(existsSync(join(dependencies, name))).toBe(true);
    for (const name of omitted) expect(existsSync(join(dependencies, name))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
