# Completion and media evidence follow-up — 2026-10-19

[English](README.md) | [简体中文](README.zh-CN.md) · [Previous investigation](../2026-10-19-answer-delivery/README.md)

This round used the authorized, already authenticated local Chrome to reload the task conversation, inspect its observed history response, view file previews, and compare source code. No new model task, product/test source change, Web2Harness DEV session, native Codex task, or multi-agent acceptance was run. The previous six-scenario records remain unchanged.

## Findings and evidence

[observations.json](observations.json) contains redacted selected-field transcription and derived comparisons, not a complete wire response or replayable SSE. Request/message identity mappings remain in ignored local storage. Authentication, signed URLs, hidden reasoning, and executable page renderer code are excluded from the public artifacts.

| ID | Observation | Design and attribution |
| --- | --- | --- |
| F01 | History returned 24 messages without preceding/following pages. All four public finals had `finished_successfully`, `end_turn=true`, and `is_complete=true`. The intentionally stopped list instead had `finish_details={type:interrupted,reason:client_stopped}`; the other three had `stop`. Its end marker remained absent. | Those three success fields alone do not establish normal completion. Current code already rejects non-`stop` termination: this supports an existing safeguard, rather than discovering an unimplemented check. Live and persisted states represent different observation times. |
| F02 | After reload, both successful and cancelled answers retained copy/regenerate controls and lacked a persistent completion notification. | Old-page action controls cannot supply positive completion evidence. History is a candidate recovery source only with correct branch/version binding and termination handling; recovery was neither implemented nor accepted here. |
| F03 | The media final had `model_dil_v2.fallbackMarkdownVersion=1`, a 3733-character fallback and 4726-character joined `content.parts`. All three `[start_idx,end_idx)` slices matched `matched_text` in fallback and failed in parts. | Offsets belong to a particular text representation. Mixing buffers can select the wrong content. This is a sample-specific observation, not a guarantee across protocol versions; non-BMP offset units remain untested. |
| F04 | All three references were `client_defined_widget`. Their `data.content` values were a chart object with 12 rows, a 1125-character Python string, and a 258-character Mermaid string. `metadata.code_blocks` was an object, not an array. | Read complete typed semantic data before converting text/media; do not assume every value is a string or execute renderer code. The current source parser returns `response_references_unsupported` for references, so rich-content adaptation remains incomplete. |
| F05 | Opening CSV preview produced actual HTTP 200 file responses. The preview screenshot displayed four columns and 12 data rows, ending `12,36,27,9`. The PNG body was 76399 bytes with the correct signature and dimensions 1780×967, matching the displayed image's natural dimensions. | Actual image bytes and visible CSV data were verified beyond model claims. CDP returned an empty CSV body despite the populated preview, so this does not establish an empty-file defect. Download-to-disk and raw CSV bytes remain unverified. |
| F06 | A synthetic evidence export opened Save As, which the user closed. Google rejected login in the independent DevTools browser with an unsafe-browser/application message. The existing local Chrome remained usable. | These are an unfinished observation export and a test-browser login obstacle, not demonstrated Web2Harness defects. No authentication or security setting was changed to make testing pass. |

Character counts use JavaScript string `.length`, not UTF-8 bytes. The cancelled answer's 633 historical characters, earlier 603 live characters and 631 DOM characters came from different times and representations; their differences do not establish data loss.

## Source comparison and recommendations

In [response-source.ts](../../../src/adapters/chatgpt-web/browser/response-source.ts), `result()` already classifies explicit non-`stop` termination as `response_message_incomplete`, which blocks DOM fallback. Unsupported references are still rejected. The earlier DOM cancellation-predicate risk needs separate work; no full Web2Harness incorrect-delivery reproduction occurred here.

Retain the proposed design: bind the current logical answer; distinguish success, cancellation, failure, and recoverable interruption; then read the appropriate complete representation and typed references. Text inactivity is a scheduling signal, not completion proof. No three-way exact-text validation or cross-step timeout budget is needed.

Use the authenticated local Chrome for the current webpage behavior baseline. Use the isolated DEV embedded browser later for actual project integration acceptance under the standard isolation procedure. Direct webpage observations are not project end-to-end acceptance.

## Confirmed, blocked, and unexecuted

- Confirmed: persisted cancellation reason, nonpersistent completion notification, all three reference offsets and payload types, 12 visible CSV rows, and valid PNG bytes. The CSV viewer was closed and temporary Network capture disabled afterward.
- Preserved failures/limitations: unfinished evidence download, independent-browser login refusal, truncated reload event buffer, and empty CSV body retrieval. Complete historical JSON was read in memory but not saved as a full replay. Initial reference-field lookup and `code_blocks.map` assumptions were observation-script errors, corrected against the actual structure.
- Unexecuted: complete raw replay of a new generation, Unicode offset-unit tests, actual download-to-disk, audio/video, arbitrary paragraph split/merge or root remounting, history-recovery implementation, Web2Harness cancellation end-to-end acceptance, and proof that the two historical incidents are resolved.

This round supplements evidence and analysis; it closes none of those remaining gaps and overwrites no previous failure. [provenance.json](provenance.json) hashes identify artifacts; they cannot substitute for original responses or live acceptance.
