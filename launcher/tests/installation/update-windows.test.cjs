const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { updateWindows } = require("../../electron/installation/update-worker.cjs");
const { buildJob } = require("../../electron/installation/update.cjs");

test("the standalone worker enters main with the current Node or embedded Bun runtime", () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../../electron/installation/update-worker.cjs")], { windowsHide: true });
  assert.equal(result.status, 1, "a missing job must fail, not silently skip the worker entrypoint");
});

test("Windows worker shows localized install progress and restarts exactly once after success", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w2h-update-window-"));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.match(path.basename(root), /^w2h-update-window-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, "installer.exe"), target = path.join(root, "Web2Harness.exe");
  fs.writeFileSync(source, "fixture");
  const job = buildJob({ platform: "win32", version: "1.0.2", assetPath: source, executablePath: target, language: "zh-CN" });
  let started = 0;
  updateWindows(job, (file, args, options) => {
    assert.equal(file, source);
    assert.deepEqual(args, ["/currentuser", "--updated", "/W2HUPDATE", "/W2HLANG=zh-CN"]);
    assert.equal(options.windowsHide, false);
    assert.equal(options.timeout, undefined, "do not terminate a user-visible installer while it is recovering");
    assert.equal(started, 0);
    fs.writeFileSync(target, "installed");
    return { status: 0 };
  }, file => { assert.equal(file, target); started++; });
  assert.equal(started, 1);
  assert.throws(() => updateWindows(job, () => ({ status: 2 }), () => started++), /code 2/);
  assert.throws(() => updateWindows(job, () => ({ error: new Error("launch failed") }), () => started++), /launch failed/);
  assert.equal(started, 1, "failed or cancelled installers do not enter the success restart path");
  const invalidLanguage = buildJob({ platform: "win32", language: "en /S", executablePath: target });
  assert.equal(invalidLanguage.language, "en");
});
