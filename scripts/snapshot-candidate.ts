import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { candidateIdentity } from "../launcher/shared/candidate-identity.cjs";

// Build provenance only; capability acceptance is reviewed by the maintainer.
const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) throw new Error("Usage: bun run scripts/snapshot-candidate.ts <output.json>");
const candidate = candidateIdentity(resolve(import.meta.dir, ".."));
writeFileSync(resolve(file), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(`Candidate ${candidate.sourceId}; ${candidate.files.length} files`);
