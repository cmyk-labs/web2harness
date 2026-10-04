import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkReleaseAssets, expectedReleaseAssets } from "../scripts/check-release-assets";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(dirname(realpathSync(root))).toBe(realpathSync(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "web2harness-release-assets-"));
  roots.push(root);
  for (const name of expectedReleaseAssets("1.0.0")) writeFileSync(join(root, name), "fixture package");
  return root;
}

test("release accepts all five installers and both macOS update archives", () => {
  expect(() => checkReleaseAssets(fixture(), "1.0.0")).not.toThrow();
});
test("release rejects an omitted updater archive even when manual installers are present", () => {
  const root = fixture();
  unlinkSync(join(root, "web2harness-1.0.0-mac-x64.zip"));
  expect(() => checkReleaseAssets(root, "1.0.0")).toThrow("Missing release assets");
});
test("release rejects auxiliary files and mixed-version packages", () => {
  for (const name of ["LICENSE", "install.sh", "web2harness-linux-arm64.tar.gz", "web2harness-0.9.0-win-x64.exe"]) {
    const root = fixture();
    writeFileSync(join(root, name), "fixture");
    expect(() => checkReleaseAssets(root, "1.0.0")).toThrow("Unexpected release asset");
  }
});
test("release rejects empty artifacts or directories named as an installer", () => {
  for (const directory of [false, true]) {
    const root = fixture();
    const installer = join(root, "web2harness-1.0.0-win-x64.exe");
    unlinkSync(installer);
    if (directory) mkdirSync(installer);
    else writeFileSync(installer, "");
    expect(() => checkReleaseAssets(root, "1.0.0")).toThrow("nonempty regular file");
  }
});
test("release filenames reject path-like versions", () => {
  for (const version of ["../1.0.0", "v1.0.0", "1.0.0/asset"]) {
    expect(() => expectedReleaseAssets(version)).toThrow("Invalid release version");
  }
});
