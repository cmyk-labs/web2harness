import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLicenseFixture } from "../tests/fixtures/license-fixture";

if (process.env.GITHUB_REF?.startsWith("refs/tags/")) throw new Error("Never use test signing keys for a release");
const directory = mkdtempSync(join(tmpdir(), "web2harness-test-package-"));
try {
  const fixture = await createLicenseFixture(directory);
  const child = Bun.spawn([process.execPath, "run", "--cwd", "launcher", "package"], {
    env: { ...process.env, WEB2HARNESS_PACKAGE_TEST: "1", WEB2HARNESS_LICENSE_KEYS_FILE: fixture.keyFile },
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Test packaging failed (${code})`);
} finally { rmSync(directory, { recursive: true, force: true }); }
