import { appendFileSync, writeFileSync } from "node:fs";

type ExistingRelease = { id: number; draft: boolean; prerelease: boolean; immutable?: boolean };

export function planRelease(existing: ExistingRelease | null, forced: boolean, tag: string) {
  if (existing?.immutable) throw new Error("An immutable release cannot be replaced");
  if (existing && !existing.draft && (!existing.prerelease || !forced)) {
    throw new Error("Published releases require a new version; only an explicitly forced preview tag may be replaced");
  }
  return {
    replace: Boolean(existing),
    prerelease: existing?.prerelease ?? tag.includes("-"),
    previousId: existing?.id ?? 0,
  };
}

if (import.meta.main) {
  const { GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: tag, GH_TOKEN: token, GITHUB_OUTPUT: output } = process.env;
  if (!repository || !tag || !token || !output) throw new Error("Missing release workflow environment");
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Release lookup failed: HTTP ${response.status}`);
  const existing = response.status === 404 ? null : await response.json() as ExistingRelease;
  const plan = planRelease(existing, process.env.REPLACE_PREVIEW === "true", tag);
  writeFileSync("previous-release.json", JSON.stringify(existing, null, 2));
  for (const [key, value] of Object.entries(plan)) appendFileSync(output, `${key}=${value}\n`);
  console.log(`Release plan: ${JSON.stringify(plan)}`);
}
