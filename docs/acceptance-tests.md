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
- [CAP-011: Native search, content and transport compatibility](#cap-011)
- [Candidate results](#result-record)
- [Adding and maintaining cases](#extend-cases)

<a id="release-requirements"></a>

## Release requirements and case index

The maintainer reviews the applicable CAP-001–006, CAP-008–011 and Q01–Q17 cases before publication. Exercise new or affected behavior, retain reviewed valid evidence and combine compatible checks in shared flows. Record the agreed scope and keep passed, failed, unexecuted and explicitly deferred items distinct. Do not reopen completed or excluded work merely because a checklist row combines several observations. This is manual capability acceptance: neither `bun run verify` nor GitHub Actions runs or enforces these cases automatically, and no fixed JSON manifest is required.

| ID | Capability | Coverage applicability | Key pass evidence |
| --- | --- | --- | --- |
| [CAP-001](#cap-001) | Code Mode, parallel tools, native patch, and result readback | Every release | Actual `Promise.all` reads inside `exec`, both returned values, patch event, and matching output file. |
| [CAP-002](#cap-002) | Asynchronous cell lifecycle and waiting | Every release | One 15-second task, a running cell, `wait` on that cell, and the recorded result. |
| [CAP-003](#cap-003) | Real delegation, parallel execution, aggregation, and read-only boundaries | Every release | Three distinct agents, actual tool execution, completed results, and before/after file checks. |
| [CAP-004](#cap-004) | Explicit family, five effort positions, Fast/non-Fast context budgets and send accounting | Automatic-mode releases; DEV account with both families and Pro | Ten family/effort menu checks, four live read/write routes, catalog budgets and model receipts. |
| [CAP-005](#cap-005) | Send accounting, receipt recovery and separate references | Automatic mode releases | Live sends/compaction, fault fixtures, bilingual UI and migration evidence. |
| [CAP-006](#cap-006) | Offline activation and runtime enforcement | Licensed releases; required alongside CAP-001–005 coverage | Activation before language; actual signed import; expiry/device/tamper rejection; Web/MCP and artifact evidence. |
| [CAP-007](#cap-007) | Optional GitHub support (retired) | No longer applicable | Feature removed; ID reserved. |
| [CAP-008](#cap-008) | Runtime logs and diagnostic bundles | Every desktop release | Readable history; native ZIP export; date boundaries, redaction, correlation and collection coverage. |
| [CAP-009](#cap-009) | Global queue and MCP round handoff | Every release containing the scheduler; UI/MCP steps apply to their supported modes | Launcher controls, standalone cross-process ownership, shared capacity, send spacing, main plus three children, physical release and explicit recovery. |
| [CAP-010](#cap-010) | Aggregate HTTP body budget | Every release containing the Responses service | Shared Responses/compact accounting, size/depth rejection, 503 overload and reservation cleanup; isolated synthetic evidence. |
| [CAP-011](#cap-011) | Native search, content and transport compatibility | Changes to search, attachments, output controls, context or Responses transport | Actual native search/tool results; validated content and output; explicit opaque-context errors; recorded HTTP/WebSocket continuation and cancellation. |

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
| Q15 | Scheduling and execution settings save together; defaults change drafts only and saving restores default provenance, including unchanged numbers. Subsequent explicit edits pin only those fields. Restart preserves settings and DEV/production remain isolated; configuration and DEV checks. |
| Q16 | Waiting work participates in unfinished-work guards; global cancellation covers waiting/running tasks without leftovers during stop/update/removal; lifecycle fixtures and applicable native gates. |
| Q17 | Queue/send/failure/cancel correlation is accurate, diagnostics exclude credentials and complete prompts; redaction/export evidence and CAP-008 for native export. |

<a id="preparation"></a>

## Preparation

Follow the [standard isolated test procedure](development.md#standard-isolated-test-procedure): start with `bun run dev:launcher`, verify DEV ownership, use a separate DEV browser profile with the current candidate source and the authorized web-login procedure, and run real Codex tasks through `bun run dev:codex`. Simulators and fixture browsers do not replace authenticated Web model acceptance.

For source-launcher dependency changes, verify preparation completion before the application-ready deadline, preparation failure and signal propagation without application startup, and packaged-executable behavior. After an Electron upgrade, record the actual engine version and cover affected native window, input protection, storage and page isolation fixtures, then the authenticated native tool task. Keep first-use download measurements separate from application-ready timing and installer validation.

1. Record candidate version, commit, an identifier for uncommitted differences, the loaded runtime, Codex version, OS/architecture, account plan, complete Web model ID, effort, and interaction/tool modes. Capture production configuration/authentication hashes and process identities first.
2. Use **Native Tools + Automatic** for the baseline and explicitly select an account-supported Web model and effort. Children retain that model; do not switch to a native API to pass. Cover additional modes, models, and platforms required by the release scope; one successful combination does not establish all combinations.
3. Replace `<TEST_DIR>` with the absolute path of a new, owned DEV fixture directory in which the task may write. Do not overwrite existing files in the user's working project. Run CAP-001 and CAP-002 sequentially, with CAP-002 continuing the same Codex conversation and directory.
4. For CAP-003, prepare a separate DEV source copy matching the candidate. Replace `<PROJECT_DIR>` with its absolute path and `<WEB_MODEL_ID>` with the actual model ID. Start a new conversation with a read-only sandbox; neither parent nor children may write source, logs, or build artifacts. Record the initial file inventory, hashes, and Git state.
5. Parallelize only the three children inside CAP-003; do not run other authenticated acceptance concurrently. The external test operator records logs, snapshots, and results outside the project being analyzed; do not delegate worklog writes to read-only children. Recheck the production boundary afterward as required by the isolation procedure.

Copy the prompts below after replacing path and model placeholders. Tool names, parameters, and scopes come from the current Codex declarations; top-level availability does not establish an export in exec's `tools` object.

<a id="cap-001"></a>

## CAP-001: Code Mode parallel reads and native patch

For native message compatibility changes, verify that real prose preceding a tool call reaches Codex as `commentary`, tool calls and results retain their order, and the final answer is `final_answer`. Check reconnect replay for duplicate text/tools and keep invalid tool blocks out of visible answers. For compaction-policy changes, check the published threshold, native compaction and continuation without trimming input; distinguish a local SSE/usage fixture from authenticated browser acceptance. For send preparation changes, cover delayed/missing sliders, unchanged explicit selection, unsent preparation failures, and unknown sends that remain paused without replay. Failed child receipts must retain their reason rather than claim user cancellation.

For Send diagnostics and lifecycle changes, verify that full model preflight completes before taking the shared send permit and that final selection/identity/cancellation checks still precede input. Cover unobstructed and obstructed trial failures, actual click errors/timeouts, readiness changes and missing acknowledgements, each selecting one composer Enter. Button disabled/missing state or a modal must not gate fallback. Cover successful/prevented Enter, composer focus recovery, already-confirmed sends, late/ambiguous acceptance, listener expiry and cancellation. Preserve each input error and bounded facts; never retry Enter or activate after cancellation. Distinguish permit/call/event/acceptance evidence and check that page content is absent from ordinary diagnostic errors. Exercise the real native read → patch → command assertion → final path in authenticated DEV, including fallback and a continued/background page; label synthetic DOM faults separately from live acceptance and historical root-cause claims.

Observe acceptance while an input call is pending. A confirmed receipt must stop the pending input, wait for its actual settlement, and prevent a late click or another Enter; it must not release the page or permit early. Also cover receipts arriving during composer/readiness checks. Concurrent observation must not press modal buttons or rebind the page, and a real in-flight DOM observation error must reach the established recovery path even when input finishes at the same time. Verify these races with controlled operations and an isolated browser; keep authenticated DEV evidence separate.

Execution-recovery coverage includes a disappearing/rebuilt model menu with one bounded retry and strict model/effort verification, cancellation, and terminal mismatch/locked/unsupported choices. Check native reply failure categories, argument privacy, unchanged retry limits and atomic event replay. Queue delivery updates require the original settled owner, reject stale sequences and never retain a browser slot; old receipts remain unconfirmed. Render Web completed and native delivery states in both languages. Replay missing-final structural evidence and public-final positive cases; candidate diagnostics must not expose private bodies/identities or override completion checks. Repeated fallback logging must preserve counts/times without altering waits. For multi-agent acceptance, separately observe the parent and child outcomes; do not stop children merely because the parent fails.

For model-control evidence changes, cover missing and foreign description references, remounted nodes with unchanged DOM IDs, owner binding, unknown descriptions, cancellation, and private sample limits. A description beyond the diagnostic sample must still be able to reject a conflicting selection. Ordinary logs/error JSON must exclude control text and raw references; only the bounded private failure archive may contain those samples. Historical unknowns without source evidence remain unknown.

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

For native context-resynchronization changes, extend the owned file task with a controlled `codex_context_resync` response before a tool call is delivered. Verify one fresh `complete` submission, unchanged model/effort/tool controls, actual native patch and command assertion afterward, and normal reuse on the next round. Record controlled fault injection separately from a naturally occurring missing-context failure. Fixtures must cover image/file/skill encoding without source mutation, genuine prefix edits, two compaction epochs, stale or mixed signals, terminal second failure, parallel task isolation, HTTP reconnect and explicit cancellation without duplicate tool delivery. Include reconnects whose input now contains the bridge progress message: cancellation must prevent another browser submission, while a new native turn remains usable. Original prefix hashes stay internal; attachment-integrity checks remain enforced. These focused checks do not require rerunning unrelated capabilities.

For answer-delivery changes, test normal completion independently from text stability: a long unchanged draft with active Stop/tools, user stop with copy controls, stale completion notices, explicit failed/interrupted terminal metadata, and a fresh completion after a tool batch. Completion starts a separate 120-second extraction allowance. A complete supported response source may deliver without answer DOM or HTTP connection closure; a pending renderer read must not block source events or cancellation, and only one read may remain outstanding.

Final extraction tests must accept complete final edits, reordered paragraphs, changed links and non-prefix replacements before any body is emitted. Preserve code, formulas, Windows paths, tables and native tool arguments literally. In append mode, reject changes to bytes actually emitted; do not freeze un-emitted drafts based on their age or node identity. Partial/virtualized DOM, missing code lines, old versions, wrong branches and unsupported semantic components cannot become complete by waiting. Test the observed 120-line source/57-line DOM case without concatenating sources or using the final marker as proof.

Replay the archived 26-event public projection with chunk sizes 1, 7, 17 and 4096. Cover context-keyed snapshot/patch operations, final fallback versions, reference patches and code-point offsets with non-BMP characters. Verify UTF-8 splits, SSE framing, identity binding, hidden-content exclusion, negative termination and late frames. Test passive automatic resume with proven current-message ancestry, independent transport framing and late callbacks; unproven continuation must not be merged or cause another Send. Distinguish public diagnostic projections from exact private wire capture.

Preserve atomic complete-event journaling, exact reconnect replay, tool-call IDs and consumer-error propagation. Check observer disposal, read-only retained failure pages, expiry/capacity release and no failed-page continuation. Diagnostic logs must omit answer text, credentials and hidden content; private artifacts remain bounded. Original failed evidence stays visible.

Authenticated DEV acceptance follows the isolated procedure: verify the requested model/effort, real native read → patch → command evidence, continuation/compaction, cancellation followed by a new task, the original read-only report, and a main agent plus three real children. All three child reports and the main final report must complete. Compare native wait intervals against Web leases and compare production baselines before/after. Distinguish fixtures, controlled fault injection and natural failures; list deferred/unexecuted cases. Reuse unaffected evidence, and do not treat disabled tools or model substitution as a pass.

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

The release-preparation run follows the maintainer's per-release decision under the [independent-session regression procedure](development.md#independent-review-regression). Start a new DEV main session on an isolated copy of the current candidate, not the implementation conversation. Preserve the complete task below instead of replacing it with a small delegation fixture.

**Prompt**

```text
Actually delegate to 3 Codex child agents working in parallel; do not act out three roles yourself.
Project path: <PROJECT_DIR>. All three children must use GPT-6 (Web) high: model chatgpt-web/gpt-6-sol, reasoning effort high; do not switch model, effort or provider.
Use delegation tools actually declared or discovered in the current Codex task; do not guess tool names.

Child 1: Review the current project's code conventions and maintainability read-only. Cite concrete paths/lines, triggers and consequences; distinguish defects from style preferences.
Child 2: Review the current technical design read-only, including browser interaction, state and metadata ownership, tool authority, completion/recovery and unnecessary complexity.
Cite source evidence, distinguish existing behavior from proposals, and do not call a static inference a reproduced failure.
Child 3: Research relevant technology and open-source projects using actual official upstream sources. Access relevant repositories and verify their licenses.
Give source URLs, useful design comparisons and adoption limits. Report access failures honestly; memory or search snippets do not establish repository access.

Wait for and summarize all three results, listing the actual child IDs and their conclusions, then close the completed children.
Analyze only throughout. Do not modify or create any project files, write worklogs, run builds or tests that produce files,
commit, publish, or create additional children. If actual delegation, parallel execution, or GitHub access cannot be completed,
report the failed step explicitly; do not simulate success. Keep the read-only sandbox and normal permission boundaries.
```

**Pass criteria and evidence**

- There are three distinct real child IDs, parent relationships, and delegation events, with overlapping execution lifetimes. Preserve Codex's current call controls: when `parallel_tool_calls=false`, create children with separate calls across model rounds; use a parallel batch only when the declared tools and controls permit it. Create all three before waiting for their results. Serial creation can still produce concurrent children; completing each child before creating the next, or describing three roles, does not establish parallel delegation. Verify concurrency from native task events, not from a single HTTP request or tool batch.
- Verify each child's actual GPT-6 Web model, high effort and read-only sandbox from runtime records or equivalent evidence. An instruction to inherit the model does not by itself prove that the model stayed unchanged.
- Child 3 has successful official upstream repository access and license evidence. Children 1 and 2 have real source-read records and conclusions matching their assignments. Record individual page failures and do not support claims with failed page access.
- All three children complete, and the parent actually receives their results and returns an aggregate answer. Successful creation, CLI exit code zero, or a child's success claim alone is insufficient.
- Before/after project file inventories, content hashes, existing modifications, and untracked files remain identical; inspect file-change events as well. Do not clean existing changes. Any project write fails the case.

The read-only requirement covers both parent and children. Store the report in the external evidence directory; these tasks must not write into the analyzed project to document their acceptance.


<a id="cap-004"></a>

## CAP-004: Model family, effort and shared budget

Applies to every release containing Automatic mode. Use an authenticated DEV account under the isolation procedure exposing GPT-5.6 Sol, GPT-6 and all five efforts; missing account capabilities mean not executed. Follow this page's preparation and use a task-owned workspace.

1. Starting from the default model, alternate between both families and Fast (web Instant), Medium, High, Extra High and Pro. Use the shared adapter to verify the actual selected family and slider position. Retain menu evidence, including layouts with a separate version header. Manual preselection must not bypass adapter selection.
2. Run a real DEV Codex task for each of GPT-5.6 Sol, GPT-5.6 Sol Pro, GPT-6 and GPT-6 Pro. Choose a non-Pro effort for ordinary entries and fixed max for Pro. Supply an input file and prompt: “Read input.txt, write result.txt using a native patch, then run a command to verify that its content matches the input, and report the result.” Retain actual tool calls, readback and artifact hashes; verify matching browser and usage-receipt models.
3. Existing `chatgpt-web/gpt-5.6-sol-instant` and `chatgpt-web/gpt-6-sol-instant` slugs remain unchanged, display as Fast, and stay separate with fixed `low`. Ordinary entries offer `medium`, `high` and account-available `xhigh`, sharing the non-Fast budget with fixed-`max` Pro. Equal window values do not merge Fast into ordinary entries. Fast/non-Fast standard context windows are fixed at 80,000/272,000 tokens. Usable capacity (95%) and auto-compaction thresholds (90%) are derived values, explained once as percentages in the UI. Verify the budget section follows Execution waiting; read-only 80k/272k values must preview the selected mode exactly. Supported routes offer triple budgets, with fixed windows of 240,000/816,000. Verify equal windows do not merge entries; cover Luna, manual profiles and compatibility IDs without treating every technical low as Fast. Message limits stay unchanged; catalog checks do not prove actual capacity or recall.

   Verify read-only windows and draft-only standard/triple switching in Runtime parameters. Reject saves with active HTTP/browser or queued tasks without interruption. After idle saves, runtime, preflight and catalog budgets must agree; a stale catalog or failed verification must not clear the Codex restart prompt. Keep the 32 KiB threshold independent. Record passed, failed and unexecuted checks separately; fixtures do not establish live capacity or recall.

   Load legacy 96,000/300,000 windows with user/default/missing sources and verify normalization to 80,000/272,000. Preserve valid standard/triple choices and verify 240,000/816,000 in triple mode. Reject retired numeric/default CLI flags and stale numeric IPC calls. Check both budget modes through UI and supported CLI switches; no editable window fields remain. Configuration acceptance does not establish actual input capacity or recall.
4. Isolated DOM fixtures cover both 6/GPT-6 labels, hidden or inert menus, wrong families and conflicting announcements. Include the retained Chinese `6 极高，第 4 项，共 5 项。` announcement and `6 极高` header, all four exact Chinese effort labels (`即时`, `中`, `高`, `极高`), unchanged `Pro`, mixed English/Chinese descriptions in both header/announcement directions, and negative cases for stale effort, wrong family/radio/slider and unknown labels. For changes to this recognition, complete a focused authenticated read/patch/command task through the shared adapter and inspect the affected effort controls. Record the labels actually observed: an English label on a Chinese-language page does not prove live Chinese recognition. Failed verification must block sending; fixtures do not replace authenticated steps 1 and 2. Reuse reviewed evidence for unchanged flows and distinguish it from newly exercised labels.

Missing selection, execution or file evidence, or accepting 5.6 as 6, fails the case. Ordinary GPT-6 messages must count separately without consuming Pro counters. On Chinese Pro pages, a delayed assistant node while “停止” is visible must not be treated as stopped generation; the generation phase retains its own deadline, without a shared allowance across preparation and extraction. Close only the case-owned DEV pages/tasks, compare the production boundary and retain evidence.

For viewport or response-extraction changes, also run the isolated Electron model-picker fixture at 100% and 125% zoom: changing the selected tab, finishing another tab, and hiding/showing the window must preserve the open picker and pane dimensions. A temporary native window size of 0×0 must preserve valid renderer measurements instead of collapsing the pane to 1×1. Run response DOM regressions for file-preview movement, repeated paragraphs, empty paragraphs that later receive text, and KaTeX source preservation. Final snapshots may change text or links before delivery; only conflicts with bytes actually emitted on append paths must fail. Complete an authenticated DEV read → patch → command task with the rebuilt shared runtime. New configurations and missing history preferences must select Temporary Chat; existing explicit history preferences must survive reload. Fixture results alone are not authenticated acceptance.

Context-file changes cover the 32768-byte UTF-8 boundary, original roles/tools/results, attachment processing failures/cancellation and count limits. Reuse authenticated read → patch → command checks with beginning/middle/end facts affecting actual output and small inline inputs. Check missing/default/user sources independently for files and budgets; only user choices survive, and disabling files clears triple. After compaction, revised history or cancellation, superseded tool pages release while exact response replay and other tasks remain intact. An empty queue alone must not unlock a page awaiting real tools. Separate fixture and authenticated DEV evidence.

For launcher window/authentication changes, scope additional manual checks to: normal launch and one-time old-size migration, including promotion of the previous 900×600 default and preservation of later manual choices; 1000×660 and 900×600 DIP windows; compact scaling with no automatic sidebar collapse, viewport-filling large windows without magnified controls, readable prose and full-width logs/queues/browser panes; manual sidebar choice and maximize/restore; English/Chinese rendering and native browser hit targets. In authenticated DEV, verify sign-in recovery after restart, opening an already loaded browser, explicit retry, and a failed/interrupted probe that remains retryable without enabling connection checks prematurely. Test bounded navigation interruption, concurrency, busy/manual mode and destruction in fixtures; keep those results separate from real session recovery.

For retained native-tool page cleanup, interrupt while a real Codex command is running, after the Web response has finished. Check the native Interrupt hook result, exact page release and a subsequent real tool call. Verify Windows quoted paths and stdin, source/bundle interrupt entry parity, the native three-second hook deadline and safe restoration of older installed hooks. A manual call to the control endpoint proves release logic, not automatic hook delivery.

For browser input protection, run `node launcher/scripts/smoke-browser-input.mjs` and `node launcher/scripts/smoke-browser-input-ui.mjs` in isolated fixture profiles. Verify the visible English/Chinese notice, attempted-input feedback, direct IPC rejection, running/tool-wait/retained/manual states, cancellation failure and concurrent ownership. In a verified DEV task, attempt physical pointer, keyboard/IME, paste, wheel, touch/drag and shortcuts while automation performs read → patch → command verification; confirm automation still clicks, types and uploads. Observe tab switching, visibility and maximize/restore without exposing an unprotected page. Electron `sendInputEvent` and CDP fixture checks do not establish physical OS input coverage; record unavailable input devices and untested platforms separately. The browser stop action ends a Web round, not independently executing Codex tools. Reuse unaffected prior acceptance evidence.

Also verify that the real DEV notice follows the application language. Idle home, manual pages and sign-in popups must default to blocked input. Check Enable interaction confirmation/cancellation, selected-page isolation, Block interaction, protection on new pages/restart/next automatic round, and stale confirmation rejection. Task completion and closing authentication must not unlock the underlying page. An override must not claim the task stopped or unlock other pages; global zoom remains locked while automatic pages are open. Record native-dialog and physical-input checks separately from mocked confirmation tests.

<a id="cap-005"></a>

## CAP-005: Local send accounting and receipt recovery

Applies to Automatic mode releases. Use an authenticated separate DEV profile under the isolation procedure, an owned workspace and the shared candidate runtime.

1. Record the initial per-account counts. Run the CAP-004 read/patch/command task using an available non-Pro model. Compare accepted Web submissions with the ledger delta, selected model/effort and task/tool-result purposes. A tool call without a Web send adds no message.
2. Exercise a real isolated compaction and verify a compaction-purpose receipt only when it submits a Web message. The context budget does not multiply send counts.
3. In an owned transport fixture, lose an acknowledgement after persistence and interrupt delivery before persistence. Restart the receipt consumer; each accepted ID appears exactly once. Pending activation without acceptance stays separate. Corrupt entries remain preserved and visible as an error. These fault fixtures do not replace authenticated steps 1–2.
4. Render both languages and a narrow window. Model rows combine efforts and send purposes; the Pro total includes both families and unidentified Pro records, excludes ordinary Sol and agrees with receipt evidence. No separate effort table is shown. Browsing another policy tier or period never changes the account counts or selected Web model. Unknown caps use `-`, the selected reference period stays visible, and concise explanations follow their respective tables. Source and verification status remain in policy metadata.

Retain receipt/tool/file evidence, old-ledger migration results, lifecycle state and production-boundary comparison. Missing delivery evidence, duplicate charging, a replayed Web send, or an official balance derived from local rolling counts fails the case.

<a id="cap-006"></a>

## CAP-006: Offline device licensing

Settings boundary: with missing, expired, invalid and not-yet-ready activation, edit and save every applicable control on Preferences and Runtime parameters, including restoring defaults. Verify persistence after restart, unchanged active runtime values, blocked task execution and explicit application after activation/setup. Cover partial application, expiry during application, stale revisions and idle checks. Language and ordinary window preferences remain editable; DEV still disables OS autostart. Render Chinese/English and narrow windows. Validate login items with fixtures; actual OS sign-in requires a disposable test system.

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

For storage changes, exercise **Storage & cache** in both languages and narrow windows: measurement, refresh, successful cleanup, failure and busy-task rejection. A real isolated Electron session must retain cookies, Local Storage and IndexedDB after HTTP/code cache cleanup; fixtures alone do not prove an authenticated account remains signed in. Test helper archive export, size/age retention and service writes through an already-open descriptor. Verify version collection with current/rollback, active process, late process discovery, recovery records, malformed/unknown trees and redirected paths. Installer/upgrade acceptance stays on a disposable VM or dedicated OS. Check window foreground requests before creation, without `ready-to-show`, after load, when minimized, after user hide and during intentionally hidden autostart; record real upgrade relaunch separately from window fixtures.

Use the current desktop candidate in verified DEV storage. Create fault records only in owned fixtures; do not interrupt production networking, processes or authentication. Keep synthetic fixture results separate from actual desktop export evidence.

1. In both languages and a narrow window, verify that complete redacted JSON is readable without a table or per-record expander. Compact/wrapped and globally formatted views must parse into identical records, retaining original timestamps, events, levels, duration and fields across language changes. Exercise full-JSON case-insensitive search, including highlights across key/value punctuation, level/source and exact trace/request filters, history pagination, keyboard selection and copying. Escaped quotes, newlines, Unicode and HTML-like text must remain literal JSON; wrapping must not overflow the page. Reading older records pauses updates; showing the latest resumes them.
2. From the DEV desktop, export a ZIP through the native save dialog for all retained logs (the default), the last 24 hours and a custom local date/time range. Cancel once without creating a file. UI filters must not limit the exported records. Verify the recorded timezone and inclusive start/exclusive end, including exact-boundary fixture records; reject invalid ranges.
3. Open the actual archive and inspect its summary, timeline, export-time snapshot and manifest. Reconstruct a known fixture timeout or tool/process failure using shared request/session/trace identifiers. Verify source timestamps, severity and safe correlation survive helper/service forwarding and export, including navigation error descriptions. Model selection must distinguish an attempted but failed check from verification, and tool delivery from execution results. Verify source coverage and checksums. Do not treat the export-time snapshot as the state at the time of the fault.
4. In owned fixtures, cover rotated history, malformed records, missing/unreadable sources, oversized sources and persistence failures. Available records must remain exportable, with applicable partial collection, truncation and errors reported. Verify bounded launcher retention without deleting unrelated files. Include structured cancellation at the Responses boundary, network causes and combined operation/cleanup failures; error codes and safe cause chains must survive correlation without exposing internal stacks in public responses.
5. Verify that credential/content sentinels, raw tool content and browser profiles are absent. Check that export cannot overwrite application source data. Record screenshots, native save outcomes, archive inspection, fixture results and production boundary comparisons; preserve earlier failures.
6. With a large owned fixture, verify cached cursor paging and search reuse, unchanged-source byte counts, stable pages across appends/rotation, explicit snapshot expiry and cancellation of superseded queries. Measure initial indexing, keyword search, cached page latency and memory separately. Cover byte-limited pages, complete oversized-record copying and bounded DOM nodes; pagination must not skip or repeat records. Exercise 25/50/100/200 records per page (default 100), persisted choice after reopening, and resetting to the first page without changing filters or pause state. Reject unsupported sizes and mismatched size/cursor pairs; a preference write failure must retain the previous selection.

An unreadable ZIP, leaked sentinel, hidden collection failure, incorrect date boundary or lost fault correlation fails the case. Backend or renderer fixtures alone do not establish the native desktop save flow; record that step as unexecuted until exercised. No authenticated model task is required for this case; it does not replace the other cases' live tool acceptance. Preserve evidence and remove only individually owned fixtures.

<a id="cap-009"></a>

## CAP-009: Global Web request queue

For handoff protocol changes, exercise explicit v1 and v2 endpoints and bindings. V2 submission schemas must omit and reject caller `submission_id`; the host returns a stable identity for equivalent object-key order, while array/code/string differences conflict. Check versioned submission names against a stale catalog, cross-version/expired bindings, cancellation, single-call limits, exact tool identity, Zero Risk recursive-bridge exclusions, physical settlement and failed durable writes. Verify both CLI and Launcher tunnel commands preserve the selected version and unsupported choices fail. Fixtures in `handoff-v2.test.ts` cover local protocol behavior; authenticated Automatic and Zero Risk acceptance remains separate and requires website-verified DEV tunnel ownership and actual connector binding under the authorized resource-creation procedure.

For queue transport changes, reset one isolated HTTP status-poll connection and verify recovery with the same owner and deadline, without a new browser attempt. Repeated resets, explicit owner rejection and malformed responses must still fail. Drop a response for enqueue, send-begin, send-end and settlement separately and verify these operations are not replayed by the poll recovery rule. Keep credentials out of retry diagnostics.

Use the current candidate and isolated DEV. Record configuration revision, request/session IDs, actual send and cleanup times, and real Codex tool evidence.

1. Verify the independent Runtime parameters page: defaults 4/30 minutes/3 seconds, draft-only defaults reset, hot save, reload persistence and unlicensed backend rejection. Verify save/discard/keep-editing navigation, Escape/focus, invalid drafts, failed saves, saved-but-unapplied status, duplicate clicks, stale revisions and draft recovery after renderer restart. Automatic task display must preserve edited settings. Check both languages and narrow windows, then queue filters, paging, cancellation and related logs.
   When retention/execution parameters change, additionally check the default target 5, idle 30 minutes, silence 5 minutes, attachments 2 minutes and retry limit 3; manual-only submission defaults are 60/120 seconds. Verify allowed choices, per-field user sources across restart, one revision for saving the whole form, new-request snapshots, pinned existing retention/retry/manual deadlines, protected tool-wait pages, unchanged execution concurrency, extended attachment substeps without bypassing completion/failure checks, helper compatibility, and the enclosing manual compaction wait. Select affected fixture and authenticated DEV cases; do not repeat unrelated queue flows.
2. Submit 50 requests through isolated HTTP clients; verify shared capacity, session fairness, count/byte protection, timeout and cancellation. These fixtures do not replace authenticated Web evidence.
3. Run a real DEV Codex main agent with three children, each of the four agents reading its own independent file; children must not spawn further agents. Check Native Tools and MCP Bridge separately. With one MCP slot, children must finish after the parent releases its Web round, and the parent must deliver a successful final response using all actual results. Preserve tool events, all four file results and call IDs. File execution followed by a parser, queue-retry or final-response failure is not a pass.
4. Check spacing against actual-send logs. Waiting must not consume execution timeout or create pages. Lowering concurrency must not terminate running work; cancellation retains capacity until physical cleanup.
5. Follow the inventory's `submission_tool` and `submission_field`: single `call` object for `parallel_tool_calls=false`, otherwise the advertised `calls` batch. Reject arrays at the single-call schema and preserve parallel-call rejection at the batch endpoint. Verify server-derived round identity/state in inventory and manual-start replies: queries and failed validation keep the round open, old receipts do not close a new round, live duplicate starts are idempotent, and committed starts are rejected. Verify default 20-entry paging, query misses that retain discovery routes, exact namespace queries and unchanged schemas. Manual mode must exclude known recursive bridge methods, including app-prefixed aliases, while retaining unrelated tools. Check a two-round discovery continuation without an exec gateway: native `tool_search_output` must retain the discovered namespace and schema, and the next round must deliver the declared tool with its exact identity. Check that one successful submission atomically validates, registers and seals the batch, returning `sealed: true`, `execution_state: "not_executed"` and `next_action: "end_web_response"`. Accepted does not mean executed: end the Web response without a separate `codex_yield_turn`. Verify that delivery and execution remain blocked until the completion fence commits, physical Web/browser resources settle and a durable delivery-intent receipt is persisted; receipt failure must block delivery. Before completion is committed, identical retries with the same `submission_id` must retain batch/call IDs even when structured argument keys change order; optional repeated `codex_yield_turn` acknowledgements must be idempotent. Reject conflicting submissions and calls after commitment or cancellation; cancellation before delivery must prevent execution and retain capacity until physical cleanup. Check canonical results in the next request, including approvals/refusals, namespaces, freeform inputs, structured/error metadata and multimodal results. Reject incorrect bindings and undeclared identities without execution; correction must use the exact current binding and catalog. Preserve Codex's tool-choice and parallel-call controls, sandbox and approval policy. Zero Risk still requires user send and completion confirmation per round; atomic submission does not replace either confirmation or permit delivery before them, and the application performs no DOM automation.
6. Inject rate limits, unknown sends, owner disconnect and restart. Require pause or explicit failure, no resurrected receipts and no duplicate sends. Recovery must be explicit and cannot release still-running pages. Check bilingual preflight/waiting/input/acknowledgement/reconciliation labels and the original blocking-task log link. Progress updates must authenticate their owner, reject stale/terminal updates, and never grant a permit or confirm acceptance. For task-isolated Native Tools uncertainty, prove input/callback settlement, unique page/helper ownership, continued slot occupancy until cleanup, unchanged global pacing, and independent sibling progress. Missing proof, shared authentication/rate-limit failures, MCP, ambiguous surfaces, lost leases and unfinished receipts after restart must retain protection. Exercise concurrency one, late receipts and duplicate settlement; neither isolation nor recovery revives ended requests. Verify the bilingual Task isolated label. Joined standalone clients without host-observed page proof remain global.
7. In owned standalone fixtures, join one canonical profile from separate CLI processes and path aliases; verify one owner, shared capacity/send permits and unchanged model/tool choices. A distinct profile and Launcher must remain independent. Reject unauthenticated, wrong-generation and cross-profile transport calls. Lost clients retain occupied physical resources; owner loss must not start a replacement pool.
8. Check standalone `browser queue status` against persisted receipts, including an offline owner. Configure all three settings while stopped; verify ranges, persistence and next-start application, and rejection while owned or when configured for Launcher. Recover only after verifying that the old runtime and its owned browsers stopped, using `browser queue recover --confirm-browser-stopped`. Require rejection without confirmation or with a live owner, failed unknown-outcome receipts, no automatic recovery/replay and no reuse of retained request IDs.

9. In Automatic MCP, verify a normal completed reply without `codex_finish_turn`, both before any tool and after real tool results; an exact reconnect must not resend. Empty replies, unfinished batches, active/late MCP activity and a required tool choice must not become successful prose replies. With one slot, record the parent's retained conversation identity before waiting and after re-admission, together with the actual child results. In browser-host fixtures, cover more than five waiting conversations, the independent cache bound, ordinary versus waiting expiry, and cancellation/explicit close; retained pages must not increase active Web concurrency. Zero Risk retains explicit reply and user completion confirmation.

10. For remote MCP recovery changes, cover current/foreign bindings, real tool results versus model prose, bounded streamed error metadata, helper transport, 401/403/quota exclusion, explicit Retry-After and 30/60-second jitter. Verify at most two retries (or the smaller configured limit), physical settlement plus atomic no-activity retirement, rejection of late claims and any prior activity, cooldown isolation/cancellation/expiry/restart, one recovery admission per scope, and separate local/remote UI states in both languages and narrow windows. Authenticated DEV must preserve model/effort/connector, prove actual file/command effects if delivery succeeds, and retain a real remote failure as a failed live acceptance when it does not.

11. For tunnel readiness changes, cover green local probes with zero successful polls and structured 401/403 failures. Desktop and CLI must reject readiness, report credential/permission repair, and avoid automatic restart with the same rejected key. Missing metrics remain unknown; an old successful poll under idle long polling is not itself a failure. After replacing an invalid DEV key, verify successful polling and a real command/file task separately from the negative and fixture checks.

Record desktop UI, standalone/HTTP/protocol fixtures, authenticated Native Tools, automatic MCP and manual/Zero Risk results separately. An unexecuted live path cannot be replaced by another mode, synthetic stress or historical results.

For timeout changes, exercise sequential operations whose combined duration exceeds the former enclosing cap while each stays within its own [operation limit](reference.md#independent-operation-timeouts). Verify attachment settings of 2/3/5/10 minutes never shorten input/card waits, compaction clocks start at their actual phase boundaries, and cancellation retains ownership until cleanup. Test helper exit/disconnection separately from a healthy long-running operation; test independent tunnel probes and concurrent per-connection WebSocket cleanup. Preserve exact model/effort, permission and single-send checks. Controlled clocks and browser fixtures prove timing behavior; the authenticated DEV task must separately demonstrate real command results and complete final-body delivery. Keep fixture, native Codex/environment failures and confirmed Web2Harness defects separate in the record.

Browser-check recovery: restore an old unknown-send pause, run the shared connection check without sending, and show blocked verification with recovery navigation rather than a connection/runtime fault. Confirm recovery only for the reviewed pause state, with no active resources; preserve manual pauses and never replay old requests. Verify successful checks followed by failure/cancellation, sign-out/account change, late results, process restart, and blocker summaries after receipt expiry. Cover bilingual narrow UI and an authenticated DEV send after recovery.

<a id="cap-010"></a>

## CAP-010: Aggregate HTTP body budget

Use isolated service/body fixtures on the current candidate, without browser login or production traffic. Record configured limits, HTTP statuses, reservation/peak counters and cleanup evidence; label these results synthetic, not authenticated Web acceptance.

1. Verify one 256 MiB estimated allocation pool across Responses and compact, including native passthrough, with independent pools for separate services. Submit 50 small pending bodies without imposing a Codex agent limit, then 50 large synthetic bodies that exhaust the pool; require HTTP 503 `request_body_overloaded`, `Retry-After: 1`, and estimated reservations never above the configured budget. Full initial admission must reject before pulling the body.
2. Check 64 MiB encoded, 128 MiB decoded and 512-level JSON limits independently of aggregate overload; boundary fixtures may isolate each limit with explicit test budgets. Check absent/false Content-Length, dense JSON, split UTF-8, zstd expansion/windows and concatenated frames. Oversize/depth violations return 413; malformed bodies return 400 and release reservations.
3. Cover queued work, JSON/SSE responses, compact and native forwarding. A disconnect or delivered terminal event must not release execution reservations before actual adapter cleanup; cancellation and decompression failure must settle reader/decoder resources. After all work settles, reservations return to zero and a new request is admitted. Preserve native request bytes and explicit model/metadata choices.
4. Record the HTTP allocation estimate separately from scheduler waiting bytes and any observed RSS. The 256 MiB estimate is not a hard RSS cap; a synthetic stress pass does not establish real browser concurrency or authenticated MCP/manual acceptance.

<a id="cap-011"></a>

## CAP-011: Native search, content and transport compatibility

For attachment-card/response-removal changes, reproduce a visible owned card whose exact-name remove control is hidden until hover; retain duplicate-card rejection and normal actionability for removal. Cover top-level valueless removal of citations, content references, fallback metadata and optional completion metadata, matching existing nested-patch semantics and diagnostic replay. Missing values on other operations, unknown fields/paths, foreign identity and incomplete terminal markers must not become successful output. An authenticated DEV task with bounded injected conditions proves those paths, not the exact cause of a historical event whose payload was withheld.

For pending commentary, cover a growing, structurally complete block that disappears before stabilization; successful source and DOM completion must deliver its remaining text once before the final answer. Exclude incomplete drafts and status/answer roots; cancellation must not flush, and callback failures must propagate. Verify model-confirmation diagnostics for stale/missing descriptions, mismatched radio/slider and read failure without accepting a different selection or logging picker text. Distinguish an unsolicited helper AbortError from caller/queue cancellation. Native-reply diagnostics must separate validation failure, journal commit and observer failure; an exact reconnect must still replay one committed reply without another browser send.

Same-request reconciliation covers missed stream/terminal events, transient/persistent body-read failures, conflicting file IDs and cancellation/timeout during a pending read. At most two original-response reads may recover valid completion within the attempt's deadline; otherwise retain unknown completion without POST replay. Late completion cannot reverse a terminal failure. Confirm permanent HTTP failures do not mutate attachments, stage evidence exists before termination, and explicit retries retain independent limits. For public commentary, compare normalized source/continuations, native tool-block projection, journal and emitter fingerprints; distinguish emitter return from client receipt, preserve source short sentences, and keep delivery unchanged when diagnostics fail or reach their bound.

For attachment recovery, inject one ordinary upload failure on a verified DEV task page. Check removal of only that card, a delay of at least 3 seconds, one reupload with identical bytes and an independent processing timeout, then real native read → patch → command → final delivery. Separately verify explicit HTTP 429 performs no removal/reupload/Send, a second ordinary failure returns the first error, cancellation stops recovery, and uncertain submission never permits replay. A browser fixture does not establish authenticated acceptance.

For attachment observation, distinguish a processing timeout from an explicit upload failure. Verify that an unavailable CDP response body, a processing response without completion, and an unconfirmed processing connection end return nonretryable observation errors without removing/reuploading files or clicking Send. A stalled streaming-observation command must allow bounded fallback to a finished response, while late events from an old attempt cannot complete a replacement attempt. Verify per-file diagnostic correlation and redaction, and preserve the same model, effort, full context and native tool semantics.

Verify the HTTP status actually observed by the runtime. In the tested Electron version, a `webRequest.onCompleted` listener makes CDP `Fetch.fulfillRequest` responses report status 0, while real server statuses remain intact. An injected “429” that arrives as 0 is not a quota-classification test. Measure the retry delay from the recorded retry event or an exact removal event; a periodically sampled absent card only bounds the removal time.

When investigating final-body loss, enable private browser diagnostics for the focused DEV run and compare the pre-cleanup public source, delivered text and DOM observation with the actual Codex final output. Include automatic continuation when observed. Record missing evidence as inconclusive; representation differences alone do not establish dropped content. New successful captures cannot retrospectively resolve an uncaptured historical failure.

For preparation-failure replay, retain the original error across native reconnects and WebSocket/HTTP changes, without a second browser attempt or a queue identity conflict caused by runtime byte estimates. Keep the initial byte reservation and terminal receipt; changed model, effort, authority and owner still fail their identity checks. Prove that a new user instruction can recover independently, and keep an upstream attachment-upload failure separate from the bridge's replay behavior.

Applies to Native Tools changes affecting search routing, attachments, output controls, context or Responses transport. Use an isolated DEV profile, an authenticated account and the selected model/effort. Keep fixture results separate from real model and tool acceptance; apply the preparation and teardown boundaries above.

1. Reapply Native Tools configuration and restart the DEV Codex client. Preserve `web_search` mode, filters and location. Prompt: “Use native Codex web search to find one official documentation page, cite its source, read input.txt, patch result.txt and verify it with a command. Report each actual result.” Confirm native `web.run` reaches the search service with its exact query/settings, real results return to the model and the file matches. Disabling search or replacing it with browser-internal browsing does not pass. Exercise cached/live and filters at the forwarding boundary; verify integration restoration and user-edit conflicts with isolated configuration fixtures.
2. Supply valid inline PDF/text/DOCX/XLSX/PPTX and images as applicable. Confirm original bytes/MIME reach the browser and the model identifies a unique fixture marker. Cover malformed, encrypted, oversized and unsupported references separately; parser acceptance alone is not upload/model acceptance. Local file tools are a separate capability.
3. Require a complete `json_object` and strict schema result. Invalid final output must fail before successful delivery; tool-only rounds remain usable. Verify effective unsupported generation controls fail before sending, while null/no-override values and command-tool budgets remain intact. Estimates must remain labelled estimates.
4. Cover original plaintext V2 collaboration, author/recipient boundaries and the supported direct-call empty encrypted-arguments marker. By default mixed plaintext/ciphertext, native reasoning/compaction, encrypted tool outputs and malformed bridge envelopes must fail before browser work without dropping history, changing model/effort or repeating tools. Test explicit `X-Web2Harness-Reasoning-Migration: visible-history` separately: only native reasoning resets, visible fields and tool results remain exact, the model and caller receive the reset notice, and continuation retains the original input. Other ciphertext and unknown policy values remain blocked. Visible summaries do not prove complete export; rejection and explicit reasoning reset are not lossless migration acceptance.
5. Verify HTTP/SSE and WebSocket tool roundtrips, then named/default-lane FIFO, bounded cross-lane concurrency, fork/cache loss and full-history recovery. Test auth/account/organization/project separation, memory-only WebSocket/prepared histories and HTTP descendants across unrelated snapshot flush/restart. Preparation must do zero model/browser/tool/download work. Test natural-completion steering: ordered acceptance, original settings on automatic successors, pending tool results/approvals, same-lane explicit continuation settings, one-time input application and failure before successor commitment. Unsupported earlier-boundary steering must not fabricate completion. Disconnect affects only owned connection work; drain/shutdown preserve cleanup. No documented Responses `response.cancel` client frame is a gate; native interrupt and background HTTP cancellation are separate. Record actual transport; synthetic dispatch and HTTP fallback are not authenticated WebSocket passes.
6. For URL references, verify task/provider/account-scoped exact grants, validation before DNS, all-address public checks, pinned HTTPS/TLS, no ambient credentials/proxy, independently authorized redirects, original bytes/MIME, bounded memory/time and cancellation cleanup. Cover URLs in normal/tool-result content, preparation without network, invalid/missing history, unsupported provider file IDs in both modes, authorized remote audio, and raw-video rejection. For inline Codex input_audio, verify supported format identity, user/native-tool-result ordering and call IDs, original-byte hashes through upload, mixed attachment limits, and real audio understanding without supplying a transcript. Check the actual CLI model catalog and native request: a successful MCP call alone does not prove Codex retained the audio. Distinguish file creation, byte transfer, upstream processing and model understanding in the evidence. MP4/WebM video tracks must not masquerade as audio. Use injected network fixtures for unsafe targets; live acceptance uses only authorized public fixtures. Prepared IDs do not prove download/model acceptance.
7. For standalone image generation/edit when the actual CLI advertises it, verify its native executor, original image model, incoming auth, output bytes/events/artifacts and task permissions. Preserve parent Web model/effort. Record generic hosted web/image/computer/file-search/interpreter/MCP blockers separately: no fabricated function, disabled tool, guessed endpoint, new container or arbitrary native-model fallback counts as equivalence. A hosted approval shape in steering tests does not certify hosted execution.
8. For reliability changes, inject a late unique input-bound acknowledgement after the initial send deadline: at most one Send activation and one confirmation, with cancellation, duplicate/mismatched requests and lost observation retaining their proper failure/fence. Unknown remote effects stay globally protected; page closure is insufficient. Verify failure-only bounded private capture before detach, privacy projection/revocation, explicit gaps, content-free normal diagnostics and offline-only replay. Success/cancel must not create the artifact. Preserve historical unknown causes and missing original streams; fault fixtures do not establish live incident resolution.

For terminal-metadata changes, verify a bound unique successful final, end_turn and both stream terminators remain sufficient when optional metadata is absent. Explicit negative completion, invalid finish, unfinished final, wrong lineage or identity and late mutations must still fail. Cover reversible Markdown composer serialization without accepting changed content, destinations, literal backslashes or whitespace; cover completed EOF tool fences with full JSON/schema validation and rejection of truncated JSON or trailing prose. Preserve the existing source/DOM coverage, cancellation and readiness cases. Unsupported semantic events must not hide later termination or identity/server failure.


For interruption diagnostics, inject client/queue cancellation and helper EOF/shutdown in isolated fixtures; verify immutable first-event linkage, per-request/per-attempt separation, unchanged original errors and settlement, and independent-error attribution. Verify model history distinguishes aria/header disagreement, control remounts, deduplicated states and bounded loss without page text. Rotate/export a failure context and test write-failure coverage. Authenticated DEV must cancel an owned submitted task, settle to zero active resources, and complete a new native read → patch → command assertion → final task without restarting the runtime. Fixtures establish logging behavior; a passing DEV task does not reproduce or prove repair of a historical reset.

For zero-final recovery, test active generation followed by independent 120-second reconciliation, a late public final on the same saved branch, a foreign branch/new user, an active tool leaf, explicit interruption and expiry without a final. Temporary chats must not enable saving/readback. Saved readback may refresh the same idle page once; count generation submissions and tool executions to prove neither is repeated. Preserve original stream and readback evidence separately; a fixture pass is not authenticated incident recovery.

Cover both legacy `mapping` and current paginated `messages` readback. Observe the actual page GET and turn identifiers. Saving may omit/reparent private nodes; that alone must not reject a completed public answer. Missing exact user/current leaf, mismatching turn identifiers, conflicting public finals or explicit interruption must still prevent recovery. A real saved-page response combined with a simulated missing-final stream is schema/replay evidence, not a naturally reproduced missing-final incident.

Verify same-request body recovery only after normal transport completion, at most once, with no resend or acceptance of a semantic failure. Interrupt the native response observer at visible prose and tool-call emission: exact reconnect must replay one validated reply with stable tool identities and one terminal, with no additional browser send. Keep failure archives separate from normal trace rotation; test exclusive bounded reservations, archive-full diagnostics, legacy evidence preservation and directory-link boundaries. Repeat the actual read-only analysis and parallel three-agent review, including the main final report; child completion alone is insufficient.

Diagnostic fixtures also cover observed `delta_encoding`/`message`/`delta` events, structural-only projection of hidden `model_editable_context`, unknown/error withholding, and chunked replay matching direct facts/results without retaining checked private values. A matching successful sample is not reproduction of a missing-metadata failure.

Recorded scoped results for the reviewed unreleased candidate (2026-10-18): real CLI resume/interrupt/recovery passed with zero HTTP fallback, and public-PDF URL reading, independent prefill and natural-boundary steering passed through shared components. Original failed evidence is retained. These results do not certify remote-image live input, raw media, Codex file-tool end-to-end execution or every CAP-011 capability; see the [verified scopes](native-tools-compatibility.md#evidence).

Later [authenticated native acceptance (2026-10-20)](investigations/2026-10-20-capability-followup/five-native-capabilities.md) passed CLI JSON Schema output, native public-image download → viewing → continuation, MP3/M4A/WebM/OGG tool-result audio, a native edit with two image references, and app-server `turn/steer` while a native tool was pending. Existing WAV evidence is reused. Direct HTTPS image input and raw FLAC encounter restrictions in the tested official Codex client before bridge input; retain those failed attempts separately. The feasible workflows do not certify the bridge's direct image-URL resolver, earlier-boundary steering, native ciphertext migration or generic hosted tools.

Reuse CAP-001–003, CAP-009–010 and valid existing evidence where the same observations apply. Record tool events, settings, file/attachment hashes, transport and lifecycle outcomes, production boundary comparisons and all unexecuted or failed paths. See [capability boundaries](native-tools-compatibility.md).

<a id="result-record"></a>

## Candidate results

The [2026-10-18 task records](native-tools-compatibility.md#evidence) preserve passing single-task read-only analysis and failed three-agent parallel review. All three child reports arrived, but the main final answer failed; body-delivery acceptance remains open. Preserve both outcomes when validating a later fix.

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
| CAP-011 | Pending | Not executed | To record | To record |

The table above is an empty example, not an instruction to rerun every case. Record completed observations separately from any remaining part of a composite case. Label Passed / Failed / Not executed, identify reused evidence, and record any maintainer decision to exclude or defer work with its reason and responsibility. Deferral is not a pass. Distinguish model output, bridge conversion, the Codex executor and permission/account/network conditions; do not blame a layer without evidence.

<a id="extend-cases"></a>

## Adding and maintaining cases

When adding a target capability or changing an existing one, add or update its acceptance case, identifying fixture and live requirements, and execute it before publication. Continue numbering at `CAP-012`; do not renumber for a new version or reuse old IDs. Keep English and Chinese IDs, prompt semantics, and pass criteria aligned, and update the index above.

Document each new case's mode/platform/account applicability and required environment, then include its affected behavior in the manual acceptance scope. Reuse a flow where its observations cover several requirements. Keep actual failures visible and document maintainer scope or deferral decisions separately. Retain retired IDs with the reason and replacement reference.

Use this format for additions:

```text
ID and name: CAP-012: <target capability>
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
