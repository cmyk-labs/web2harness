const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runtimeInvocation } = require("../../electron/runtime/runtime-command.cjs");
const { prepareRuntimeInBackground } = require("../../electron/runtime/runtime-preparation.cjs");
const {
  ensurePackagedRuntime,
  preparePackagedRuntime,
  validateRuntimeBundle,
  waitForPackagedRuntimeSource,
} = require("../../electron/installation/runtime-install.cjs");

test("fresh installation hashes the source and candidate once, then commits without re-reading files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-passes-"));
  const resourcesPath = runtimeFixture(root), coreHome = path.join(root, "home");
  const original = fs.readFileSync, reads = [], progress = [];
  try {
    fs.readFileSync = (file, ...args) => { reads.push(String(file)); return original(file, ...args); };
    const installed = await preparePackagedRuntime({ app: { isPackaged: true, getVersion: () => "0.2.0" },
      coreHome, resourcesPath, onProgress: event => progress.push(event) });
    fs.readFileSync = original;
    const dependency = path.join("app", "node_modules", "zod", "v4", "index.js");
    assert.equal(reads.filter(file => file === path.join(resourcesPath, "runtime", dependency)).length, 1);
    assert.equal(reads.filter(file => file.includes(".tmp-") && file.endsWith(dependency)).length, 1);
    assert.equal(reads.filter(file => file === path.join(installed, dependency)).length, 0);
    assert.ok(progress.some(event => event.reason === "first-install"));
    for (const stage of ["waiting-source", "verifying-source", "copying-runtime", "verifying-copy", "committing-runtime"]) {
      assert.ok(progress.some(event => event.stage === stage && event.status === "completed" && event.elapsedMs >= 0));
    }
    const next = [];
    await preparePackagedRuntime({ app: { isPackaged: true, getVersion: () => "0.2.0" },
      coreHome, resourcesPath, onProgress: event => next.push(event) });
    assert.deepEqual([...new Set(next.map(event => event.stage))], ["checking-installation"]);
    assert.equal(next.at(-1).reason, "verified-installation");
  } finally { fs.readFileSync = original; fs.rmSync(root, { recursive: true, force: true }); }
});

test("access failures do not copy, hash the entire source or replace the installation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-access-"));
  const options = { app: { isPackaged: true, getVersion: () => "0.2.0" },
    resourcesPath: runtimeFixture(root), coreHome: path.join(root, "home") };
  const original = fs.readFileSync, originalCopy = fs.cpSync;
  try {
    const installed = await preparePackagedRuntime(options);
    fs.readFileSync = (file, ...args) => {
      if (String(file) === `${installed}.verified.json`) throw Object.assign(new Error("Access denied"), { code: "EACCES" });
      return original(file, ...args);
    };
    fs.cpSync = () => { throw new Error("Unexpected repair"); };
    await assert.rejects(preparePackagedRuntime(options), { code: "EACCES" });
    assert.equal(original(path.join(installed, "app", "cli.js"), "utf8"), "cli");
  } finally { fs.readFileSync = original; fs.cpSync = originalCopy; fs.rmSync(root, { recursive: true, force: true }); }
});

test("a corrupt source fails after one verification instead of retrying hashes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-hash-fail-"));
  const resourcesPath = runtimeFixture(root);
  const target = path.join(resourcesPath, "runtime", "app", "cli.js");
  fs.writeFileSync(target, "bad");
  const original = fs.readFileSync;
  let reads = 0;
  try {
    fs.readFileSync = (file, ...args) => { if (String(file) === target) reads++; return original(file, ...args); };
    await assert.rejects(waitForPackagedRuntimeSource({ app: { isPackaged: true, getVersion: () => "0.2.0" },
      resourcesPath, timeoutMs: 500, intervalMs: 10 }), /checksum mismatch/);
    assert.equal(reads, 1);
  } finally { fs.readFileSync = original; fs.rmSync(root, { recursive: true, force: true }); }
});

test("receipt commit failure restores the previous runtime and its receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-receipt-"));
  const options = { app: { isPackaged: true, getVersion: () => "0.2.0" },
    resourcesPath: runtimeFixture(root), coreHome: path.join(root, "home") };
  const original = fs.writeFileSync;
  try {
    const installed = await preparePackagedRuntime(options);
    const receipt = fs.readFileSync(`${installed}.verified.json`, "utf8");
    const source = path.join(options.resourcesPath, "runtime");
    fs.writeFileSync(path.join(source, "app", "cli.js"), "updated");
    writeRuntimeManifest(source);
    fs.writeFileSync = (file, ...args) => {
      if (String(file).startsWith(`${installed}.verified.json.tmp-`)) throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
      return original(file, ...args);
    };
    await assert.rejects(preparePackagedRuntime(options), { code: "ENOSPC" });
    assert.equal(fs.readFileSync(path.join(installed, "app", "cli.js"), "utf8"), "cli");
    assert.equal(fs.readFileSync(`${installed}.verified.json`, "utf8"), receipt);
  } finally { fs.writeFileSync = original; fs.rmSync(root, { recursive: true, force: true }); }
});

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function manifestFiles(source) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => comparePaths(left.name, right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(source, absolutePath).split(path.sep).join("/");
      if (relativePath === "manifest.json") continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const content = fs.readFileSync(absolutePath);
      files.push({
        path: relativePath,
        size: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
  };
  visit(source);
  return files.sort((left, right) => comparePaths(left.path, right.path));
}

function bundleIdFor(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function writeRuntimeManifest(source, version = "0.2.0") {
  const files = manifestFiles(source);
  fs.writeFileSync(path.join(source, "manifest.json"), `${JSON.stringify({
    schemaVersion: 2,
    appVersion: version,
    bundleId: bundleIdFor(files),
    bunVersion: "1.4.0",
    platform: process.platform,
    arch: process.arch,
    launcher: `bin/${process.platform === "win32" ? "web2harness.cmd" : "web2harness"}`,
    entrypoint: "app/cli.js",
    playwright: "1.62.0",
    files,
  })}\n`);
}

function runtimeFixture(root, version = "0.2.0") {
  const source = path.join(root, "resources", "runtime");
  const executable = path.join(source, "runtime", process.platform === "win32" ? "bun.exe" : "bun");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.join(source, "app"), { recursive: true });
  fs.writeFileSync(executable, "bun");
  if (process.platform !== "win32") fs.chmodSync(executable, 0o755);
  fs.writeFileSync(path.join(source, "app", "cli.js"), "cli");
  fs.writeFileSync(path.join(source, "app", "browser-helper.cjs"), "helper");
  fs.mkdirSync(path.join(source, "app", "node_modules", "zod", "v4"), { recursive: true });
  fs.writeFileSync(path.join(source, "app", "node_modules", "zod", "v4", "index.js"), "zod-v4");
  if (process.platform !== "win32") {
    fs.mkdirSync(path.join(source, "app", "node_modules", ".bin"), { recursive: true });
    fs.symlinkSync("../zod/v4/index.js", path.join(source, "app", "node_modules", ".bin", "zod-v4"));
  }
  fs.mkdirSync(path.join(source, "app", "node_modules", "nested-dependency", "dist", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(source, "app", "node_modules", "nested-dependency", "dist", "runtime", "worker.js"),
    "nested-worker",
  );
  fs.mkdirSync(path.join(source, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(source, "bin", process.platform === "win32" ? "web2harness.cmd" : "web2harness"),
    "launcher",
  );
  writeRuntimeManifest(source, version);
  return path.join(root, "resources");
}

test("warm startup checks its receipt and four entry files without scanning the dependency tree", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-warm-"));
  const resourcesPath = runtimeFixture(root);
  const options = { app: { isPackaged: true, getVersion: () => "0.2.0" }, coreHome: path.join(root, "core-home"), resourcesPath };
  const originalRead = fs.readFileSync;
  try {
    const installed = await preparePackagedRuntime(options);
    const reads = [];
    fs.readFileSync = (file, ...args) => { reads.push(String(file)); return originalRead(file, ...args); };
    assert.equal(await preparePackagedRuntime(options), installed);
    fs.readFileSync = originalRead;
    const sourceReads = reads.filter(file => file.startsWith(resourcesPath + path.sep));
    assert.deepEqual(sourceReads, [path.join(resourcesPath, "runtime", "manifest.json")]);
    assert.equal(reads.some(file => file.includes(`${path.sep}node_modules${path.sep}`)), false);
    for (const file of ['app/cli.js', 'app/browser-helper.cjs', `runtime/${process.platform === 'win32' ? 'bun.exe' : 'bun'}`,
      `bin/${process.platform === 'win32' ? 'web2harness.cmd' : 'web2harness'}`]) {
      assert.equal(reads.filter(read => read === path.join(installed, ...file.split('/'))).length, 1, file);
    }
    fs.writeFileSync(`${installed}.verified.json`, '{}');
    assert.equal(await preparePackagedRuntime(options), installed, 'legacy/missing receipt gets a complete check');
    assert.equal(JSON.parse(originalRead(`${installed}.verified.json`, 'utf8')).schemaVersion, 1);
    const helper = path.join(installed, "app", "browser-helper.cjs");
    fs.writeFileSync(helper, "broken");
    assert.equal(await preparePackagedRuntime(options), installed);
    assert.equal(originalRead(helper, "utf8"), "helper", "damaged installed code is repaired, not trusted");
    fs.writeFileSync(helper, "broken");
    fs.writeFileSync(path.join(resourcesPath, "runtime", "app", "browser-helper.cjs"), "broken");
    await assert.rejects(preparePackagedRuntime({ ...options, timeoutMs: 0 }), /checksum mismatch/);
  } finally {
    fs.readFileSync = originalRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("background preparation preserves responsiveness and diagnostics detects non-entry corruption", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-worker-"));
  const resourcesPath = runtimeFixture(root);
  const options = { app: { isPackaged: true, getVersion: () => "0.2.0" }, coreHome: path.join(root, "core-home"), resourcesPath };
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  try {
    const installed = await prepareRuntimeInBackground(options);
    assert.ok(ticks > 0, 'the main event loop stays responsive during installation');
    assert.equal(await prepareRuntimeInBackground(options), installed);
    assert.equal(await prepareRuntimeInBackground({ app: { isPackaged: false } }), null);
    assert.equal(await prepareRuntimeInBackground({ app: options.app, verifyRoot: installed }), installed);
    fs.writeFileSync(path.join(installed, 'app', 'node_modules', 'zod', 'v4', 'index.js'), 'damaged');
    // A lightweight start deliberately is not an exhaustive dependency integrity audit.
    assert.equal(await prepareRuntimeInBackground(options), installed);
    await assert.rejects(prepareRuntimeInBackground({ app: options.app, verifyRoot: installed }), /size mismatch|checksum mismatch/);
    assert.equal(fs.existsSync(`${installed}.verified.json`), false, 'failed diagnostics marks repair for next startup');
    assert.equal(await prepareRuntimeInBackground(options), installed);
    assert.equal(fs.readFileSync(path.join(installed, 'app', 'node_modules', 'zod', 'v4', 'index.js'), 'utf8'), 'zod-v4');
  } finally {
    clearInterval(timer);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime is installed once into a durable versioned directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-install-"));
  const resourcesPath = runtimeFixture(root);
  const coreHome = path.join(root, "core-home");
  const app = { isPackaged: true, getVersion: () => "0.2.0" };
  try {
    const installed = ensurePackagedRuntime({ app, coreHome, resourcesPath });
    assert.equal(installed, path.join(coreHome, "versions", `0.2.0-${process.platform}-${process.arch}`));
    assert.equal(fs.readFileSync(path.join(installed, "app", "cli.js"), "utf8"), "cli");
    assert.equal(ensurePackagedRuntime({ app, coreHome, resourcesPath }), installed);

    const invocation = runtimeInvocation({
      app,
      sourceRoot: root,
      installedRuntimeRoot: installed,
      args: ["serve"],
    });
    assert.equal(invocation.cwd, installed);
    assert.equal(invocation.args[0], path.join(installed, "app", "cli.js"));
    assert.equal(invocation.args[1], "serve");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime installation rejects a platform or version mismatch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-mismatch-"));
  const resourcesPath = runtimeFixture(root, "0.1.0");
  try {
    assert.throws(
      () => ensurePackagedRuntime({
        app: { isPackaged: true, getVersion: () => "0.2.0" },
        coreHome: path.join(root, "core-home"),
        resourcesPath,
      }),
      /identity mismatch/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime rejects a missing executable before creating durable state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-missing-"));
  const resourcesPath = runtimeFixture(root);
  const coreHome = path.join(root, "core-home");
  const executable = path.join(
    resourcesPath,
    "runtime",
    "runtime",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  fs.rmSync(executable);
  try {
    assert.throws(
      () => ensurePackagedRuntime({
        app: { isPackaged: true, getVersion: () => "0.2.0" },
        coreHome,
        resourcesPath,
      }),
      /Runtime bundle file is missing/,
    );
    assert.equal(fs.existsSync(coreHome), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const relativePath of [
  ["app", "node_modules", "zod", "v4", "index.js"],
  ["app", "node_modules", "nested-dependency", "dist", "runtime", "worker.js"],
]) {
  test(`packaged runtime rejects a missing nested dependency: ${relativePath.join("/")}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-dependency-"));
    const resourcesPath = runtimeFixture(root);
    const coreHome = path.join(root, "core-home");
    fs.rmSync(path.join(resourcesPath, "runtime", ...relativePath));
    try {
      assert.throws(
        () => ensurePackagedRuntime({
          app: { isPackaged: true, getVersion: () => "0.2.0" },
          coreHome,
          resourcesPath,
        }),
        /Runtime bundle file is missing/,
      );
      assert.equal(fs.existsSync(coreHome), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("packaged runtime rejects same-count content corruption", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-corrupt-"));
  const resourcesPath = runtimeFixture(root);
  const coreHome = path.join(root, "core-home");
  const dependency = path.join(resourcesPath, "runtime", "app", "node_modules", "zod", "v4", "index.js");
  fs.writeFileSync(dependency, "bad-v4");
  try {
    assert.throws(
      () => ensurePackagedRuntime({
        app: { isPackaged: true, getVersion: () => "0.2.0" },
        coreHome,
        resourcesPath,
      }),
      /checksum mismatch/,
    );
    assert.equal(fs.existsSync(coreHome), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime source wait accepts a delayed final dependency within its bound", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-delayed-"));
  const resourcesPath = runtimeFixture(root);
  const delayed = path.join(
    resourcesPath,
    "runtime",
    "app",
    "node_modules",
    "nested-dependency",
    "dist",
    "runtime",
    "worker.js",
  );
  const content = fs.readFileSync(delayed);
  fs.rmSync(delayed);
  const materialize = setTimeout(() => fs.writeFileSync(delayed, content), 40);
  try {
    assert.equal(
      await waitForPackagedRuntimeSource({
        app: { isPackaged: true, getVersion: () => "0.2.0" },
        resourcesPath,
        timeoutMs: 500,
        intervalMs: 10,
      }),
      path.join(resourcesPath, "runtime"),
    );
  } finally {
    clearTimeout(materialize);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime source wait fails closed when materialization exceeds its bound", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-timeout-"));
  const resourcesPath = runtimeFixture(root);
  fs.rmSync(path.join(resourcesPath, "runtime", "app", "node_modules", "zod", "v4", "index.js"));
  try {
    await assert.rejects(
      waitForPackagedRuntimeSource({
        app: { isPackaged: true, getVersion: () => "0.2.0" },
        resourcesPath,
        timeoutMs: 30,
        intervalMs: 5,
      }),
      /did not fully materialize within 30ms.*Runtime bundle file is missing/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime transactionally repairs an incomplete installed bundle", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-repair-"));
  const resourcesPath = runtimeFixture(root);
  const coreHome = path.join(root, "core-home");
  const app = { isPackaged: true, getVersion: () => "0.2.0" };
  try {
    const installed = ensurePackagedRuntime({ app, coreHome, resourcesPath });
    const dependency = path.join(
      installed,
      "app",
      "node_modules",
      "nested-dependency",
      "dist",
      "runtime",
      "worker.js",
    );
    fs.rmSync(dependency);
    fs.writeFileSync(path.join(installed, "corrupt.partial"), "interrupted copy");

    assert.equal(ensurePackagedRuntime({ app, coreHome, resourcesPath }), installed);
    assert.equal(fs.readFileSync(dependency, "utf8"), "nested-worker");
    assert.equal(fs.existsSync(path.join(installed, "corrupt.partial")), false);
    assert.deepEqual(
      fs.readdirSync(path.dirname(installed)).filter(name => name.includes(".previous-") || name.includes(".tmp-")),
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed candidate validation preserves the previous validated runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-preserve-"));
  const resourcesPath = runtimeFixture(root);
  const coreHome = path.join(root, "core-home");
  const app = { isPackaged: true, getVersion: () => "0.2.0" };
  const originalCopy = fs.cpSync;
  try {
    const installed = ensurePackagedRuntime({ app, coreHome, resourcesPath });
    const source = path.join(resourcesPath, "runtime");
    fs.writeFileSync(path.join(source, "app", "cli.js"), "new cli");
    writeRuntimeManifest(source);

    fs.cpSync = (from, to, options) => {
      originalCopy(from, to, options);
      fs.rmSync(path.join(to, "app", "node_modules", "zod", "v4", "index.js"));
    };
    assert.throws(
      () => ensurePackagedRuntime({ app, coreHome, resourcesPath }),
      /Runtime bundle file is missing/,
    );
    assert.equal(fs.readFileSync(path.join(installed, "app", "cli.js"), "utf8"), "cli");
    assert.equal(
      validateRuntimeBundle(installed, {
        version: "0.2.0",
        platform: process.platform,
        arch: process.arch,
      }),
      installed,
    );
    assert.deepEqual(
      fs.readdirSync(path.dirname(installed)).filter(name => name.includes(".previous-") || name.includes(".tmp-")),
      [],
    );
  } finally {
    fs.cpSync = originalCopy;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime replaces stale files when a release is refreshed under the same version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-runtime-refresh-"));
  const resourcesPath = runtimeFixture(root, "0.2.0");
  const coreHome = path.join(root, "core-home");
  const app = { isPackaged: true, getVersion: () => "0.2.0" };
  try {
    const installed = ensurePackagedRuntime({ app, coreHome, resourcesPath });
    fs.writeFileSync(path.join(installed, "old-release-marker"), "old");

    const source = path.join(resourcesPath, "runtime");
    fs.writeFileSync(path.join(source, "app", "cli.js"), "new cli");
    writeRuntimeManifest(source);

    assert.equal(ensurePackagedRuntime({ app, coreHome, resourcesPath }), installed);
    assert.equal(fs.readFileSync(path.join(installed, "app", "cli.js"), "utf8"), "new cli");
    assert.equal(fs.existsSync(path.join(installed, "old-release-marker")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
