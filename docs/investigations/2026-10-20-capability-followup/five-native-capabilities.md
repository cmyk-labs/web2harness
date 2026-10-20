# Five feasible native capabilities

[English](five-native-capabilities.md) | [简体中文](five-native-capabilities.zh-CN.md)

Date: 2026-10-20. This is evidence for the unreleased source checkpoint `9ca034d`, not a production release. The checkpoint was committed locally without pushing. Existing implementations are reused; changes are limited to demonstrated Web2Harness defects. Historical/intermittent failures, native ciphertext migration and hosted capabilities without a verified service contract are outside this round.

This round completed the feasible scopes below and corrected their compatibility records. No product runtime code changed after the checkpoint.

## Method and status

The standard DEV launcher uses independent configuration, credentials and browser partition. Each actual Codex task starts through `bun run dev:codex`, with its own workspace and normal native sandbox. The parent model is explicitly `chatgpt-web/gpt-6-sol` / `xhigh`; observed Web requests must be `gpt-6-thinking` / `max`. No MCP Bridge or production session is used. Local fixture MCP tools remain bound to the owned task.

| Order | Capability | Result and evidence |
| --- | --- | --- |
| F01 | Native JSON Schema final output | **Passed.** The real CLI used `--output-schema`; one successful native command read a fixture. The result passed the original schema without repair, contained the correct values and matched the native final. Both fixture files were unchanged. Nine checks passed. |
| F02 | Remote image input | **Native download → view → continuation passed, 11 checks.** Direct app-server HTTPS image input is rejected by Codex itself and remains a separate boundary. |
| F03 | Encoded native audio tool results | **MP3, M4A, WebM and OGG passed, thirteen checks each.** Existing WAV evidence is reused. FLAC failed in native Codex before bridge input and is excluded from this round's feasible scope. |
| F04 | Native image edit with two references | **Passed.** Eleven native/byte/file/final checks plus direct visual review. |
| F05 | Active native task steering | **Passed.** Twelve checks: accepted during a pending native tool, one turn/receipt/input, real file write/readback and correct final. |

F01 thread: `01a15924-2f61-7d02-b6d2-b36009d20864`. Its initial prompt did not contain the fixture's answer. The original schema was present in the uploaded context and both Web requests used the selected model/effort. The native `standalone_web_search` experimental warning is retained; no feature was disabled to remove it.

## Corrected remote-image assumption

The installed official Codex `0.162.0-alpha.17.2` app-server rejected HTTPS image input at `turn/start` with `-32600`, stating that remote image URLs are unsupported and an inline data URL is required. This happened before model generation or Web2Harness dispatch, so it is not a bridge resolver failure.

The original plan's direct native URL premise was incorrect for this client. The feasible native workflow is to download the original public image with a native tool, then use native image viewing. That workflow must not be represented as authenticated acceptance of the bridge's direct HTTPS image resolver. Existing resolver fixtures and public-PDF component evidence retain their separate scopes.

Thread `01a1592d-1dba-77f3-8bd6-80bbdc429566` first failed to download because the test child's default native sandbox prohibited network access; no image was created. A continuation explicitly granted network access in that task's native workspace-write policy, without changing global or production settings. Its real command downloaded the 2,070,074-byte public PNG with HTTP 200. The download, native `view_image` result and Web-selected image had the same SHA-256 (`5cbfe09c463f400d25723cef6048e17c1fc2c543012f12ce5cf2b4180a26f35d`). The final answer correctly read four card headings and all three operating-system names. Native/CLI final text matched; the original fixtures were unchanged and only `remote.png` was added. The two-round continuation passed all eleven checks.

## Encoded audio and the FLAC boundary

The same verified recording was independently encoded with the existing local FFmpeg installation. FFprobe confirmed container/codec and duration; decoded signal levels confirmed non-silence. Each format used a separate native thread and exactly one audio fixture call. The answer was absent from prompts and tool metadata, and no transcription service or local command supplied it.

| Format | Actual encoding | Native thread | Result |
| --- | --- | --- | --- |
| MP3 | MP3, `audio/mpeg`, 40,482 bytes | `01a1593a-baf5-7932-b3c4-17e056fad332` | Pass |
| M4A | AAC in MP4, `audio/mp4`, 29,597 bytes | `01a1593c-4410-7ed0-87da-bfd7b10ed650` | Pass |
| WebM | Opus, `audio/webm`, 19,143 bytes | `01a1593d-cd4b-74f1-bdc6-820ac720bfc8` | Pass |
| OGG | Vorbis, `audio/ogg`, 17,036 bytes | `01a1593f-30a0-73c3-a39a-70efc4ebbbbd` | Pass |
| FLAC | FLAC, `audio/flac`, 59,935 bytes | `01a15940-b95d-7630-8172-88c0b1a956bd` | Failed; native-client boundary |

The four passes each verify original native audio bytes/MIME, browser selection, completed file processing, submitted attachment/call association, actual model/effort, correct transcription, no answer leakage, native/CLI final equality and unchanged fixture. They do not establish all recording conditions or long-form audio accuracy.

For FLAC, the actual MCP result contained the correct bytes, but Codex Code Mode emitted an audio-omission placeholder instead of `input_audio`. The Web observer received no FLAC attachment. The inspected official [audio preparation implementation](https://github.com/openai/codex/blob/e1b9c9457ceca75a99b034a5df39ac48c3998d15/codex-rs/utils/audio/src/lib.rs) excludes FLAC from its MIME list and falls back to data-URL size when duration estimation fails. Its [output truncation](https://github.com/openai/codex/blob/e1b9c9457ceca75a99b034a5df39ac48c3998d15/codex-rs/utils/output-truncation/src/lib.rs) can omit audio exceeding the native tool budget. The observed omission is consistent with that native path; merely increasing the budget would not remove the separate MIME restriction.

No Codex fork, MIME disguise, transcription substitute or bridge recovery of already-discarded bytes was added. Existing bridge FLAC parsing remains supported by offline tests, but it is not a native end-to-end pass. This finding does not explain earlier intermittent WAV recognition failures.

The FLAC task subsequently retried/resynchronized without receiving audio. Its verified owned native process was stopped, then only its active DEV request was cancelled. The recorded exit is 255 with no final answer; it was not a naturally completed task. The failed audit and cancellation identities remain available.

## Native image editing

Thread `01a1594c-1e5b-7771-86e8-be77da0e1799` called the actual native `image_gen__imagegen` executor once, with two local reference paths. It returned a new 1,254×1,254 PNG in 16.3 seconds. The original generated artifact, native image result and `edited.png` saved by a real native command were all 1,397,947 bytes with SHA-256 `40e29a55b11fa37f5c74c3b0f9a9f7efb72424cae03bad25e1273f6fbd6ef37e`.

Direct viewing confirmed that the second reference's white looping emblem and central H appear inside the first reference's blue triangle on white. Both reference copies and the text fixture remained unchanged. The parent remained GPT-6 Web/xhigh; native and CLI final text matched. This validates the native edit/multiple-reference path and continuation, not generic hosted `image_generation` events or universal image quality.

## Active native task steering

The actual Codex app-server started thread `01a15950-434f-7382-8bf0-b225eeb54151`, turn `01a15950-4465-7eb0-b862-8c448bc1249a`. A task-owned stdio tool created one unique receipt and held its return until the client sent `turn/steer` with that exact active turn ID. Codex acknowledged the same turn at `12:37:25.143Z`, while the tool was still pending; the client then released it.

The added instruction changed the requested color from blue to green and added a marker. Actual native commands created and read back `result.json` with the original receipt token, `color: green` and `steering: STEER_APPLIED_7261`. The receipt was created once, the steering input appeared once in native history, and only one native turn started. The fixture and receipt were unchanged, actual model/effort stayed selected, and the native final matched the client report. Twelve checks passed.

This is real native `turn/steer` acceptance at a pending-tool boundary using a controlled task fixture. It does not claim interruption of an in-flight Web model token stream, earlier-boundary Responses steering or arbitrary hosted-tool approval compatibility.

## Evidence and retained failures

Private evidence root: `output/2026-10-20-five-native-capabilities/`.

- `f01-schema/acceptance.private.json`: nine explicit checks, native rollout digest, command/file/final evidence.
- `f01-observer.private.json`: actual Web model/effort and schema-bearing context.
- `f02-image-url/`: real app-server requests, rejection and owned-thread identity.
- `f02-native-download/`: retained network-disabled task failure; a normal CLI exit is not a semantic acceptance pass.
- `f02-native-network/acceptance.private.json` and `f02-observer.private.json`: native network-enabled continuation, image hashes, actual model/effort, command/file/answer evidence.
- `remote-image-fixture.private.json`: public image status, MIME, original hash and inspected reference.
- `audio-fixtures.private.json`: original WAV and independently encoded samples, codecs, duration and decoded signal levels. Preparation is not live acceptance.
- `f03-audio-{mp3,m4a,webm,ogg}/acceptance.private.json`, `f03-observer.private.json`, and `audio-*-calls.private.jsonl`: four authenticated passes, native input/final records and byte/call association.
- `f03-audio-flac/`: retained failed audit, raw MCP result, native omission, cancellation ownership and queue settlement.
- `official-audio-source/manifest.private.json`: captured official revision and three source-file hashes.
- `f04-image-edit/{acceptance.private.json,image-artifacts.private.json,visual-review.private.json}` and `f04-observer.private.json`: one actual native edit, both references, original output hashes, file command, visual review and final equality.
- `f05-steer/{requests.private.jsonl,app-events.private.jsonl,acceptance.private.json,native-rollout.private.jsonl}`, gate receipts and `f05-observer.private.json`: real native steering acknowledgement, pending-tool timing, single execution, file readback and final equality.

The initial DEV smoke failed because its browser panel had not received layout bounds. Opening that panel allowed the standard smoke to pass; the first attempt sent no model task. PowerShell's separate public-image download failed TLS authentication; Bun fetched the same URL with normal TLS validation. Neither event justified a product change.

The native remote-image workflow later encountered one existing missing-public-final error and Codex retried it. The error remains recorded; this task does not investigate or claim to fix intermittent body delivery.

## Closeout

The three production configuration/authentication hashes, related services and all 26 pre-existing relevant process identities were unchanged. All 16 added relevant processes were verified descendants of the owned DEV launcher startup. The cancelled FLAC task's six recorded descendants had exited. DEV remained independently authenticated and idle, with zero queued, active-browser or active-WebSocket turns.

The 243 pre-existing diagnostic files and 210 files present at closeout were copied separately and hash-verified. Per-case native rollouts, Web observers, original failures and outputs remain under the private evidence root; archive counts do not imply complete historical stream coverage.

Eight affected documentation files passed local-link checks (122 references) and whitespace checks; `git diff --check` passed. Existing implementation regressions were reused because runtime code did not change; no new whole-suite/build pass is claimed. `closeout.private.json` records acceptance scopes, retained failures, boundary comparison and idle state.

The checkpoint remains local. Follow-up documentation is uncommitted; unrelated poster files were preserved. Installer validation, publication and production deployment were not performed.
