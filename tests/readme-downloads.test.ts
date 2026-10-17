import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { releaseDownloadLinks, syncReadmeDownloads, updateReadmeDownloads, type DownloadRelease } from "../scripts/update-readme-downloads";

const repository = "cmyk-labs/web2harness";
function release(): DownloadRelease {
  return {
    tag_name: "v3.1.0", draft: false, prerelease: false,
    assets: ["win-x64.exe", "mac-arm64.dmg", "linux-x64.AppImage"].map((suffix) => ({
      name: `web2harness-3.1.0-${suffix}`, state: "uploaded", size: 123,
      browser_download_url: `https://github.com/${repository}/releases/download/v3.1.0/web2harness-3.1.0-${suffix}`,
    })),
  };
}
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(dirname(realpathSync(root))).toBe(realpathSync(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("both real READMEs preserve prose, artwork, formatting and all unrelated links", () => {
  const links = releaseDownloadLinks(release(), repository);
  const buttonUrl = /(?<=<a href=")[^"]+(?="><img src="assets\/readme\/download-(?:windows|macos|linux)\.svg")/g;
  for (const name of ["README.md", "README.zh-CN.md"]) {
    const source = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    const updated = updateReadmeDownloads(source, links);
    expect(updated.replace(buttonUrl, "BUTTON_URL")).toBe(source.replace(buttonUrl, "BUTTON_URL"));
    expect([...updated.matchAll(buttonUrl)].map(([url]) => url)).toEqual([links.windows, links.macos, links.linux]);
    expect(updateReadmeDownloads(updated, links)).toBe(updated);
  }
});

test("preview, draft and non-version releases cannot replace stable downloads", () => {
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: "v3.1.0-rc.1" }, { tag_name: "latest" }]) {
    expect(() => releaseDownloadLinks({ ...release(), ...change }, repository)).toThrow("published stable");
  }
});

test("an omitted architecture or duplicate installer is rejected", () => {
  const missing = release();
  missing.assets.splice(1, 1);
  expect(() => releaseDownloadLinks(missing, repository)).toThrow("mac-arm64.dmg");
  const duplicate = release();
  duplicate.assets.push({ ...duplicate.assets[0]! });
  expect(() => releaseDownloadLinks(duplicate, repository)).toThrow("win-x64.exe");
});

test("unavailable, empty, foreign or wrong-version assets cannot become download links", () => {
  for (const change of [
    { state: "starter" }, { size: 0 },
    { browser_download_url: "https://example.com/installer.exe" },
    { browser_download_url: `https://github.com/${repository}/releases/download/v3.0.0/web2harness-3.0.0-win-x64.exe` },
  ]) {
    const invalid = release();
    Object.assign(invalid.assets[0]!, change);
    expect(() => releaseDownloadLinks(invalid, repository)).toThrow("invalid published installer");
  }
});

test("a malformed second README leaves both files unchanged", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "web2harness-download-links-"));
  roots.push(root);
  const source = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  writeFileSync(join(root, "README.md"), source);
  writeFileSync(join(root, "README.zh-CN.md"), "missing buttons\r\n");
  expect(() => syncReadmeDownloads(root, release(), repository)).toThrow("download button");
  expect(readFileSync(join(root, "README.md"), "utf8")).toBe(source);
  expect(readFileSync(join(root, "README.zh-CN.md"), "utf8")).toBe("missing buttons\r\n");
  writeFileSync(join(root, "README.zh-CN.md"), source);
  expect(syncReadmeDownloads(root, release(), repository)).toEqual(["README.md", "README.zh-CN.md"]);
  expect(syncReadmeDownloads(root, release(), repository)).toEqual([]);
});
