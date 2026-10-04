import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export function expectedReleaseAssets(version: string): string[] {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Invalid release version");
  }
  const prefix = `web2harness-${version}`;
  return [
    `${prefix}-win-x64.exe`,
    `${prefix}-mac-arm64.dmg`, `${prefix}-mac-x64.dmg`,
    `${prefix}-mac-arm64.zip`, `${prefix}-mac-x64.zip`,
    `${prefix}-linux-x64.AppImage`, `${prefix}-linux-arm64.AppImage`,
  ];
}

export function checkReleaseAssets(directory: string, version: string): void {
  const expected = new Set(expectedReleaseAssets(version));
  for (const name of readdirSync(directory)) {
    if (!expected.has(name)) throw new Error(`Unexpected release asset: ${name}`);
    const stat = lstatSync(join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
      throw new Error(`Release asset must be a nonempty regular file: ${name}`);
    }
    expected.delete(name);
  }
  if (expected.size) throw new Error(`Missing release assets: ${[...expected].join(", ")}`);
}

if (import.meta.main) {
  const [directory, version] = process.argv.slice(2);
  if (!directory || !version) throw new Error("Usage: check-release-assets.ts <directory> <version>");
  checkReleaseAssets(resolve(directory), version);
  console.log(`RELEASE_ASSETS_OK ${version}: five installers and two macOS update archives`);
}
