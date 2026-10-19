# Answer delivery evidence index — 2026-10-19

[English](evidence.md) | [简体中文](evidence.zh-CN.md) · [Archive conclusions](README.md)

Follow conclusion C → evidence E → archived summary/source S → original record R/V and SHA-256. This index preserves the facts needed without requiring ignored local logs. Original relative paths and hashes are in [provenance](evidence/provenance.json). It is an investigation inventory, not a release acceptance manifest or raw network replay.

| Material | Content and evidence level |
| --- | --- |
| [observations.json](evidence/observations.json) | Derived browser-observation summaries from existing records; not raw SSE/DOM |
| [validation-summary.json](evidence/validation-summary.json) | Allowlisted fields from existing task verification, cancellation predicates, and observation source baseline; no model/predicate rerun for archiving |
| [source-snapshot.json](evidence/source-snapshot.json) | Working-tree SHA-256, line numbers, and verbatim source excerpts S01–S07; HEAD alone does not identify this dirty tree |
| [provenance.json](evidence/provenance.json) | Archive hashes, original relative paths/hashes and availability; no authentication, private raw logs or browser state |

<a id="e01"></a>

## E01 — Two production incidents

Sources: R01 (October17 incident), R02 (two-thread coverage investigation). These summarize prior rollout/queue/installed-manifest inspection. Production was not reread or rerun for this archive. Times below are Asia/Shanghai.

| Case | Recorded facts | Unsupported inference |
| --- | --- | --- |
| October17 multi-agent | Body checks failed at22:31:21/22:33:41; unknown send paused the queue at22:37:05; two unstarted requests expired at22:52:12/19 after15minutes | Insufficient concurrency is not established; the low-level missing-acceptance event remains unknown |
| October18 read-only | Five successes; sixth failed at11:31:23 with missing_pending_content; buffered/emittedChars=0/observedSegments=36; no pause;180frames and DONE telemetry | Counts are not raw response replay; exact DOM changes and the other task's queue chain cannot be inferred |
| Version | Both source IDs matched the then-current stable2.4.0 manifest without the new response-source markers | Not failure to update, and not proof of a later unpublished-source regression |

R01 also records four offline causal probes and68regressions. Synthetic pending table growth from`Al`to`Alpha` triggered the actual buffer's rejection; increasing concurrency did not release a globally paused queue. These establish code paths, not the exact production table mutation. Missing original streams/adjacent DOM limit attribution.

<a id="e02"></a>

## E02 — Same-task authenticated DEV pass

Sources: R03/V01. Real Codex`0.162.0-alpha.17.2`, `chatgpt-web/gpt-6-sol/xhigh`, read-only sandbox, approval=never.947.844seconds,35commands (34successful; one corrected regexp-escaping error), nine successful Web requests; turn.completed and4564characters. The file, native final_answer, task_complete and CLI event agreed; booleans and the result hash are retained.

An initial verifier searched only phase=final and missed final_answer. Only the ignored verifier was corrected; the model/output was not rerun or altered.888project files, HEAD and Git status were unchanged; the original record reports production-boundary checks passing. This authentic new-source DEV pass is not exact historical replay or proof against all intermittent failures.

<a id="e03"></a>

## E03 — Overall three-agent task failure

Sources: R04/V02. All three actual children retained the requested model/effort/read-only context; parent linkage and overlapping lifetimes were verified. Actual peak Web concurrency was4. The parent was observed in native wait without an active Web request while three children executed.

- Reports of7648/8620/3214characters reached the parent. Code review was sampled, not verified coverage of all82changed files.
- After4286.756seconds the parent ended turn.failed/exit1; final delivery failed twice, parentReportExists=false.
- 139 requests: 128 successful, ten failed, one intentional cancellation. Failures comprised five source validations, four body alignment failures, and one model-control failure. The verifier labels the last transport reason upstream_server_error; that field alone does not establish a server root cause.
- 44 native sampling retries, automatic HTTP fallback and tool-call-block relay failure remain recorded. Ten of 266 commands were nonzero, including nine PowerShell constrained-language reads; local sandbox command errors are not all bridge defects.
- The first two detailed source artifacts were pruned by ordinary ten-directory rotation. Six later artifacts were retained, some explicitly replayable=false. There is no complete original-wire archive.

Overall FAILED remains despite child delivery. The outer coordinator's result.md is a separate synthesis, not successful parent output. V02 retains passed=false/taskCompleted=false and failure counts; R04 preserves the initial verifier's mistaken report-file assumption and ENOENT.

<a id="e04"></a>

## E04 — Implemented repairs and latest verification limits

Sources: R05 (body repair), R06 (continued acceptance), R07 (independent timers). These are existing implementation records; archiving adds no product pass count.

- Implemented targeted changes include source termination/message boundaries, late content/evidence retention, table hydration/wrappers, model-selector races, and native receipt replay. Historical source artifacts3/5 were replayed; others were unavailable or non-replayable, so blanket closure is unsupported.
- One live table-wrapper rejection retained pending/committed/final DOM; targeted repair replay produced7680characters matching the final snapshot. The complete un-emitted prefix requirement still exists (S05).
- A later live boundary-final probe failed in46.836seconds with zero commands: subtracting attachment baselines/configuration produced1ms, a confirmed Web2Harness regression. Subsequent reconnects had unresolved queue_identity_conflict.
- The user approved independent operation timers without cross-step total allowances, retaining cancellation, ownership and normal permissions. Native wait and model usage quotas are separate.
- Final combined core evidence:1755passed/80skipped; launcher:688passed/4skipped. Types, builds, audits and relocated-package smoke passed. **These combine a failing full run with scoped corrected reruns, not a claim that a final full command had zero failures.** Intermediate failures remain.
- The user deferred latest authenticated short/full-three-child tasks pending a report. Restricted-token, fake-clock, stale-threshold and fixture-ceiling failures remain distinguished from product defects; production/system settings were not altered to pass.

Current thresholds belong in the [configuration reference](../../reference.md); this archive does not introduce a competing operating table.

<a id="e05"></a>

## E05 — First direct Chrome research generation

Sources: R08/R09. UI GPT-6/Extra High, request`gpt-6-thinking/max`; one new-chat public Codex-source research prompt requesting feature tables, code, Mermaid, formulas, citations and lists.196changed DOM states, temporary WeakMap node identities and CDP network observation. This did not execute through Web2Harness.

| Check | Observation |
| --- | --- |
| Lifecycle |496.871seconds; longest unchanged text242.303seconds,898characters with Stop still present |
| Intermediate/final state | Intermediate merged message finished_successfully/end_turn=false; final end_turn=true, message_stream_complete and DONE |
| Continuation | Initial ERR_CONNECTION_CLOSED; automatic resume RESET/NETWORK_CHANGED then200SSE completion; no manual resend; ERR_ABORTED after completion |
| Representations | innerText7044, textContent14174, HTML189382, public fallback Markdown8928characters; lengths do not prove equivalence |
| Copy | Whole answer18988characters with Mermaid CSS and missing source/three code languages; separate diagram source418characters/16lines matched public source |
| References/media |18reference markers/120private-use characters;18images were32×32source favicons, not body images; references need resolution |

The outer turn and answer root stayed stable in this sample; no remount was reproduced. The logical answer involved fragments, merging and context`c`updates; `c`is not the final/commentary channel. The initial temporary projector ignored context and duplicated fragments; correcting the observer yielded public merged content. That observer error is not evidence of product corruption.

No complete raw SSE/DOM files were retained. This archive contains existing written tool/memory observations and derived summaries. Copy changed the clipboard; observers/timers/network listening were stopped. A retrospective summary must not be labeled raw replay.

<a id="e06"></a>

## E06 — Six browser scenarios

Sources: R10/R11/V04. All requests retained`gpt-6-thinking/max`. Durations below run from generation POST start to its network end. The cancelled603characters are public Markdown;631is DOM text, not an equivalence comparison.

| Scenario | Seconds | Public Markdown characters | Outcome |
| --- | ---: | ---: | --- |
| Two Python calls and rich report |148.262|3733| Completed; totals274/211 and difference63 independently checked; actual image, CSV preview, chart, formula, code and Mermaid |
| Long follow-up |62.175|3506| Completed;12sections,24table rows,120assignments and code/body end markers |
| Regeneration |59.961|3450| Completed; same user turn, new assistant revision/root |
| Edited branch, tool error recovery |20.534|255| Completed; Python division error followed by16; new user turn/answer |
| Intentional stop |38.744|603| Stopped at item20, no end marker; in_progress/end_turn=null, no DONE/stream completion |
| Follow-up after stop |4.364|22| Completed; exact two lines RECOVERY-OK and `7 + 9 = 16`; prior partial answer remained |

All five normal results had successful final/end_turn=true/stream completion/DONE. All six network endings were ERR_ABORTED. The division-error tool receipt itself was finished_successfully: message completion is not tool-business success.

**Complete-read counterexample:** first report code source1125characters, top DOM808, end navigation901with the beginning missing. Second source1707characters; initial DOM had120assignments, menu opening left57lines/732characters while the body end marker remained. No code edit or further generation occurred. This is CodeMirror viewport virtualization.

**Content types:** CodeMirror uses`.cm-content`/`.cm-line`, not ordinary`code`. Chart references contain objects; code/Mermaid references contain strings. CSV opens from an href-less`span[role=link]`into a preview then a format menu. Three download waits timed out: the first two preceded export; the third did not prove local delivery. This does not establish a product download defect.

The second-phase observer recorded186changed states. Same-answer roots stayed stable; regeneration replaced the root. Initial scope mistakenly expanded to native acceptance, then was corrected by the user. Prepared DEV was closed without native tasks. Existing production checks report three files/services unchanged, but one of ten tracked bun child identities disappeared while its parent remained; no control action targeted it, cause unknown. Do not claim every production process stayed unchanged.

<a id="e07"></a>

## E07 — Cancellation predicate gap

Sources: E06observation, V03existing predicate output, S01/S02/S03/S06source.

```json
{
  "responsePresent": true,
  "running": false,
  "currentText": "STOPCASE-BEGIN partial answer",
  "completionActionVisible": true,
  "handoffCompletionVisible": false
}
```

This is a **reduced representative input**, not the631-character raw snapshot. Existing evaluation returned `chatGptTurnIsComplete(input) === true` and `responseSourceBlocksFallback({state:"rejected",reason:"response_transport_incomplete"}) === false`.

The chain establishes a gap between DOM completion and incomplete-transport fallback. It does not establish inevitable worker delivery: subsequent buffer/identity/tool fences can still reject. Codex-origin cancellation separately uses abortSignal→AbortError (S06). This case concerns webpage stop/unknown interruption. Add positive completion evidence; do not blanket-reject every abort or remove every DOM fallback.

<a id="e08"></a>

## E08 — Source identity and static mapping

Use the working-tree hashes, line numbers and verbatim excerpts in[source-snapshot.json](evidence/source-snapshot.json). HEAD=`71eefe428cc99f8c84fd5ca7540f1bd4301637ea`; the tree included uncommitted repairs, so that commit alone is not the analyzed implementation. Relative source links aid navigation; use saved excerpts when later source changes.

| Source ID | File | Basis |
| --- | --- | --- |
| S01 | [turn-observation.ts](../../../src/adapters/chatgpt-web/browser/turn-observation.ts) | Completion predicate and settlement/tool checks; not simple inactivity detection |
| S02 | [response-source.ts](../../../src/adapters/chatgpt-web/browser/response-source.ts) | Fallback-blocking list; single current/p-o context; incomplete observed merge/reference support |
| S03 | [response-stream.ts](../../../src/adapters/chatgpt-web/browser/response-stream.ts) | Initial request matching; post-completion closure tolerance; resume not linked as a generation chain |
| S04 | [response-dom.ts](../../../src/adapters/chatgpt-web/browser/response-dom.ts) | Image/SVG/preview removal; pre/code normalization does not fully read observed CodeMirror |
| S05 | [markdown.ts](../../../src/adapters/chatgpt-web/markdown.ts) | Image/SVG removal and buffered candidate.startsWith(known) requirement |
| S06 | [browser-worker.ts](../../../src/adapters/chatgpt-web/browser/browser-worker.ts) | Source eligibility, whole final delivery, cancellation, DOM fallback and coverage settlement |
| S07 | [chatgpt-answer-dom.cjs](../../../launcher/shared/chatgpt-answer-dom.cjs) | Existing selectors/ownership classification; file hash retained, not a license to select all message IDs |

## Verification and limits

R01–R11identify prior development records; V01–V05identify existing validation/derived summaries. Original paths are repository-relative without user-home or authentication data. Ignored originals do not travel with a clone; this page/JSON preserve necessary shareable facts and identify missing raw replay.

Verify archive SHA-256 → compare available local originals → check S-indexed saved excerpts/file hashes → assess the E-level of each claim. A changed current-source hash indicates a different version, not automatic invalidation of historical findings; matching hashes do not prove runtime inferences.

Archiving checks files/links/anchors, source/excerpt hashes, bilingual conclusion IDs, existing README-related regression and change scope. No new browser/product acceptance was performed. Full replay, CSV local delivery, other media and latest real multi-agent final delivery remain unverified.
