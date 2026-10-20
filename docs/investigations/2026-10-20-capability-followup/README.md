# Native capability follow-up, 2026-10-20

[English](README.md) | [简体中文](README.zh-CN.md) · [Compatibility](../../native-tools-compatibility.md)

This record covers the unpublished source after local checkpoint `a5ed839`. No remote push, release, installation or production reconfiguration was performed. Authenticated browser tasks select `chatgpt-web/gpt-6-sol` with `xhigh`; developer subagents used native `gpt-6-astra/high`.

The subsequent [recovery implementation and authenticated evidence](recovery.md) records same-turn readback, explicit reasoning reset, successful image-task continuation and remaining audio failures. The historical results below are preserved.

The later [audio automation retest](audio-automation.md) passed four cases across two recordings and ordinary/native tool-result paths without product-code changes. Earlier failures did not recur; their cause remains unidentified.

The [five feasible native capabilities](five-native-capabilities.md) report records subsequent schema, remote-image, encoded-audio, image-edit and active-task steering acceptance after local checkpoint `9ca034d`. It corrects a direct remote-image assumption rejected by the actual Codex client, and separates native-client and environment failures from bridge defects.

## Evidence and attribution

| Case | Observation | Result and scope |
| --- | --- | --- |
| Explicit upload quota failure | An owned HTTPS server returned 429 to an authenticated DEV upload. The browser response and an independent CDP observer both recorded 429. One upload, no conversation submission, no tool execution and no final answer; the original quota error survived. | Passed: authenticated page with real HTTP fault injection. This is not evidence of naturally exhausted account quota. |
| Missing redundant input acknowledgement | The captured stream contained the exact request-bound user message, a complete final answer and both terminal markers, but no separate `input_message` event. The bridge rejected it as `response_identity_incomplete`. | Web2Harness defect fixed: the matching user snapshot also establishes acknowledgement. Conversation, role, ancestry and terminal checks remain. |
| Snapshot repair replay | The original 42-event public projection replayed in 1-, 17- and 4096-byte chunks to the same 392-character answer. Subsequent authenticated image attempts reached complete source delivery and tool parsing. | Passed for response binding; this does not establish successful image execution. |
| Image attempts v2/v3 | Both emitted a direct `image_gen.imagegen` call, rejected as an unknown top-level tool. Removing an extra argument did not fix the call. The following page response had no public final answer. | Failed tests retained. A native CLI request probe established that the actual surface is `functions.exec` with nested `tools.image_gen__imagegen`. The test demanded the wrong invocation surface; argument shape alone was not the demonstrated cause. |
| Transparent context envelopes | Explicit empty text, signatures and arrays were lost; an empty decoded compaction summary was treated as opaque. | Fixed. 79 context tests / 416 assertions passed. This is reversible-envelope fidelity, not native ciphertext decryption. |
| Original audio transport | Inline and task-authorized public HTTPS Codex audio input uses the shared attachment path with original bytes, MIME, position and call identity. Encoded byte count is no longer misreported as text-token count. | Automated format, fidelity, reference-resolution and accounting checks passed. Real audio understanding has not passed; partial transport evidence is recorded below. |
| Audio model catalog | A real outer Code Mode call reached the MCP server, which returned the original WAV. Codex then replaced audio with an unsupported-modality notice because the bridge advertised only text/image. | Web2Harness integration defect fixed: automatic Web rows now advertise audio; manual text-only and native model rows remain unchanged. Catalog/audio/Responses Lite checks: 55 passed / 542 assertions. |

The catalog probe used the real DEV CLI with a command-local loopback collector that rejected inference. It captured `additional_tools` in Responses Lite input and passed it through the real parser. It is contract evidence, not model or tool execution acceptance. No persistent route was changed.

The first audio attempt only executed native tool discovery. Its final model report claimed a `TypeError`, but no corresponding native invocation or error existed; that report is not proof of a Codex defect. The second attempt made one real MCP call and isolated the missing catalog declaration. The official [Codex modality enum](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/protocol/src/openai_models.rs#L163) includes audio. Supported transport does not guarantee every recording is decodable or accepted by the selected account.

## Authenticated media results before human verification

After the catalog repair, the actual DEV CLI model listing included `text`, `image` and `audio` for the selected automatic Web model. Corrected type checking and the v4 development runtime build passed. The following tests used that runtime:

| Case | Proven result | Unresolved or unexecuted part |
| --- | --- | --- |
| Native audio v3 | One outer Code Mode call and one MCP call returned a 71,790-byte WAV. The original MCP bytes and Codex `input_audio` bytes had the same SHA-256. Browser file creation returned 200 with the expected name, MIME and size. Final source, delivered answer and CLI answer matched exactly. No command execution or fixture change occurred. | The model reported that it could not reliably hear the recording. Audio understanding failed. This run's observer did not capture the selected file hash or transfer/processing acknowledgements; file creation alone is not complete upload/model acceptance. |
| Native image v4 | The page displayed a status line and ended without a public final answer. The native task recorded zero outer tool calls, zero commands and zero image files. | Failed with `response_final_message_ambiguous`. No valid public answer was observed for the bridge to deliver; the underlying model/page cause remains unresolved. A more explicit outer Code Mode test is prepared but unexecuted. |
| Direct audio component | An independent file-change observer captured the original 197,792-byte WAV selected by the browser, with a matching SHA-256. File creation returned 200. | Both preparation and generation were rejected with upstream HTTP 403 / `cloudflare_challenge`, with no accepted conversation or response events. The screenshot retained the challenge error. This proves neither audio understanding nor Codex end-to-end acceptance; it is a shared Responses component test. |

The native v3 audio SHA-256 was `b6da8ad3e7f7f2e259438f3d7cd61e350b9e7108dc4b6bce6341ffdfad994156`; its final answer SHA-256 was `ea3e6cbd35a76b3040014f1434ecebc4033581a0843c96291ef1951833923bdc`. The direct component's input and browser-selected bytes both hashed to `38b3547e1a4b74640b5d94769fec742a5f306e83f90a611e2a24ba74734310d8`. Neither prompt supplied the expected transcription.

At this checkpoint, the maintainer selected continuing after human verification in DEV. The selection alone did not confirm completion, so new model requests were held. The challenge was an upstream access gate, not evidence that response validation or audio parsing was defective. No challenge bypass or production credential reuse was attempted. The later confirmation and results follow below.

Private evidence under the task output directory includes `native-audio-v3/audio-check.private.json`, `native-image-v4/proof.private.json`, `audio-v4-observer.private.json` and `audio-component-proof.private.json`. The DEV diagnostics retain the component's `response-source-27` artifact and browser failure screenshot under trace `e9fe8c5d083a-b6504c57`, plus the image v4 screenshot under trace `1483f88ef5df-29b55947`. The versioned private evidence index binds these artifacts by digest. The observer stopped and DEV was left open for human verification.

The v4 live-test source baseline contained 938 files with no changes, unchanged HEAD and unchanged Git status across the test interval. The subsequent production-boundary comparison found all three configuration/authentication hashes unchanged, no service changes and no changed identity among retained processes. This documentation update occurs after that source comparison. These checks do not replace media acceptance.

## Results after confirmed human verification

The maintainer then explicitly confirmed completion. DEV ownership, authentication and an idle queue were rechecked before new requests. The same v4 runtime and GPT-6 Web / xhigh selection were retained; no product code or production settings changed during these tests.

| Case | Evidence | Result |
| --- | --- | --- |
| Audio component v2 | The original 197,792-byte WAV and the browser-selected file had identical hashes. Upload PUT returned 201, the processing stream returned 200, and the request completed without 403. | Transport progressed, but the model said it could not reliably identify the speech. Audio understanding failed. HTTP processing status alone is not proof of correct interpretation. |
| Plain audio question control | The shared browser implementation received only an ordinary transcription question and the same audio file, without the outer Codex context envelope. It used the existing single-slot queue and the same model/effort. | Completed, but returned an unrelated quotation instead of the test phrase. This is a diagnostic control, not native Codex end-to-end acceptance. Removing the context envelope did not establish correct audio understanding. |
| Recording ground truth | The existing offline Microsoft Zira voice regenerated the explicitly specified test phrase at 22,050 Hz / 16-bit mono. The complete WAV matched the original 197,792-byte file and SHA-256 exactly. | Passed: the wrong transcript cannot be explained by comparing against a different reference recording. No transcription service, network, microphone or system configuration change was used. |
| Native image v5 | One real outer `functions.exec` invoked `tools.image_gen__imagegen`; it returned a 981,129-byte, 1254×1254 PNG in 20.5 seconds. The original file and native `input_image` bytes had identical hashes. Visual inspection confirmed the requested blue triangle. | Image generation and original result transport passed. The complete task failed: neither subsequent Web attempt produced a public final, so the copy command and final report never ran. CLI exited 1, the fixture stayed unchanged and no `acceptance.png` was created. |

The image SHA-256 is `bdc5943477e7cabc1a96b6a57fbf25cee722ed31c14c8eb241d35b4f4c0cd0e6`. Its source tool-call answer was delivered intact (418 characters). Later failing streams under traces `b70afbf2083f` and `d837a3354a3e` retained all 30 and 46 projected/public evidence records, with no dropped records. Both accepted the input and reached stream termination without a public final. The first ended on nonterminal thought metadata, with hidden tool/commentary structures; those bodies were not read or promoted into an answer. DOM Markdown and tool panels do not substitute for a final response. The first failure screenshot timed out after five seconds; its earlier screenshot and structured failure remain, and the second failure screenshot was retained.

Native Codex performed its own sampling retries; subsequent cached failures did not regenerate the image. Only one native image call occurred. No extra retry, model substitution or fabricated image/final response was introduced by the acceptance runner.

These results do not isolate a new Web2Harness defect in audio interpretation or the missing Web finals. They also do not prove that every audio route is supported or that the complete image task works. The known catalog/binding repairs remain separate from these unresolved behaviors.

Evidence after confirmation includes `audio-component-v2-proof.private.json`, `audio-v5-observer.private.json`, `audio-plain-control-proof.private.json`, `audio-ground-truth.private.json`, `native-image-v5/image-check.private.json` and `native-image-v5/proof.private.json`. DEV diagnostic artifacts `response-source-29` through `response-source-32` retain the image failures. `evidence-index-after-human-verification.private.json` records their digests alongside earlier evidence.

At handoff, DEV was authenticated and idle with zero active/waiting requests. The new 938-file source comparison again showed no changes during live testing. Production configuration/authentication hashes and services remained unchanged; retained process identities matched, while host Codex/MCP/editor processes had separate additions and exits outside task control. Only documentation and ignored evidence were updated after that comparison. No new commit or push was made.

## 429 evidence chain

The earlier CDP synthetic response test produced status 0 under Electron and was not valid 429 proof. The replacement used a real HTTPS response while retaining the application's existing `onCompleted` observer. Only one owned DEV upload target was redirected; authorization/cookie headers and the original context body were removed before the local fixture received `{}`. A certificate exception applied only to that target and exact loopback origin, then was removed. System trust and shared network settings were unchanged.

Codex's later reconnect/HTTP fallback did not cause another browser upload. The unchanged failed attachment card, absence of Send, one server request and retained quota error support the intended immediate-error branch. The nonzero CLI exit was expected; it is not a successful user task.

Raw evidence is private under ignored `output/2026-10-20-capabilities-round2/`. Stable artifact digests:

| Artifact | SHA-256 |
| --- | --- |
| `upload-quota-https-fault.private.json` | `810fc49910aee27e1dc6627ec70c717b59af0abf5a0e1a9db480d2e58ea1b768` |
| `upload-quota-https/quota-check.private.json` | `7f86e44b850ff472cd574b96de699646dd72728a220a322226c54347a7914e02` |
| `native-image/source-failure.private.json` | `76a7412b67bc5979e5fde0105852e11e304bab8e7bf4007a9c2690784d11bbb7` |
| `native-image/source-replay-after.private.json` | `843905757b6f7883ec83753e4a0d3b4466e9b88c8b0afeb0a4987a50ee976337` |

The replayed answer SHA-256 is `eb347c965b4d54f10cb4b9ffacfaa4e6d4014d9eaaae8362a11603fb84ce03f7`. Private artifacts can include public response text; they are not included in Git.

## Remaining boundaries

Native opaque reasoning/compaction cannot be imported into Web through any contract verified in this investigation. Full source plaintext or a supported source export/target import is required; visible summaries and empty plaintext markers cannot decrypt existing payloads. The [context compatibility boundary](../../native-tools-compatibility.md#data-contracts) remains explicit.

API hosted `file_search`, `code_interpreter`, hosted MCP/computer tools and provider `file_id` need their actual service, state, account and permission contracts. They are distinct from Codex's registered local/MCP tools, which retain their native executors. No additional API file service or credentials were introduced. Raw video, bare PCM and arbitrary media containers remain unsupported; transcript/frame substitution would not preserve the requested data.

Automated fixtures, a real CLI contract probe, authenticated page fault injection and authenticated tool execution are separate evidence levels. Installer and cross-platform live validation were not performed in this task.
