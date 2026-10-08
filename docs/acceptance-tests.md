# Release capability acceptance tests

[English](acceptance-tests.md) | [简体中文](acceptance-tests.zh-CN.md) · [Release manual](release.md) · [Documentation](../README.md#documentation)

This document maintains repeatable live capability cases: prompts, pass criteria, and required evidence. It is a checklist for each release, not a record of passed results. Record each candidate separately; a model's success claim, fixture result, or earlier release cannot establish a current pass.

**Contents**

- [Release requirements and case index](#release-requirements)
- [Preparation](#preparation)
- [CAP-001: Code Mode parallel reads and native patch](#cap-001)
- [CAP-002: Code Mode waiting and same-task continuation](#cap-002)
- [CAP-003: Three real agents performing parallel read-only analysis](#cap-003)
- [CAP-004: Model family, effort and shared budget](#cap-004)
- [CAP-005: Local send accounting and receipt recovery](#cap-005)
- [Candidate results](#result-record)
- [Adding and maintaining cases](#extend-cases)

<a id="release-requirements"></a>

## Release requirements and case index

Run CAP-001 through CAP-005, subject to each case’s applicability, again on the current candidate before every release, including previews. All applicable cases must pass with recorded evidence before pushing a tag that triggers publication or making the release public. Failed, blocked, and unexecuted checks are not passes; retest after fixes and retain earlier failures. This is a manual publication gate: neither `bun run verify` nor GitHub Actions currently runs or enforces these cases automatically.

| ID | Capability | Frequency | Key pass evidence |
| --- | --- | --- | --- |
| [CAP-001](#cap-001) | Code Mode, parallel tools, native patch, and result readback | Every release | Actual `Promise.all` reads inside `exec`, both returned values, patch event, and matching output file. |
| [CAP-002](#cap-002) | Asynchronous cell lifecycle and waiting | Every release | One 15-second task, a running cell, `wait` on that cell, and the recorded result. |
| [CAP-003](#cap-003) | Real delegation, parallel execution, aggregation, and read-only boundaries | Every release | Three distinct agents, actual tool execution, completed results, and before/after file checks. |
| [CAP-004](#cap-004) | Explicit family, five effort positions, triple budget and send accounting | Automatic-mode releases; DEV account with both families and Pro | Ten family/effort menu checks, four live read/write routes, catalog budgets and model receipts. |
| [CAP-005](#cap-005) | Send accounting, receipt recovery and separate references | Automatic mode releases | Live sends/compaction, fault fixtures, bilingual UI and migration evidence. |

These cases do not replace the [release manual's](release.md#authenticated-runtime) cancellation, compaction, conversation reuse, MCP, platform, or installation/upgrade checks. Changes to candidate source or the loaded runtime that affect accepted behavior require new evidence for the changed candidate.

<a id="preparation"></a>

## Preparation

Follow the [standard isolated test procedure](development.md#standard-isolated-test-procedure): start with `bun run dev:launcher`, verify DEV ownership, use an independent login and current candidate source, and run real Codex tasks through `bun run dev:codex`. Simulators and fixture browsers do not replace authenticated Web model acceptance.

1. Record candidate version, commit, an identifier for uncommitted differences, the loaded runtime, Codex version, OS/architecture, account plan, complete Web model ID, effort, and interaction/tool modes. Capture production configuration/authentication hashes and process identities first.
2. Use **Native Tools + Automatic** for the baseline and explicitly select an account-supported Web model and effort. Children retain that model; do not switch to a native API to pass. Cover additional modes, models, and platforms required by the release scope; one successful combination does not establish all combinations.
3. Replace `<TEST_DIR>` with the absolute path of a new, owned DEV fixture directory in which the task may write. Do not overwrite existing files in the user's working project. Run CAP-001 and CAP-002 sequentially, with CAP-002 continuing the same Codex conversation and directory.
4. For CAP-003, prepare a separate DEV source copy matching the candidate. Replace `<PROJECT_DIR>` with its absolute path and `<WEB_MODEL_ID>` with the actual model ID. Start a new conversation with a read-only sandbox; neither parent nor children may write source, logs, or build artifacts. Record the initial file inventory, hashes, and Git state.
5. Parallelize only the three children inside CAP-003; do not run other authenticated acceptance concurrently. The external test operator records logs, snapshots, and results outside the project being analyzed; do not delegate worklog writes to read-only children. Recheck the production boundary afterward as required by the isolation procedure.

Copy the prompts below after replacing path and model placeholders. Tool names, parameters, and scopes come from the current Codex declarations; top-level availability does not establish an export in exec's `tools` object.

<a id="cap-001"></a>

## CAP-001: Code Mode parallel reads and native patch

**Prompt**

```text
Work only in the current test directory <TEST_DIR>. First create a.txt and b.txt containing ALPHA and BETA respectively.
Then you must use Code Mode exec with Promise.all to invoke two file-reading tools in parallel and return both results.
Next, call apply_patch through exec to create result.txt containing ALPHA-BETA, then read it back to verify it.
If exec is unavailable, explicitly report that; do not complete the task by another method. Do not modify files outside the test directory.
```

**Pass criteria and evidence**

- Logs contain a real Codex `exec` call whose original script dispatches two independent reading tools using `Promise.all`. One command reading both files sequentially, or returning expected constants, is insufficient.
- Actual tool results read ALPHA and BETA respectively. Retain call IDs, original tool identities, and returned results; verify that both reads completed.
- A subsequent `exec` actually invokes `apply_patch` to create `result.txt`. Retain its patch event; writing with a shell or manually supplying the file is not a pass.
- A real readback or content assertion confirms `ALPHA-BETA`, allowing a normal trailing newline. Check actual contents of a.txt, b.txt, and result.txt and the file modification scope.

Missing exec, lack of real parallel dispatch, unmet requirements after tool errors, incorrect output, or writes outside the fixture cannot be recorded as a pass.

<a id="cap-002"></a>

## CAP-002: Code Mode waiting and same-task continuation

**Prompt**

```text
Test Code Mode waiting and continuation. Work only in the current test directory <TEST_DIR>:
In exec, start a task that waits 15 seconds and returns WAIT-110-OK. Set a short yield_time_ms according to the current exec declaration
so exec first returns a running cell_id. Then call wait until you obtain the result.
Do not restart that task or start an external replacement task.
Finally, use apply_patch to write the obtained marker to wait-result.txt and read it back to verify it.
If exec or wait is unavailable, explicitly report that; do not bypass the requirement.
```

**Pass criteria and evidence**

- The original script starts exactly one 15-second task, with a yield shorter than the task delay, such as 1000ms. Actual exec returns a running state and cell ID, rather than immediate completion.
- Subsequent Code Mode `wait` calls resume that cell. Multiple waits are permitted, but the cell ID must remain identical. Record each call and final output; do not resubmit the timer script.
- Obtain `WAIT-110-OK` from the completed task, write it to `wait-result.txt` using a real `apply_patch` call, and read back matching contents, allowing a normal trailing newline.
- Retain the original script, call times, running response, cell ID, wait results, patch event, and file verification. The duration of the whole conversation does not prove that the script waited 15 seconds.

Use `setTimeout` if the active exec declaration provides it; do not infer `tools.clock__sleep` from a top-level `clock.sleep` tool. `WAIT-110-OK` is a fixed acceptance marker, not a requirement to test version 1.1.0. An attempt without a running cell and continuation of that same cell cannot pass.

<a id="cap-003"></a>

## CAP-003: Three real agents performing parallel read-only analysis

**Prompt**

```text
Actually delegate to 3 Codex child agents working in parallel; do not act out three roles yourself.
Project path: <PROJECT_DIR>. All three children must retain the current Web model <WEB_MODEL_ID>; do not switch to a native API.
Use delegation tools actually declared or discovered in the current Codex task; do not guess tool names.

Child 1: Research GitHub read-only. Find an open-source project similar to this project, actually access its repository and verify its license.
Provide the repository link, similarities, and evidence. Report access failures honestly; memory or search snippets do not establish repository access.
Child 2: Analyze the current project's implemented features read-only. Cite source paths and evidence, distinguishing static implementation from runtime validation.
Child 3: Analyze optimization opportunities or potential new features read-only. Cite source evidence, distinguish existing implementation from suggestions,
and do not describe a static inference as a reproduced failure.

Wait for and summarize all three results, listing the actual child IDs and their conclusions, then close the completed children.
Analyze only throughout. Do not modify or create any project files, write worklogs, run builds or tests that produce files,
commit, publish, or create additional children. If actual delegation, parallel execution, or GitHub access cannot be completed,
report the failed step explicitly; do not simulate success. Keep the read-only sandbox and normal permission boundaries.
```

**Pass criteria and evidence**

- There are three distinct real child IDs, parent relationships, and delegation events. Dispatch the three delegations in one parallel batch, with overlapping execution lifetimes; three sequential tasks or three role descriptions do not establish parallel delegation.
- Verify each child's actual Web model and read-only sandbox from runtime records or equivalent evidence. An instruction to inherit the model does not by itself prove that the model stayed unchanged.
- Child 1 has successful GitHub repository access and license evidence. The other children have real source-read records and conclusions matching their assignments. Record individual page failures and do not support claims with failed page access.
- All three children complete, and the parent actually receives their results and returns an aggregate answer. Successful creation, CLI exit code zero, or a child's success claim alone is insufficient.
- Before/after project file inventories, content hashes, existing modifications, and untracked files remain identical; inspect file-change events as well. Do not clean existing changes. Any project write fails the case.

The read-only requirement covers both parent and children. Store the report in the external evidence directory; these tasks must not write into the analyzed project to document their acceptance.


<a id="cap-004"></a>

## CAP-004: Model family, effort and shared budget

Applies to every release containing Automatic mode. Use an independently authenticated DEV account exposing GPT-5.6 Sol, GPT-6 and all five efforts; missing account capabilities mean not executed. Follow this page's preparation and use a task-owned workspace.

1. Starting from the default model, alternate between both families and Instant, Medium, High, Extra High and Pro. Use the shared adapter to verify the actual selected family and slider position. Retain menu evidence, including layouts with a separate version header. Manual preselection must not bypass adapter selection.
2. Run a real DEV Codex task for each of GPT-5.6 Sol, GPT-5.6 Sol Pro, GPT-6 and GPT-6 Pro. Choose a non-Pro effort for ordinary entries and fixed max for Pro. Supply an input file and prompt: “Read input.txt, write result.txt using a native patch, then run a command to verify that its content matches the input, and report the result.” Retain actual tool calls, readback and artifact hashes; verify matching browser and usage-receipt models.
3. Check that the Pro-account catalog offers four ordinary efforts and fixed max for both Pro entries. Compare standard and triple configurations for all four routes: context windows and compaction thresholds must triple while effort grouping remains identical. Single-message limits stay unchanged. Catalog checks do not establish server capacity.
4. Isolated DOM fixtures cover both 6/GPT-6 labels, hidden or inert menus, wrong families and conflicting announcements. Failed verification must block sending; fixtures do not replace authenticated steps 1 and 2.

Missing selection, execution or file evidence, or accepting 5.6 as 6, fails the case. Ordinary GPT-6 messages must count separately without consuming Pro counters. On Chinese Pro pages, a delayed assistant node while “停止” is visible must not be treated as stopped generation; the overall turn deadline still applies. Close only the case-owned DEV pages/tasks, compare the production boundary and retain evidence.

For viewport or response-extraction changes, also run the isolated Electron model-picker fixture at 100% and 125% zoom: changing the selected tab, finishing another tab, and hiding/showing the window must preserve the open picker and pane dimensions. A temporary native window size of 0×0 must preserve valid renderer measurements instead of collapsing the pane to 1×1. Run response DOM regressions for file-preview movement, repeated paragraphs, empty paragraphs that later receive text, and KaTeX source preservation; genuine edits or changed links must still fail. Complete an authenticated DEV read → patch → command task with the rebuilt shared runtime. New configurations and missing history preferences must select Temporary Chat; existing explicit history preferences must survive reload. Fixture results alone are not authenticated acceptance.

<a id="cap-005"></a>

## CAP-005: Local send accounting and receipt recovery

Applies to Automatic mode releases. Use an independently authenticated DEV profile, an owned workspace and the shared candidate runtime.

1. Record the initial per-account counts. Run the CAP-004 read/patch/command task using an available non-Pro model. Compare accepted Web submissions with the ledger delta, selected model/effort and task/tool-result purposes. A tool call without a Web send adds no message.
2. Exercise a real isolated compaction and verify a compaction-purpose receipt only when it submits a Web message. No count multiplier comes from the triple budget.
3. In an owned transport fixture, lose an acknowledgement after persistence and interrupt delivery before persistence. Restart the receipt consumer; each accepted ID appears exactly once. Pending activation without acceptance stays separate. Corrupt entries remain preserved and visible as an error. These fault fixtures do not replace authenticated steps 1–2.
4. Render both languages and a narrow window. Model rows combine efforts and send purposes; the Pro total includes both families and unidentified Pro records, excludes ordinary Sol and agrees with receipt evidence. No separate effort table is shown. Browsing another policy tier or period never changes the account counts or selected Web model. Unknown caps use `-`, the selected reference period stays visible, and concise explanations follow their respective tables. Source and verification status remain in policy metadata.

Retain receipt/tool/file evidence, old-ledger migration results, lifecycle state and production-boundary comparison. Missing delivery evidence, duplicate charging, a replayed Web send, or an official balance derived from local rolling counts fails the case.

<a id="result-record"></a>

## Candidate results

Create a separate result record for each candidate. Keep raw logs, rollouts, snapshots, and artifacts in ignored `output/` or private DEV storage; share only redacted conclusions. Full release metadata and confidentiality requirements are in the [release manual](release.md#validation-evidence).

Record version/commit and candidate-difference identifier, test date and operator, loaded runtime, Codex version, OS/architecture, model/effort, modes, conversation IDs, and each case's attempt number, evidence location, observed result, failure cause, and follow-up. Preserve earlier attempts when retesting.

| Case | Attempt | Status | Call/artifact/hash evidence | Actual result and issues |
| --- | --- | --- | --- | --- |
| CAP-001 | Pending | Not executed | To record | To record |
| CAP-002 | Pending | Not executed | To record | To record |
| CAP-003 | Pending | Not executed | To record | To record |
| CAP-004 | Pending | Not executed | To record | To record |
| CAP-005 | Pending | Not executed | To record | To record |

Use Passed / Failed / Not executed. A blocked check remains non-passing with its reason recorded. Distinguish model output, bridge conversion, the Codex executor, and permission/account/network conditions during diagnosis; do not blame one layer without evidence.

<a id="extend-cases"></a>

## Adding and maintaining cases

When adding a target capability or changing an existing one, add or update its live acceptance case and execute it before publication. Continue numbering at `CAP-006`; do not renumber for a new version or reuse old IDs. Keep English and Chinese IDs, prompt semantics, and pass criteria aligned, and update the index above.

New cases join the every-release baseline by default. If a case only applies to specific modes, platforms, or accounts, document those conditions and the required environment; execute it for every applicable release. Do not narrow scope, lower pass criteria, or relabel unexecuted checks as inapplicable to bypass a failure. Retain retired IDs with the reason and replacement case reference.

Use this format for additions:

```text
ID and name: CAP-006: <target capability>
Scope and frequency: <every release, or explicit mode/platform/account conditions>
Prerequisites: <candidate, environment, permissions, fixture, and selected model>
Prompt and steps: <copyable; no private paths or historical conversation IDs>
Pass criteria: <observable and verifiable behavior, prohibited substitutes>
Required evidence: <tool calls, lifecycle, file/external results, boundary checks>
Failure and non-execution criteria: <distinctions; outcomes that cannot count as a pass>
Teardown: <only verified resources owned by this test; preserve evidence>
```

Keep cases reusable over time. Whether a particular version passed belongs in its result record, not in a permanent pass statement here.
