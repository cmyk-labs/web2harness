import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DownloadRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; state: string; size: number; browser_download_url: string }>;
}

const installers = {
  windows: "win-x64.exe",
  macos: "mac-arm64.dmg",
  linux: "linux-x64.AppImage",
} as const;
type DownloadLinks = Record<keyof typeof installers, string>;

export function releaseDownloadLinks(release: DownloadRelease, repository: string): DownloadLinks {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  if (release.draft !== false || release.prerelease !== false || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error("Download buttons require a published stable release");
  }
  const links = {} as DownloadLinks;
  for (const platform of Object.keys(installers) as Array<keyof DownloadLinks>) {
    const name = `web2harness-${release.tag_name.slice(1)}-${installers[platform]}`;
    const matches = release.assets.filter((asset) => asset.name === name);
    const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
    if (matches.length !== 1 || matches[0]!.state !== "uploaded" || !(matches[0]!.size > 0)
      || matches[0]!.browser_download_url !== url) {
      throw new Error(`Missing or invalid published installer: ${name}`);
    }
    links[platform] = url;
  }
  return links;
}

export function updateReadmeDownloads(source: string, links: DownloadLinks): string {
  let result = source;
  for (const platform of Object.keys(installers) as Array<keyof DownloadLinks>) {
    const anchor = new RegExp(`<a href="[^"]*">(?=<img src="assets/readme/download-${platform}\\.svg")`, "g");
    if ([...result.matchAll(anchor)].length !== 1) throw new Error(`Expected one ${platform} download button`);
    result = result.replace(anchor, () => `<a href="${links[platform]}">`);
  }
  return result;
}

export function syncReadmeDownloads(root: string, release: DownloadRelease, repository: string): string[] {
  const links = releaseDownloadLinks(release, repository);
  // Validate both documents before writing either; preserve all bytes outside the button hrefs.
  const updates = ["README.md", "README.zh-CN.md"].map((name) => {
    const path = resolve(root, name);
    const before = readFileSync(path, "utf8");
    return { name, path, before, after: updateReadmeDownloads(before, links) };
  }).filter(({ before, after }) => before !== after);
  for (const { path, after } of updates) writeFileSync(path, after, "utf8");
  return updates.map(({ name }) => name);
}

if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY || "cmyk-labs/web2harness";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "Web2Harness-readme-downloads" };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Latest release lookup failed: HTTP ${response.status}`);
  const release = await response.json() as DownloadRelease;
  const changed = syncReadmeDownloads(process.cwd(), release, repository);
  console.log(`${release.tag_name}: ${changed.length ? `updated ${changed.join(", ")}` : "download links already current"}`);
}
