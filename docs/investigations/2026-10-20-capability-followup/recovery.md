# Result reconciliation and capability recovery, 2026-10-20

[English](recovery.md) | [简体中文](recovery.zh-CN.md) · [Earlier evidence](README.md) · [Compatibility](../../native-tools-compatibility.md)

This follow-up implements the approved recovery plan in the unpublished working tree after checkpoint `a5ed839`. Native Codex still owns tools, execution, sandbox and approvals. Authenticated media tasks used `chatgpt-web/gpt-6-sol` / `xhigh`; no development subagent was needed. No commit, push, release or production deployment was performed in this follow-up.

## Implemented behavior

| Area | Result |
| --- | --- |
| Ended stream with zero public finals | Separate `awaiting_final` from conflicting finals. After page/tool activity stops, allow an independent 120-second read-only reconciliation window. Expiry returns non-retryable `chatgpt_public_answer_missing`; the bridge does not regenerate or repeat tools. |
| Saved conversation recovery | Observe the same page's normal GET after at most one automatic refresh of an idle saved conversation. Support legacy `mapping` and current paginated `messages`, with exact submitted-user and active-final binding. Temporary chats do not enable saving/readback. |
| Cross-representation validation | Saved pages omit/reparent private nodes. Their ordered active branch is bound by exact user/current-node IDs and matching `turn_exchange_id` / `working_turn_id`; private stream parent IDs need not remain unchanged. Legacy graph readback proves ancestry inside its snapshot. |
| Explicit reasoning reset | `X-Web2Harness-Reasoning-Migration: visible-history` resets only top-level native encrypted reasoning. Visible fields, tools/results, explicit model/effort and original continuation input remain. The model receives a notice; successful HTTP responses include the reset count. Default/`strict` still rejects opaque context. |

Reasoning reset sacrifices encrypted reasoning continuity. It does not decrypt ciphertext, reconstruct hidden compaction/agent/tool state, or authorize repeating side effects. Other ciphertext and malformed bridge envelopes still fail.

## Saved-page observation and correction

A new owned saved conversation submitted one question using actual `gpt-6-thinking` / `max`; its public response was `SAVED_READBACK_20261020_OK`. Reload requested `/backend-api/conversations/{id}` with `num_turns` and `include_has_versions`. HTTP 200 returned `messages`, `current_node` and pagination information instead of legacy `mapping`. Three visible message records shared both turn identifiers. The recap's private parent differed from the stream while the user ID, final ID and text remained unchanged.

This exposed two incomplete assumptions in the initial implementation: observing only the singular endpoint and treating hidden parent links as immutable across representations. Both were corrected. Missing/foreign users, missing active leaf, mismatching turn identifiers, conflicting finals and explicit interruption still prevent recovery.

**Replay passed:** remove four final-related frames from the real public projection, retain 19 records, confirm `awaiting_final`, then recover the exact original final from the real saved-page projection. Replay executes no generation or tools. The authenticated observation and this replay do **not** establish automatic full-worker recovery from a naturally occurring missing-final incident. Several manual reloads inspected schema; these are not evidence of the worker's one-refresh limit, which has fixture coverage.

Auxiliary failures remain recorded: a Chinese-only assertion rejected English `6 Extra High`; a saved request omitted `history_and_training_disabled` rather than sending `false`; exact URL matching initially missed query parameters. Correcting those test assumptions did not change model selection or resend the question.

## Native image and audio results

| Case | Evidence | Result |
| --- | --- | --- |
| Existing image as user input | Real Codex `--image`, original 981,129-byte PNG, correct 65-character description, no commands | Vision diagnostic passed |
| Same image as native tool result | One real outer Code Mode/MCP call; native `input_image` hash matches the original; correct 82-character final | Original-result continuation passed |
| New image, initial attempt | One real `image_gen` returned a 995,093-byte, 1254×1254 PNG. Native bytes matched. Subsequent commands failed before process creation with `CreateRestrictedToken: 87`. | Native Windows environment failure retained; only the owned DEV request was cancelled after repeated failures |
| Same image thread resumed | Normal outer launcher environment; child Codex retained `workspace-write`, Windows `unelevated`, approval `never` and specified Web model/effort. One command exited 0 and copied the existing PNG; no second generation. | Tool/file/report chain passed |
| Independent ordinary-page audio | Original recording A could not be accurately heard. Distinct recording B was transcribed correctly, without its expected text in the prompt. | B passed this ordinary-page control only |
| Native audio B | One real MCP return; original bytes, native `input_audio` and browser-selected bytes matched. PUT 201 and processing HTTP 200. No commands or fixture changes; final said it could not reliably transcribe. | Transport evidence passed; audio understanding failed |
| Plain question through shared BrowserWorker | Same B recording without the Codex context wrapper | Understanding still failed; the wrapper alone is not the demonstrated cause |
| Upload-entry comparison, no generation | Direct selection and actual page chooser used the same input and equivalent `ace_upload`, `chat_composer`, MIME and size; both processed | No evidence supporting an invented audio endpoint or guessed fields |

Independent visual inspection confirmed the requested blue triangle on white. Tool bytes, generated file and copied `acceptance.png` all hashed to `cc09cac3c26e456258a3ddd0ed32c18180b993df13c2ac09e8d0ce86e3a2ce74`. The original 51-byte fixture stayed unchanged; only the image was added. The 529-character report matched actual native `phase: final_answer` and CLI output. The first command failure was not evidence of a bridge defect or a bad PowerShell command; no system sandbox or production setting was changed.

The first image audit's aggregate remains **false**: eight execution/file checks passed, but no corresponding optional successful-delivery private snapshot had been retained after the earlier DEV restart. A supplementary audit verified native final messages and the runtime source-delivery event, not raw source/DOM/CLI three-way byte equality. Another auxiliary audit initially assumed `channel: final` instead of the actual CLI `phase: final_answer`; its false result is also retained.

Recording B is 144,870 bytes, SHA-256 `7ccfeec59db12f930fbb7e6b495eb93b38de34092a63abd4d8876b35c2cddd6c`. **Native audio understanding remains failed.** No ASR/transcript substitution, model substitution or speculative uploader rewrite was introduced.

Those failures belong to the run documented here. A [later two-recording retest](audio-automation.md) passed both ordinary BrowserWorker and real native audio continuation on the existing product implementation. It does not replace the earlier failures or establish that their cause was fixed.

## Verification and boundaries

| Check | Result |
| --- | --- |
| Affected browser/Responses suite before final saved-schema correction | 814 passed, 88 skipped, 0 failed; 5,343 assertions |
| Latest source/readback/stream/worker regression | 75 passed, 0 failed; 520 assertions |
| Final new/old endpoint and payload combinations | 20 passed, 0 failed; 123 assertions |
| Full worker saved-readback recovery/expiry fixtures | 2 passed, 0 failed; 20 assertions; 22 other cases filtered out |
| Core type check and development runtime bundle | Passed: `typecheck-v7`, `runtime-v3` |
| Restarted isolated DEV | Ownership, Native Tools runtime readiness and authenticated browser verified |

These groups overlap; do not add their counts. Earlier type errors, an unsupported-presentation lifecycle regression, incomplete readback assumptions and auxiliary failures remain in logs. Full-suite, skipped cases, installer and cross-platform live checks were not rerun.

The original 944-file baseline remained unchanged during media acceptance; concurrent work added 16 unrelated poster/prompt files, so Git status and the whole workspace were not unchanged. The later saved-schema fix intentionally changed two source files and their tests; documentation followed. Unrelated assets were preserved.

Final production comparison: all three configuration/authentication hashes unchanged, services unchanged and 35 retained process identities unchanged. DEV restarts and other host additions/exits are separately recorded; the complete process set did not remain fixed.

Native opaque compaction/agent/tool migration still needs supported complete source export/target import. Provider `file_id`, API hosted `file_search`, persistent `code_interpreter` and other hosted tools still need actual service/account/state contracts. Bare PCM, AAC-only streams and raw video remain unsupported. The earlier valid 429 authenticated HTTP fault injection is reused; it does not prove natural quota exhaustion. Rejection and reasoning reset do not resolve these gaps.

## Evidence chain

Private artifacts remain in ignored `output/2026-10-20-capability-recovery/`. Authentication and private ancestor bodies are not included here.

| Claim | Artifacts |
| --- | --- |
| Original saved response and actual new schema | `saved-readback-ui-v2-proof.private.json`, `saved-live-shape-v3.private.json`, `saved-readback-resume-v2-result.png` |
| Failed assumptions and exact recovery | `saved-readback-resume-proof.private.json`, `saved-readback-resume-v2-proof.private.json`, `saved-live-replay.private.json`, `saved-live-replay-v3.private.json` |
| Image invocation, original failure, resume and files | `native-image-full/`, `native-image-resume/`, `native-result-audit-v2.private.json` |
| Audio control, bytes and understanding failure | `audio-ui-b3-proof.private.json`, `native-audio-b/audio-check.private.json`, `audio-plain-control-b2-proof.private.json`, `upload-entry-comparison-v3.private.json` |
| Checks and isolation | `affected-tests-v5.log`, `readback-v8.log`, `readback-stream-v9.log`, `saved-worker-v10.log`, `typecheck-v7.log`, `build-v3.log`, `boundary-comparison.private.json`, `project-live-v1-summary.json` |

`evidence-index-final.private.json` binds 141 current artifacts and checks the earlier 58-artifact index. That audit **failed preservation of four old screenshots**: the failure images for the earlier 403 and image-v4 cases, plus the image-v5 response-visible/failure images, were absent from the shared rotating diagnostic pool. All other 54 artifacts still matched. A search of 5,004 PNGs under owned output found no exact copies. The pool retains ten trace directories; the acceptance workflow had not copied those indexed screenshots outside rotation before further tests.

The surviving 54 artifacts were copied and hash-verified in `prior-evidence-archive/`, with `prior-evidence-preservation.private.json` recording original paths, archive paths and the four unavailable hashes. Historical structured/public-event failures remain inspectable, but the missing screenshots cannot be independently rechecked. The original failed index is retained. `evidence-completion.private.json` binds the index, preservation record and final documentation; it does not turn this preservation failure into a pass.
