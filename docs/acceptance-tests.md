# Release capability acceptance tests

[English](acceptance-tests.md) | [简体中文](acceptance-tests.zh-CN.md) · [Release manual](release.md) · [Documentation](../README.md#documentation)

This document maintains reusable capability cases: prompts, pass criteria and required fixture or live evidence. It supports manual acceptance and is not a record of passed results. Select cases from the agreed change/release scope, preserve each execution's actual version and review relevant changes before reusing earlier evidence. A model's success claim or fixture does not establish a live pass.

**Contents**

- [Release requirements and case index](#release-requirements)
- [Queue requirements Q01–Q17](#queue-requirements)
- [Preparation](#preparation)
- [CAP-001: Code Mode parallel reads and native patch](#cap-001)
- [CAP-002: Code Mode waiting and same-task continuation](#cap-002)
- [CAP-003: Three real agents performing parallel read-only analysis](#cap-003)
- [CAP-004: Model family, effort and shared budget](#cap-004)
- [CAP-005: Local send accounting and receipt recovery](#cap-005)
- [CAP-006: Offline device licensing](#cap-006)
- [CAP-007: Optional GitHub support (retired)](#cap-007)
- [CAP-008: Runtime logs and diagnostic bundles](#cap-008)
- [CAP-009: Global Web request queue](#cap-009)
- [CAP-010: Aggregate HTTP body budget](#cap-010)
- [Candidate results](#result-record)
- [Adding and maintaining cases](#extend-cases)

<a id="release-requirements"></a>

## Release requirements and case index

The maintainer reviews the applicable CAP-001–006, CAP-008–010 and Q01–Q17 cases before publication. Exercise new or affected behavior, retain reviewed valid evidence and combine compatible checks in shared flows. Record the agreed scope and keep passed, failed, unexecuted and explicitly deferred items distinct. Do not reopen completed or excluded work merely because a checklist row combines several observations. This is manual capability acceptance: neither `bun run verify` nor GitHub Actions runs or enforces these cases automatically, and no fixed JSON manifest is required.

| ID | Capability | Coverage applicability | Key pass evidence |
| --- | --- | --- | --- |
| [CAP-001](#cap-001) | Code Mode, parallel tools, native patch, and result readback | Every release | Actual `Promise.all` reads inside `exec`, both returned values, patch event, and matching output file. |
| [CAP-002](#cap-002) | Asynchronous cell lifecycle and waiting | Every release | One 15-second task, a running cell, `wait` on that cell, and the recorded result. |
| [CAP-003](#cap-003) | Real delegation, parallel execution, aggregation, and read-only boundaries | Every release | Three distinct agents, actual tool execution, completed results, and before/after file checks. |
| [CAP-004](#cap-004) | Explicit family, five effort positions, triple budget and send accounting | Automatic-mode releases; DEV account with both families and Pro | Ten family/effort menu checks, four live read/write routes, catalog budgets and model receipts. |
| [CAP-005](#cap-005) | Send accounting, receipt recovery and separate references | Automatic mode releases | Live sends/compaction, fault fixtures, bilingual UI and migration evidence. |
| [CAP-006](#cap-006) | Offline activation and runtime enforcement | Licensed releases; required alongside CAP-001–005 coverage | Activation before language; actual signed import; expiry/device/tamper rejection; Web/MCP and artifact evidence. |
| [CAP-007](#cap-007) | Optional GitHub support (retired) | No longer applicable | Feature removed; ID reserved. |
| [CAP-008](#cap-008) | Runtime logs and diagnostic bundles | Every desktop release | Readable history; native ZIP export; date boundaries, redaction, correlation and collection coverage. |
| [CAP-009](#cap-009) | Global queue and MCP round handoff | Every release containing the scheduler; UI/MCP steps apply to their supported modes | Launcher controls, standalone cross-process ownership, shared capacity, send spacing, main plus three children, physical release and explicit recovery. |
| [CAP-010](#cap-010) | Aggregate HTTP body budget | Every release containing the Responses service | Shared Responses/compact accounting, size/depth rejection, 503 overload and reservation cleanup; isolated synthetic evidence. |

The applicability column guides manual scope selection. These cases and the [release manual's](release.md#authenticated-runtime) cancellation, compaction, reuse, MCP, platform and installation checks may share evidence when the same observations establish the required behavior. Revalidate affected behavior or invalidated assumptions, and preserve valid results elsewhere.

<a id="queue-requirements"></a>

## Queue requirements Q01–Q17

These are stable references for the queue behavior covered by CAP-009, not seventeen additional execution jobs. Use them to choose and review affected scenarios within the agreed scope. The protocol, standalone and mode requirements in CAP-009 remain applicable.

| ID | Required behavior and evidence |
| --- | --- |
| Q01 | Shared capacity and session fairness for 20–50 synthetic requests; no immediate failure merely at request six within backlog limits; small authenticated counterpart. |
| Q02 | Mixed models/efforts share capacity and preserve actual explicit selections; fixtures and DEV. |
| Q03 | A parent plus three children complete real tasks through supported Native Tools and MCP paths, with actual tool/file-change evidence; no recursive child delegation. |
| Q04 | Small-capacity parent/child dependencies complete without hidden over-admission, leaked capacity or silent deadlock; state/protocol fixtures and bounded DEV checks. |
| Q05 | Queue expiry starts at first admission, retries do not renew it and expired work is not sent; record real streaming/non-streaming client waiting limits. |
| Q06 | Cancelled waiting requests never dispatch; cancellation/retry races do not duplicate pages, sends or capacity release; fault fixtures. |
| Q07 | Triple budgets, compaction and continuation preserve send spacing and avoid duplicate capacity acquisition/self-deadlock; fixtures and DEV. |
| Q08 | Lowering concurrency preserves running work, existing queue deadlines remain, new sends use changed spacing, and save/apply feedback is truthful; unit and DEV checks. |
| Q09 | Rate limits pause the correct scope, retries are bounded and network/account-limit failures are distinguishable; synthetic faults, not deliberate real-account limiting. |
| Q10 | Crashes/lease loss/restart retain ownership until physical state is verified, do not blindly resend unknown outcomes or resurrect old queues; isolated faults. |
| Q11 | Count/byte backlog limits, paged metadata without full prompt transfer, sampled peak memory and query latency; local pressure fixtures. |
| Q12 | Unlicensed users can read but cannot mutate/dispatch; expiry while waiting cannot bypass enforcement and safe stop remains available; fixtures and isolated DEV. |
| Q13 | Manual mode never auto-sends, its submission deadline starts in execution and UI does not promise enforced user click spacing; real manual DEV flow. |
| Q14 | Forms, tables, buttons and stable feedback remain usable in normal/maximized/narrow windows, with narrow overflow limited to the table; DEV UI. Session choices follow state/search across all pages, empty results expose no sessions, and the first page detects new tasks. Verify family/Pro/effort labels and matching model searches. |
| Q15 | All three settings save together, defaults change drafts only, restart preserves settings and DEV/production remain isolated; configuration and DEV checks. |
| Q16 | Waiting work participates in unfinished-work guards; global cancellation covers waiting/running tasks without leftovers during stop/update/removal; lifecycle fixtures and applicable native gates. |
| Q17 | Queue/send/failure/cancel correlation is accurate, diagnostics exclude credentials and complete prompts; redaction/export evidence and CAP-008 for native export. |

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

- There are three distinct real child IDs, parent relationships, and delegation events, with overlapping execution lifetimes. Preserve Codex's current call controls: when `parallel_tool_calls=false`, create children with separate calls across model rounds; use a parallel batch only when the declared tools and controls permit it. Create all three before waiting for their results. Serial creation can still produce concurrent children; completing each child before creating the next, or describing three roles, does not establish parallel delegation. Verify concurrency from native task events, not from a single HTTP request or tool batch.
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

For Context as File changes, use `context.file-contracts` to check the 32768-byte UTF-8 envelope boundary (including Chinese and JSON escapes), exact decoded source/roles/tools/results, unchanged standard/triple budgets, and file integrity/attachment limits. Real DOM/network fixtures must reject 503, processing errors, incomplete streams and cancellation before Send; only all owned files' completion permits submission. An enabled Send button is insufficient. Use `context.files` in the same authenticated read → patch → command flow: a large first request uploads one complete TXT, beginning/middle/end sentinels affect verified output, and tool-result continuation completes. A small subsequent envelope must use inline transport. Retain upload completion, transport selection, actual tool events and output bytes; upload success alone does not establish context use. Preserve explicit mode restrictions. New or non-user-owned context preferences use files enabled and the standard budget in supported automatic modes. Check missing/default/unknown sources, explicit user off/on and user standard/triple choices independently. Only `user` preserves a stored choice; automatic synchronization must not mark a setting as user-selected. Disabling files clears the larger budget. Verify the persisted source through UI/CLI changes and restart.

For launcher window/authentication changes, scope additional manual checks to: normal launch and one-time old-size migration; 900×600 and 640×480 DIP windows; uniform canvas scaling without automatic sidebar collapse; manual sidebar choice and maximize/restore; English/Chinese rendering and native browser hit targets. In authenticated DEV, verify sign-in recovery after restart, opening an already loaded browser, explicit retry, and a failed/interrupted probe that remains retryable without enabling connection checks prematurely. Test bounded navigation interruption, concurrency, busy/manual mode and destruction in fixtures; keep those results separate from real session recovery.

For browser input protection, run `node launcher/scripts/smoke-browser-input.mjs` and `node launcher/scripts/smoke-browser-input-ui.mjs` in isolated fixture profiles. Verify the visible English/Chinese notice, attempted-input feedback, direct IPC rejection, running/tool-wait/retained/manual states, cancellation failure and concurrent ownership. In a verified DEV task, attempt physical pointer, keyboard/IME, paste, wheel, touch/drag and shortcuts while automation performs read → patch → command verification; confirm automation still clicks, types and uploads. Observe tab switching, visibility and maximize/restore without exposing an unprotected page. Electron `sendInputEvent` and CDP fixture checks do not establish physical OS input coverage; record unavailable input devices and untested platforms separately. The browser stop action ends a Web round, not independently executing Codex tools. Reuse unaffected prior acceptance evidence.

Also verify that the real DEV notice follows the application language, not only a fixture-supplied locale. Check Exit view-only confirmation/cancellation, isolation to the selected page, Restore view-only, protection on the next automatic round and rejection of a stale confirmation after selection/ownership changes. An override must not report the task as stopped or unlock other pages/global zoom. Record native-dialog and physical-input checks separately from mocked confirmation tests.

<a id="cap-005"></a>

## CAP-005: Local send accounting and receipt recovery

Applies to Automatic mode releases. Use an independently authenticated DEV profile, an owned workspace and the shared candidate runtime.

1. Record the initial per-account counts. Run the CAP-004 read/patch/command task using an available non-Pro model. Compare accepted Web submissions with the ledger delta, selected model/effort and task/tool-result purposes. A tool call without a Web send adds no message.
2. Exercise a real isolated compaction and verify a compaction-purpose receipt only when it submits a Web message. No count multiplier comes from the triple budget.
3. In an owned transport fixture, lose an acknowledgement after persistence and interrupt delivery before persistence. Restart the receipt consumer; each accepted ID appears exactly once. Pending activation without acceptance stays separate. Corrupt entries remain preserved and visible as an error. These fault fixtures do not replace authenticated steps 1–2.
4. Render both languages and a narrow window. Model rows combine efforts and send purposes; the Pro total includes both families and unidentified Pro records, excludes ordinary Sol and agrees with receipt evidence. No separate effort table is shown. Browsing another policy tier or period never changes the account counts or selected Web model. Unknown caps use `-`, the selected reference period stays visible, and concise explanations follow their respective tables. Source and verification status remain in policy metadata.

Retain receipt/tool/file evidence, old-ledger migration results, lifecycle state and production-boundary comparison. Missing delivery evidence, duplicate charging, a replayed Web send, or an official balance derived from local rolling counts fails the case.

<a id="cap-006"></a>

## CAP-006: Offline device licensing

For licensed releases, review the applicable licensing scenarios alongside the other capabilities. Use task-owned DEV storage and test keys, never production activation storage. The independent issuer stays outside Git. Customer installer acceptance uses a disposable OS and separately issued device licenses under the candidate's pinned public key.

1. Without a license, the unified Product license page opens first, before language or browser setup. All pages remain readable, including explanations and diagnostic views, but configuration, sign-in and runtime actions are disabled; Browser must not show an interactive web view. Overview shows the activation requirement and links to the same License page. Capture a copyable device code and verify no Web/MCP submission occurs.
2. Import supplied test licenses with perpetual, day-based and calendar-month validity. Check their displayed expiry, including month-end and leap-year cases. Activation precedes language setup and survives restart/upgrade. Invalid import preserves the old license. Renewal on the same page immediately updates Overview; expiry restores read-only access.
3. Reject altered signatures/payloads, unknown keys, another device, exact expiry and detected clock rollback. Direct protected IPC calls, CLI setup/start commands, new browser-control tasks/session operations, Responses/compaction and automatic/manual MCP registration must fail before work; read-only status, CLI diagnostics, stop/cancellation and cleanup remain available.
4. Under valid licenses, run a real native-tool task and real automatic/manual MCP tasks using an applicable baseline case. Retain tool/file evidence, process ownership and production boundary hashes. Mocked adapters do not replace authenticated acceptance.
5. Confirm runtime environment variables cannot replace pinned keys. Inventory artifacts: no private keys, issuer, issuer dependencies or customer license. Missing production keys and test-key release attempts must fail. Package smoke verifies the actual unactivated screen, installed runtime and clean exit; it does not establish authenticated behavior.

Record CLI/HTTP output, safe screenshots, expiry-test conclusions, artifact inventory and real tool evidence. Preserve initial failures. Missing test-device licenses or untested platforms remain unexecuted. Teardown only individually owned fixtures.

<a id="cap-007"></a>

## CAP-007: Optional GitHub support (retired)

Retired on 2026-10-10 because the support/Star prompt and its sign-in interfaces were removed at the product owner’s request. Keep this ID reserved; there is no replacement case. Validate first-run setup and branding in both languages under the development manual’s desktop UI checks.

<a id="cap-008"></a>

## CAP-008: Runtime logs and diagnostic bundles

Use the current desktop candidate in verified DEV storage. Create fault records only in owned fixtures; do not interrupt production networking, processes or authentication. Keep synthetic fixture results separate from actual desktop export evidence.

1. In both languages and a narrow window, verify that complete redacted JSON is readable without a table or per-record expander. Compact/wrapped and globally formatted views must parse into identical records, retaining original timestamps, events, levels, duration and fields across language changes. Exercise full-JSON case-insensitive search, including highlights across key/value punctuation, level/source and exact trace/request filters, history pagination, keyboard selection and copying. Escaped quotes, newlines, Unicode and HTML-like text must remain literal JSON; wrapping must not overflow the page. Reading older records pauses updates; showing the latest resumes them.
2. From the DEV desktop, export a ZIP through the native save dialog for all retained logs (the default), the last 24 hours and a custom local date/time range. Cancel once without creating a file. UI filters must not limit the exported records. Verify the recorded timezone and inclusive start/exclusive end, including exact-boundary fixture records; reject invalid ranges.
3. Open the actual archive and inspect its summary, timeline, export-time snapshot and manifest. Reconstruct a known fixture timeout or tool/process failure using shared request/session/trace identifiers. Verify source timestamps, severity and safe correlation survive helper/service forwarding and export, including navigation error descriptions. Model selection must distinguish an attempted but failed check from verification, and tool delivery from execution results. Verify source coverage and checksums. Do not treat the export-time snapshot as the state at the time of the fault.
4. In owned fixtures, cover rotated history, malformed records, missing/unreadable sources, oversized sources and persistence failures. Available records must remain exportable, with applicable partial collection, truncation and errors reported. Verify bounded launcher retention without deleting unrelated files.
5. Verify that credential/content sentinels, raw tool content and browser profiles are absent. Check that export cannot overwrite application source data. Record screenshots, native save outcomes, archive inspection, fixture results and production boundary comparisons; preserve earlier failures.
6. With a large owned fixture, verify cached cursor paging and search reuse, unchanged-source byte counts, stable pages across appends/rotation, explicit snapshot expiry and cancellation of superseded queries. Measure initial indexing, keyword search, cached page latency and memory separately. Cover byte-limited pages, complete oversized-record copying and bounded DOM nodes; pagination must not skip or repeat records. Exercise 25/50/100/200 records per page (default 100), persisted choice after reopening, and resetting to the first page without changing filters or pause state. Reject unsupported sizes and mismatched size/cursor pairs; a preference write failure must retain the previous selection.

An unreadable ZIP, leaked sentinel, hidden collection failure, incorrect date boundary or lost fault correlation fails the case. Backend or renderer fixtures alone do not establish the native desktop save flow; record that step as unexecuted until exercised. No authenticated model task is required for this case; it does not replace the other cases' live tool acceptance. Preserve evidence and remove only individually owned fixtures.

<a id="cap-009"></a>

## CAP-009: Global Web request queue

Use the current candidate and isolated DEV. Record configuration revision, request/session IDs, actual send and cleanup times, and real Codex tool evidence.

1. Verify the independent Runtime parameters page: defaults 4/15 minutes/3 seconds, draft-only defaults reset, hot save, reload persistence and unlicensed backend rejection. Verify save/discard/keep-editing navigation, Escape/focus, invalid drafts, failed saves, saved-but-unapplied status, duplicate clicks, stale revisions and draft recovery after renderer restart. Automatic task display must preserve edited settings. Check both languages and narrow windows, then queue filters, paging, cancellation and related logs.
2. Submit 50 requests through isolated HTTP clients; verify shared capacity, session fairness, count/byte protection, timeout and cancellation. These fixtures do not replace authenticated Web evidence.
3. Run a real DEV Codex main agent with three children, each of the four agents reading its own independent file; children must not spawn further agents. Check Native Tools and MCP Bridge separately. With one MCP slot, children must finish after the parent releases its Web round, and the parent must deliver a successful final response using all actual results. Preserve tool events, all four file results and call IDs. File execution followed by a parser, queue-retry or final-response failure is not a pass.
4. Check spacing against actual-send logs. Waiting must not consume execution timeout or create pages. Lowering concurrency must not terminate running work; cancellation retains capacity until physical cleanup.
5. Follow the inventory's `submission_tool` and `submission_field`: single `call` object for `parallel_tool_calls=false`, otherwise the advertised `calls` batch. Reject arrays at the single-call schema and preserve parallel-call rejection at the batch endpoint. Verify server-derived round identity/state in inventory and manual-start replies: queries and failed validation keep the round open, old receipts do not close a new round, live duplicate starts are idempotent, and committed starts are rejected. Verify default 20-entry paging, query misses that retain discovery routes, exact namespace queries and unchanged schemas. Manual mode must exclude known recursive bridge methods, including app-prefixed aliases, while retaining unrelated tools. Check a two-round discovery continuation without an exec gateway: native `tool_search_output` must retain the discovered namespace and schema, and the next round must deliver the declared tool with its exact identity. Check that one successful submission atomically validates, registers and seals the batch, returning `sealed: true`, `execution_state: "not_executed"` and `next_action: "end_web_response"`. Accepted does not mean executed: end the Web response without a separate `codex_yield_turn`. Verify that delivery and execution remain blocked until the completion fence commits, physical Web/browser resources settle and a durable delivery-intent receipt is persisted; receipt failure must block delivery. Before completion is committed, identical retries with the same `submission_id` must retain batch/call IDs even when structured argument keys change order; optional repeated `codex_yield_turn` acknowledgements must be idempotent. Reject conflicting submissions and calls after commitment or cancellation; cancellation before delivery must prevent execution and retain capacity until physical cleanup. Check canonical results in the next request, including approvals/refusals, namespaces, freeform inputs, structured/error metadata and multimodal results. Reject incorrect bindings and undeclared identities without execution; correction must use the exact current binding and catalog. Preserve Codex's tool-choice and parallel-call controls, sandbox and approval policy. Zero Risk still requires user send and completion confirmation per round; atomic submission does not replace either confirmation or permit delivery before them, and the application performs no DOM automation.
6. Inject rate limits, unknown sends, owner disconnect and restart. Require pause or explicit failure, no resurrected receipts and no duplicate sends. Recovery must be explicit and cannot release still-running pages.
7. In owned standalone fixtures, join one canonical profile from separate CLI processes and path aliases; verify one owner, shared capacity/send permits and unchanged model/tool choices. A distinct profile and Launcher must remain independent. Reject unauthenticated, wrong-generation and cross-profile transport calls. Lost clients retain occupied physical resources; owner loss must not start a replacement pool.
8. Check standalone `browser queue status` against persisted receipts, including an offline owner. Configure all three settings while stopped; verify ranges, persistence and next-start application, and rejection while owned or when configured for Launcher. Recover only after verifying that the old runtime and its owned browsers stopped, using `browser queue recover --confirm-browser-stopped`. Require rejection without confirmation or with a live owner, failed unknown-outcome receipts, no automatic recovery/replay and no reuse of retained request IDs.

9. In Automatic MCP, verify a normal completed reply without `codex_finish_turn`, both before any tool and after real tool results; an exact reconnect must not resend. Empty replies, unfinished batches, active/late MCP activity and a required tool choice must not become successful prose replies. With one slot, record the parent's retained conversation identity before waiting and after re-admission, together with the actual child results. In browser-host fixtures, cover more than five waiting conversations, the independent cache bound, ordinary versus waiting expiry, and cancellation/explicit close; retained pages must not increase active Web concurrency. Zero Risk retains explicit reply and user completion confirmation.

Record desktop UI, standalone/HTTP/protocol fixtures, authenticated Native Tools, automatic MCP and manual/Zero Risk results separately. An unexecuted live path cannot be replaced by another mode, synthetic stress or historical results.

<a id="cap-010"></a>

## CAP-010: Aggregate HTTP body budget

Use isolated service/body fixtures on the current candidate, without browser login or production traffic. Record configured limits, HTTP statuses, reservation/peak counters and cleanup evidence; label these results synthetic, not authenticated Web acceptance.

1. Verify one 256 MiB estimated allocation pool across Responses and compact, including native passthrough, with independent pools for separate services. Submit 50 small pending bodies without imposing a Codex agent limit, then 50 large synthetic bodies that exhaust the pool; require HTTP 503 `request_body_overloaded`, `Retry-After: 1`, and estimated reservations never above the configured budget. Full initial admission must reject before pulling the body.
2. Check 64 MiB encoded, 128 MiB decoded and 512-level JSON limits independently of aggregate overload; boundary fixtures may isolate each limit with explicit test budgets. Check absent/false Content-Length, dense JSON, split UTF-8, zstd expansion/windows and concatenated frames. Oversize/depth violations return 413; malformed bodies return 400 and release reservations.
3. Cover queued work, JSON/SSE responses, compact and native forwarding. A disconnect or delivered terminal event must not release execution reservations before actual adapter cleanup; cancellation and decompression failure must settle reader/decoder resources. After all work settles, reservations return to zero and a new request is admitted. Preserve native request bytes and explicit model/metadata choices.
4. Record the HTTP allocation estimate separately from scheduler waiting bytes and any observed RSS. The 256 MiB estimate is not a hard RSS cap; a synthetic stress pass does not establish real browser concurrency or authenticated MCP/manual acceptance.

<a id="result-record"></a>

## Candidate results

Keep a simple result record for the agreed candidate scope. Reference valid earlier results with the original version and the reason they still apply; do not reset them or invent a new execution. No fixed JSON schema or source-hash approval record is required. Keep raw logs, rollouts, snapshots and artifacts in ignored `output/` or private DEV storage; share only redacted conclusions. Full release metadata and confidentiality requirements are in the [release manual](release.md#validation-evidence).

Record version/commit and candidate-difference identifier, test date and operator, loaded runtime, Codex version, OS/architecture, model/effort, modes, conversation IDs, and each case's attempt number, evidence location, observed result, failure cause, and follow-up. Preserve earlier attempts when retesting.

| Case | Attempt | Status | Call/artifact/hash evidence | Actual result and issues |
| --- | --- | --- | --- | --- |
| CAP-001 | Pending | Not executed | To record | To record |
| CAP-002 | Pending | Not executed | To record | To record |
| CAP-003 | Pending | Not executed | To record | To record |
| CAP-004 | Pending | Not executed | To record | To record |
| CAP-005 | Pending | Not executed | To record | To record |
| CAP-006 | Pending | Not executed | To record | To record |
| CAP-008 | Pending | Not executed | To record | To record |
| CAP-009 | Pending | Not executed | To record | To record |
| CAP-010 | Pending | Not executed | To record | To record |

The table above is an empty example, not an instruction to rerun every case. Record completed observations separately from any remaining part of a composite case. Label Passed / Failed / Not executed, identify reused evidence, and record any maintainer decision to exclude or defer work with its reason and responsibility. Deferral is not a pass. Distinguish model output, bridge conversion, the Codex executor and permission/account/network conditions; do not blame a layer without evidence.

<a id="extend-cases"></a>

## Adding and maintaining cases

When adding a target capability or changing an existing one, add or update its acceptance case, identifying fixture and live requirements, and execute it before publication. Continue numbering at `CAP-011`; do not renumber for a new version or reuse old IDs. Keep English and Chinese IDs, prompt semantics, and pass criteria aligned, and update the index above.

Document each new case's mode/platform/account applicability and required environment, then include its affected behavior in the manual acceptance scope. Reuse a flow where its observations cover several requirements. Keep actual failures visible and document maintainer scope or deferral decisions separately. Retain retired IDs with the reason and replacement reference.

Use this format for additions:

```text
ID and name: CAP-011: <target capability>
Applicability and revalidation triggers: <modes/platforms/accounts; affected dependencies>
Prerequisites: <candidate, environment, permissions, fixture, and selected model>
Prompt and steps: <copyable; no private paths or historical conversation IDs>
Pass criteria: <observable and verifiable behavior, prohibited substitutes>
Required evidence: <tool calls, lifecycle, file/external results, boundary checks>
Shared flows/checks: <stable check IDs, reusable flows and evidence references>
Failure and non-execution criteria: <distinctions; outcomes that cannot count as a pass>
Teardown: <only verified resources owned by this test; preserve evidence>
```

Keep cases reusable over time. Whether a particular version passed belongs in its result record, not in a permanent pass statement here.
