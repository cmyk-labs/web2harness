import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { candidateIdentity } from "../launcher/shared/candidate-identity.cjs";
import { checkAcceptance, REQUIRED_CASES, LIVE_CASES } from "../scripts/acceptance-evidence";

test("candidate includes untracked source and is stable across line endings and receipt commits", () => {
  const root = mkdtempSync(join(tmpdir(), "w2h-candidate-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
    git("init");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), '{"version":"1.0.0"}\n');
    writeFileSync(join(root, "src/cli.ts"), "export const answer = 1;\n");
    git("add", "package.json", "src/cli.ts");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
    const initial = candidateIdentity(root);
    writeFileSync(join(root, "src/cli.ts"), "export const answer = 1;\r\n");
    expect(candidateIdentity(root).sourceId).toBe(initial.sourceId);
    mkdirSync(join(root, ".github/acceptance"), { recursive: true });
    writeFileSync(join(root, ".github/acceptance/current.json"), "{}");
    expect(candidateIdentity(root).sourceId).toBe(initial.sourceId);
    writeFileSync(join(root, "src/new.ts"), "export const added = true;");
    const changed = candidateIdentity(root);
    expect(changed.sourceId).not.toBe(initial.sourceId);
    expect(changed.files.some(file => file.path === "src/new.ts")).toBeTrue();
  } finally {
    if (resolve(root).startsWith(join(resolve(tmpdir()), "w2h-candidate-"))) rmSync(root, { recursive: true });
  }
});

test("evidence gate rejects stale, synthetic live, missing, failed and altered receipts", () => {
  const root = mkdtempSync(join(tmpdir(), "w2h-evidence-"));
  try {
    const candidate = { schemaVersion: 1 as const, sourceId: "a".repeat(64), version: "1.0.0", gitCommit: "b".repeat(40), files: [] };
    const results = REQUIRED_CASES.map(caseId => {
      const layer = LIVE_CASES.has(caseId) ? "authenticated-dev" : "fixture";
      const receipt = JSON.stringify({ sourceId: candidate.sourceId, loadedSourceId: candidate.sourceId, runtimeSha256: "c".repeat(64),
        layer, cases: [caseId], status: "pass", summary: "Fixture for checker validation only; no live acceptance asserted." });
      const path = `${caseId}.json`;
      writeFileSync(join(root, path), receipt);
      return { caseId, attempt: 1, status: "pass", sourceId: candidate.sourceId, layer, mode: "mixed", model: "fixture", effort: "fixture",
        platform: "fixture", actor: "fixture", at: "2026-10-14T00:00:00Z", evidence: [{ path, sha256: createHash("sha256").update(receipt).digest("hex") }] };
    });
    const manifest = { schemaVersion: 1, candidate, results };
    expect(checkAcceptance(manifest, candidate, root)).toEqual([]);
    expect(checkAcceptance(manifest, { ...candidate, sourceId: "d".repeat(64) }, root).length).toBeGreaterThan(0);
    expect(checkAcceptance({ ...manifest, results: [] }, candidate, root)).toHaveLength(REQUIRED_CASES.length);
    const synthetic = structuredClone(manifest);
    synthetic.results[0]!.layer = "fixture";
    expect(checkAcceptance(synthetic, candidate, root).join("\n")).toContain("authenticated evidence");
    const failed = structuredClone(manifest);
    failed.results.push({ ...failed.results[0]!, attempt: 2, status: "fail" });
    expect(checkAcceptance(failed, candidate, root).join("\n")).toContain("latest attempt is fail");
    const traversal = structuredClone(manifest);
    traversal.results[0]!.evidence[0]!.path = "../outside.json";
    expect(checkAcceptance(traversal, candidate, root).join("\n")).toContain("invalid evidence");
    writeFileSync(join(root, "CAP-001.json"), "{}");
    expect(checkAcceptance(manifest, candidate, root).join("\n")).toContain("invalid evidence");
  } finally {
    if (resolve(root).startsWith(join(resolve(tmpdir()), "w2h-evidence-"))) rmSync(root, { recursive: true });
  }
});
