const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { collectRuntimeVersions } = require("../../electron/installation/runtime-retention.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w2h-retention-"));
  t.after(() => { assert.ok(path.basename(root).startsWith("w2h-retention-")); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { coreHome: path.join(root, "core"), codexHome: path.join(root, "codex"), appData: path.join(root, "appData") };
  const roots = [];
  for (let i = 1; i <= 5; i++) {
    const version = `1.${i}.0`, directory = path.join(options.coreHome, "versions", `${version}-${process.platform}-${process.arch}`);
    const launcher = `bin/web2harness${process.platform === "win32" ? ".cmd" : ""}`;
    const files = ["app/cli.js", "app/browser-helper.cjs", launcher, `runtime/bun${process.platform === "win32" ? ".exe" : ""}`].sort().map(file => {
      const absolute = path.join(directory, file), data = Buffer.from(file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, data, { mode: 0o700 });
      return { path: file, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    });
    const digest = createHash("sha256");
    for (const file of files) for (const part of [file.path, String(file.size), file.sha256]) digest.update(part).update("\0");
    const manifest = { schemaVersion: 2, appVersion: version, platform: process.platform, arch: process.arch,
      bundleId: digest.digest("hex"), bunVersion: "1.4.0", playwright: "1.62.0", launcher, entrypoint: "app/cli.js", files };
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(directory + ".verified.json", JSON.stringify({ ...manifest, schemaVersion: 1, verifiedAt: `2026-10-0${i}T00:00:00Z` }));
    roots.push(directory);
  }
  return { root, roots, options: { ...options, currentRoot: roots[4] }, run: (references = () => "") => collectRuntimeVersions({ ...options, currentRoot: roots[4] }, { processReferences: references }) };
}

test("keeps current and last verified rollback, removing only owned older bundles", t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.deferred, null); assert.equal(result.removed.length, 3);
  assert.deepEqual(f.roots.map(fs.existsSync), [false, false, false, true, true]);
  assert.equal(fs.existsSync(f.roots[0] + ".verified.json"), false);
});
test("active processes and configuration/recovery references retain additional versions", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.options.coreHome, "codex"));
  fs.writeFileSync(path.join(f.options.coreHome, "codex/integration-journal.recovery.json"), JSON.stringify({ runtime: f.roots[0] }));
  const result = f.run(() => `"${path.join(f.roots[1], "runtime/bun.exe")}" serve`);
  assert.equal(result.removed.length, 1);
  assert.deepEqual(f.roots.map(fs.existsSync), [true, true, false, true, true]);
});
test("a process starting during validation is rechecked before removal", t => {
  const f = fixture(t); let calls = 0;
  const result = f.run(() => ++calls === 1 ? "" : f.roots[2]);
  assert.equal(result.removed.length, 2); assert.equal(fs.existsSync(f.roots[2]), true);
});
test("unavailable inventory, pending installer and interrupted runtime transactions defer deletion", t => {
  const f = fixture(t);
  assert.ok(f.run(() => { throw new Error("unavailable"); }).deferred);
  const transaction = path.join(f.options.appData, "Web2Harness-installations/fixture/setup-transaction");
  fs.mkdirSync(transaction, { recursive: true });
  assert.match(f.run().deferred, /recovery/);
  fs.rmdirSync(transaction);
  fs.mkdirSync(f.roots[0] + ".previous-123-456");
  assert.match(f.run().deferred, /recovery/);
  assert.ok(f.roots.every(fs.existsSync));
});
test("unrecognized content and damaged rollback are retained; the next valid rollback is used", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.roots[0], "user-file.txt"), "preserve");
  fs.writeFileSync(path.join(f.roots[3], "app/cli.js"), "damaged");
  const result = f.run();
  assert.deepEqual(f.roots.map(fs.existsSync), [true, false, true, true, true]);
  assert.equal(result.skipped.length, 2);
});
test("redirected stores and hard-linked files cannot cause unrelated deletion", t => {
  const f = fixture(t);
  const other = path.join(f.root, "unrelated"); fs.mkdirSync(other);
  const external = path.join(other, "keep"); fs.writeFileSync(external, "keep");
  fs.linkSync(external, path.join(f.roots[0], "external"));
  f.run(); assert.equal(fs.readFileSync(external, "utf8"), "keep");
  assert.ok(fs.existsSync(f.roots[0]));
  const linkCore = path.join(f.root, "redirected"); fs.mkdirSync(linkCore);
  fs.symlinkSync(path.join(f.options.coreHome, "versions"), path.join(linkCore, "versions"), process.platform === "win32" ? "junction" : "dir");
  assert.ok(collectRuntimeVersions({ ...f.options, coreHome: linkCore, currentRoot: path.join(linkCore, "versions", path.basename(f.roots[4])) }).deferred);
});

test("legacy bundles without receipts are collected only after full validation", t => {
  const f = fixture(t);
  fs.unlinkSync(f.roots[0] + ".verified.json");
  fs.utimesSync(path.join(f.roots[0], "manifest.json"), new Date("2020-01-01"), new Date("2020-01-01"));
  const result = f.run();
  assert.equal(result.removed.length, 3); assert.equal(fs.existsSync(f.roots[0]), false);
});
test("a stopped service definition protects its referenced runtime", t => {
  const f = fixture(t), definition = path.join(f.root, "daemon.plist");
  fs.writeFileSync(definition, `<string>${path.join(f.roots[0], "runtime/bun")}</string>`);
  const result = collectRuntimeVersions({ ...f.options, serviceDefinitions: [definition] }, { processReferences: () => "" });
  assert.equal(result.removed.length, 2); assert.equal(fs.existsSync(f.roots[0]), true);
});
