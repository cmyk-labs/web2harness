import { expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { cliCommandRequiresLicense } from "../../src/licensing/access";
import { createLicenseFixture } from "../fixtures/license-fixture";

test("CLI admission denies mutations by default and preserves activation/inspection/stop", () => {
  for (const args of [["setup"], ["serve"], ["login"], ["browser", "check"], ["route", "connect"],
    ["service", "start"], ["service", "install"], ["tunnel", "restart"], ["tunnel", "key-import"], ["subagents", "native"], ["future-command"]]) {
    expect(cliCommandRequiresLicense(args[0]!, args.slice(1))).toBe(true);
  }
  for (const args of [["license", "import"], ["status"], ["doctor"], ["service", "stop"], ["service", "cancel-turns"],
    ["tunnel", "stop"], ["route", "disconnect"], ["subagents", "status"], ["hook", "interrupt"], ["dev", "launcher"], ["mcp"]]) {
    expect(cliCommandRequiresLicense(args[0]!, args.slice(1))).toBe(false);
  }
});

test("real CLI rejects unlicensed setup/service/route/browser work before touching the selected home", async () => {
  const root = mkdtempSync(join(tmpdir(), "w2h-license-cli-access-"));
  try {
    const fixture = await createLicenseFixture(join(root, "fixture"));
    const home = join(root, "unused-home");
    const env = { ...process.env, WEB2HARNESS_HOME: home, CODEX_HOME: join(root, "codex"),
      WEB2HARNESS_LICENSE_KEYS_FILE: fixture.keyFile, WEB2HARNESS_LICENSE_FILE: join(root, "missing.w2h") };
    for (const args of [["setup", "--native-tools"], ["serve"], ["login"], ["route", "connect"], ["service", "start"], ["tunnel", "start"], ["browser", "check"]]) {
      const child = Bun.spawn([process.execPath, "run", "src/cli.ts", "--home", home, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [exit, error] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
      expect(exit).toBe(1);
      expect(error).toContain("license: missing");
      expect(existsSync(home)).toBe(false);
      expect(existsSync(join(root, "codex"))).toBe(false);
    }
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("w2h-license-cli-access-")) throw new Error("Unowned test path");
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
