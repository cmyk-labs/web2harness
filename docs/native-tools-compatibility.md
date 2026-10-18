# Native Tools compatibility and boundaries

[English](native-tools-compatibility.md) | [简体中文](native-tools-compatibility.zh-CN.md) · [Documentation](../README.md#documentation)

This comparison describes the source and evidence reviewed on **2026-10-18**. **2.4.0 is the latest published version in this review; the compatibility changes below are unreleased source.** A working-tree implementation, a passing fixture, or an unchanged package version does not mean the installed 2.4.0 application contains these changes. No publication or production deployment is established here.

The goal is to use Web models for Codex model interaction while preserving Codex tools, execution, task context, permissions, approvals, and explicit model/effort choices. Removing an extra restriction does not establish compatibility with every Codex capability. Explicitly rejecting an unsupported request is correct failure handling, not implementation of the missing capability.

**Contents**

- [Capability comparison](#comparison)
- [Native search](#search)
- [Hosted tools and real standalone executors](#hosted-tools)
- [Attachments, output and context](#data-contracts)
- [Transport, continuation and native waiting](#transport)
- [Reliability work and remaining failures](#reliability)
- [Evidence and outstanding acceptance](#evidence)

<a id="comparison"></a>

## Capability comparison

“Implemented” below means present in the reviewed source. The evidence column limits what has actually been demonstrated; it is not a blanket compatibility certificate.

| Capability | Unreleased source / retained behavior | Boundary and evidence |
| --- | --- | --- |
| Native function/custom/namespace tools and deferred `tool_search` | Retains the task's tool inventory, identities, arguments and call/result association. Codex executes the tools under its own sandbox and approvals. | Existing targeted fixtures and earlier authenticated DEV read → patch → command flows. This does not certify every individual tool, plugin or MCP server. |
| Native search | Adds reversible `standalone_web_search` configuration and search-model alias handling around the native `/alpha/search` path. Codex retains its `web.run` executor and search settings. | Configuration/transport fixtures, a synthetic-upstream CLI fixture, and authenticated DEV acceptance passed for GPT-6 Sol / `xhigh`, live search restricted to `learn.chatgpt.com`, with native read/change/readback evidence. |
| Raw hosted `web_search` / `web_search_preview` declarations | Still rejected by the Web Responses parser, with guidance to use the Codex standalone search path. | The declaration is not silently removed or translated into an invented local tool. Disabling search is not an equivalent fix. |
| DOCX/XLSX/PPTX input | Adds direct Office byte uploads, canonical MIME types and bounded package validation to the existing PDF/text path. | Fixtures and authenticated DEV through the shared Responses components passed: distinct markers in three Office attachments were read correctly. This is component acceptance, not a Codex Office-tool end-to-end pass. |
| Remote image / `input_file.file_url` | Adds task/provider/account-scoped exact URL grants and bounded public HTTPS resolution after preflight. Preparation keeps original references without downloading. | Seven shared boundary tests and resolver/network fixtures passed. Authenticated public-PDF URL component acceptance **passed**; this is not remote-image live or Codex file-tool end-to-end acceptance. |
| Provider `file_id` and raw audio/video | Explicitly unsupported in this Web attachment path, including preparation. | No verified Codex/ChatGPT file-ID download endpoint or raw-media processing contract. A transcript or extracted frames are not equivalent input. |
| `text.format: json_object` | Parses the requested format and validates the complete final answer as a JSON object. | Validator/adapter fixtures and authenticated DEV through the shared Responses components passed. No Web-side constrained-decoding guarantee. |
| Strict JSON Schema | Retains existing schema validation without coercion, repair, default injection or removal of extra properties. | Prompt plus final-output validation, not a claim that the Web model uses the API's decoding mechanism. |
| Effective generation controls unavailable on Web | Fails before adapter construction with HTTP 400 `unsupported_web_request_control`. | This replaces silent acceptance with an explicit boundary; it does not implement sampling, token caps, background jobs or API service tiers. |
| Opaque encrypted context and cross-backend agent messages | Adds a bounded preflight over expanded source input before browser work. Incompatible input returns HTTP 400 `incompatible_web_context`. | Classifier and collaboration fixtures; server preflight is present. Native ciphertext portability remains unresolved. |
| Responses WebSocket | Shared dispatch supports FIFO per named/default lane, bounded cross-lane parallelism and natural-completion steering. | 11 shared scenarios / 274 assertions passed. Real CLI resume/interrupt/recovery and independent-prefill/steering component acceptance **passed**; zero HTTP fallback in the CLI flow. Original failed evidence is retained. Published 2.4.0 is unchanged. |
| Web `generate:false` request-state preparation | Validates and retains expanded input in memory, then returns an empty completed response; URL references are not fetched. | Fixtures and real independent-lane preparation **passed**: `output: []` completed before the first model terminal. No model/browser/tool execution or KV-prewarm claim; provider file IDs and native passthrough prewarm remain unsupported. |
| `previous_response_id` | Bounded local cache partitioned by incoming auth/account/organization/project digest; WebSocket/prepared histories and descendants stay memory-only. | Cache scope is not authentication. Miss/expiry/eviction/restart requires original full history, without tool replay. No durability or upstream cache-equivalence guarantee. |
| Native blocking `wait` | After the Web round and physical resources settle, the parent's native wait holds no Web execution slot. | **Existing behavior**, not newly introduced by this batch. Earlier authenticated multi-agent observations support this boundary. |

Hosted types and real Codex tools have different contracts. Native image generation/edit forwarding exists; route presence alone does not prove authenticated acceptance. See the [per-tool conditional blockers](#hosted-tools) before treating an unsupported declaration as a missing local tool.

Source owners: [tool parser](../src/responses/parser.ts), [Responses server](../src/server.ts), [native passthrough](../src/codex/native-passthrough.ts), and [native tool-call contract](../src/adapters/chatgpt-web/tools/native-tool-call-block.ts).

<a id="search"></a>

## Native search

The supported integration direction is Codex's **standalone search executor**:

1. Native Tools setup manages `[features].standalone_web_search = true` reversibly. Codex exposes the native `web.run` tool; the Web model requests that declared tool and Codex executes it.
2. Codex sends standalone requests to the bridge's `POST /v1/alpha/search`, which forwards them to the native `/alpha/search` service with the incoming Codex Bearer authorization.
3. The bridge resolves its own Web model aliases to the corresponding search identity. Unknown or unverified aliases fail explicitly; native model generation is not substituted for the selected Web model.
4. Codex's `web_search` policy, including `cached`, `live` and `disabled`, stays user-owned. Search commands, `external_web_access`, domain filters and results retain their native transport semantics. The bridge does not replace cached search with live browsing, remove filters, or enable a search policy the user disabled.

The standalone feature flag enables an executor; it does not itself change cached/live policy or grant authentication/account access. Requests without incoming authorization receive 401, and upstream denial/quota errors remain failures. Search-service access must not be inferred from the availability of Web model generation.

The mainline authenticated DEV result reported on 2026-10-18 passed with Native Tools, the GPT-6 Sol Web model and `xhigh`, `live` search and a `learn.chatgpt.com` domain restriction. The outer Codex `webSearch` event succeeded; the native read command exited 0, `fileChange` completed, and the readback command exited 0. The check matched `CHECK=NATIVE-SEARCH-3187 COUNT13` exactly, and the final answer cited the official [Web search documentation](https://learn.chatgpt.com/docs/web-search). This establishes the tested live/domain-filter path with actual tool/file evidence. It does not turn fixture coverage of cached/disabled policy or other filter combinations into authenticated acceptance.

New integration journals record ownership and the prior value. Disconnect/uninstall or leaving Native Tools restores that baseline. Explicit later edits cause a conflict rather than being overwritten. An older journal does not acquire this feature merely by reconnecting: setup/reapply with explicit Native Tools configuration and a Codex configuration reload are required. The reversible editor supports the ordinary scalar boolean in `[features]`; unsupported alternate TOML representations fail without rewriting them.

Profile review was corrected for the installed Codex **0.155.1**: a root `profile` selector is unsupported, and inline `[profiles.<name>]` tables are not the current CLI profile-selection mechanism. The integration guard rejects an explicitly present legacy root selector without changing the user's selection, model, provider or permissions. It does not merge obsolete tables, infer an unspecified `--profile` invocation, or read/change externally selected profile files; unused inline data remains untouched. Acceptance of a legacy configuration by the old guard was not evidence that the current CLI actually applied that profile. Compatibility V1 separator/blank-line restoration was also fixed for newly recorded operations, without guessing ownership in old journals. The configuration regression suite passed **117 tests**.

This path does **not** make raw hosted `web_search` declarations parseable. Do not remove those declarations, disable search, or substitute another executor and then report full equivalence. `tool_search` is deferred tool discovery and is a separate capability.

Implementation and fixtures: [search mapping](../src/codex/native-search.ts), [integration](../src/codex/integration.ts), [configuration restoration tests](../tests/codex/standalone-search-integration.test.ts), [native search transport tests](../tests/codex/native-search.test.ts), [actual CLI fixture](../scripts/smoke-codex-web-search.ts).

<a id="hosted-tools"></a>

## Hosted tools and real standalone executors

Official Codex CLI **0.155.1** source (`be2951ea34f0d295ed0becf97079f92fa5f6950e`) and the inspected current source (`8c076942cb70fba8e5c4732c23f1faabc4aed484`) distinguish real registered tools from hosted Responses types. Their [ToolSpec enum](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/tools/src/tool_spec.rs) declares function, namespace, custom, tool search and web search. Parsing a history item does not establish an executor. No new generic hosted bridge was added where an equivalent service contract could not be verified.

| Tool family | Existing route and conditional blocker |
| --- | --- |
| `web_search` | The actual `web.run` extension uses `/alpha/search`; its feature, provider and user search-policy gates must all permit execution. Raw hosted declarations remain unsupported on the Web route. |
| `image_generation` | The real `image_gen.imagegen` extension owns input reads, image API requests, artifacts and tool-result events. `/images/generations` and `/images/edits` preserve incoming auth, exact image model/body, response bytes, errors and cancellation. CLI 0.155.1 additionally gates the tool on its image feature, provider image/namespace capabilities, image input and supported auth, excluding a known Free plan. Route presence does not enable it. Generic hosted call IDs, partial-image events, revised prompts and edit continuation cannot be manufactured from an Images response. [Hosted image contract](https://developers.openai.com/api/docs/guides/tools-image-generation). |
| `computer` / `computer_use_preview` | An actual task-owned browser/desktop driver, screenshots and safety/approval handling are required. Registered Codex tools can retain their existing executor, but a Responses declaration gives the gateway no environment-control capability. No universal hosted driver bridge is implemented. [Computer contract](https://developers.openai.com/api/docs/guides/tools-computer-use). |
| `file_search` | Standalone vector-store retrieval exists, but a complete equivalent needs original store/file identity, project-bound auth, query planning/ranking/filter behavior, call lifecycle and citations. Local file reads or an unrelated MCP search do not provide that contract. [File Search](https://developers.openai.com/api/docs/guides/tools-file-search), [Retrieval](https://developers.openai.com/api/docs/guides/retrieval). |
| `code_interpreter` | Hosted execution uses a persistent container, its files and citation identities. The inspected public Containers contract exposes lifecycle/file operations, not an independent endpoint that resumes a hosted interpreter call. A local shell or different sandbox changes state and authority. [Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter). |
| Hosted `mcp` | Codex-registered MCP functions keep their prepared server binding and native execution. Hosted MCP additionally owns connector/server credentials, discovery and approval-request/response state. Matching names cannot establish equivalent authorization or execution. [MCP contract](https://developers.openai.com/api/docs/guides/tools-connectors-mcp). |

The inspected [image executor](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/ext/image-generation/src/tool.rs) returns images through Codex's native function result and begin/end events. Backend `generation_id`, native tool call ID and hosted image call ID are separate identities. The [release tool plan](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/tools/spec_plan.rs) includes the namespace gate described above; the inspected newer revision removes that particular image gate. Follow the actual client's advertised tool and gates, without enabling an unavailable tool from route presence alone.

The existing native forwarder is reusable for the verified standalone search/image requests. The client executor must continue owning calls, outputs, permissions and artifacts. Tool-service model selection does not authorize replacing the parent Web model or effort with native Responses generation. Remaining hosted gaps need proven task-bound service contracts, not disabled tools, fabricated functions or successful-looking placeholder results.

<a id="data-contracts"></a>

## Attachments, output and context

### Direct Office input

DOCX/XLSX/PPTX files are transferred as the caller's original bytes. No extraction-to-text substitute, document repair or macro stripping occurs. Package validation checks ZIP directory/local-header agreement, ranges, names, checksums, required main parts, content types and the internal root relationship. It is a bounded container/identity check, not a complete OOXML schema validator or malware scan.

The mainline authenticated DEV component run passed through the shared Responses implementation in **81 seconds**, correctly reading different markers from a DOCX, an XLSX and a PPTX and satisfying `json_object` output validation. The markers appeared only inside the attachments, not in the prompt. This establishes actual Office upload/reading and JSON output on that shared component path. It is **not** an end-to-end Codex Office-tool execution result and does not certify every Office structure or rendering detail.

The existing upload limits remain 20,000,000 bytes per file, 10 mixed attachments per message and 50,000,000 total upload bytes. Office validation additionally allows at most 4,096 entries, 50,000,000 expanded bytes per entry, 100,000,000 total expanded bytes and 1,000,000 bytes per manifest. Canonical main-part locations and UTF-8 manifests are required. Legacy DOC/XLS/PPT, macro-enabled formats, encrypted/split archives, ZIP64 and unsupported structures fail explicitly. Binary token accounting is an estimate from original byte length, not an extracted-token or model-capacity guarantee.

### Task-authorized attachment references

The Web request path now validates expanded history, selected model/effort, tools and controls before resolving remote images or `input_file.file_url`. The shared server grants only exact references in validated task input, bound to task, selected provider route and incoming account scope. Arbitrary tool arguments/metadata do not become download instructions. Preparation validates shape and retains original references with no DNS or HTTP; generation resolves before ordinary attachment parsing. Native requests bypass this Web resolver.

Downloads permit only public HTTPS on port 443. Every DNS answer must pass public-address checks; the connection is pinned to a checked address while retaining hostname/TLS verification. No browser/provider authorization, cookies, ambient proxy or credential lookup is used. Each redirect needs its own exact scoped URL grant; a redirect alone grants nothing. Inline and remote image/file attachments in the expanded request share the 10-attachment limit and 50,000,000-byte total; inline content bytes count toward that total alongside downloaded bytes. Each attachment is limited to 20,000,000 bytes. Downloads have a 30-second overall deadline and at most three redirects, alongside the shared request allocation budget and cancellation. Supported specific MIME types and original bytes are retained; ambiguous MIME, unsupported charset/HTTP compression and raw audio/video fail explicitly.

Provider `file_id` remains unsupported in both preparation and generation. The public API Files endpoint does not prove a compatible Codex OAuth/ChatGPT backend service. Adding it requires a verified service origin, account-bound incoming auth, redirect policy and the same resource bounds. Raw media likewise needs a verified upload/processing contract for the selected Web route; transcription or frame extraction does not close that gap. Direct-upload boundaries do not restrict local Codex tools/skills from operating on files.

See [reference resolution](../src/responses/input-references.ts), [pinned HTTPS transport](../src/responses/input-reference-network.ts) and [shared boundary fixtures](../tests/responses/server-input-references.test.ts).

See [input validation](../src/responses/file-input.ts), [file compatibility fixtures](../tests/responses/file-input-compatibility.test.ts), and [attachment transport fixtures](../tests/adapters/chatgpt-web/browser/attachment-compatibility.test.ts).

### Output validation and unavailable controls

`json_object` validation parses the **entire final answer** and requires an object. Arrays, scalars, partial JSON, Markdown fences and surrounding prose fail; output is never repaired or extracted from a fragment. Failure is non-retryable `structured_output_validation_failed` with error classification 502; an already-open stream reports failure rather than a successful final. Tool-only rounds and interim tool transport are not final JSON answers. Existing strict JSON Schema validation is retained. Both are delivery checks, not proof of native constrained decoding.

On ordinary Web Responses requests, effective unsupported top-level controls are rejected before browser/queue work:

| Rejected override | Values that mean no override for this check |
| --- | --- |
| `max_output_tokens`; explicit `temperature` or `top_p`, including numeric API defaults | Absent or null |
| Stop strings or nonempty stop lists | Absent, null or an empty list |
| Nonzero `presence_penalty` / `frequency_penalty` | Absent, null or zero |
| An explicit API service tier other than `auto` | Absent, null or `auto` |
| Background generation; automatic history truncation | Absent/null, `background:false`, `truncation:"disabled"` |

Normal schema validation still applies. The guard is Web-only, not a restriction on native passthrough, standalone search or command-tool arguments such as `exec_command.max_output_tokens`. Dedicated compaction has its own contract. Accepting a no-override value does not establish an identical Web sampling configuration. Usage remains estimated rather than native token accounting.

See [output validator](../src/adapters/chatgpt-web/output-validation.ts), [request controls](../src/adapters/chatgpt-web/request-controls.ts), and [server boundary fixtures](../tests/responses/server-web-capabilities.test.ts).

### Opaque context

The preflight checks expanded source history, including agent messages, reasoning, compaction variants, tool outputs and explicit encrypted argument metadata. It returns bounded, content-free issue locations and recovery guidance. Mixed plaintext, adjacent summaries or an empty plaintext marker on another item do not make ciphertext readable.

The bridge must not decrypt unknown native state, drop it, replace it with a summary, force MultiAgent V1, switch models, disable encryption or replay tool side effects to manufacture continuity. Existing plaintext V2 delivery and valid bridge-owned transparent `ocx1`/`ocxr1` envelopes remain usable; these envelopes are reversible encodings, not decryption of native ciphertext. Native passthrough retains its separate original-data path.

The verified plaintext contract is narrower than migration: CLI 0.155.1's [router](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/tools/router.rs) recognizes `encrypted_function_args: []` only for direct `collaboration.spawn_agent`, `send_message` and `followup_task` calls carrying original plaintext. The recipient keeps author/recipient/content boundaries. This marker cannot decrypt an existing payload; mixed encrypted/plaintext content still fails.

Native [reasoning](https://developers.openai.com/api/docs/guides/reasoning) and [compaction](https://developers.openai.com/api/docs/guides/compaction) contracts provide opaque-state replay on a supported backend, not a verified complete plaintext export for a Web model. Hosted [Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent) actions are server-executed and must not be replayed as local functions. Its separate `/responses/compact` restriction also prevents assuming that endpoint is a general migration/export service. Continuing on the original backend requires preserving the user's explicit route choice; automatic fallback is not migration.

A supported complete export or original plaintext delivery from the producing system would be needed to close the remaining gap. Preflight improves diagnosis without proving lossless cross-backend continuation. See [context compatibility](../src/responses/context-compatibility.ts) and [its fixtures](../tests/responses/context-compatibility.test.ts).

<a id="transport"></a>

## Transport, continuation and native waiting

The [WebSocket adapter](../src/responses/websocket.ts) uses the shared HTTP Responses handler, body budget and cancellation lifecycle. Each named `stream_id` and the implicit default lane run FIFO without overlap; different lanes may run concurrently. Defaults are 16 active responses, 32 named lanes plus the default, and a bounded pending queue of 128 requests / 64 MiB per connection. Event/backpressure and steering budgets are also bounded. These transport limits do not increase the global Web execution-slot limit. `stream_id` orders delivery; `previous_response_id` selects history, including a fork while its parent remains available.

Continuation is partitioned by a digest of incoming authorization, account, organization and project headers. This is cache separation, not authentication or a grant of tool permissions. WebSocket histories, prepared contexts and their descendants remain `memoryOnly`, including a later HTTP continuation; unrelated snapshot flushes exclude them. Retention is bounded by one hour, 1,000 entries and 64 MiB of UTF-8 item data. Restart, expiry, eviction or a changed scope may yield `previous_response_not_found`. Recover by submitting the complete original history without that ID, including existing tool results, without re-executing tools. This is a process-local shared cache, not the upstream service's connection-local cache or a ZDR certification.

Web `generate:false` validates and retains the complete expanded input before returning an empty completed response with a usable ID. It runs no model, browser or tool; input/output/total usage are all zero, without a separate cache-token claim. URL references remain unresolved during preparation, with zero DNS/download activity; malformed or unsupported provider-file references fail. Both text and URL preparation now use configured provider parameters without reading a live Launcher/browser descriptor or constructing the model adapter; native revision/cancellation checks remain. Normal generation still resolves the live descriptor. A preparation ID proves retained request state, not resource reachability, model acceptance or KV-cache warming. Native passthrough preparation still fails with `unsupported_native_prewarm`; the flag is never discarded to start generation.

`response.steer` is implemented at **natural completion**, for supported ordinary automatic GPT-6 Native Tools requests. Validation does not generate, download or commit cache state. Prepared/native passthrough requests, unsupported routes, hosted conversations, hosted agents and automatic compaction are excluded. `response.steer.accepted` means queued input; the successor's `response.created` is its commit point. A successful completion without external input can schedule a successor using the original model, effort, tools and other settings. The bridge does not interrupt an in-flight browser turn at an earlier output-item boundary or synthesize `incomplete: steered`.

If client-owned tool results or approvals are required, accepted steering stays pending and emits `response.steer.pending`. A matching explicit `response.create` on the same connection/lane must supply the required results/decisions; accepted steering is prepended once. That explicit continuation retains its own settings. Do not resend the accepted steer, rerun tools or manufacture approvals. Failure before the successor starts is reported through `response.steer.failed`. Recognizing a pending hosted approval shape is not implementation of the hosted tool itself.

The current official [Responses WebSocket](https://developers.openai.com/api/docs/guides/websocket-mode) and [steering](https://developers.openai.com/api/docs/guides/steering) contracts document create/steer, not a Realtime-style `response.cancel` client event. The earlier missing-cancel-frame gap is corrected: an invented cancel frame is not a parity requirement. Owned-connection disconnect cancels that connection's work; native precise turn interrupt remains a separate identity/authority path. Background HTTP cancellation is another contract. Background/non-streaming Web generation, native prewarm and earlier-boundary steering remain unsupported.

Shared-server fixtures cover scoped history, lanes and tool-pending steering. Real CLI resume, interrupt and recovery passed with zero HTTP fallback; shared-component acceptance passed public-PDF reading, independent-lane preparation and one natural-boundary steering successor. See the [verification scopes](#evidence). The original failed run remains recorded. These results do not establish earlier-boundary steering, upstream cache/protocol equivalence or native token-by-token model streaming.

Native blocking `wait` has **already** released the parent's Web slot once the preceding Web round and physical resources have settled. A subsequent model invocation acquires a slot again; child agents' Web requests count separately. Local queue-status polling is different from invoking a model repeatedly. “Wait uses no Web slot” does not mean every polling/model round is free of queue admission.

The two added suggestions to do independent work before waiting and reduce short model polling were removed at the user's request. This batch does not impose those orchestration strategies. Necessary tool/result matching and round-settlement rules remain. The native executor, wait arguments, approvals and sandbox are unchanged by removing the suggestions.

<a id="reliability"></a>

## Reliability work and remaining failures

The earlier response-source, send-confirmation and queue-error changes are also unreleased. The two investigated failures occurred on **latest published 2.4.0**, not an outdated installation and not this new implementation.

| Improvement | Remaining boundary |
| --- | --- |
| Strict public-final reconstruction with independent DOM fallback for unavailable terminal metadata; bounded same-request body fallback and private replay evidence | Rich references/unknown forms are not all supported. Capture is privacy-projected diagnostic evidence, not original wire bytes or delivery authority. The original historical failing streams are still missing. |
| Single Send activation plus bounded read-only late-acknowledgement reconciliation | For up to five seconds after the initial observation/stage failure, only one matched request with HTTP 200, input-bound acceptance and intact source identity can confirm that original submission. No second click, reload, rebind or resend. Historical unknown-send cause remains unproven. |
| Immediately report `queue_blocked_<reason>` and preserve known pause origins | The global unknown-send protection remains. This is not automatic task isolation or background recovery. |

Failure-only private evidence is captured before observer detach, with defaults of 2 MiB / 2,048 events. Normal diagnostics expose only a reference and counts. Capture/replay admits the observed `delta_encoding`, `message` and `delta` names only with supported payload shapes. Hidden `model_editable_context` retains structural fields only; unknown events, error payloads and unsupported shapes remain withheld. Known private bodies are projected out, and gaps/truncation remain explicit; later hidden-channel changes revoke prior body-bearing records. Offline replay performs no network, model or tool work and cannot authorize delivery. Successful/cancelled turns do not create this artifact. Private artifacts can still contain public answer text and require controlled access.

The original historical cause of `response_message_incomplete` remains unproven. Replaying 37 saved, already-redacted samples preserved their results (36 complete, one collecting); those samples are not exact reproductions of the missing historical failures. Late-acknowledgement fixtures establish a specific timing/race repair, not the historical root cause. Ambiguous identities, observation loss or unknown remote effects retain the global `send_outcome_unknown` fence; page closure is not proof of remote termination.

The first current-phase authenticated WebSocket round completed native read → patch → readback. In the same-session second turn, the native patch reached `COUNT14` and command verification exited 0, but the final response failed with `response_message_incomplete`. Codex attempted an HTTP fallback, which the WebSocket acceptance runner rejected. That original failed proof remains retained; the subsequent resume/interrupt/recovery acceptance passed without replaying the completed patch.

The failed run's observer reported `finished`, `endTurn` and `done` true, with completion (`is_complete`) and finish metadata missing. Its private capture withheld non-default SSE events and cannot recover those omitted payloads. A later authenticated smoke captured 12,885 bytes with the now-supported `delta_encoding`, `message` and `delta` event names. Diagnostic replay retained **23 events, 18 projected, zero withheld and zero dropped**; three chunking modes matched direct facts/results, and four checked private values were absent from the artifact. This validates capture/privacy/replay for that sample, **not reproduction of the missing-metadata failure** or recovery of historical streams.

Missing `is_complete` or finish metadata now yields `response_terminal_metadata_unavailable` only after input/conversation identity, unique finished final, other public-message status and parent-lineage checks pass. This never authorizes source-text delivery: only the existing independent DOM completion and Markdown coverage checks may permit fallback. Explicit false completion, non-stop or malformed finish metadata, unfinished status, identity conflicts and late mutations still block fallback; explicit terminal failures retain `response_message_incomplete`.

<a id="evidence"></a>

## Evidence and outstanding acceptance

### 2026-10-18 read-only task acceptance

Both authenticated tests used the same unreleased source checkpoint, isolated DEV, Codex CLI `0.162.0-alpha.17.2`, Native Tools, and `chatgpt-web/gpt-6-sol` / `xhigh`. The project was a read-only analysis target; historical production threads were not controlled.

| Task | Result | Evidence and limits |
| --- | --- | --- |
| Repeat the earlier change/failure analysis | **PASS**, 947.844 seconds | Nine successful Web requests; 35 native commands, including one corrected regex failure. The 4,564-character final report matched CLI events, the saved answer and native terminal records. One pass does not establish that intermittent faults are fixed. |
| Three parallel agents review code style, architecture and related technologies; the main agent aggregates | **FAIL**, 4,286.756 seconds | All three child reports arrived, but main final delivery failed twice: `turn.failed`, exit 1, no valid main final report. Of 139 Web requests, 128 succeeded, ten failed and one was intentionally cancelled. |

The parallel test reproduced five `response_message_incomplete` rejections, three `missing_pending_content` conflicts, one `unanchored_snapshot` conflict and one unavailable-model-controls failure. Completed final messages coexisted with unfinished earlier commentary; the protocol semantics still need investigation. All four Markdown conflicts preceded body emission. Forty-four native sampling retries are not forty-four distinct Web requests. Private logs also retain a tool-call-block relay failure and automatic HTTP fallback.

The parallel task executed 266 native commands (256 exit 0, ten nonzero), including 27 native Web operations. Actual Web concurrency reached four; parent native wait without a Web slot while all three children ran was observed. Child reports matched messages received by the parent. The outer coordinator's summary is not a successfully delivered model main answer.

Both tests verified 888 project files, HEAD and Git state unchanged, production configuration/authentication hashes and relevant process/service identities unchanged, and owned DEV shutdown. Parallel-test concurrency was restored from four to one. Private evidence remains in local `output/2026-10-18-thread-01a14d08-retest/` and `output/2026-10-18-parallel-review/`. Six later source exports were preserved; two earlier exports had rotated out, and some exports are explicitly non-replayable. Parallel acceptance remains failed despite the single-task pass. Neither test establishes installer acceptance, publication or complete Codex equivalence.

### Earlier scoped acceptance

The results below apply to their recorded source checkpoints. **Real CLI resume/cancellation/recovery, public-PDF URL/independent-prefill/steering components, final runtime package and isolation checks passed.** Original failure evidence and historical root-cause limits remain. Independent DEV login restored authentication, not the readiness correction. Published 2.4.0 is unchanged; these scoped passes do not establish complete Codex compatibility or a production release.

| Check | Result | Scope / limitation |
| --- | --- | --- |
| Core full suite after terminal/readiness fixes | **1,689 passed / 77 skipped / 0 failed; 11,824 assertions; 137 files; 214.81 seconds** | Predates the SSE event allowlist correction, which has separate targeted verification below. |
| Post-preparation-fix shared regressions | **7 reference cases** and **11 WebSocket scenarios / 274 inner assertions** passed; combined run: **8 outer tests / 48 outer assertions passed** | Covers text/URL preparation without a live descriptor, reference boundaries, scoped history, lanes and steering. Outer and subprocess counts overlap; not authenticated model acceptance. |
| Final whole-project typechecks | **Passed** | Includes the final diagnostic event changes; not authenticated acceptance. |
| Final source/stream/evidence regressions | **57 passed / 269 assertions**; focused capture suite **29 passed / 148 assertions** | Overlapping scopes, not additive. Covers terminal classification, observed SSE names and privacy/replay; no complete CLI continuation claim. |
| Desktop full suite and isolated recheck | Full run: **673 passed / 4 skipped / 2 environment failures**. Authorized two-file recheck: **94 passed / 1 skipped / 0 failed** | The recheck resolves the Vite ancestor-access and owned-child-termination failures. Preserve the original full-run result; no subsequent all-green Desktop full run is claimed. |
| Final verified runtime package | `runtime-bundle-verified` build and relocation smoke **passed**, with `RELOCATABLE_RUNTIME_SMOKE_OK` | Verifies the rebuilt package; not an installed upgrade or complete authenticated tool/model acceptance. |
| Real authenticated Codex CLI | **PASS** | Resumed the original failed thread and verified existing `COUNT14` without replaying its patch. States: completed/interrupted/completed; three commands exited 0, one file change completed, final `COUNT15` and nonce preserved. Three WS upgrades, two prefills, four continuations, zero HTTP fallback. Interrupt settled HTTP/browser/WS active-turn owners to zero; the same thread then patched/read back without a runtime restart. |
| Authenticated shared components | **PASS** | Read the public W3C PDF's `Dummy PDF file` text without that answer in the prompt. An independent lane's `generate:false` completed with `output: []` before the first model terminal. One accepted steer produced a natural-boundary successor with the correct random proof; original and successor responses passed JSON validation. This is component acceptance, not remote-image live, raw-media or Codex file-tool end-to-end acceptance. |
| Isolation closeout | **PASS** | Three production configuration/authentication file hashes, identities of nine installed app/runtime processes plus one user Codex process, and related services were unchanged. The owned DEV process was closed and confirmed exited. |
| Installer / production rollout | Not exercised | No publication, installed upgrade or production acceptance is established. |

Focused fixtures additionally cover reversible configuration, attachment/network limits, private evidence and offline replay, late acknowledgements, standalone forwarding and opaque-context guards. These overlap the full and shared suites and must not be added into a larger total. Skipped checks remain unexecuted; fixture success does not resolve the missing historical failure streams or hosted/ciphertext blockers.

Earlier actual-CLI fixtures establish search execution and sequential WebSocket preparation/tool continuation with synthetic upstreams; they do not establish authenticated Web generation or acceptance of later lanes/steering. Earlier authenticated DEV established read → patch → command, compaction, cancellation/reuse and native waiting; the separate search flow verified GPT-6 Sol / `xhigh`, live search and its domain filter. The shared Office/`json_object` component flow also passed. Those results retain their original scopes: the earlier offline-task flow had search disabled, and Office component acceptance is not Codex Office-tool end-to-end acceptance.

Select relevant cases under [capability acceptance](acceptance-tests.md), use the [isolated development procedure](development.md#standard-isolated-test-procedure), and assess publication under the [release manual](release.md). Keep fixture, authenticated DEV and installer evidence separate. Do not claim complete Codex equivalence from this matrix.
