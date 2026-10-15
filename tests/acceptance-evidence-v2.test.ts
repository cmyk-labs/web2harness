import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { CandidateIdentity } from "../launcher/shared/candidate-identity.cjs";
import { checkAcceptance } from "../scripts/acceptance-evidence";
import { inspectAcceptanceV2, sourceChanges, validateSnapshot } from "../scripts/acceptance/checker";
import { ACCEPTANCE_CHECKS, REQUIRED_CASES, catalogHash, criteriaHash } from "../scripts/acceptance/catalog";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function snapshot(entries: Record<string, string>): CandidateIdentity {
  const files = Object.entries(entries).sort(([a], [b]) => a < b ? -1 : 1).map(([path, value]) => ({ path, sha256: hash(value) }));
  return { schemaVersion: 1, version: "1.0.0", sourceId: hash(`web2harness-candidate-v1\n${JSON.stringify(files)}`), gitCommit: "a".repeat(40), files };
}
function fixture(action: (f: ReturnType<typeof setup>) => void) {
  const temp = resolve(tmpdir()), root = mkdtempSync(join(temp, "w2h-acceptance-v2-"));
  try { action(setup(root)); }
  finally {
    // This invocation created this exact directory; never delete a discovered workspace.
    if (dirname(resolve(root)) !== temp || !resolve(root).startsWith(join(temp, "w2h-acceptance-v2-"))) throw new Error("Fixture ownership lost");
    rmSync(root, { recursive: true });
  }
}
function setup(root: string) {
  const files = { "package.json": '{"version":"1.0.0"}', "src/cli.ts": "cli", "src/adapter.ts": "adapter" };
  const baseline = snapshot(files);
  const write = (path: string, value: any) => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    return { path, sha256: hash(text) };
  };
  const proof = write("proof.json", { fixtureOnly: true, note: "Synthetic checker test; no live acceptance asserted" });
  const run: any = { schemaVersion: 2, kind: "execution", id: "run-1", source: write("source.json", baseline),
    recordedAt: "2026-10-15T05:00:00Z", actor: "Fixture", platform: "fixture", environment: "isolated checker fixture",
    observations: ACCEPTANCE_CHECKS.map(check => ({ checkId: check.id, criteriaHash: criteriaHash(check), outcome: "pass",
      layer: check.layers[0], mode: check.modes[0], model: "fixture-model", effort: "fixture-effort", at: "2026-10-15T04:00:00Z",
      summary: "Synthetic expected result", evidence: [proof], ...(check.layers[0] !== "fixture" ? { loadedSourceId: baseline.sourceId, runtimeSha256: "b".repeat(64) } : {}),
      ...(check.layers[0] === "native-package" ? { artifactSha256: "c".repeat(64) } : {}) })) };
  const manifest: any = { schemaVersion: 2, candidate: baseline, catalogHash: catalogHash(), archives: [], executions: [write("run.json", run)], reviews: [], issues: [],
    coverage: ACCEPTANCE_CHECKS.map(check => ({ checkId: check.id, status: "covered", runId: run.id })) };
  const saveRun = () => { manifest.executions[0] = write("run.json", run); };
  const only = (...ids: string[]) => { manifest.coverage = ACCEPTANCE_CHECKS.map(check => ids.includes(check.id)
    ? { checkId: check.id, status: "covered", runId: run.id }
    : { checkId: check.id, status: "needs-evidence", reason: "Outside this synthetic selection" }); };
  const review = (target: CandidateIdentity, checks = ["native.read-patch"]) => {
    manifest.candidate = target;
    const value: any = { schemaVersion: 2, id: "review-1", targetSourceId: target.sourceId, runId: run.id, reviewer: "Fixture",
      at: "2026-10-15T06:00:00Z", checkIds: checks, changes: sourceChanges(baseline, target).map(change => ({ ...change, impact: "unrelated", reason: "Documentation only" })),
      environment: { status: "unchanged", reason: "Controlled test environment" }, resolvedFailures: [] };
    const save = () => { manifest.reviews = [write("review.json", value)]; for (const row of manifest.coverage) if (checks.includes(row.checkId)) row.reviewId = value.id; };
    save(); return { value, save };
  };
  return { root, files, baseline, write, proof, run, manifest, saveRun, only, review, report: (target = manifest.candidate) => inspectAcceptanceV2(manifest, target, root) };
}

test("v2 current executions cover the full catalog and shared checks satisfy several cases", () => fixture(f => {
  const report = f.report();
  expect(report.errors).toEqual([]);
  expect(checkAcceptance(f.manifest, f.baseline, f.root)).toEqual([]);
  expect(report.cases.every(row => row.satisfied)).toBeTrue();
  expect(new Set(ACCEPTANCE_CHECKS.flatMap(check => check.cases))).toEqual(new Set(REQUIRED_CASES));
  expect(report.checks.find(row => row.checkId === "queue.cancellation")?.cases).toEqual(["CAP-009", "Q06"]);
}));

test("v2 document-only changes inherit original observations without rewriting their source", () => fixture(f => {
  f.only("native.read-patch");
  const target = snapshot({ ...f.files, "docs/guide.md": "new documentation" });
  f.review(target);
  const report = f.report();
  expect(report.errors).toEqual([]);
  expect(report.checks[0]?.status).toBe("inherited");
  expect(JSON.parse(readFileSync(join(f.root, "source.json"), "utf8")).sourceId).toBe(f.baseline.sourceId);
  expect(report.cases.find(row => row.caseId === "CAP-001")?.satisfied).toBeTrue();
  expect(report.cases.find(row => row.caseId === "CAP-009")?.satisfied).toBeFalse();
  expect(checkAcceptance(f.manifest, target, f.root).length).toBeGreaterThan(0);
}));

test("v2 rejects missing cumulative changes, including deleted files and edits before the last commit", () => fixture(f => {
  f.only("native.read-patch");
  const target = snapshot({ "package.json": f.files["package.json"], "src/cli.ts": "changed", "docs/new.md": "new" });
  const review = f.review(target);
  review.value.changes = review.value.changes.filter((x: any) => x.path === "docs/new.md"); review.save();
  expect(f.report().errors.join(" ")).toContain("cumulative");
  review.value.changes = sourceChanges(f.baseline, target).map(x => ({ ...x, impact: "reviewed-unaffected", reason: "Reviewed implementation paths", support: [f.proof] }));
  review.value.changes[0].before = "f".repeat(64); review.save();
  expect(f.report().errors.join(" ")).toContain("mismatched");
}));

test("v2 dependency changes need explicit supported review; affected, unknown and invalidated oracles cannot inherit", () => fixture(f => {
  f.only("native.read-patch");
  const target = snapshot({ ...f.files, "src/adapter.ts": "changed" });
  const review = f.review(target);
  expect(f.report().errors.join(" ")).toContain("dependency change");
  review.value.changes[0].impact = "reviewed-unaffected"; review.save();
  expect(f.report().errors.length).toBeGreaterThan(0);
  review.value.changes[0].support = [f.proof]; review.save();
  expect(f.report().errors).toEqual([]);
  for (const impact of ["affected", "unknown", "oracle-invalidated"]) {
    review.value.changes[0].impact = impact; review.save();
    expect(f.report().errors.join(" ")).toContain("requires new evidence");
  }
}));

test("v2 changed acceptance criteria and unknown environment cannot use old observations", () => fixture(f => {
  f.only("native.read-patch");
  f.run.observations[0].criteriaHash = "d".repeat(64); f.saveRun();
  expect(f.report().errors.join(" ")).toContain("criteria changed");
  f.run.observations[0].criteriaHash = criteriaHash(ACCEPTANCE_CHECKS[0]!); f.saveRun();
  const review = f.review(snapshot({ ...f.files, "docs/guide.md": "updated" }));
  review.value.environment.status = "unknown"; review.save();
  expect(f.report().errors.join(" ")).toContain("Environment validity unresolved");
}));

test("v2 refuses fixture-for-live, mode substitution, missing files and forged runtime identity", () => fixture(f => {
  const original = structuredClone(f.run.observations[0]);
  for (const patch of [{ layer: "fixture" }, { mode: "automatic-mcp" }, { loadedSourceId: "d".repeat(64) }, { evidence: [] }]) {
    f.run.observations[0] = { ...original, ...patch }; f.saveRun();
    expect(f.report().errors.length).toBeGreaterThan(0);
  }
}));

test("v2 rejects altered receipts, traversal, absolute paths and malformed references without throwing", () => fixture(f => {
  for (const path of ["../proof.json", "C:/outside.json", "/outside.json", "a/../proof.json", "a\\proof.json"]) {
    f.manifest.executions = [{ path, sha256: f.proof.sha256 }];
    expect(f.report().errors.join(" ")).toContain("path/hash");
  }
  f.saveRun();
  writeFileSync(join(f.root, "proof.json"), "{}");
  expect(f.report().errors.join(" ")).toContain("digest mismatch");
}));

test("v2 later failure and unresolved issue invalidate a pass; older failures need explicit resolution", () => fixture(f => {
  f.only("native.read-patch");
  const fail = structuredClone(f.run); fail.id = "failure";
  fail.observations = [{ ...fail.observations[0], outcome: "fail", at: "2026-10-15T05:00:00Z" }];
  f.manifest.executions.push(f.write("failure.json", fail));
  expect(f.report().errors.join(" ")).toContain("Later failure");
  fail.observations[0].at = "2026-10-15T03:00:00Z";
  f.manifest.executions[1] = f.write("failure.json", fail);
  expect(f.report().errors.join(" ")).toContain("resolution review");
  const review = f.review(f.baseline);
  review.value.resolvedFailures = [{ runId: "failure", checkId: "native.read-patch", reason: "Fixed and confirmed by the selected later execution" }]; review.save();
  expect(f.report().errors).toEqual([]);
  f.manifest.issues = [{ id: "open-1", status: "open", at: "2026-10-15T05:00:00Z", reason: "Unresolved defect", checkIds: ["native.read-patch"] }];
  expect(f.report().errors.join(" ")).toContain("Unresolved issue");
  f.manifest.issues[0].status = "resolved"; f.manifest.issues[0].resolutionRunId = "run-1";
  f.manifest.issues[0].resolutionReason = "Selected an older passing result";
  expect(f.report().errors.join(" ")).toContain("later passing confirmation");
}));

test("v2 manifest cannot omit checks, duplicate IDs or silently waive them", () => fixture(f => {
  const original = structuredClone(f.manifest.coverage);
  f.manifest.coverage.pop(); expect(f.report().errors.join(" ")).toContain("missing coverage");
  f.manifest.coverage = [...original, original[0]]; expect(f.report().errors.join(" ")).toContain("duplicate");
  f.manifest.coverage = original; f.manifest.coverage[0].status = "not-applicable";
  expect(f.report().errors.join(" ")).toContain("Invalid coverage status");
  f.manifest.coverage = original.slice(1); f.manifest.catalogHash = "e".repeat(64);
  expect(f.report().errors.join(" ")).toContain("catalog changed");
}));

test("v2 reports blocked and owner-operated gaps distinctly and still blocks publication", () => fixture(f => {
  f.manifest.coverage[0] = { checkId: "native.read-patch", status: "blocked", reason: "DEV prerequisite unavailable" };
  f.manifest.coverage[1] = { checkId: "native.same-cell", status: "owner-operated", reason: "Assigned to maintainer" };
  const report = f.report();
  expect(report.errors).toEqual([]);
  expect(report.checks[0]?.status).toBe("blocked");
  expect(report.checks[1]?.status).toBe("owner-operated");
  expect(checkAcceptance(f.manifest, f.baseline, f.root)).toHaveLength(2);
}));

test("v2 native artifact gate requires actual current-candidate artifact evidence", () => fixture(f => {
  f.only("license.artifact");
  f.review(snapshot({ ...f.files, "docs/guide.md": "update" }), ["license.artifact"]);
  expect(f.report().errors.join(" ")).toContain("current-candidate evidence");
}));

test("v2 legacy mapping preserves original source, attempt, mode, receipt and failure outcomes", () => fixture(f => {
  f.only("native.read-patch");
  const original = f.run.observations[0];
  const receipt = { sourceId: f.baseline.sourceId, loadedSourceId: f.baseline.sourceId, runtimeSha256: original.runtimeSha256,
    cases: ["CAP-001"], status: "pass", layer: "authenticated-dev", summary: "Synthetic legacy native result" };
  const receiptRef = f.write("history/evidence/native.json", receipt);
  const old = { schemaVersion: 1, candidate: f.baseline, results: [{ caseId: "CAP-001", attempt: 2, status: "pass", sourceId: f.baseline.sourceId,
    at: original.at, mode: original.mode, layer: original.layer, model: original.model, effort: original.effort, evidence: [{ ...receiptRef, path: "evidence/native.json" }] }] };
  const oldRef = f.write("history/current.json", old);
  f.run.kind = "legacy-mapping"; f.run.mappingRationale = "Original reviewed case covers the current check";
  f.run.observations = [{ ...original, evidence: [receiptRef], legacy: { manifest: oldRef, caseId: "CAP-001", attempt: 2, receipt: receiptRef } }]; f.saveRun();
  expect(f.report().errors).toEqual([]);
  f.run.observations[0].legacy.attempt = 1; f.saveRun();
  expect(f.report().errors.join(" ")).toContain("Legacy attempt missing");
  f.run.observations[0].legacy.attempt = 2; f.run.observations[0].effort = "changed"; f.saveRun();
  expect(f.report().errors.join(" ")).toContain("metadata was changed");
  f.run.observations[0].effort = original.effort;
  old.results.push({ ...old.results[0]!, attempt: 3, status: "fail", at: "2026-10-15T05:00:00Z" });
  f.run.observations[0].legacy.manifest = f.write("history/current.json", old); f.saveRun();
  expect(f.report().errors.join(" ")).toContain("Later legacy failure");
}));

test("snapshot hashing rejects forged inventory, duplicate paths and noncanonical paths", () => {
  const base = snapshot({ "package.json": "package", "src/cli.ts": "cli" });
  expect(validateSnapshot(base)).toEqual(base);
  for (const files of [[...base.files, base.files[0]], [{ ...base.files[0], path: "../package.json" }, base.files[1]], base.files.toReversed()]) {
    expect(() => validateSnapshot({ ...base, files })).toThrow();
  }
  expect(() => validateSnapshot({ ...base, sourceId: "f".repeat(64) })).toThrow("digest mismatch");
});

test("legacy aggregate can expose an explicitly reviewed fixture subset without upgrading fixture evidence to live", () => fixture(f => {
  f.only("models.contracts");
  const obs = f.run.observations.find((x: any) => x.checkId === "models.contracts");
  const receiptRef = f.write("history/model.json", { sourceId: f.baseline.sourceId, status: "pass", layer: "authenticated-dev",
    loadedSourceId: f.baseline.sourceId, runtimeSha256: "b".repeat(64), cases: ["CAP-004"], summary: "Synthetic live case with separately recorded model fixtures" });
  const old = { schemaVersion: 1, candidate: f.baseline, results: [{ caseId: "CAP-004", attempt: 1, status: "pass", sourceId: f.baseline.sourceId,
    at: obs.at, layer: "authenticated-dev", mode: "native-tools", model: obs.model, effort: obs.effort, evidence: [{ ...receiptRef, path: "model.json" }] }] };
  const legacy = { manifest: f.write("history/current.json", old), caseId: "CAP-004", attempt: 1, receipt: receiptRef,
    fixtureSubset: true, fixtureRationale: "Original receipt explicitly identifies deterministic model/viewport fixture results" };
  f.run.kind = "legacy-mapping"; f.run.mappingRationale = "Narrow extraction, original live execution unchanged";
  f.run.observations = [{ ...obs, evidence: [receiptRef], legacy }]; f.saveRun();
  expect(f.report().errors).toEqual([]);
  f.run.observations[0].legacy.fixtureRationale = ""; f.saveRun();
  expect(f.report().errors.join(" ")).toContain("metadata was changed");
}));
