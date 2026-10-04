const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { validateRuntimeBundle } = require("../electron/installation/runtime-install.cjs");

if (process.platform !== "darwin") throw new Error("CLI archive smoke requires a native macOS host");
const launcherRoot = path.resolve(__dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(launcherRoot, "package.json"), "utf8")).version;
const asset = `web2harness-${version}-mac-${process.arch}.zip`;
const archive = path.join(launcherRoot, "artifacts", asset);
const digest = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "web2harness-cli-install-smoke-"));
const installer = path.resolve(launcherRoot, "../scripts/install.sh");
const tools = path.join(scratch, "tools");
const cliRoot = path.join(scratch, "cli");
const binRoot = path.join(scratch, "bin");
const docsRoot = path.join(scratch, "docs");
const home = path.join(scratch, "home");
const temporary = path.join(scratch, "temporary");

try {
  for (const directory of [tools, home, temporary]) fs.mkdirSync(directory);
  // Route only the two expected download URLs to local fixture data. All archive
  // extraction, hash validation, runtime execution and install logic stay real.
  fs.writeFileSync(path.join(tools, "curl"), `#!/bin/sh
set -eu
url=''
destination=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -fsSL) shift ;;
    -o) destination="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) echo 'Unexpected fixture curl argument' >&2; exit 2 ;;
  esac
done
case "$url" in
  "https://github.com/fixture-owner/web2harness/releases/download/v$FIXTURE_VERSION/$FIXTURE_ASSET")
    cp "$FIXTURE_ARCHIVE" "$destination" ;;
  "https://github.com/fixture-owner/web2harness/releases/download/v$FIXTURE_VERSION/checksums.txt")
    printf '%s  %s\\n' "$FIXTURE_DIGEST" "$FIXTURE_ASSET" > "$destination" ;;
  *) echo 'Unexpected fixture download URL' >&2; exit 2 ;;
esac
`, { mode: 0o755 });
  const env = {
    ...process.env, HOME: home, TMPDIR: temporary,
    PATH: `${tools}:${process.env.PATH}`,
    WEB2HARNESS_REPOSITORY: "fixture-owner/web2harness", WEB2HARNESS_VERSION: version,
    WEB2HARNESS_HOME: path.join(home, "core"), CODEX_HOME: path.join(home, "codex"),
    WEB2HARNESS_BIN_DIR: binRoot, WEB2HARNESS_LIB_DIR: cliRoot, WEB2HARNESS_DOC_DIR: docsRoot,
    FIXTURE_ARCHIVE: archive, FIXTURE_ASSET: asset, FIXTURE_DIGEST: digest, FIXTURE_VERSION: version,
  };
  const install = (overrides = {}) => {
    const result = spawnSync("/bin/sh", [installer], { env: { ...env, ...overrides }, cwd: scratch,
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
    assert.ifError(result.error);
    return result;
  };
  const rejected = install({ FIXTURE_DIGEST: "0".repeat(64) });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /SHA-256 verification failed/);
  assert.equal(fs.existsSync(cliRoot), false);
  assert.equal(fs.existsSync(binRoot), false);

  for (let attempt = 0; attempt < 2; attempt++) {
    const installed = install();
    assert.equal(installed.status, 0, installed.stderr);
    const runtime = path.join(cliRoot, version);
    validateRuntimeBundle(runtime, { version, platform: "darwin", arch: process.arch });
    assert.equal(fs.realpathSync(path.join(binRoot, "web2harness")), path.join(runtime, "bin", "web2harness"));
    for (const relative of ["LICENSE", "LICENSES/Bun-1.4.0.md", "THIRD_PARTY_NOTICES.txt"]) {
      assert.deepEqual(fs.readFileSync(path.join(docsRoot, path.basename(relative))), fs.readFileSync(path.join(runtime, relative)));
    }
    assert.deepEqual(fs.readdirSync(cliRoot), [version]);
    assert.equal(fs.existsSync(path.join(home, "Applications")), false);
  }
  const before = fs.readFileSync(path.join(cliRoot, version, "manifest.json"));
  const failedRepair = install({ FIXTURE_DIGEST: "0".repeat(64) });
  assert.notEqual(failedRepair.status, 0);
  assert.deepEqual(fs.readFileSync(path.join(cliRoot, version, "manifest.json")), before);
  console.log(`CLI_DESKTOP_ARCHIVE_SMOKE_OK darwin/${process.arch}: fresh install, repeat install, hash rejection and license preservation`);
} finally {
  assert.equal(path.dirname(fs.realpathSync(scratch)), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(scratch).startsWith("web2harness-cli-install-smoke-"));
  fs.rmSync(scratch, { recursive: true, force: true });
}
