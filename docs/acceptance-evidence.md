# Candidate acceptance evidence

[English](acceptance-evidence.md) | [简体中文](acceptance-evidence.zh-CN.md)

Scope and reuse follow the [acceptance protocol](acceptance-protocol.md); behavior follows the [capability catalog](acceptance-tests.md). Schema 2 supports check-level coverage, shared executions and cumulative validity reviews. Schema 1 remains compatible. The checker validates consistency, not the truth of tool execution; reviewed real evidence remains necessary.

## Candidate identity

Run `bun run scripts/acceptance-evidence.ts snapshot output/candidate.json` after stabilizing the change. It includes tracked and new non-ignored product, test, build, workflow, documentation and asset files, normalizing text CRLF/LF. `sourceId` identifies the sorted path/content-hash inventory; the commit is provenance. `.github/acceptance/` is excluded to avoid a receipt/identity cycle; do not place implementation there.

The service reports its startup source through `/healthz`; bundles also retain `bundleId` and per-file hashes. Restart only verified DEV after loaded implementation changes. Documentation or acceptance-tool changes alone do not require restarting a functioning application: preserve its actual loaded identity and review differences. Hashes establish identity, not ownership, execution or universal invalidation.

Archive original snapshots inside the evidence root. The checker recomputes each inventory digest, requires sorted unique portable paths and compares every added, modified or deleted file from the original execution to the target. Do not compare only the last commit or an intermediate inherited target.

## Schema-2 coverage manifest

`scripts/acceptance/catalog.ts` defines stable check IDs, capability mappings, criteria, allowed layers/modes and conservative dependencies. A manifest cannot omit checks, supply a smaller catalog or silently waive requirements. Multiple checks can share a run, and one check can satisfy several CAP/Q entries; composite capabilities retain their remaining gaps.

| Field | Content |
| --- | --- |
| `schemaVersion` | `2` |
| `candidate` | Actual target sourceId/version and provenance gitCommit |
| `catalogHash` | Digest of the current source-controlled check catalog |
| `archives` | Hash-bound original manifests preserved in migration |
| `executions` | Immutable execution or legacy-mapping references |
| `reviews` | Target-specific validity review references |
| `coverage` | Exactly one row per catalog check |
| `issues` | Dated open/resolved issues and affected checks |

File references have `path` and `sha256`, relative to the manifest directory. They must identify regular JSON files within that directory, have matching byte hashes, and contain no absolute/traversal/backslash paths or symlinks. Raw credentials, logs, rollouts and browser state stay in ignored `output/`; only reviewed redacted records belong in the evidence store.

A covered row has `checkId`, `status: covered`, `runId` and, when needed, `reviewId`. Cross-candidate reuse and resolution of recorded failures require a review. A gap has `checkId`, a factual `reason`, no passing selection, and status `needs-evidence`, `needs-review`, `blocked`, `owner-operated` or `failed`. No gap passes publication. Version 2 has no per-row applicability waiver: a genuine scope change requires reviewed catalog/requirement changes.

## Execution records

Each record has `schemaVersion: 2`, `kind: execution`, unique `id`, a `source` snapshot reference, `recordedAt`, `actor`, `platform`, `environment` and `observations`. Recording cannot precede an observation. Each observation contains:

- `checkId`, the check's `criteriaHash`, `outcome` (pass/fail/blocked) and actual `at` timestamp.
- `layer` (fixture/authenticated-dev/native-package) and exact allowed `mode` (native-tools/automatic-mcp/manual-mcp/desktop/not-applicable). Desktop evidence does not imply a model task.
- Actual `model`, `effort`, factual `summary` and nonempty hash-bound `evidence` references; explicitly describe non-applicable fixture/desktop metadata.
- Non-fixture evidence also requires `loadedSourceId` equal to the original snapshot and `runtimeSha256`. Native-package evidence requires `artifactSha256`; the artifact check additionally requires the current candidate.

One record can contain several observations, but a check appears at most once in that record. Preserve mode/layer boundaries per observation. Partial success is a gap. Criterion-hash changes require reassessment; attaching a new hash does not prove an old execution tested new requirements.

## Validity reviews

Each review has `schemaVersion: 2`, `id`, `runId`, `targetSourceId`, `reviewer`, `at`, `checkIds`, `changes`, `environment` and optional `resolvedFailures`. It cannot predate the reviewed observation. The checker derives cumulative differences from the run's snapshot. `changes` must contain exactly those paths, matching `before`/`after` hashes (null for absence), `impact` and a specific `reason`.

- `unrelated` is permitted only outside the check's dependency scopes.
- `reviewed-unaffected` needs nonempty `support` references. Explain the actual changed code/contract, unchanged behavior and relevant supplemental evidence.
- Affected behavior, unknown impact or an invalidated oracle cannot be inherited. Select a suitable new execution or retain a gap.

Environment review requires `status: unchanged` with factual reasoning, or `revalidated` with evidence references. Unknown environment validity blocks inheritance. Historical functional observations do not assert a new external readiness probe: refresh prerequisites and release smoke under the protocol.

A later failed observation blocks an earlier pass. Earlier failures need `resolvedFailures` entries containing the failed `runId`, `checkId` and resolution reason tied to the selected later success. Issues require unique `id`, `at`, `status`, `reason` and affected `checkIds`. Open issues block those checks; resolved issues also require `resolutionReason` and `resolutionRunId` with later passing confirmation of every affected check. Preserve failures; a newer timestamp or repeated retries alone does not explain resolution.

## Commands and results

```bash
bun run scripts/acceptance-evidence.ts snapshot output/candidate.json
bun run scripts/acceptance-evidence.ts report .github/acceptance/current.json
bun run scripts/acceptance-evidence.ts check .github/acceptance/current.json
```

`report` produces executed/inherited/gap states, reasons and CAP/Q aggregation. Zero exit means a structurally valid report, possibly with gaps; it is not release approval. `check` exits nonzero for invalid evidence or any required gap and remains the CI publication gate. Check-count fractions are not development progress. Actual artifact, platform, installer and publication requirements in the [release manual](release.md) remain separate.

<a id="checker-compatibility"></a>

## Legacy compatibility and migration

Schema 1 retains exact-candidate, highest-attempt whole-case validation. Use schema 2 for new coverage. Before replacing `current.json`, archive the old manifest and referenced receipts byte-for-byte, retaining earlier histories. Do not rewrite original identities or claim a new live execution.

A `kind: legacy-mapping` record also requires `mappingRationale`. Each observation has `legacy` with `manifest`, `caseId`, `attempt` and `receipt`; manifest/receipt are file references. The checker binds the original row, receipt, source, outcome, timestamp, mode, model, effort and runtime identity. A later failed legacy attempt invalidates an earlier selected pass. Imported failures remain failures and require resolution review.

When a live case explicitly aggregates separately executed fixtures, extract a fixture-only observation using `legacy.fixtureSubset: true`, a specific `fixtureRationale`, and mode `not-applicable`. Original metadata stays in the archived row. This only narrows the claim to documented fixture results; it never upgrades fixture evidence to live or invents observations. Inspect the original fixture evidence first.

Keep migration helpers and raw comparisons in ignored `output/`. Validate the draft before replacing the current manifest. Unknown historical coverage remains needs-review/needs-evidence. CI checks integrity and consistency; operators remain responsible for observed results and honest impact analysis.
