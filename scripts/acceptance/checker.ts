import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, posix } from "node:path";
import type { CandidateIdentity } from "../../launcher/shared/candidate-identity.cjs";
import { ACCEPTANCE_CHECKS, REQUIRED_CASES, catalogHash, criteriaHash, type AcceptanceCheck } from "./catalog";

type ObjectValue = Record<string, any>;
export interface EvidenceRef { path: string; sha256: string }
export interface CheckResult { checkId: string; cases: string[]; status: string; reason: string; runId?: string }
export interface AcceptanceReport { schemaVersion: 2; sourceId: string; errors: string[]; checks: CheckResult[]; cases: { caseId: string; satisfied: boolean; gaps: string[] }[] }
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function requireValue(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }
function object(value: unknown, name: string): ObjectValue {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${name}: expected object`);
  return value as ObjectValue;
}
function array(value: unknown, name: string): any[] { requireValue(Array.isArray(value), `${name}: expected array`); return value; }
function date(value: unknown, name: string): number {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), `${name}: invalid timestamp`);
  return Date.parse(value);
}
function portablePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\\:\x00]/.test(value) && !isAbsolute(value)
    && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
function sameRef(a: any, b: any): boolean { return a?.path === b?.path && a?.sha256 === b?.sha256; }

export function validateSnapshot(value: unknown): CandidateIdentity {
  const snapshot = object(value, "source snapshot");
  requireValue(snapshot.schemaVersion === 1 && nonempty(snapshot.version) && hex(snapshot.sourceId)
    && typeof snapshot.gitCommit === "string" && /^[a-f0-9]{40}$/.test(snapshot.gitCommit), "Invalid source snapshot metadata");
  const files = array(snapshot.files, "snapshot files");
  let previous = "";
  for (const entry of files) {
    const file = object(entry, "snapshot file");
    requireValue(portablePath(file.path) && hex(file.sha256) && file.path > previous
      && Object.keys(file).length === 2, "Snapshot paths must be unique, sorted and canonical");
    previous = file.path;
  }
  requireValue(files.some(f => f.path === "src/cli.ts") && files.some(f => f.path === "package.json"), "Incomplete source snapshot");
  requireValue(digest(`web2harness-candidate-v1\n${JSON.stringify(files)}`) === snapshot.sourceId, "Source snapshot digest mismatch");
  return snapshot as CandidateIdentity;
}

export function sourceChanges(from: CandidateIdentity, to: CandidateIdentity): { path: string; before: string | null; after: string | null }[] {
  const a = new Map(from.files.map(f => [f.path, f.sha256])), b = new Map(to.files.map(f => [f.path, f.sha256]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter(path => a.get(path) !== b.get(path))
    .map(path => ({ path, before: a.get(path) ?? null, after: b.get(path) ?? null }));
}

class EvidenceStore {
  private root: string;
  private cache = new Map<string, unknown>();
  constructor(root: string) { this.root = realpathSync(root); }
  read(reference: unknown): any {
    const ref = object(reference, "evidence reference");
    requireValue(portablePath(ref.path) && hex(ref.sha256), "Invalid evidence path/hash");
    const key = `${ref.path}:${ref.sha256}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let path = this.root;
    for (const part of ref.path.split("/")) {
      path = resolve(path, part);
      requireValue(!lstatSync(path).isSymbolicLink(), "Evidence symlinks are not permitted");
    }
    const rel = relative(this.root, realpathSync(path));
    requireValue(rel && !rel.startsWith("..") && !isAbsolute(rel) && lstatSync(path).isFile(), "Evidence escapes root or is not a regular file");
    const bytes = readFileSync(path);
    requireValue(digest(bytes) === ref.sha256, "Evidence digest mismatch");
    const parsed = JSON.parse(bytes.toString("utf8"));
    this.cache.set(key, parsed);
    return parsed;
  }
}

interface Run { record: ObjectValue; source: CandidateIdentity; observations: Map<string, ObjectValue> }
const definitions = new Map(ACCEPTANCE_CHECKS.map(check => [check.id, check]));

function legacyObservation(store: EvidenceStore, observation: ObjectValue, source: CandidateIdentity, check: AcceptanceCheck): void {
  const legacy = object(observation.legacy, "legacy mapping");
  const manifest = object(store.read(legacy.manifest), "legacy manifest");
  requireValue(manifest.schemaVersion === 1 && manifest.candidate?.sourceId === source.sourceId
    && manifest.candidate?.version === source.version, "Legacy manifest/source mismatch");
  requireValue(check.cases.includes(legacy.caseId), "Legacy case does not cover this check");
  const entries = array(manifest.results, "legacy results").filter(x => x?.caseId === legacy.caseId && x.attempt === legacy.attempt);
  requireValue(entries.length === 1, "Legacy attempt missing or duplicated");
  const entry = entries[0];
  requireValue(!manifest.results.some((item: any) => item?.caseId === legacy.caseId && item.status === "fail"
    && (item.attempt > entry.attempt || Date.parse(item.at) > Date.parse(entry.at))), "Later legacy failure contradicts selected evidence");
  // A legacy live case may aggregate separately executed fixtures. Extracting that
  // explicitly documented subset narrows the claim; the inverse is never allowed.
  const fixtureSubset = legacy.fixtureSubset === true && observation.layer === "fixture" && observation.mode === "not-applicable"
    && ["authenticated-dev", "native-package"].includes(entry.layer) && nonempty(legacy.fixtureRationale);
  requireValue(entry.sourceId === source.sourceId && entry.status === observation.outcome && entry.at === observation.at
    && ((entry.layer === observation.layer && entry.mode === observation.mode) || fixtureSubset)
    && entry.model === observation.model && entry.effort === observation.effort, "Legacy execution metadata was changed");
  const matched = array(entry.evidence, "legacy references").some(ref => {
    const located = { path: posix.join(posix.dirname(legacy.manifest.path), ref.path), sha256: ref.sha256 };
    return sameRef(located, legacy.receipt);
  });
  requireValue(matched && observation.evidence.some((ref: any) => sameRef(ref, legacy.receipt)), "Legacy receipt is not bound to the original attempt");
  const receipt = object(store.read(legacy.receipt), "legacy receipt");
  requireValue(receipt.sourceId === source.sourceId && receipt.status === observation.outcome
    && receipt.layer === entry.layer && array(receipt.cases, "legacy cases").includes(legacy.caseId), "Legacy receipt identity mismatch");
  if (observation.layer !== "fixture") requireValue(receipt.loadedSourceId === observation.loadedSourceId
    && receipt.runtimeSha256 === observation.runtimeSha256, "Legacy loaded-runtime identity was changed");
}

function readRun(store: EvidenceStore, ref: unknown): Run {
  const run = object(store.read(ref), "execution");
  requireValue(run.schemaVersion === 2 && ["execution", "legacy-mapping"].includes(run.kind) && nonempty(run.id)
    && nonempty(run.actor) && nonempty(run.platform) && nonempty(run.environment), "Incomplete execution metadata");
  const recordedAt = date(run.recordedAt, "execution recordedAt");
  if (run.kind === "legacy-mapping") requireValue(nonempty(run.mappingRationale), "Legacy mapping rationale missing");
  const source = validateSnapshot(store.read(run.source));
  const observations = new Map<string, ObjectValue>();
  for (const item of array(run.observations, "observations")) {
    const obs = object(item, "observation"), check = definitions.get(obs.checkId);
    requireValue(check && !observations.has(obs.checkId), "Unknown or duplicate observed check");
    requireValue(hex(obs.criteriaHash) && ["pass", "fail", "blocked"].includes(obs.outcome)
      && nonempty(obs.summary) && nonempty(obs.model) && nonempty(obs.effort), "Incomplete observation");
    requireValue(recordedAt >= date(obs.at, "observation at"), "Observation occurs after its record");
    requireValue(check.layers.includes(obs.layer) && check.modes.includes(obs.mode), `${check.id}: wrong evidence layer or mode`);
    const evidence = array(obs.evidence, "observation evidence");
    requireValue(evidence.length > 0, "Observation evidence missing");
    for (const proof of evidence) store.read(proof);
    if (obs.layer !== "fixture") requireValue(obs.loadedSourceId === source.sourceId && hex(obs.runtimeSha256), "Loaded runtime identity mismatch");
    if (obs.layer === "native-package") requireValue(hex(obs.artifactSha256), "Native artifact identity missing");
    if (run.kind === "legacy-mapping") legacyObservation(store, obs, source, check);
    else requireValue(obs.legacy === undefined, "New execution cannot disguise a legacy mapping");
    observations.set(obs.checkId, obs);
  }
  requireValue(observations.size > 0, "Empty execution");
  return { record: run, source, observations };
}

function reviewForCheck(store: EvidenceStore, review: ObjectValue, run: Run, check: AcceptanceCheck, target: CandidateIdentity): void {
  requireValue(review.schemaVersion === 2 && review.targetSourceId === target.sourceId && review.runId === run.record.id
    && nonempty(review.id) && nonempty(review.reviewer), "Invalid review identity/reviewer");
  requireValue(date(review.at, "review timestamp") >= date(run.observations.get(check.id)?.at, "reviewed observation"), "Review predates its observation");
  requireValue(array(review.checkIds, "review checks").includes(check.id), "Review does not cover check");
  const actual = sourceChanges(run.source, target), changes = array(review.changes, "review changes");
  requireValue(changes.length === actual.length, "Review does not cover cumulative source differences");
  const byPath = new Map<string, ObjectValue>();
  for (const value of changes) {
    const change = object(value, "change review");
    requireValue(portablePath(change.path) && !byPath.has(change.path) && nonempty(change.reason), "Invalid or duplicate change review");
    byPath.set(change.path, change);
  }
  for (const diff of actual) {
    const change = byPath.get(diff.path);
    requireValue(change && change.before === diff.before && change.after === diff.after, "Cumulative difference missing or mismatched");
    const dependent = check.dependencies.some(prefix => diff.path === prefix || diff.path.startsWith(prefix));
    requireValue(["unrelated", "reviewed-unaffected"].includes(change.impact), `${check.id}: affected/unknown/oracle-invalidated change requires new evidence`);
    if (dependent) requireValue(change.impact === "reviewed-unaffected", `${check.id}: dependency change cannot be declared unrelated`);
    if (change.impact === "reviewed-unaffected") {
      const support = array(change.support, "change support");
      requireValue(support.length > 0, "Reviewed dependency change needs supporting evidence");
      for (const ref of support) store.read(ref);
    }
  }
  const environment = object(review.environment, "environment review");
  requireValue(["unchanged", "revalidated"].includes(environment.status) && nonempty(environment.reason), "Environment validity unresolved");
  if (environment.status === "revalidated") {
    const refs = array(environment.evidence, "environment evidence");
    requireValue(refs.length > 0, "Environment revalidation evidence missing");
    for (const ref of refs) store.read(ref);
  }
}

export function inspectAcceptanceV2(value: unknown, candidate: CandidateIdentity, evidenceRoot: string): AcceptanceReport {
  const report: AcceptanceReport = { schemaVersion: 2, sourceId: candidate.sourceId, errors: [], checks: [], cases: [] };
  const runs = new Map<string, Run>(), reviews = new Map<string, ObjectValue>(), coverage = new Map<string, ObjectValue>();
  let manifest: ObjectValue, store: EvidenceStore;
  try {
    manifest = object(value, "manifest");
    requireValue(manifest.schemaVersion === 2, "Unsupported acceptance schema");
    validateSnapshot(candidate);
    requireValue(manifest.candidate?.sourceId === candidate.sourceId && manifest.candidate?.version === candidate.version, "Candidate source identity/version mismatch");
    requireValue(manifest.catalogHash === catalogHash(), "Check catalog changed; reassess coverage");
    store = new EvidenceStore(evidenceRoot);
    for (const ref of array(manifest.archives, "archives")) store.read(ref);
    for (const ref of array(manifest.executions, "executions")) {
      try {
        const run = readRun(store, ref);
        requireValue(!runs.has(run.record.id), "Duplicate execution ID");
        runs.set(run.record.id, run);
      } catch (error) { report.errors.push(`Execution: ${(error as Error).message}`); }
    }
    for (const ref of array(manifest.reviews, "reviews")) {
      const review = object(store.read(ref), "review");
      requireValue(nonempty(review.id) && !reviews.has(review.id), "Duplicate or missing review ID");
      reviews.set(review.id, review);
    }
    for (const value of array(manifest.coverage, "coverage")) {
      const row = object(value, "coverage row");
      requireValue(definitions.has(row.checkId) && !coverage.has(row.checkId), "Unknown or duplicate coverage check");
      requireValue(["covered", "needs-evidence", "needs-review", "blocked", "owner-operated", "failed"].includes(row.status), "Invalid coverage status");
      if (row.status !== "covered") requireValue(nonempty(row.reason) && row.runId === undefined && row.reviewId === undefined, "Uncovered check needs a reason and no passing selection");
      coverage.set(row.checkId, row);
    }
    const issueIds = new Set<string>();
    for (const issue of array(manifest.issues, "issues")) {
      requireValue(nonempty(issue?.id) && nonempty(issue.reason) && ["open", "resolved"].includes(issue.status), "Invalid issue");
      requireValue(!issueIds.has(issue.id), "Duplicate issue ID"); issueIds.add(issue.id);
      const raisedAt = date(issue.at, "issue timestamp");
      const ids = array(issue.checkIds, "issue checks");
      requireValue(ids.length > 0 && ids.every(id => definitions.has(id)), "Issue refers to unknown checks");
      if (issue.status === "resolved") {
        const resolution = runs.get(issue.resolutionRunId);
        requireValue(nonempty(issue.resolutionReason) && resolution && ids.every(id => {
          const obs = resolution.observations.get(id);
          return obs?.outcome === "pass" && obs.criteriaHash === criteriaHash(definitions.get(id)!) && Date.parse(obs.at) > raisedAt;
        }), "Issue resolution lacks a later passing confirmation");
      }
    }
  } catch (error) {
    report.errors.push((error as Error).message);
    return report;
  }

  for (const check of ACCEPTANCE_CHECKS) {
    const row = coverage.get(check.id);
    const result: CheckResult = { checkId: check.id, cases: check.cases, status: row?.status ?? "needs-evidence", reason: row?.reason ?? "Missing coverage row" };
    if (!row) report.errors.push(`${check.id}: missing coverage row`);
    if (row?.status === "covered") {
      try {
        const run = runs.get(row.runId), observation = run?.observations.get(check.id);
        requireValue(run && observation?.outcome === "pass", "Selected execution has no passing observation");
        if (run.source.sourceId === candidate.sourceId) requireValue(run.source.version === candidate.version, "Execution snapshot version mismatch");
        requireValue(observation.criteriaHash === criteriaHash(check), "Acceptance criteria changed; reassess this observation");
        const inherited = run.source.sourceId !== candidate.sourceId;
        const review = reviews.get(row.reviewId);
        if (inherited || row.reviewId !== undefined) {
          requireValue(review, "Validity review missing");
          reviewForCheck(store, review, run, check, candidate);
        }
        if (check.id === "license.artifact") requireValue(!inherited, "Release artifact needs current-candidate evidence");
        for (const other of runs.values()) {
          const failed = other.observations.get(check.id);
          if (failed?.outcome !== "fail") continue;
          requireValue(date(observation.at, "pass") > date(failed.at, "failure"), "Later failure contradicts selected passing evidence");
          const resolution = review?.resolvedFailures?.find((entry: any) => entry.runId === other.record.id && entry.checkId === check.id);
          requireValue(resolution && nonempty(resolution.reason), "Historical failure lacks an explicit resolution review");
        }
        requireValue(!manifest.issues.some((issue: any) => issue.status === "open" && issue.checkIds.includes(check.id)), "Unresolved issue blocks this check");
        result.status = inherited ? "inherited" : "executed";
        result.reason = inherited ? "Original execution retained; cumulative impact reviewed" : "Passing execution on this candidate";
        result.runId = run.record.id;
      } catch (error) {
        result.status = "needs-review";
        result.reason = (error as Error).message;
        report.errors.push(`${check.id}: ${result.reason}`);
      }
    }
    report.checks.push(result);
  }
  for (const caseId of REQUIRED_CASES) {
    const relevant = report.checks.filter(check => check.cases.includes(caseId));
    const gaps = relevant.filter(check => !["executed", "inherited"].includes(check.status)).map(check => check.checkId);
    report.cases.push({ caseId, satisfied: relevant.length > 0 && gaps.length === 0, gaps });
  }
  return report;
}

export function acceptanceErrors(report: AcceptanceReport): string[] {
  return [...report.errors, ...report.checks.filter(check => !["executed", "inherited"].includes(check.status))
    .map(check => `${check.checkId}: ${check.status} (${check.reason})`)];
}
