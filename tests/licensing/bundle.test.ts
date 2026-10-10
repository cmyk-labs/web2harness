import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLicenseFixture } from "../fixtures/license-fixture";

test("compiled verification pins its public keys even when the runtime environment supplies different keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "w2h-license-bundle-"));
  try {
    const trusted = await createLicenseFixture(join(root, "trusted"));
    const foreign = await createLicenseFixture(join(root, "foreign"));
    const entry = join(root, "entry.ts");
    writeFileSync(entry, `import {licenseStatus} from ${JSON.stringify(resolve("src/licensing/service.ts"))}; console.log(JSON.stringify(await licenseStatus()));`);
    const result = await Bun.build({ entrypoints: [entry], target: "bun", minify: true, outdir: join(root, "bundle"),
      define: { __WEB2HARNESS_LICENSE_KEYS__: JSON.stringify(trusted.keys) } });
    expect(result.success).toBe(true);
    const bundle = result.outputs[0]!.path;
    const run = async (file: string) => {
      const child = Bun.spawn([process.execPath, bundle], { env: { ...process.env, WEB2HARNESS_LICENSE_KEYS_FILE: foreign.keyFile, WEB2HARNESS_LICENSE_FILE: file }, stdout: "pipe", stderr: "pipe" });
      const status = JSON.parse(await new Response(child.stdout).text());
      expect(await child.exited).toBe(0);
      return status.state;
    };
    expect(await run(trusted.licenseFile)).toBe("active");
    expect(await run(foreign.licenseFile)).toBe("invalid");
    expect(readFileSync(bundle, "utf8")).not.toContain("issued-records.jsonl");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
