import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";

export function isDevelopmentArtifact(file: string): boolean {
  const name = basename(file);
  if (/^(?:licen[cs]e|copying|copyright|notice)(?:[.-]|$)/i.test(name)) return false;
  return /\.d\.(?:ts|mts|cts)$/.test(name)
    || /\.(?:js|cjs|mjs|ts|cts|mts)\.map$/.test(name)
    || /^(?:readme|changelog|history)(?:\.(?:md|markdown|txt))?$/i.test(name);
}

/** Apply only to newly built staging dependencies, never the checkout's node_modules. */
export function pruneRuntimeDevelopmentFiles(dependencies: string): { files: number; bytes: number } {
  const root = realpathSync(dependencies);
  const removed = { files: 0, bytes: 0 };
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      // Do not traverse package-manager links; a runtime tree must be relocatable.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(target); continue; }
      if (!isDevelopmentArtifact(entry.name)) continue;
      const suffix = relative(root, realpathSync(target));
      if (!suffix || isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) {
        throw new Error("Runtime distribution entry escapes staging dependencies");
      }
      const size = lstatSync(target).size;
      rmSync(target);
      removed.files++;
      removed.bytes += size;
    }
  };
  visit(root);
  return removed;
}
