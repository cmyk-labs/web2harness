# Public response replay and native file responsibilities — 2026-10-19

[English](README.md) | [简体中文](README.zh-CN.md) · [Previous follow-up](../2026-10-19-answer-delivery-followup/README.md) · [Initial investigation](../2026-10-19-answer-delivery/README.md)

The user authorized further observation and asked whether CSV/PNG downloading is required to preserve Codex capabilities. This round narrowed that scope and completed one local Chrome generation plus offline replay. No product/test source, DEV/native Codex task, commit, or release changed.

## File responsibilities

| Capability | Responsibility and scope |
| --- | --- |
| Codex creates, reads, or saves CSV/PNG files in its task environment | Preserve native tools, commands, skills, plugins, and file results. File formats do not inherently require a dedicated downloader; generation depends on the available tools and dependencies. |
| Codex downloads files through existing browser, network, or other tools | Preserve those tools, permissions, calls, and results. Omitting a new webpage downloader does not justify disabling existing tools. |
| Web2Harness automatically transfers artifacts from ChatGPT's webpage Python sandbox | This bridges distinct execution environments and is not inherently required for native Codex file operations. Listing download-to-disk as a core prerequisite expanded the previous scope; it is now recorded as a webpage-artifact extension, still unverified, with no new functionality implemented. |
| An answer contains webpage image/file references | Preserve their meaning or explicitly disclose delivery limits; do not silently remove them and claim a complete answer. A webpage sandbox path is not a file in the Codex task environment. |

The official [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) describes local files, commands, and tools. [Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter) specifies hosted containers and file citations/downloads; that does not establish the same contract for private ChatGPT webpage endpoints or default Codex tools.

The project's [native tool contract](../../../src/adapters/chatgpt-web/tools/native-tool-call-block.ts) assigns decisions to the Web model and execution to Codex under its sandbox and approvals. Direct webpage Python tests observed tool/rich-content lifecycles; they do not imply moving native execution into webpage Python. Existing native image, attachment, and hosted-tool boundaries remain in the [compatibility matrix](../../native-tools-compatibility.md).

## Observation and replay

One new generation used `gpt-6-thinking` / `max`, explicitly requesting no tools, file access, or downloadable artifacts. Its answer contained Chinese, `🙂𠮷é`, two table data rows, Python, and Mermaid. It completed normally after about 60.852 seconds. Final fallback measured 438 UTF-16 code units, 436 Unicode code points, and 973 UTF-8 bytes.

- Network observation began before submission and captured 26 events from initial `delta_encoding` through `[DONE]`, without buffer truncation. The concatenated 30778-byte stream remained in observation-session memory and was not saved verbatim.
- A live completion notification appeared, alongside final success, end_turn, is_complete, finish_details=stop, message_stream_complete, and DONE. Network termination then reported ERR_ABORTED, and subsequent getResponseBody was unavailable. The live collector retained received content; neither later result alone establishes answer failure.
- [public-events.json](public-events.json) preserves all 26 event positions, public content updates, references, and termination. User/system/non-public bodies, resume token, renderer code/constants, and nonessential metadata were removed. Identity aliases preserve equality and ancestry.
- Browser-side projected JSON measured 10254 bytes with FNV-1a 90e57e59; local transcription matched before public aliasing. FNV is a transcription check, not cryptographic proof. Artifact SHA-256 values are in [provenance.json](provenance.json).
- With chunk sizes 1, 7, 17, and 4096 bytes, the current parser replay consistently decoded 26 events without incomplete SSE framing and returned `response_references_unsupported`: see [replay-result.json](replay-result.json). This is offline evidence of a source-parser gap, not a full Web2Harness failure/incorrect-delivery reproduction; its DOM fallback was not exercised.

This is a **public-content projection preserving complete event order**, not the full private response, original transport chunks, or lossless coverage of every protocol semantic. Fourteen renderer/constants patches were explicitly omitted, not fabricated. The artifact reproduces this sample's body, Unicode references, and rejection; it does not resolve missing historical wire captures or cover all context/merged-message variants.

## Newly confirmed boundaries

| ID | Observation | Design implication |
| --- | --- | --- |
| R01 | Python used [330,375), with actual JS start332; Mermaid used [377,424), with actual JS start379. Code-point slicing matched both references; UTF-16 and UTF-8 byte slicing did not. | Offsets use code points in this version/sample. Two non-BMP characters account for the two-unit JS difference. Match representation/version and interpret units correctly; do not directly use String.slice or normalize Unicode before resolving offsets. |
| R02 | Events18 and19 replaced fallback. A partial table placeholder became complete; empty Mermaid became complete. New fallback did not retain the old full prefix, yet the final answer was complete. | Undelivered drafts can legitimately revise prior content. Final snapshots establish completeness. This does not prove arbitrary DOM paragraph splits/merges or root remounting. |
| R03 | References were initially added together, then nested patches updated Mermaid data.content, matched_text, and end_idx (392→424). | Do not freeze references at first appearance. Body and reference metadata must belong to the same final revision. |
| R04 | Four chunk sizes produced the same unsupported-reference result while observed completion boundaries remained true. | Track logical completion separately from representation support; do not label unsupported references as network interruption. |

The preceding reference sample had no non-BMP characters, so JS and code-point slicing coincided. It established fallback ownership, not a JS-index contract. Its record remains intact; this report adds the qualification.

## Reproduction and status

In a checkout matching the [source hashes](provenance.json), read public-events.json, serialize each value as SSE data (keep DONE unquoted), preserve event names, and feed [ChatGptResponseSource](../../../src/adapters/chatgpt-web/browser/response-source.ts) and [ServerSentEventDecoder](../../../src/adapters/chatgpt-web/browser/sse-decoder.ts). The artifact includes binding. Replay every event; do not omit rejecting events to manufacture success. The offline helper remains in ignored local output, outside product/test implementation.

Completed: one repeatable complete public-answer sample, Unicode offset units, reference updates, and non-prefix fallback revisions. Webpage CSV/PNG download-to-disk remains an unverified extension and is no longer a core-body prerequisite.

Unproven: full original wire replay, arbitrary context switches/merged-message variants, arbitrary paragraph splits/merges or root remounting, audio/video, actual Web2Harness integration, and resolution of historical incidents. Existing evidence supports implementation discussion without expanding this round into reproducing all ChatGPT webpage features. Implementation and integration acceptance have not run.
