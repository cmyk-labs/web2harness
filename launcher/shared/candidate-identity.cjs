const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { readFileSync, lstatSync } = require("node:fs");
const { resolve, relative, sep } = require("node:path");

const sha256 = value => createHash("sha256").update(value).digest("hex");
function candidateIdentity(root) {
  root = resolve(root);
  // Include new, non-ignored implementation files. Evidence is excluded to avoid
  // a circular fingerprint when a reviewed receipt is added to the candidate.
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    .split("\0").filter(Boolean).filter(path => /^(src\/|tests\/|scripts\/|launcher\/|docs\/|assets\/|LICENSES\/|\.github\/workflows\/|(?:package\.json|bun\.lock|tsconfig\.json|\.gitattributes|\.gitignore|LICENSE|README(?:\.zh-CN)?\.md|AGENTS(?:\.zh-CN)?\.md)$)/.test(path));
  const files = [...new Set(paths)].sort().flatMap(path => {
    const absolute = resolve(root, path);
    const rel = relative(root, absolute);
    if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Candidate path escapes source checkout");
    let stat;
    try { stat = lstatSync(absolute); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Candidate path must be a regular file: ${path}`);
    const bytes = readFileSync(absolute);
    const textFile = /\.(?:[cm]?[jt]sx?|json|lock|css|html|md|ya?ml|toml|ps1|sh|svg|txt|cts)$/.test(path) || /(?:^|\/)(?:LICENSE|\.gitattributes|\.gitignore)$/.test(path);
    const content = textFile ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;
    return [{ path, sha256: sha256(content) }];
  });
  if (!files.some(file => file.path === "src/cli.ts")) throw new Error("Candidate source checkout is incomplete");
  return { schemaVersion: 1, version: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version,
    sourceId: sha256(`web2harness-candidate-v1\n${JSON.stringify(files)}`),
    // Informational provenance: adding the receipt can create a new commit without changing sourceId.
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim(), files };
}
module.exports = { candidateIdentity };
