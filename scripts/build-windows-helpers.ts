import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform === "win32") {
  const output = resolve(import.meta.dir, "../launcher/build/uninstall");
  mkdirSync(output, { recursive: true });
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/platform/windows/uninstall.ts")],
    target: "bun", format: "cjs", minify: true, outdir: output, naming: "uninstall.cjs",
  });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join("; "));
  const setup = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/platform/windows/install.ts")],
    target: "bun", format: "cjs", minify: true, outdir: output, naming: "install.cjs",
  });
  if (!setup.success) throw new Error(setup.logs.map(log => log.message).join("; "));
  // Run the shared setup/deployment tests with the exact runtime shipped in NSIS.
  // Node-only tests do not cover Bun filesystem compatibility (e.g. cpSync).
  const regression = Bun.spawnSync([
    resolve(import.meta.dir, "../launcher/build/runtime/runtime/bun.exe"), "test",
    "./launcher/tests/installation/windows-install.test.cjs", "./launcher/tests/installation/runtime-install.test.cjs",
  ], { cwd: resolve(import.meta.dir, ".."), stdout: "inherit", stderr: "inherit" });
  if (regression.exitCode !== 0) throw new Error("Embedded Bun installation regression failed; package creation stopped");
  console.log(`Built and checked independent Windows setup helpers: ${output}`);
}
