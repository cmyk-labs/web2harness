import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";

const isLicense = (name: string) => /^(?:licen[cs]e|copying|copyright|notice)(?:[.-]|$)/i.test(name);
// Audited package-root test suites, not arbitrary directories named "test" inside runtime code.
// Re-audit after a dependency update; unknown versions retain their files.
const TEST_ONLY_PACKAGES: Record<string, string> = {
  "@mixmark-io/domino": "2.2.0", "call-bind-apply-helpers": "1.0.2", "call-bound": "1.0.4",
  "dunder-proto": "1.0.1", "es-define-property": "1.0.1", "es-errors": "1.3.0", "es-object-atoms": "1.1.2",
  "fast-uri": "3.1.8", "function-bind": "1.1.2", "get-intrinsic": "1.3.0", "get-proto": "1.0.1",
  "gopd": "1.2.0", "has-symbols": "1.1.0", "isexe": "2.0.0", "math-intrinsics": "1.1.0",
  "object-inspect": "1.13.4", "qs": "6.16.0", "setprototypeof": "1.2.0", "side-channel": "1.1.1",
  "side-channel-list": "1.0.1", "side-channel-map": "1.0.1", "side-channel-weakmap": "1.0.2",
};

export function isDevelopmentArtifact(file: string): boolean {
  const name = basename(file);
  if (isLicense(name)) return false;
  return /\.d\.(?:ts|mts|cts)$/.test(name)
    || /\.(?:js|cjs|mjs|ts|cts|mts)\.map$/.test(name)
    || /^(?:readme|changelog|history)(?:\.(?:md|markdown|txt))?$/i.test(name);
}

/** Apply only to newly built staging dependencies, never the checkout's node_modules. */
export function pruneRuntimeDevelopmentFiles(dependencies: string): { files: number; bytes: number } {
  const root = realpathSync(dependencies);
  const removed = { files: 0, bytes: 0 };
  const visit = (directory: string, testOnly = false): void => {
    let packageTests = false;
    try {
      if (!testOnly) {
        const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
        packageTests = typeof manifest.name === "string" && typeof manifest.version === "string"
          && Object.hasOwn(TEST_ONLY_PACKAGES, manifest.name) && TEST_ONLY_PACKAGES[manifest.name] === manifest.version;
      }
    } catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      // Do not traverse package-manager links; a runtime tree must be relocatable.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const tests = testOnly || (packageTests && entry.name === "test");
        visit(target, tests);
        if (tests && readdirSync(target).length === 0) rmdirSync(target);
        continue;
      }
      if (isLicense(entry.name) || (!testOnly && !isDevelopmentArtifact(entry.name))) continue;
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
