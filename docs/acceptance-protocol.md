# Change-based acceptance protocol

[English](acceptance-protocol.md) | [简体中文](acceptance-protocol.zh-CN.md) · [Development](development.md) · [Release](release.md)

This protocol governs acceptance scope, evidence reuse and completion for development changes and releases. The [capability catalog](acceptance-tests.md) defines observable requirements; the [evidence manual](acceptance-evidence.md) defines storage and checker support. When an older checklist appears to require rerunning every capability after every change, use this protocol to select execution scope. Required behavior and evidence levels remain mandatory.

## Acceptance unit and responsibilities

An acceptance batch is one coherent behavior change, including its implementation, tests and documentation. It is not each file save, chat turn or receipt update. Identify a test snapshot after the behavior stabilizes; subsequent changes reopen only affected checks.

Distinguish development verification, business acceptance and release readiness. Developers provide implementation and regression evidence; test review checks coverage and results; business acceptance evaluates new or materially changed user workflows. A small team may combine roles. Ordinary changes follow this protocol without approval for every test; high-risk scope decisions and exceptions require maintainer review. Publishing and accepting unresolved release risk remain separate decisions.

## Requirements, checks, flows and evidence

| Object | Required content |
| --- | --- |
| Capability | Stable CAP/Q identifier, expected behavior and applicability. |
| Check | Preconditions, observable expected result, mode/platform/configuration and required evidence layer. Split only where results or revalidation can be assessed independently. |
| Flow | Repeatable preparation, steps, observations and cleanup; one flow may cover multiple checks and capabilities. |
| Execution | Unique run ID, actual source/runtime or artifact, environment, procedure/data version, per-check outcomes and evidence references. |
| Validity review | Target candidate, original evidence, cumulative differences, impact rationale and reviewer; explains reuse without changing the execution's original identity. |

CAP/Q identifiers are coverage indexes, not separate execution jobs. A capability is satisfied only when all applicable required checks have valid evidence. Missing one check does not erase other results. Fixture, authenticated DEV and native-package evidence keep their distinct meanings; they cannot substitute for one another's boundaries.

## Change-impact plan

Before expensive execution, record a short plan containing:

1. Changed behavior, purpose and observable success criteria.
2. Evidence baselines and cumulative differences from each relevant baseline to the target, including uncommitted changes. Do not inspect only the latest commit.
3. Affected components, callers, shared state, interfaces, permissions, data, configuration, build/runtime dependencies, platforms and external services.
4. Checks to confirm the change, checks to regress, existing evidence to reuse and the reasons for exclusions. Common reasons may be grouped.
5. Combined flows, expected effort, prerequisites, exit conditions and known blockers.

Risk depends on failure consequences, shared behavior and uncertainty, not line count. Authorization, file changes, duplicate execution, queue ownership and physical resource cleanup are high-risk areas. Unchanged files may still be affected through dependencies. Dependency maps and coverage assist analysis but do not establish absence of dynamic effects. Unknown impact expands testing to the relevant subsystem; broad architecture changes or an unreliable baseline may require full regression.

| Change | Default evidence scope |
| --- | --- |
| Explanatory documentation or spelling | Content, links and bilingual consistency. Reassess affected criteria if promises change; generated behavior/configuration follows the product-change rules. |
| Local UI | Affected interaction, rendering, languages/window sizes, type and build checks. |
| Local business logic or API | Fix confirmation, affected unit/contract/integration tests and a user flow where needed. |
| Shared browser, queue, cancellation or tool handoff | Related regressions and defect cases, affected adapter contracts and necessary authenticated flows. |
| Authorization or persistence/data format | Success/rejection, compatibility, migration/recovery and affected real workflows. |
| Runtime, key dependencies, packaging or installation | Affected integration, target artifact/platform and applicable disposable-OS checks. |
| Broad or uncertain impact | Expanded subsystem regression or a new complete baseline, with recorded rationale. |

Test at the lowest layer that establishes the property. Use deterministic tests for error branches, races and parameter boundaries; use live flows for actual browser/tool delivery and native checks for operating-system behavior. Run an affordable stable automated suite once at integration or candidate freeze when appropriate. Do not repeat an equivalent valid run merely to create another receipt or report. Expensive live/manual flows follow the impact plan.

## Shared flows and parameter coverage

Select required checks, subtract valid existing evidence, then choose flows covering the remaining gaps. Prefer compatible flows with useful observations and diagnosable failures over a single giant script.

| Reusable flow | Checks that can share its evidence |
| --- | --- |
| Read → patch → command readback → continuation/finish | Tool delivery, actual files, explicit model/effort, send accounting, logs and settlement; add same-cell waiting only when needed. |
| One-slot parent with three children | Delegation, actual results, parent release/re-admission, capacity and cleanup. |
| Settings and permission changes | Save/default drafts, hot application, persistence, rejection and affected layout. |
| Controlled fault → physical cleanup → next task | Deadline, cancellation, no replay, capacity recovery and diagnostic correlation. |
| Compaction and continuation | Context budget, sends/accounting, spacing and queue ownership. |
| Native diagnostic export | Save/cancel, actual archive, redaction and fault correlation. |
| Artifact and deployment | Integrity, platform startup and applicable installation/upgrade/recovery. |

Combine only compatible build/environment/preconditions, or explicitly describe their transitions. Every claimed check needs an observation tied to its step. Reuse one execution for several CAP/Q references; do not mark an entire capability passed because only part of it was observed.

Native Tools, Automatic MCP and Manual MCP have different boundaries. Shared implementation evidence may be reused; changed mode-specific behavior needs its own evidence. Select model/effort/platform variants using implementation-based equivalence classes, boundaries and known interactions. Preserve explicit user selections and promised differences. Do not run every Cartesian combination without an identified interaction, or infer untested modes from one successful mode.

## Evidence validity and inheritance

Keep original execution records immutable. A target candidate may use a new execution or a reviewed still-valid execution from another candidate. Label these separately. Reuse requires all of the following:

- Complete verifiable passing evidence, with no later unresolved failure contradicting the claimed behavior.
- Applicable criteria, evidence layer and relevant implementation/contract assumptions remain valid.
- Cumulative changes do not affect the behavior or its transitive dependencies, configuration, data and build assumptions, or supplemental evidence resolves the relevant impact.
- Environment assumptions remain applicable, including runtime/browser, platform, mode and external interfaces.
- An explicit original run reference, target identity, comparison range, impact rationale and reviewer. Preserve prior failures.

The full source digest remains provenance; it is not the sole invalidation rule for all capabilities. Track artifact/runtime, procedure/data and environment identity as relevant. A documentation-only source change need not invalidate tool-execution results. A new physical artifact still needs its own applicable artifact checks.

Repairing a recorder does not invalidate independently verifiable earlier results. Repairing a missing assertion, wrong oracle or false-positive test requires reassessing every result that relied on it. Missing or previously unproven checks cannot become passes by inheritance.

External browser pages and connectors can change without repository changes. Before a new live batch, perform a lightweight readiness/binding check; interface drift or unexplained failure reopens relevant checks. Before release, refresh necessary evidence for supported external critical paths; an adequate same-candidate run already in the batch can supply it. Do not apply arbitrary age-based full invalidation or assume external evidence is valid forever.

## Execution and failure handling

1. Stabilize the change snapshot and impact plan.
2. Map valid evidence and gaps, then combine compatible flows.
3. Run relevant static/unit/interface checks before necessary system/live work. Fix lower-layer failures before launching dependent long runs.
4. Preflight DEV ownership, required binding/permissions, command entry points, selectors and evidence capture. Share preparation within the batch.
5. Collect per-check outcomes in one execution; diagnose failures before selecting a retry.
6. Verify physical cleanup and isolation boundaries, update coverage and stop when exit conditions hold. Do not broaden or repeat without a new change, failure or unresolved risk.

All execution follows the [isolated procedure](development.md#standard-isolated-test-procedure). Reuse batch-level production boundary snapshots while ownership remains unchanged; recheck changed modes, tunnels or processes. Restart only verified DEV when loaded implementation/configuration requires it. Source metadata changes alone do not require restarting a functioning runtime. Preserve sandbox, approval, model/route, independent authentication and disposable-OS boundaries.

| Failure class | Required response |
| --- | --- |
| Product defect | Preserve failure, fix, confirm the failed behavior and regress affected paths. Do not retry until an accidental pass. |
| External/local network interruption | Verify restoration and normally retry the affected flow once. Persistent failure is an environment blocker; do independent work without changing unrelated product or machine settings. |
| Driver or evidence-capture error | Correct and preflight the driver; fill independent gaps while retaining valid observations. |
| Unexplained/intermittent failure | Keep unresolved, investigate purposefully; do not assume network failure or success. |
| Unavailable tooling or owner-operated check | Record the exact gap, responsibility and prerequisite; neither a product failure nor a pass. |

A continuation requires verified preconditions. Independent observations may be supplemented separately; concurrency, continuous conversation, cancellation races and transactions require the smallest complete flow establishing that property. Never join unrelated runs into a claimed single success. A network interruption does not excuse a product invariant violation such as permanently retained capacity.

## Completion and release

A change is accepted when its intended behavior and affected regressions have valid evidence, related blocking defects are resolved, applicable permission/data/cleanup invariants hold and scope/results are traceable. Record unrelated issues separately unless they invalidate this conclusion. Business UAT targets new or materially changed workflows; established functionality does not require repeated whole-product user acceptance for every fix.

For releases, including previews, require:

1. Valid coverage of applicable promised capabilities: new executions plus reviewed inherited evidence; unknown checks remain unknown.
2. Incremental acceptance for cumulative changes from the relevant evidence baselines, with no unresolved blocking defects.
3. Evidence for the actual release artifact's integrity, startup and necessary critical-path smoke, plus applicable platform/installation/upgrade checks under the release manual. An old artifact cannot establish the new artifact's behavior.

Rebuild the full capability baseline when first establishing it, after broad architecture/protocol or material runtime/environment changes, when impact cannot be bounded, or when baseline trust is lost. Full expensive authenticated acceptance is not the default for each small release. Candidate freeze may include one affordable full automated run. Current adequate executions can also supply release smoke; do not duplicate them by label.

Report **newly executed**, **existing evidence still valid**, **needs verification**, **product failure**, **environment blocked**, **owner-operated**, and **not applicable with rationale** separately. Keep execution outcomes separate from applicability/validity. Inheritance is not a new execution, a blocker is not an exemption, and CAP/Q row counts are not development completion percentages. Explicitly record any maintainer release-risk decision; never relabel an exception as passing.

## Records and checker transition

Use a small repository-local coverage table and the existing evidence store; no separate test-management platform or per-test approval workflow is required. The minimum mapping is:

```text
Check ID | Capability IDs | Criteria / required layer | Mode / platform
Affected dependencies | Flow / run IDs | Evidence and observed result
Target validity: new / inherited / needs verification / blocked
Cumulative comparison and rationale | Reviewer / owner | Next action
```

The schema-2 checker implements check-level coverage, shared executions and cumulative validity reviews; schema 1 remains compatible for historical records. Preserve original identities and failures, archive manifests before migration and validate target reviews instead of resetting all capabilities. Unknown or affected checks remain gaps. The checker cannot establish evidence authenticity or replace external readiness and actual artifact checks. See the [evidence manual](acceptance-evidence.md#checker-compatibility).
