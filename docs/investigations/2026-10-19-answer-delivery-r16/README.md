# Authenticated DEV answer-delivery acceptance — 2026-10-19

[English](README.md) | [简体中文](README.zh-CN.md) · [Evidence index](evidence.md)

R16's scoped acceptance is complete: real native tools, the read-only analysis task, cancellation/recovery/resume, and a Web main agent with three Web children produced verified results. This is unreleased source work after checkpoint `f687d92`, not release approval or complete Codex compatibility. Original failures and one incomplete observation remain below.

## Scope and method

The main agent and all three acceptance children actually used `chatgpt-web/gpt-6-sol`, `xhigh`, verified in native turn contexts and DEV queue records. The instruction to use native `gpt-6-astra` concerns development helpers, not these Web acceptance subjects. An earlier mixed-model task is supplemental only.

The shared implementation ran through `dev:launcher` and `dev:codex`, with independent DEV credentials, browser profile, endpoints and owned workspaces. Native sandbox enforcement remained enabled. The write case used `workspace-write`; analysis cases used `read-only`. No MCP Bridge was enabled. Existing Web capacity stayed at one: agent lifetimes overlapped, while Web inference requests queued. This does not establish multi-slot Web throughput.

Verification connected actual tool results and fixture contents to the public response, CLI output file/events, native final message and `task_complete`. Agent creation/closure and queue leases were checked separately. A model's report, a zero exit status or a fixture alone was not sufficient.

## Completed checks

| Case | Result and evidence |
| --- | --- |
| `tool-roundtrip-2` | 260.646 seconds; actual read, native `apply_patch`, command assertion `R16_ASSERT_OK`, and correct two-line `result.txt`. Five Web requests succeeded; 847-character final matched public capture `public-observations/001` and native/CLI receipts. One incorrect assertion path was corrected by the model. |
| `read-only-analysis-2` | 821.407 seconds; eight commands, including two corrected failures. Complete 2663-character table/Mermaid report matched `public-observations-r2/008` and native/CLI receipts. |
| `cancel-recover` | Native interrupt after confirmed Web send settled all active owners to zero. A real read succeeded in the next turn without restarting DEV; 47-character recovery and 51-character resumed final matched public captures `r2/011` and `r2/012`. Eight verification checks passed. |
| `parallel-review-web` | 2895.336 seconds; three children spawned before the first wait, overlapping task lifetimes, real code reads and research search/page reads. Child reports of 1516/1298/1715 characters and the 3705-character main report matched captures `web/021`, `web/032`, `web/028`, `web/040`. All reports were received and children closed. Main agent ran 21 successful read-only commands. Ten verification checks passed, with one recovered intermediate failure retained below. |
| `report-resume-2` | Following the URL-control fix, the same mixed-task parent delivered a 4738-character report in 247.199 seconds, matching `r3/002`. Three actual `url_moderation` events occurred in this successful response. This is recovery evidence, not a rewrite of the original failed task. |
| `postfix-final` | Final rebuilt runtime delivered the exact requested 118-character table, Mermaid block and marker in 54.020 seconds. Public capture `r4/003`, native final, CLI file and requested Markdown matched; no failed requests, queue idle. |

Four actual blocking wait intervals in the all-Web task lasted 31.028, 31.039, 31.022 and 31.031 seconds. No parent Web lease overlapped them; all 14 queue samples showed zero parent activity while another Web child could occupy the global slot. Code Mode can yield and request further model inference between blocking intervals; the whole asynchronous wait lifetime is not a promise of zero Web calls. Native wait releasing its slot is existing behavior.

The research child's real tool outputs included an official Playwright search result and opened official pages. Some large batched outputs were truncated, so unseen portions are not claimed as reviewed. Static audit suggestions are not automatically confirmed defects: the proposed source-path bypass of MCP completion fencing/checkpoints was excluded by the actual mode branches. The `localTools` flag describes browser MCP access, not Codex native filesystem permission. Unknown protocol events still cannot receive blanket DOM fallback. Hypothetical callback hangs and the array/inline-code edge cases were not reproduced or used to justify extra defensive code.

## Failures, partial evidence and fixes

| Observation | Disposition |
| --- | --- |
| Initial tool task: `CreateRestrictedToken failed: 87` | No real patch occurred. Retained as an environment failure. The isolated DEV client was relaunched in a normal outer process context while preserving its inner sandbox/approval policy; the real tool rerun passed. |
| Initial read-only task: failed attachment upload, then `queue_identity_conflict` | The upload's network/upstream cause remains unknown; delayed failure feedback is not claimed fixed. Confirmed bridge defects were corrected: serialized byte count no longer defines semantic replay identity, and nonretryable failures retain their original failure journal. Input/model/permission identity checks and original byte accounting remain. |
| Mixed Web main/native Astra children, then `report-resume` | Three native children completed, but the Web main failed on an unsupported control event. The diagnostic resume identified `url_moderation`; parser and privacy projection now handle this observed ancillary envelope without treating it as completion. Native children's initial WebSocket 502/HTTP fallback remains unexplained and is not a WebSocket pass. The mixed model selection cannot satisfy all-Web acceptance. |
| One early failure in `parallel-review-web` | A nonterminal assistant text node with `channel=null` was rejected before any public final. Codex retried once and the full task completed. The early channel rejection was subsequently deleted: non-public bodies are discarded while ancestry is retained. Explicit public final, request ancestry, completion and unsupported-operation checks remain. |
| `channel-resume` after the channel fix | 479 characters matched CLI/native receipts, with no failed request, but the observer captured only an interrupted 15-event physical stream. The requested Mermaid was absent and the marker's underscores were escaped. Cleanup had already cleared the page, so final-body completeness and the cause are unverified. This remains **partial evidence**, not a full pass or a confirmed product defect. The separate exact-format `postfix-final` pass does not overwrite it. |

The five captured structural events from the channel failure rejected under the old implementation in 1/17/4096-byte chunkings. They now remain `collecting/generating`, without fabricating a missing tail. Synthetic descendant-final, absent-final, wrong-parent and privacy replay cases verify the remaining boundaries. The later live check validates normal delivery on the rebuilt shared runtime; it did not reproduce the same non-public text node in a complete live stream.

## Automated checks and isolation

Replay/scheduler fixes passed 141 adapter/reference tests, 33 scheduler/queue tests and eight server-retry tests. URL-control changes passed 78 focused tests. The final channel change passed **82 focused tests / 500 assertions**, typecheck and a fresh relocatable runtime smoke. The preceding full suite recorded 1751 passed, 81 skipped, zero failed; it was not rerun after these focused fixes, and overlapping counts are not added together. New regression failures on the old implementation remain recorded. One earlier test command also selected old ignored test copies; later commands used explicit `./tests/...` paths.

Both later frozen source windows covered 922 files with unchanged contents, HEAD and Git status. At teardown, HTTP/browser/WebSocket active-owner counts were zero. The owned DEV launcher/service exited normally. **All three production configuration/authentication hashes, all 24 relevant process identities and service identities matched the initial baseline.** No production routing, authentication, global tools or services were changed.

## Remaining scope limits

The upload root cause, the supplemental native WebSocket fallback and the partial `channel-resume` observation remain open. Historical missing wire data cannot be reconstructed. This acceptance does not certify every native/hosted tool, encrypted-state migration, all media protocols, all WebSocket extensions, MCP remote bindings, multi-slot throughput, installers, updates or other operating systems. See the [compatibility matrix](../../native-tools-compatibility.md) and [acceptance procedure](../../acceptance-tests.md). No release, installation, new commit or push was performed for this acceptance.
