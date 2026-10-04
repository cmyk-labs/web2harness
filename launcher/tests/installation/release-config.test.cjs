const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { configuredRepository, normalizeRepository, repositoryUrl } = require("../../electron/installation/release-config.cjs");
const { createUpdateController, validateReleaseAssetUrl } = require("../../electron/installation/update.cjs");

test("release identity comes only from explicit configuration or packaged metadata", () => {
  assert.equal(configuredRepository({ env: {}, manifest: {} }), null);
  assert.equal(repositoryUrl({ env: {}, manifest: {} }), null);
  assert.equal(configuredRepository({ env: {}, manifest: { web2harnessRepository: "fixture-owner/web2harness" } }), "fixture-owner/web2harness");
  assert.equal(repositoryUrl({ env: { WEB2HARNESS_REPOSITORY: " fixture-owner/web2harness " }, manifest: {} }), "https://github.com/fixture-owner/web2harness");
  assert.equal(configuredRepository({ env: { WEB2HARNESS_REPOSITORY: "" }, manifest: { web2harnessRepository: "fixture-owner/web2harness" } }), null);
  for (const repository of [undefined, "", "../web2harness", "owner/..", "https://github.com/owner/web2harness", "owner/repo/issues", "owner/repo?x=1", "owner/repo#x"]) {
    assert.equal(normalizeRepository(repository), null, String(repository));
  }
});

test("unconfigured or invalid update repositories fail closed without network or worker actions", async () => {
  for (const repository of [null, "", "../web2harness", "https://example.com"]) {
    let calls = 0;
    const controller = createUpdateController({
      currentVersion: "6.0.0", platform: "win32", arch: "x64", packaged: true, repository,
      dependencies: {
        fetchRelease: async () => { calls++; throw new Error("network must stay unused"); },
        spawnWorker: () => { calls++; throw new Error("worker must stay unused"); },
      },
    });
    assert.deepEqual(await controller.checkOnce(), { status: "disabled" });
    await assert.rejects(controller.beginInstall(), /No launcher update/);
    assert.equal(calls, 0);
  }
});

test("update asset URLs cannot switch repository or smuggle URL authority fields", () => {
  const repository = "fixture-owner/web2harness";
  const asset = "web2harness-6.0.1-win-x64.exe";
  const url = `https://github.com/${repository}/releases/download/v6.0.1/${asset}`;
  assert.equal(validateReleaseAssetUrl(url, "6.0.1", asset, repository), url);
  assert.throws(() => validateReleaseAssetUrl(url, "6.0.1", asset, null), /not configured/);
  for (const invalid of [url.replace("fixture-owner", "other-owner"), `${url}?redirect=elsewhere`, `${url}#fragment`, url.replace("github.com/", "github.com:444/"), url.replace("github.com/", "name@github.com/")]) {
    assert.throws(() => validateReleaseAssetUrl(invalid, "6.0.1", asset, repository), /unexpected release asset URL/);
  }
});

test("Windows installer exits before networking or filesystem mutation without a release repository", {
  skip: process.platform !== "win32" ? "Windows PowerShell installer" : false,
}, () => {
  const installer = path.resolve(__dirname, "../../../scripts/install-launcher.ps1");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    $env:WEB2HARNESS_REPOSITORY = ''
    function Invoke-RestMethod { throw 'NETWORK_REACHED' }
    function Invoke-WebRequest { throw 'NETWORK_REACHED' }
    function New-Item { throw 'WRITE_REACHED' }
    & '${installer.replaceAll("'", "''")}'
  `], { encoding: "utf8", timeout: 15_000, windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /releases are not configured/);
  assert.doesNotMatch(result.stderr, /NETWORK_REACHED|WRITE_REACHED/);
});

const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
test("POSIX installers parse and reject unpublished repositories before any install action", {
  skip: !fs.existsSync(shell) ? "POSIX shell unavailable" : false,
}, () => {
  for (const basename of ["install.sh", "install-launcher.sh"]) {
    const installer = path.resolve(__dirname, "../../../scripts", basename);
    const syntax = spawnSync(shell, ["-n", installer], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    assert.equal(syntax.status, 0, syntax.stderr);
    for (const repository of ["", "../web2harness"]) {
      const result = spawnSync(shell, [installer], {
        env: { ...process.env, WEB2HARNESS_REPOSITORY: repository },
        encoding: "utf8", timeout: 10_000, windowsHide: true,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, repository ? /Invalid GitHub repository/ : /releases are not configured/);
    }
  }
});

test("release metadata uses the project repository and desktop install paths do not overwrite the CLI", () => {
  const root = path.resolve(__dirname, "../../..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.repository.url, "https://github.com/cmyk-labs/web2harness.git");
  assert.equal(manifest.homepage, "https://github.com/cmyk-labs/web2harness");
  assert.equal(manifest.bugs.url, "https://github.com/cmyk-labs/web2harness/issues");
  const launcher = JSON.parse(fs.readFileSync(path.join(root, "launcher/package.json"), "utf8"));
  assert.equal(launcher.repository.url, manifest.repository.url);
  assert.equal(repositoryUrl({ env: {}, manifest: launcher }), manifest.homepage);
  const desktopInstaller = fs.readFileSync(path.join(root, "scripts/install-launcher.sh"), "utf8");
  const cliInstaller = fs.readFileSync(path.join(root, "scripts/install.sh"), "utf8");
  assert.match(desktopInstaller, /LIB_DIR="\$\{WEB2HARNESS_DESKTOP_LIB_DIR:-\$HOME\/\.local\/lib\/web2harness-desktop\}"/);
  assert.match(desktopInstaller, /WRAPPER="\$BIN_DIR\/web2harness-desktop"/);
  assert.match(cliInstaller, /LIB_DIR="\$\{WEB2HARNESS_LIB_DIR:-\$HOME\/\.local\/lib\/web2harness\}"/);
  for (const installer of [desktopInstaller, cliInstaller]) {
    assert.match(installer, /REPOSITORY="\$\{WEB2HARNESS_REPOSITORY:-\}"/);
    assert.ok(installer.indexOf("releases are not configured") < installer.indexOf("curl "));
  }
  const packager = fs.readFileSync(path.join(root, "launcher/scripts/package.cjs"), "utf8");
  assert.match(packager, /--config\.extraMetadata\.web2harnessRepository=/);
  const release = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
  assert.match(release, /WEB2HARNESS_REPOSITORY: \$\{\{ github\.repository \}\}/);
});
