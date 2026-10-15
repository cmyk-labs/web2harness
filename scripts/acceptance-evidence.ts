import { createHash } from "node:crypto";
import { readFileSync, realpathSync, existsSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { candidateIdentity, type CandidateIdentity } from "../launcher/shared/candidate-identity.cjs";
import { acceptanceErrors, inspectAcceptanceV2 } from "./acceptance/checker";
import { REQUIRED_CASES } from "./acceptance/catalog";
export { REQUIRED_CASES } from "./acceptance/catalog";
export { inspectAcceptanceV2 } from "./acceptance/checker";

export const LIVE_CASES = new Set(["CAP-001", "CAP-002", "CAP-003", "CAP-004", "CAP-005", "CAP-006", "CAP-008", "CAP-009",
  "Q01", "Q02", "Q03", "Q04", "Q05", "Q07", "Q08", "Q12", "Q13", "Q14", "Q15"]);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function checkAcceptance(manifest: unknown, candidate: CandidateIdentity, evidenceRoot: string): string[] {
  if ((manifest as { schemaVersion?: unknown } | null)?.schemaVersion === 2) return acceptanceErrors(inspectAcceptanceV2(manifest, candidate, evidenceRoot));
  const errors: string[] = [];
  if (!manifest || typeof manifest !== "object") return ["Invalid acceptance manifest"];
  const data = manifest as Record<string, any>;
  if (data.schemaVersion !== 1) errors.push("Unsupported acceptance schema");
  if (data.candidate?.sourceId !== candidate.sourceId || data.candidate?.version !== candidate.version) errors.push("Candidate source identity/version mismatch");
  if (!Array.isArray(data.results)) return [...errors, "Missing results"];
  const root = realpathSync(evidenceRoot);
  for (const id of REQUIRED_CASES) {
    const attempts = data.results.filter((entry: any) => entry?.caseId === id);
    if (!attempts.length) { errors.push(`${id}: no evidence`); continue; }
    const numbers = new Set<number>();
    for (const entry of attempts) {
      if (!Number.isSafeInteger(entry.attempt) || entry.attempt < 1 || numbers.has(entry.attempt)) errors.push(`${id}: invalid/duplicate attempt`);
      numbers.add(entry.attempt);
    }
    const latest = [...attempts].sort((a, b) => b.attempt - a.attempt)[0];
    if (latest.status !== "pass") { errors.push(`${id}: latest attempt is ${latest.status ?? "not-run"}`); continue; }
    if (latest.sourceId !== candidate.sourceId) errors.push(`${id}: stale source evidence`);
    if (LIVE_CASES.has(id) && latest.layer !== "authenticated-dev" && latest.layer !== "native-package") errors.push(`${id}: authenticated evidence is required`);
    if (!["fixture", "authenticated-dev", "native-package"].includes(latest.layer)
      || !["native-tools", "automatic-mcp", "manual-mcp", "mixed", "not-applicable"].includes(latest.mode)
      || !["model", "effort", "platform", "actor"].every(key => typeof latest[key] === "string" && latest[key].trim())
      || !Number.isFinite(Date.parse(latest.at))) errors.push(`${id}: incomplete execution metadata`);
    if (!Array.isArray(latest.evidence) || !latest.evidence.length) { errors.push(`${id}: missing evidence files`); continue; }
    for (const item of latest.evidence) {
      try {
        if (typeof item.path !== "string" || isAbsolute(item.path) || item.path.split(/[\\/]/).includes("..")) throw new Error("path");
        const path = resolve(root, item.path);
        const rel = relative(root, realpathSync(path));
        if (!rel || rel.startsWith("..") || isAbsolute(rel) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("path");
        if (hash(readFileSync(path)) !== item.sha256) throw new Error("hash");
        // Receipts are redacted, human-reviewed JSON, not private raw logs.
        const receipt = JSON.parse(readFileSync(path, "utf8"));
        if (receipt.sourceId !== candidate.sourceId || !Array.isArray(receipt.cases) || !receipt.cases.includes(id)
          || receipt.status !== "pass" || receipt.layer !== latest.layer) throw new Error("receipt");
        if (latest.layer !== "fixture" && (receipt.loadedSourceId !== candidate.sourceId
          || !/^[a-f0-9]{64}$/.test(receipt.runtimeSha256 ?? ""))) throw new Error("loaded runtime identity");
        if (typeof receipt.summary !== "string" || !receipt.summary.trim()) throw new Error("summary");
      } catch { errors.push(`${id}: invalid evidence path, hash, receipt or loaded runtime identity`); }
    }
  }
  return errors;
}

if (import.meta.main) {
  const [command, file] = process.argv.slice(2);
  const candidate = candidateIdentity(resolve(import.meta.dir, ".."));
  if (command === "snapshot" && file) {
    writeFileSync(resolve(file), `${JSON.stringify(candidate, null, 2)}\n`);
    console.log(`Candidate ${candidate.sourceId}; ${candidate.files.length} files`);
  } else if ((command === "check" || command === "report") && file) {
    if (!existsSync(file)) throw new Error("Current candidate acceptance manifest is required before publication");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (command === "report") {
      if (manifest.schemaVersion !== 2) throw new Error("Detailed coverage reports require schemaVersion 2");
      const report = inspectAcceptanceV2(manifest, candidate, dirname(resolve(file)));
      console.log(JSON.stringify(report, null, 2));
      if (report.errors.length) process.exitCode = 1;
    } else {
      const errors = checkAcceptance(manifest, candidate, dirname(resolve(file)));
      if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
      else console.log(`Acceptance evidence matches ${candidate.sourceId}`);
    }
  } else throw new Error("Usage: bun run scripts/acceptance-evidence.ts snapshot <output.json> | check|report <manifest.json>");
}
