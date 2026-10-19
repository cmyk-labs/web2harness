# Answer delivery investigation archive — 2026-10-19

[English](README.md) | [简体中文](README.zh-CN.md) · [Project documentation](../../../README.md#documentation)

This archive focuses on two rounds of direct Chrome observation and analysis of answer extraction and validation. Two production incidents, two authenticated DEV tasks, and subsequent repair records provide background evidence. **Conclusion: establish completion of the current logical answer, then read its complete content. Text inactivity and a single post-completion DOM read are insufficient guarantees.**

This is a dated investigation as of 2026-10-19 (Asia/Shanghai), not operating instructions, release acceptance, or certification of all Codex capabilities. The new design recommendations following the browser observations remain unimplemented. Archiving changes documentation only: no new model tasks, product changes, commits, or releases.

## Navigation

- [Conclusions and evidence](#conclusions)
- [Historical tasks and repair status](#history)
- [Existing implementation and recommendations](#design)
- [Open issues](#open)
- [Evidence index and verification](evidence.md)

<a id="conclusions"></a>

## Conclusions and evidence

Evidence is classified as **direct observation**, **source/predicate confirmation**, **inferred risk**, or **unverified**. Browser success does not substitute for Web2Harness end-to-end acceptance; fixture passes do not erase live failures.

| ID | Conclusion | Evidence and limits |
| --- | --- | --- |
| C01 | Unchanged text does not establish completion | [E05](evidence.md#e05): text stayed unchanged for242.303seconds while Stop and subsequent processing remained active. This observation does not establish a fixed inactivity threshold. |
| C02 | A stopped page is not necessarily a successful answer | [E06/E07](evidence.md#e07): an intentionally stopped300-item list reached only item20, yet Copy/Regenerate appeared without source completion. The existing DOM predicate returns true and incomplete transport allows fallback. Predicate gap confirmed; full product false-success delivery not reproduced. |
| C03 | The completed DOM may contain only part of the content | [E06](evidence.md#e06): opening a menu after120code lines completed changed the readable DOM to57assignment lines while the final answer marker remained. Complete public code source was unchanged. Code-component virtualization was observed. |
| C04 | Turn containers, answer roots, revisions, and requests have different identities | [E05/E06](evidence.md#e06): outer turns include the question/progress/answer; commentary also has message IDs; regeneration changes the answer revision and editing creates a branch. An outer turn or arbitrary message ID is insufficient final-answer selection. |
| C05 | Transport errors, tool errors, and turn failure are different | [E05/E06](evidence.md#e06): natural reconnection completed; five successful responses and one cancellation all ended with ERR_ABORTED; a Python division error was followed by successful execution and completion. The underlying network cause remains unassigned. |
| C06 | Public-response and rich-content support is incomplete | [E05/E06/E08](evidence.md#e08): observed context switching, merged messages, typed references, virtual code, charts, images, and file previews exceed the current parser/DOM conversion coverage. Source-to-structure comparison is not a reproduction of every media failure. |
| C07 | Historical prefix requirements can reject valid un-emitted drafts | [E01/E04/E08](evidence.md#e08): synthetic table growth and a live wrapper change previously exposed false rejection and received targeted fixes. Current buffered reconstruction still requires the entire known prefix. A final-content authority is recommended; the new strategy is not implemented or accepted. |
| C08 | Clipboard, DOM, and source should not require byte-for-byte agreement | [E05](evidence.md#e05): whole-answer copy included Mermaid CSS and omitted source/language information; source Markdown still needs reference resolution. Length differences alone do not prove loss; no representation is universally safe to pass through. |
| C09 | Native waiting already releases Web execution capacity | [E03](evidence.md#e03): three child requests ran while the parent waited without an active Web request. This is neither a new feature of the repair nor the demonstrated failure cause. |
| C10 | Independent timers were improved; historical outcomes remain separate | [E04](evidence.md#e04): attachment arithmetic producing1ms was a confirmed project regression. Cross-step budgets were removed and automated checks completed. Latest live task acceptance was deferred; unknown sends, queue identity conflicts, and full live delivery are not thereby resolved. |

<a id="history"></a>

## Historical tasks and repair status

| Stage | Recorded outcome | Supported interpretation |
| --- | --- | --- |
| October17 production multi-agent task | Two body failures; replacement send unknown paused the queue; two requests each expired after15minutes; no main report | [E01](evidence.md#e01). Insufficient concurrency is not the explanation for the pause. The low-level missing-acceptance cause remains unknown. |
| October18 production read-only task | Five requests succeeded; sixth/final answer failed with missing_pending_content; no queue pause | [E01](evidence.md#e01). Do not import the other task's queue timeline. Both used the then-latest stable2.4.0 without the unpublished source-response implementation. |
| Isolated same-task DEV retest | 947.844seconds;35commands, nine successful Web requests;4564-character report matched four representations | [E02](evidence.md#e02). One authentic pass, not byte-exact replay or proof that intermittent failures disappeared. |
| Three-child parallel review | All child reports arrived; main delivery failed twice; overall turn.failed;139requests:128success, ten failures, one intentional cancellation | [E03](evidence.md#e03). Preserve the overall failure. The outer coordinator's synthesis is not a successful main-agent output. |
| October18–19 repairs and timers | Source boundaries, table/wrapper handling, evidence retention and other repairs implemented; independent timer automation completed | [E04](evidence.md#e04). Distinguish existing repairs from this archive's new recommendations; final live outcomes remain open. |
| Direct Chrome observation | One research generation followed by six generation observations: five completed and one intentionally stopped | [E05/E06](evidence.md#e05). Browser evidence, outside the Web2Harness/native multi-agent execution path. |

<a id="design"></a>

## Existing implementation and recommendations

The implementation already prioritizes response source, delivers a completed answer as a whole, independently falls back to DOM, checks running/tool activity, handles Codex cancellation, and tolerates transport closure after completion. It is not merely a text-stability detector and does not need a parallel execution framework. [E08](evidence.md#e08) fixes source identity and relevant excerpts.

Recommended sequence within those existing responsibilities; **these recommendations remain unimplemented**:

1. **Establish logical completion.** Associate submission, user turn, current answer revision, and resume requests. Use a bound public terminal result; DOM fallback needs positive completion evidence for the current answer. Copy controls and inactivity are auxiliary. Cancellation, failure, or recoverable interruption must not become success; a late network error must not invalidate an already completed answer.
2. **Read complete content and serialize by type.** Support public merged responses, contexts, and references. DOM can recover ordinary text; virtual code, charts, formulas, Mermaid, images, and files need their complete semantic representation. Do not execute supplied renderers, include hidden reasoning, or treat browser sandbox paths as local Codex files. Disclose unsupported types instead of silently deleting them.
3. **Remove ineffective defensive checks.** Un-emitted drafts may change, reorder, merge, and split; complete final content establishes correctness. Preserve non-retractability for already emitted deltas. Keep identity, model/effort, permissions, terminal-state, and tool-protocol checks. Do not require unrelated representations to match byte-for-byte or treat style/viewport changes as corruption.
4. **Validate affected boundaries.** Check cancellation versus success, completed transport closure, continuation without resend, complete code, branch isolation, and separate buffered/incremental contracts. Then run affected authenticated isolated DEV acceptance. Preserve approved independent operation timeouts without recreating cross-step total budgets.

The goal remains browser-based model interaction with Codex's native tools, execution, permissions, sandbox, waiting, and supported streaming intact. Disabling tools, media, or streaming is not equivalence; this investigation does not certify every Codex capability.

<a id="open"></a>

## Open issues

- The two production incidents lack complete original streams and adjacent DOM snapshots. Exact replay is unavailable; the low-level unknown-send cause and later queue_identity_conflict remain unresolved.
- These browser cases were not run through Web2Harness. The cancellation predicate check is not full false-delivery reproduction. The new strategy is neither implemented nor accepted.
- CSV preview was observed, but no download event/local file was verified. Complete audio/video, other models, and whole long-history virtualization were not covered.
- Arbitrary paragraph merge/split or same-answer root remount was not observed. Code-component virtualization and answer revision replacement were observed and must not be conflated with those hypotheses.
- Native encrypted-state migration, other hosted tools, media, and WebSocket capabilities still require individual checks under the [compatibility scope](../../native-tools-compatibility.md); this body investigation does not close every capability gap.

The evidence package contains redacted conclusions, existing verification summaries, source excerpts, and original-record paths with SHA-256. **Hashes identify material; they do not recreate missing raw streams or independently prove conclusions.** Private raw logs, authentication, browser state, and production baselines remain outside this archive. See the [evidence index](evidence.md).
