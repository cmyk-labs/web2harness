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

test("only audited package-root tests are removed, retaining notices and runtime paths", () => {
  const root = mkdtempSync(join(tmpdir(), "web2harness-distribution-tests-"));
  try {
    for (const [name, version] of [["@mixmark-io/domino", "2.2.0"], ["unknown", "1.0.0"], ["qs", "99.0.0"]]) {
      const directory = join(root, ...name.split("/"));
      mkdirSync(join(directory, "test"), { recursive: true });
      mkdirSync(join(directory, "lib", "test"), { recursive: true });
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version }));
      writeFileSync(join(directory, "test", "fixture.json"), "fixture");
      writeFileSync(join(directory, "test", "LICENSE.txt"), "retained");
      writeFileSync(join(directory, "lib", "test", "runtime.js"), "runtime");
    }
    expect(pruneRuntimeDevelopmentFiles(root).files).toBe(1);
    expect(existsSync(join(root, "@mixmark-io/domino/test/fixture.json"))).toBe(false);
    for (const name of ["@mixmark-io/domino", "unknown", "qs"]) {
      expect(existsSync(join(root, name, "test/LICENSE.txt"))).toBe(true);
      expect(existsSync(join(root, name, "lib/test/runtime.js"))).toBe(true);
    }
    expect(existsSync(join(root, "unknown/test/fixture.json"))).toBe(true);
    expect(existsSync(join(root, "qs/test/fixture.json"))).toBe(true);
  } finally { expect(root.startsWith(join(tmpdir(), "web2harness-distribution-tests-"))).toBe(true); rmSync(root, { recursive: true, force: true }); }
});
