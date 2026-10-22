# Troubleshooting

[English](troubleshooting.md) | [简体中文](troubleshooting.zh-CN.md) · [Documentation](../README.md#documentation)

Locate the first failed layer before changing configuration. A browser check, an applied route, a verified model catalog, and a completed task establish different parts of the connection. Normal operation is described in the [user guide](user-guide.md); exact settings are in the [reference](reference.md).

**Contents**

- [Initial diagnosis](#failure-boundary)
- [Startup and installation](#startup-and-installation)
- [Routing and catalog](#codex-routing-and-catalog)
- [Browser and account](#browser-and-account-checks)
- [MCP Bridge and manual interaction](#mcp-bridge-and-manual-interaction)
- [Tasks and context](#task-execution-and-context)
- [Support report](#support-report)

<a id="failure-boundary"></a>

## Establish the failure boundary

Automatic Native Tools may display “Resynchronizing task context (1/1)” when the Web model sends a valid current-round context-resync signal. The bridge resends the complete current Codex context once in a fresh conversation before delivering tools. `context_resync_invalid` means the control reply had invalid fields/binding or was mixed with other content; `context_resync_failed` means the one complete recovery could not continue. Neither is a successful task answer or an ordinary retryable failure. Check required attachments and start a new request if needed. A model's natural-language claim of a prefix hash mismatch is not proof that native history or files are corrupt; the original prefix checksum is verified only by the host. Increasing context budgets or changing the 32 KiB upload threshold does not repair a representation mismatch.

Record the application and Codex versions, installation method, regular or DEV profile, active mode and interaction, selected model, failure time, and final detailed error. “Reconnecting” is an intermediate state and does not identify a cause.

Response failures retain specific codes: `chatgpt_empty_response` means the Web round ended without a usable reply or accepted tool call; `chatgpt_assistant_turn_missing` means the sent message was accepted but no assistant turn became observable; `chatgpt_dom_unresponsive` means same-page observation recovery was exhausted; `chatgpt_response_timeout` means the configured response deadline expired. These observations alone do not establish a network fault or a Codex execution failure. Accepted requests are not automatically resent for these errors, because the original result may be uncertain. Inspect the owned conversation and correlated diagnostics before continuing.

In automatic MCP mode, `mcp_handoff_not_received` means the browser issued a connector call carrying the current round's binding, but the local broker still had no MCP activity after the existing completion grace period. Explanatory text cannot complete that round successfully. A late real receipt may settle within that same budget; the application does not resend an unexplained failure or execute arguments extracted from the page. Classified remote errors follow the bounded recovery rules below. Diagnostics retain only call/result counts and binding-match facts, not arguments or binding values. This detects an unreceived handoff; it does not establish a remote safety refusal or repair the remote delivery cause. Calls after earlier local activity and unavailable/unsupported browser evidence are not classified by this specific zero-activity check. Restart the runtime and browser helper together after upgrading this behavior.

Transport diagnostics retain at most 64 events and prioritize recent conversation requests, response status codes and completion/failure categories over page assets. Counters survive a full request-handle budget or a same-page observation rebind. HTTP completion alone does not prove visible output or SSE completion; dropped events remain counted. These records contain no request URLs, headers or bodies.

Large-context rendering and input insertion are separate stages. The context JSON uses reversible Unicode escapes for backticks to avoid pathological Markdown link parsing after submission; decoded code, whitespace and historical identifiers remain unchanged. When a submitted user bubble is collapsed, reply rebinding can expand it and verify the complete supported text structure, then recheck for competing turns. A shared prefix or truncated bubble is never sufficient proof. Splitting input insertion alone does not prevent the final complete message from triggering a rendering fault.

For `tool_identity_mismatch`, diagnostics compare the submitted identity with the current visible Codex registry. Matching declared tool names and booleans identify a missing namespace, a namespace joined into the name, or an input-kind mismatch; unknown supplied names, arguments and response contents are not logged. A rejected submission is not an executed tool. Keep Codex's tool names, permissions and call controls unchanged.

The browser smoke test also uses the global Web request queue and send interval. Its launcher-owned helper is identified by both operation ID and process ID, so the test can run while its maintenance lock continues to exclude unrelated browser work. If it immediately reports “busy with browser smoke test”, retain the diagnostic log; that is a local ownership failure, not evidence of an account or network limit.

**Check browser connection** reports connection/page readiness separately from send verification. If dispatch is paused, the connection stage can still run, but send verification remains blocked and the overall check has not passed. Use **Review queue and resume**, inspect the blocking task and confirm that browser work has stopped before **Confirm recovery → Resume dispatch**. This does not resend old requests or clear a separate manual pause. A changed pause requires a new confirmation. Unknown-send protection survives upgrades and restarts; neither proves the remote outcome. Minimal blocker metadata remains available after ordinary task receipts expire, although older detailed logs may have expired.

Queue blockage, cancelled inspection and a failed connector/plan operation do not by themselves establish a browser connection failure. Review the specific operation result and independent browser/runtime health. A newer failed, blocked or cancelled check replaces the current success flag. Signing out, detecting an account change or restarting the browser process requires a fresh check; reopening the renderer alone does not. Historical success is not current verification.

Run **Usage & Diagnostics → Health checks → Run doctor** and retain every failed check. If startup prevents access to the workspace, use **View details** and **Export diagnostic log** on the startup page. For automatic interaction, inspect browser sign-in, applied configuration, and catalog readiness in that order. For manual interaction, personally verify the browser and remote connector binding.

| Symptom | Start here |
| --- | --- |
| The workspace never opens, installation fails, or removal stops | [Startup and installation](#startup-and-installation) |
| The browser works but Codex has no Web models | [Routing and catalog](#codex-routing-and-catalog) |
| Login, composer, model, or effort checks fail | [Browser and account](#browser-and-account-checks) |
| The local tunnel runs but connector tools fail | [MCP Bridge](#mcp-bridge-and-manual-interaction) |
| The catalog is verified but a turn or compaction fails | [Tasks and context](#task-execution-and-context) |

Where appropriate, reproduce once and immediately export a safe log. Stop after an account-side limit or a repeated browser-structure error. Reinstallation and repeated configuration application can obscure a fault in an otherwise working setup. Preserve browser profiles, route journals, checkpoints, and installer recovery records.

For development, use the [isolated test procedure](development.md#standard-isolated-test-procedure). Do not restart, redirect, or reconfigure production to reproduce a DEV failure. Installer, updater, and removal acceptance belongs in a disposable VM or dedicated test OS.

<a id="startup-and-installation"></a>

## Startup and installation

### Source startup or dependency installation fails

**Check and action:** run commands from the repository root and verify the tool versions in the [installation procedure](user-guide.md#installation). Install both dependency sets with their lockfiles. `bun run app` also checks dependencies before launching. Preserve the first failing command and correct its reported network, permission, or dependency problem; do not remove lockfiles or change global settings to bypass it.

**Verify:** the startup screen completes and the intended profile opens. This establishes desktop startup only; continue with browser and Codex connection checks.

### Windows setup fails or recovery remains incomplete

**Check:** save the exact installation or startup error. Registered Windows installations prepare the private runtime during setup; normal startup checks readiness. A missing or damaged runtime requires installer repair. Formal platform acceptance is tracked in the [release manual](release.md).

**Action:**

1. Finish affected tasks and select **Exit** from the target launcher's tray menu.
2. For a repair instruction, rerun the matching installer. If automatic recovery is incomplete, retain recovery files and rerun the installer before starting Web2Harness.
3. For unsafe directories, unrecognized files, redirected paths, busy files, or ownership conflicts, resolve the specific condition reported. Do not delete unrelated files, force-close all same-name processes, or edit installation records.

**Verify:** setup completes, the application opens, and the existing profile is available for inspection. If recovery fails again, collect both the deployment and rollback errors. A failed transaction is not a completed installation or repair.

### A runtime belongs to another instance, or a port is busy

**Check and action:** inspect diagnostics to identify the profile, process, and endpoint. The launcher refuses to control a runtime whose ownership cannot be proven. Do not terminate unrelated processes to free a port. DEV uses its status command and independently allocated loopback endpoint; do not copy production endpoints or change global configuration.

If the launcher reports that it restored the previous Codex route after runtime failure, restart the affected Codex client once, then repair the runtime separately.

**Verify:** the intended profile reports its own ready runtime and endpoint. For DEV, confirm ownership using the development procedure before controlling any process.

### Uninstall stops before completion

**Check and action:** finish tasks and exit the exact application installation. The uninstaller verifies route restoration, process ownership, and any selected data roots. A changed route, missing recovery record, redirected data path, or occupied program file can block removal. Resolve the reported condition and retry; retain uninstall registration and recovery evidence.

**Verify:** removal completes, the prior Codex route works, and local data matches the retention choice. The optional data-removal checkbox is off by default. Retaining data leaves settings disconnected, without an active Codex integration. See [removal scope](user-guide.md#disconnect-and-uninstall) for data that belongs to Codex or remote ChatGPT/MCP resources.

<a id="codex-routing-and-catalog"></a>

## Codex routing and model catalog

### Web models are absent, or the catalog stays unverified

**Check and action:**

1. Confirm Codex uses ChatGPT sign-in. Its session is independent of the launcher browser; an API-key or signed-out session can retain only the built-in catalog.
2. With automatic interaction, pass **Check connection**, then select **Apply configuration** once.
3. Refresh the affected Codex client's catalog. If it remains stale, finish its tasks, fully quit the client and its associated background process, and reopen it while Web2Harness remains running. Signing out, closing only a window, or opening another task may not reload the catalog.
4. Inspect the launcher's catalog status and select a **(Web)** model. If verification still fails, run diagnostics and export a fresh safe log.

**Verify:** Codex reads the Web catalog and the launcher marks it verified. Diagnose subsequent turn failures separately. For development, restart only the verified DEV client.

For a catalog HTTP 401, distinguish Codex credentials from the browser's ChatGPT session. `codex login status` identifies the locally stored authentication method; it does not prove that the server accepts those credentials. A test bootstrap credential or an explicitly supplied fixture catalog cannot establish authenticated catalog access. In DEV, use `bun run dev:codex login` with the intended DEV home, then refresh the catalog without a fixture override and confirm a successful catalog response. Keep production credentials and sessions outside ordinary DEV testing; follow the [isolation procedure](development.md#standard-isolated-test-procedure). See [OpenAI authentication guidance](https://learn.chatgpt.com/docs/auth) for credential storage and login methods.

A short client timeout can interrupt the first upstream connection before it finishes. Identical catalog GETs now share an in-flight attempt, including across client disconnect/retry, only when the complete request headers and query match. An attempt without waiters is cancelled after 30 seconds; an unclaimed successful response is kept for at most 10 seconds and discarded after delivery. HTTP/transport failures are not retained. This does not substitute cached or fabricated model metadata, retry task execution, or restart the browser. A client disconnect does not overwrite the last completed catalog health result; safe transport error codes and `http.model_catalog_fetch` operation IDs distinguish actual upstream failures from retries. Persistent network/authentication failures still require their specific remedy.

### `openai_base_url changed after setup` or model “not supported”

**Check:** another router, wrapper, or configuration layer may have replaced the route globally or for one process. Web2Harness refuses unexpected ownership changes.

**Action:** choose one route owner. To use Web2Harness, disable the competing provider/proxy route, apply Web2Harness configuration, refresh or restart the affected client, and start it directly rather than through the competing wrapper. An independent MCP integration can remain if it does not replace the route. To switch away, use **Remove Codex integration** to restore the recorded previous route. Do not edit the route journal manually.

**Verify:** the selected route owner starts the intended models without an ownership error. If ownership remains unclear, report the exact error and safe log; composition with an external router is unsupported.

### Native models stop working when Web2Harness exits

**Check and action:** the installed integration routes native Codex models through the local service as well. Keep Web2Harness running, or finish tasks and use **Runtime controls → Remove Codex integration** before exiting. Restart the affected Codex client after restoration. CLI `web2harness route disconnect` is temporary; starting the launcher reconnects an installed integration. DEV does not offer production integration removal.

**Verify:** native requests work with the running integration, or work independently after permanent removal and client restart.

### A model switch returns `Encrypted content could not be decrypted or parsed`

**Check and action:** Web2Harness converts Web checkpoints for native requests and preserves native encrypted history. A different route can bypass that conversion. Confirm a single route owner and reproduce through Web2Harness. Preserve encrypted history and checkpoints. If the error persists, report both model names, whether compaction preceded the switch, and a fresh safe log.

**Verify:** the target model continues the task with its context intact. A new task succeeding alone does not establish that the original task was recovered.

### A Codex usage banner disables Send

**Check and action:** the Codex client's send gate is separate from Web model access. For **You're out of Codex and Work usage**, restore that Codex account's sending ability or use another account you own that has access and no blocking banner. Keep the intended Web account signed in to Web2Harness.

**Verify:** Codex accepts the task, followed by the normal Web request. Changing Codex login does not reset or increase the Web account's allowance.

<a id="browser-and-account-checks"></a>

## Browser and account

### ChatGPT login does not complete

**Check and action:** log in inside the launcher-owned browser. Automatic login verification and session inspection use Temporary Chat regardless of the task-history preference. Wait for a usable Temporary Chat composer; do not navigate or close the browser during verification.

If **Try another way** is offered, a supported alternative may avoid a platform-passkey limitation. Passkey-only macOS accounts have a known limitation without a generally validated workaround. If no available method works, capture one failure instead of repeatedly deleting the browser profile.

**Verify:** the composer becomes usable and **Check connection** passes. For a report, include operating system, application version, account tier, sign-in provider, and whether the composer appeared. Exclude cookies, browser storage, authentication headers, and raw profile files.

### Connection checks cannot find or verify page controls

**Check:** errors involving the composer, send button, effort selector, Temporary Chat, personalization, model verification, or viewport indicate that the expected page state was not established.

**Action:**

1. Confirm the intended current application version and dismiss any required login, onboarding, capacity, or rate-limit condition appropriately.
2. Check that a normal Temporary Chat opens for account inspection. MCP connector verification follows **Save to history**, matching task conversations; it selects and clears the exact connector without sending a prompt.
3. If Temporary Chat exposes neither the configured plugin nor a supported personalization control, this page cannot verify MCP access. Explicitly enable **Save to history** for MCP Bridge if saving task conversations is acceptable, or choose **Native Tools**. The application does not change this preference automatically. Changing the website language cannot restore a missing plugin capability. For an otherwise available but unrecognized localized control, select **ChatGPT Settings → General → Language → English**, reload, and retry once.
4. Keep the launcher visible during the check. If the structural error repeats, export a safe log for an implementation investigation rather than repeating setup.

**Verify:** the requested connection checks pass for the account. Free and Go flows can expose Luna and Think without the paid effort selector; its absence alone does not establish login failure. See the [model reference](reference.md).

### ChatGPT temporarily restricts the account

**Check and action:** stop retrying after the first account-side limit response and wait for recovery. The five-tab ceiling is a local bound, not a service concurrency quota. Limits can occur with fewer active tasks; the application cannot confirm the remaining quota or reset time.

Reduce concurrent agent work in the affected Codex environment. For clients supporting this setting, use the existing `[agents]` table:

```toml
[agents]
max_concurrent_threads_per_session = 1
```

Do not duplicate the table or retain both this key and its `max_threads` alias. Development tests use DEV configuration only. Larger context budgets do not increase concurrency or allowance.

**Verify:** after the account restriction clears, one task can complete. Repeated requests during the restriction do not provide useful recovery evidence.

<a id="mcp-bridge-and-manual-interaction"></a>

## MCP Bridge and manual interaction

### Binding checks fail, or tools never become available

Native Tools and Browser-only require no connector. For MCP Bridge:

**Check and action:**

1. Confirm that the intended mode and interaction are active, with configuration applied.
2. Verify the selected profile's Tunnel ID and regular API key with **Tunnels Read + Use**. The local tunnel must connect before creating the ChatGPT connector.
3. Enable ChatGPT **Developer Mode** and use the exact displayed connector name: **Codex Native2** for regular automatic interaction, **Codex Native2 DEV** for DEV automatic interaction, or **Codex Zero Risk** for manual interaction. The shared manual name does not establish remote isolation.
4. Select the correct tunnel, **Authentication: None**, and **Allow all actions**. Confirm the account, workspace, and applicable workspace policy.
5. For automatic interaction, pass **Verify connector binding**. For manual interaction, personally inspect the remote binding and run **Check local runtime**; the latter proves local readiness only.

Create the current connector as a new identity instead of renaming or refreshing an older **Codex Native** connector. ChatGPT can cache tool definitions. If an updated `codex_exec` lacks `sandbox_permissions`, `justification`, and `prefix_rule`, recreate the current connector to load its current schema. These optional fields request authority through Codex; sandbox and approval enforcement still decide execution.

**Verify:** an actual tool request reaches the intended Codex task and returns a result. A healthy tunnel alone is insufficient. DEV acceptance additionally requires website verification of DEV tunnel ownership and the actual connector binding; use the authorized new-resource procedure when ownership is unclear, as described in the [development manual](development.md#mcp-bridge-isolation).

### Tunnel is locally ready but its runtime key is rejected

`/healthz` and `/readyz` can return 200 while control-plane polling repeatedly returns `401 token_invalidated`. This means the tunnel runtime key is invalid; retrying Web requests or restarting the client cannot renew it. Replace only the affected profile's runtime key through the official key management page, retain the intended Tunnel ID and connector binding, and apply MCP configuration again. For HTTP 403, verify **Tunnels Read + Use** and access to that tunnel instead of treating it as rate limiting.

Desktop startup and CLI diagnostics check the current tunnel process's polling metrics and structured errors in addition to local readiness. Startup waits for a completed successful poll within its bounded readiness window; an authentication or permission rejection fails immediately. The desktop monitor reports these failures without automatically restarting the same invalid credentials. Missing diagnostics do not prove readiness. A successful poll still does not prove connector delivery or tool execution; verify a real task afterward.

### Remote MCP rate limits and bounded recovery

An actual current-binding connector tool result reporting `MCP SSE probe returned 429 from openai.org` is classified as `mcp_remote_rate_limited`. Authentication (401), permission (403), explicit exhausted allowance, and unavailable-service errors have separate codes. Model prose and old bindings are not evidence. Diagnostics retain a fixed category/status and an explicit Retry-After when present; they do not retain tool bodies or credentials. Unsupported evidence continues to use the unreceived-handoff check.

Automatic MCP recovery is capped at two retries and also respects a smaller configured Web retry limit. It requires physical browser settlement and atomic retirement of a broker binding with no past or current tool activity. Uncertain execution, cleanup failure, authentication, permission, exhausted allowance and Zero Risk interaction do not authorize replay. Model, effort, connector, sandbox and approvals remain unchanged. Recovery uses the existing native client's reconnect and queue; it is not a background task that resends finished requests.

The shared queue cools down only the affected tunnel and connector scope. An explicit Retry-After takes precedence; otherwise waits are 30 seconds then 60 seconds, each with 0–5 seconds of jitter. A Retry-After above 120 seconds stops automatic recovery; queued future work still observes that wait and its normal queue deadline. Waiting tasks remain cancellable, occupy no execution slots, and survive neither cancellation nor runtime restart as replayable work. Cooldown metadata is retained across restart; after cooldown, one queued request probes the affected scope at a time until an actual remote receipt is verified. Native Tools and other scopes retain their own admission.

**Runtime controls → Task queue** shows only unresolved failure or cooldown for the currently configured MCP tunnel and connector, plus the actual recovery attempt count. Native Tools does not show MCP history. **Usage & Diagnostics → Health checks → MCP call history** retains dated receipts and failures; an older failure is marked historical when a newer receipt exists. A receipt proves delivery, not tool completion. Local readiness or connector selection does not prove delivery. A Web turn can generate multiple probes/calls, so official tunnel allowances are not local send targets; a 429 alone cannot identify the upstream limiter.

### ChatGPT reports `Error creating connector`

**Check and action:** verify the tunnel and key belong to the intended account and the local runtime has connected. The first creation attempt can fail even with a running tunnel; retry once after checking readiness. If it fails again, stop and inspect account, Tunnel ID, running tunnel, and workspace policy.

**Verify:** the connector is created and its binding passes the applicable automatic or manual check. Creation alone does not establish correct binding.

### Tools disappear on a follow-up message

**Check and action:** inspect the actual connector in the existing ChatGPT tab; a model statement that tools are unavailable is insufficient. ChatGPT may omit the connector on a later message. After the active turn finishes, select **Preferences → Conversation reuse → New each turn** in automatic interaction and retry. This keeps the Codex task but uses fresh browser chats and resends more context.

If needed, recreate **Codex Native2** with the correct tunnel and permissions, then verify binding. Do not close an active browser tab as a recovery shortcut.

**Verify:** a subsequent request produces a real tool result. If a fresh chat also lacks tools, report that separately with the observed browser state and a safe log.

### Manual handoff waits indefinitely

**Check and action:** confirm the message was sent in ChatGPT before selecting **Sent** in the launcher, with **Codex Zero Risk** attached. Check the website model and effort, and the separate manual tunnel profile. The application cannot inspect these choices. Record the last completed step: copy, paste, send, **Sent**, or first MCP call. Follow the [handoff procedure](user-guide.md#manual-handoff).

**Verify:** the connector binds the active task and the answer returns to Codex. Local runtime readiness alone does not confirm a completed handoff.

### Windows reports `unable to verify the first certificate`

**Check:** test the affected host with Windows `curl.exe`, for example:

```powershell
curl.exe -Iv https://api.openai.com/
```

If this executable uses Schannel and receives an HTTP response, Windows trusts the tested connection. That result does not by itself establish trust for a different host.

**Action:** finish tasks and exit the affected launcher. Enable system CA use only in the PowerShell session that starts it:

```powershell
$env:NODE_USE_SYSTEM_CA = "1"
bun run app
```

For development, use `bun run dev:launcher` in that session. For an installed package, start its exact executable from the same session instead of `bun run app`. Retry **Apply configuration** once. Do not disable certificate verification with `NODE_TLS_REJECT_UNAUTHORIZED=0` or change machine-wide trust settings for a test.

**Verify:** the affected connection succeeds with certificate verification enabled. If it fails, retain the exact host error and export a safe log.

### An automatic approval reviewer blocks tools

**Check and action:** inspect the explicit review error. Codex's reviewer can use a native model independently of the selected Web model, so a native allowance failure may deny a Web tool request. Restore reviewer availability or use an approval policy explicitly supported by the affected Codex environment. A successful Web response does not authorize bypassing a rejection.

**Verify:** the tool receives the required approval and executes within Codex's sandbox. A model's claim of success is not execution evidence.

<a id="task-execution-and-context"></a>

## Tasks and context

Native Tools forwards real tool-preface prose as Codex `commentary` and the final answer as `final_answer`. The transport contract preserves progress text requested by the active Codex task outside the tool-call block. Public progress traces keep their existing event path. Tool blocks and answer-integrity checks still apply; the bridge does not invent progress when the model produces none. A child's original failure reason and a global send pause remain distinct from user cancellation.

Before sending, the browser waits for a usable effort slider and verifies the selected model. The full model-menu check has a separate preparation deadline; it does not consume the send acknowledgement budget. A failure before activation is unsent. `chatgpt_submission_ambiguous` and `send_outcome_unknown` mean acceptance could not be established: inspect the owned task page and completed tool results before explicitly retrying. Neither a successful HTTP status alone nor a timeout authorizes an automatic resend.

### WebSocket continuation or steering is rejected

These are unreleased-source behaviors, not an installed 2.4.0 upgrade. `previous_response_not_found` can mean expiry, eviction, restart or different incoming auth/account/organization/project scope. WebSocket/prepared histories and their descendants are memory-only. Submit complete original history without the missing ID, preserving existing tool results; never rerun tools to rebuild it.

Same-lane creates now queue FIFO; other lanes can run concurrently within bounded admission and Web capacity. `websocket_queue_full` means the rejected request was not executed. Steering applies at natural completion on supported automatic GPT-6 Native Tools requests. `response.steer.accepted` is not commitment: keep reading until a successor starts or a failure is returned. For `response.steer.pending` / `steering_required_input_missing`, return matching tool results or approval decisions on the same lane; do not repeat the accepted steering. Automatic successors keep original model/effort; explicit continuations use their own settings. No documented Responses `response.cancel` client frame was established; use the applicable owned disconnect/native interrupt path, not a Realtime frame.

### A remote attachment or provider file is rejected

Remote image/file URLs require exact task/provider/account-scoped grants and public HTTPS on port 443. Private/special-use DNS addresses, ungranted redirect targets, ambient credentials/proxies, unsupported MIME/charset/HTTP compression and exceeded bounds fail explicitly. Do not weaken these checks or attach production credentials. Supply supported inline original bytes through an authorized task tool, or an authorized public URL satisfying the [reference contract](reference.md#input-references).

`generate:false` can retain a valid URL without downloading it; readiness does not prove reachability or model acceptance. Provider `file_id` fails in preparation and generation because no compatible Codex/ChatGPT download contract is established. Raw audio/video is also unsupported by this attachment path; transcript/frame substitutes do not establish equivalence.

### A hosted tool or native encrypted context is unsupported

Use Codex's actual registered `web.run`, `image_gen.imagegen` or MCP tools when available, preserving their feature/auth/permission gates. A same-name function is not a replacement for a hosted declaration. Other hosted types need their original environment, resources, credentials and event/approval lifecycle; see [per-tool blockers](native-tools-compatibility.md#hosted-tools).

`incompatible_web_context` is non-retryable for unchanged input. Preserve the complete original request; do not remove ciphertext or replace it with visible summaries. The empty encrypted-arguments marker only supports new original plaintext collaboration calls, not old ciphertext. No verified native reasoning/compaction plaintext-export service is implemented. Keep the requested model/effort; a supported source-backend export or explicitly chosen original-backend continuation is a separate action.

### Page preparation fails before the message is sent

An explicit ordinary attachment failure removes only that failed card, waits 3 seconds and uploads the original bytes once more. Successful attachments and the prompt remain intact. A second failure returns the first error. Explicit HTTP 429 returns `upload_quota_exceeded` immediately without removal or retry. An unconfirmed processing timeout is not an explicit upload failure. Cancellation or evidence that submission started stops recovery; it never resends the task. File creation HTTP failures are observed as well as processing failures, and uploads use the active composer form.

`chatgpt_attachment_processing_timeout` means the attachment deadline expired without confirmed completion. `chatgpt_attachment_observation_failed` means bounded reads could not confirm the response or it ended without a valid completion event. Neither authorizes automatic removal/reupload. Observation failure, response termination or one final read window can trigger at most two reads of the original response, without repeating its POST, refreshing the page or extending the attempt's deadline. A finished response is read without waiting for stalled stream activation. Cancellation/timeout remain terminal despite late completion; explicit upload retries retain independent processing limits.

The `browser.attachment_observation` diagnostic records the owned file's index and attempt, observed creation/processing status, last event, elapsed time, observation failures and available card counts. It contains no file names or contents. Use the task trace and error reference to correlate it with the reported failure. Missing observation and incomplete processing are distinct evidence states; these records do not by themselves establish an upstream service defect.

HTTP 4xx other than 408, and unsupported HTTP 501/505, do not remove or reupload the file; 429 retains `upload_quota_exceeded`. A creation connection ending without a response is unconfirmed, not an explicit upload failure. Bounded `browser.attachment_stage` records key transitions before the terminal summary and distinguishes upload phase from observation health. Conflicting file identities cannot confirm completion.

For public commentary, `browser.public_text_evidence` records bounded lengths and content references at observation, projection, journal and emitter boundaries, accounting for whitespace normalization, continuation and native tool-block removal without retaining prose or arguments. A mismatch does not authorize replay or invented progress. `emitter_returned` is not a Codex-client acknowledgement. Existing opt-in private final-answer evidence remains available; metadata alone cannot reconstruct a missing historical source.

At successful source or DOM delivery, the bridge flushes any remaining observed commentary with structural completion evidence, even if its root disappeared before stabilization. It emits only the missing continuation and does not flush drafts, status labels or answer roots from this buffer. Failure and cancellation do not trigger this completion flush.

For interrupted delivery, correlate `browser.helper_abort_requested`, `browser.helper_error_received` and `browser.queue_execution_interrupted` with the trace's transport events. They retain local signal/queue/protocol evidence separately from the received error; an `AbortError` without a local abort is not proof of user cancellation. `browser.native_reply_delivery` distinguishes validation, atomic journal commit and emitter return/failure. Journal commit and emitter return do not prove client receipt. These diagnostics neither authorize resending an unknown outcome nor establish the cause of an earlier connection reset without matching evidence.

`runtime.interruption_observed` records the first locally observed interruption and its propagation using `firstEventId` and `parentEventId`. It preserves the original abort reason; independent errors remain separate. Correlate `websocketConnectionId` / `websocketRequestId`, HTTP `requestId`, hashed task/turn references, `attemptId`, `queueId`, and helper process identity. Helper shutdown, input closure, signals, pipe failures and observed process exits have distinct records. A dead diagnostic pipe or forced process termination can still prevent the final child record; inspect the parent-side evidence. These observations do not by themselves prove which remote service, network device or client caused a reset.

`browser.model_verification_state` records changes from the existing confirmation checks: family radio, slider range/value, separately identified aria/header descriptions, model/effort predicates, control remount identity, visibility and busy state. Failure retains the first and latest observations (up to 32 changes), with a dropped-state count. Ordinary logs contain no unknown control text. Selection checks and their waiting policy remain unchanged.

The compact failure-context recorder retains up to four description-node relationships and two owner details, with explicit omitted counts, to stay within its existing 4096-byte record limit. The ordinary event retains its larger bounded sample. Diagnostic bundle export excludes private sample files.

Model snapshots also record menu/owner relationships, ephemeral node identities, whether a description reference resolves inside the menu, and the document language category. At most eight description predicates are logged, with the total and omitted counts; verification still checks every description. `description_unknown` means the available description cannot establish the requested model/effort; `selection_mismatch` means an observed option, slider or recognized description disagrees. Neither authorizes sending or a downgrade. On a model-verification failure, `browser-failure.private.json` can retain the last readable sample from that exact check: at most eight descriptions, 512 characters per description and 128 per source reference, with truncation/omission and observation-attempt information. These private samples are excluded from ordinary traces and error responses. Existing failure archive limits apply, and old failures without samples remain unexplained.

`chatgpt_composer_unavailable`, `chatgpt_page_structure_unsupported` and `chatgpt_preparation_timeout` describe browser preparation, not model capacity. Sign-in, expired-session and browser-verification prompts keep their own errors. Generic service unavailability or HTTP 503 alone does not establish model overload.

A sign-in indicator while the document is still loading keeps readiness waiting within the existing deadline; it never releases an editable composer while sign-in remains visible. A fully loaded sign-in page still fails with `chatgpt_sign_in_required`. This handling does not restore authentication. A previous authenticated home page may be stale: check the current task page and sign in independently to the DEV profile before resuming DEV acceptance.

A single two-second readiness probe expiring does not exhaust page preparation. The bridge continues waiting for that same DOM read within that readiness operation’s own timeout, without overlapping readiness probes or resending the request. It checks cancellation, the deadline and authentication again before accepting a ready composer. A rejected read retains its original error; a readiness deadline failure retains the observation timeout as its cause when available.

`chatgpt_browser_unresponsive` means an exclusive task page did not settle after its preparation or input deadline and its independent cleanup operations. The application closes that task page and reports failure only after closure is confirmed; it does not resend the message. Other task pages and the sign-in homepage are retained. If closure cannot be confirmed, diagnostics report a cleanup failure instead. Retry the task after checking its tool results; a renderer stall alone does not establish a network fault.

Before typing a connector query or preparing a prompt without a connector, the bridge clears its owned draft through native editor deletion and verifies that no text or selected connector remains. It checks the current editor again if the page replaces it. An already verified connector with an empty draft can be reused. `prompt_attachment_integrity` means clearing or text verification failed; the bridge stops before sending that prompt. Cancellation still gets an independent, bounded cleanup. This does not add request retries or replace a retained conversation.

Automatic new conversations allow at most one preparation recovery. Queue waiting, navigation, composer readiness and recovery operations have independent timeouts; earlier elapsed time cannot shorten a later operation. The failed page is released before recovery re-enters the global queue. The native-round identity retains the consumed recovery count across HTTP reconnects; generic retryable errors do not grant another recovery. Existing conversations are not replaced by new chats for this recovery.

Recovery requires independent evidence that submission has not started: no Send activation, conversation request, user/assistant turn, Stop state or MCP activity. A `prepared` label alone is insufficient. Accepted or uncertain submissions keep their replay protection. Model, effort and connector selection are checked again before sending.

If preparation still fails, retain the exact error and inspect the owned task page. Normal diagnostics contain bounded page/transport categories, event counts and visible-text lengths, not response bodies, tool arguments or hidden reasoning. Separate failure-only private response evidence may contain privacy-projected public answer events; do not include it in ordinary logs or public support reports. Unknown/truncated/withheld data remains inconclusive. A model's safety-rejection claim is not platform evidence.

### `Reconnecting`, `stream disconnected`, `ChatGPT failed`, or HTTP 502

An exact reconnect retains the original failed operation, including an unclassified preparation failure; it does not authorize a fresh browser attempt. Only explicitly retryable failures use the bounded retry policy. Queue byte estimates retain their first admission value and are not semantic request identity. Model, effort, tool authority, input identity and owner checks still apply. A new user instruction can start a new operation after the failed one settles.

**Check:** inspect the final detailed error after reconnect attempts. These messages can result from account limits, website errors, changed controls, a closed browser page, route conflicts, or an expired MCP tool deadline. A generic 502 does not identify a tunnel fault.

**Action:** if no account limit or other stopping condition applies, try once in a new Codex task. Record whether tools executed, whether ChatGPT showed a final answer, and whether the new task succeeded. Run diagnostics and export a safe log immediately. For `codex_tool_timeout`, inspect the actual tool and its turn-bound deadline before retrying.

**Verify:** a complete answer and expected tool results return to Codex. Identify any partial file changes from a failed attempt before requesting the same operation again.

For Launcher queue status polling, `browser.queue_poll_transport_retry` records one retry after a local `ECONNRESET`. It uses the same captured endpoint, owner ticket and original 10-second deadline; the retry only refreshes that owner's status/heartbeat. A second reset, an expired deadline, an explicit owner rejection or malformed response still fails. Enqueue, send permits, send receipts and settlement are not retried by this rule. A single broken status-query connection therefore need not cancel otherwise healthy browser work, while actual cancellation and ownership failures remain effective.

### The Web answer exists but Codex reports `browser_stream_inconsistent`

For a focused reproduction, `WEB2HARNESS_BROWSER_DIAGNOSTICS=1` additionally captures the public final answer before page cleanup in `response-delivery.private.json`. It records the selected source, delivered text, available DOM text, automatic-resume facts and privacy-projected source events. It excludes DOM HTML and hidden reasoning; unavailable or truncated observations remain explicit. These bounded private archives are separate from failure archives and ordinary diagnostics. They help compare model output with bridge delivery and do not add a delivery validation gate. Keep them private and redact before sharing.

Automatic Native Tools and Browser-only now prefer the verified original response, preserving table cells, code-fence info and repeated paragraphs without HTML round-tripping. `browser.response_source_committed` records that path; `browser.response_source_fallback` records why independently checked DOM extraction was used. Rich references and unsupported protocol shapes may still require DOM. `chatgpt_response_source_invalid` means positive identity/completion/rejection evidence prevented delivery; do not bypass it or treat a visible answer as an executed tool result.

A bound, unique successful final with `end_turn=true` and both stream terminators establishes source completion. The message-level `message_stream_complete` marker does not freeze the SSE response: supported tail patches are projected through `[DONE]`, then the final state is checked. Optional `is_complete` and finish metadata need not repeat completion; removing either restores absence. Explicit false completion, non-stop/malformed finish, unfinished final, unrelated/later unfinished public messages, identity conflicts and post-`[DONE]` mutations still block fallback. An unfinished nonterminal commentary ancestor can be superseded by its complete descendant final. Request binding compares all textual parts together, permits attachment parts and preserves leading/trailing whitespace. It accepts exact composer text or one reversible Markdown serialization layer (punctuation escapes and automatic links with identical label and destination); changed content, whitespace or destinations are rejected. Completed EOF may close a tool fence, while complete JSON, declared tool arguments and native permissions remain required. Preparation, rollback, model selection and send preflight use independent operation timeouts, without an enclosing shared allowance. Composer lookup and verification each allow 60 seconds; cleanup actions each allow 30 seconds. Model controls allow 120 seconds to hydrate, 60 seconds per action and 30 seconds to settle, with 15 seconds for final family-selection confirmation. Prompt write/read each allow 60 seconds and matching allows 30 seconds. Explicit model, effort, request identity and permission checks remain required. See the [operation limits](reference.md#independent-operation-timeouts).

For `chatgpt_send_outcome_unknown`, inspect bounded input/traffic facts and input-bound acknowledgement. After click/Enter attempts, the worker performs at most 30 seconds of read-only reconciliation; only one matched request, HTTP 200, a bound acceptance acknowledgement and intact identity can confirm the send. This final reconciliation does not send more input, rebind or reload. Duplicates, lost observation, cancellation or expiry remain uncertain/failures as applicable. `queue_blocked_send_outcome_unknown` and other fault pauses still report the original blocker immediately. Existing recovery does not restart failed children.

An unknown Native Tools send can be isolated to its task only when the worker has physically settled its input operation and any acknowledgement callback, the connection is intact, there is no conflicting request identity, and the host verifies exactly one current page and helper owner. The queue shows **Task isolated** and records `sendFailureScope=task`. The task still occupies its slot until physical page cleanup; other independent tasks may use remaining slots while respecting the shared send interval. This does not confirm acceptance or remote cancellation and never permits replay of the failed request. A single occupied slot still blocks a concurrency-one queue. MCP, unproven ownership, disconnected observation and old records retain global protection; standalone clients joining another process currently lack the stronger page proof and retain global protection too. Closing a page alone cannot clear an existing global fence. Restarting with an unfinished isolated receipt restores protection. Sign-in loss and account rate limits remain shared faults.

A filled composer does not establish that Send ran. The queue distinguishes preflight, waiting for a send permit, input attempt, acknowledgement and reconciliation; a blocked task can still contain prepared text. Full model preflight runs before acquiring the shared send permit, with selection, conversation identity and cancellation checked again before input. `queue.send_permit_granted` (formerly `queue.send_attempted`) means permission only; the retained `sendAttemptedAt` field has the same meaning. `browser.send_input_completed` records whether each input call returned or failed, not acceptance. Click failures retain their original cause; diagnostic logs remove DOM previews while retaining actionability reasons. Input evidence is collected before waiting for acknowledgement. The passive listener stops after 120 seconds but retains one bounded result until collection or replacement; missing, expired or empty evidence cannot prove that the server received nothing. Private Send snapshots include button geometry, hit testing and page visibility. Use the queue's blocking-task log link to inspect that request before explicitly recovering dispatch. These diagnostics do not establish the cause of an older click timeout whose evidence was lost.

Private failure capture is bounded by default to 2 MiB / 2,048 events and saved before detach, with references/counts only in normal diagnostics. It is privacy-projected event data, not exact original wire bytes; unknown sensitive forms and gaps remain explicit. Replay is offline diagnostic-only and cannot execute tools or authorize delivery. The original historical failing streams were not retained: neither the new capture nor 37 consistent redacted-sample replays proves the old `response_message_incomplete` or unknown-send cause was fixed. The failed DEV continuation remains recorded. Independent DEV login restored authentication. Capture/replay now supports the observed SSE names with privacy projection; the real sample replay matched direct facts/results, but did not reproduce the missing-metadata failure. Real CLI resume/interrupt/recovery and public-PDF/prefill/steering component revalidation passed; original failed evidence and historical root-cause limits remain. See [reliability evidence](native-tools-compatibility.md#reliability). Successful tool commands do not prove final response delivery. Published 2.4.0 is unchanged.

**Check:** distinguish normal generation completion from complete content extraction and delivery. A stopped answer can still have Copy/Regenerate controls, and a completed answer can have virtualized code missing from the visible DOM. Text stability and toolbar visibility do not establish success. Native Tools prepares the completed reply before parsing tool calls, so an extraction failure does not mean Codex received the report.

**Recovery:** use the current bound answer's complete public source, with supported rich-content conversion. If that source is unavailable, DOM recovery requires current normal-completion evidence and a complete supported representation. Do not compare the final answer byte-for-byte with every earlier draft: un-emitted text may legitimately change links, reorder paragraphs or replace a table. Existing emitted deltas remain non-retractable. A partial viewport, an end marker or stitched historical blocks cannot establish complete content.

Extraction has its own 120-second limit starting after normal generation completion, independent of earlier generation time. Unavailable content may be observed again within that operation; an explicitly unsupported representation reports its limitation. A timeout does not authorize success, and extraction recovery does not resend an accepted task or execute its tools again. The selected model, effort, request identity and native permissions remain unchanged.

Private failure evidence retains bounded, privacy-projected public events and content/delivery facts before resource cleanup. It can contain answer text and links and requires controlled access; normal logs contain references and safe metadata only. It does not include authentication or hidden reasoning and cannot authorize automatic delivery or tool execution. The historical investigation and failed acceptance evidence remain available; a new implementation is not proof that their root causes are closed.

**Action:** for a Markdown delivery error, the built-in browser keeps the failed page read-only for up to ten minutes; it can be closed manually or reclaimed earlier for capacity. **Copy answer** saves unverified visible text and does not automatically send it to Codex. The failed page holds no execution slot or continuation entitlement. Cancellation and other errors retain their own cleanup behavior. Export diagnostics before retrying and check the reported stage, source/content availability and delivery state. Attribute network, upstream, Codex, host or bridge failures only when the evidence supports that attribution; otherwise retain an unknown cause.

Send prefers a click. Any click-path failure—including a failed actionability trial, an actual click error/timeout, or no acceptance within the acknowledgement window—selects one Enter fallback in the current task's composer. Obstruction, button visibility/enabled state, modal presence and proof of non-dispatch are not eligibility conditions. The fallback reuses the task, send permit and response observer; it neither refills the prompt nor enqueues another round. An already-confirmed send completes normally, and cancellation stops further input. Enter still requires actual acceptance evidence; returning from the key operation is not success. A click exception can occur after submission and its receipt can arrive late, so duplicate matching requests remain ambiguous rather than being silently selected. Enter is not retried. `browser.send_input_completed` and `browser.send_input_evidence` identify each input method; the former only means that operation settled.

Acceptance is also observed while the actual click or Enter operation is pending. A verified receipt stops that pending input, but the worker waits for the input operation to settle before reporting submission; requesting cancellation alone does not release its page or queue resources. The concurrent observer does not press modal buttons or rebind the page. An in-flight DOM probe retains its real result or error, and observation failures enter the existing recovery after input settles. A receipt known before the first click suppresses that click. `confirmed_during_input` distinguishes this path from an input merely returning, and `browser.send_input_stopped_after_acceptance` retains any input error accompanying the receipt. The normal post-input acknowledgement budget remains independent.

Before sending, a failed model-menu read can recover once when an earlier visible menu is observed closing or being rebuilt on the same page. Recovery reopens/rebinds the menu and verifies the requested model and effort again. A readable mismatch, locked/unsupported effort, cancellation or changed page remains a failure; a zero-width semantic slider alone is not evidence of menu loss. `browser.model_menu_read_failed` and `browser.model_menu_recovery` retain the first error and recovery outcome.

For `browser.native_reply_delivery`, inspect `failure.category` and bounded issue categories/schema keywords, the hashed contract identity, retry attempt and associated queue receipt. Diagnostics distinguish parsing, tool contract, batch constraints, structured output and response-writing failures without logging tool arguments. The existing correction/retry budget still applies. In the queue, **Web completed** describes only browser completion; native delivery separately reports validation failure or **Response written**. Writing does not prove Codex received the reply or executed its tools, and old receipts may show **Delivery unconfirmed**.

For `chatgpt_public_answer_missing`, inspect `source.projection.candidateAudit`: aggregate rejection reasons and bounded candidate structures distinguish hidden/non-final content, incomplete completion and input-binding failures. Structural candidates alone cannot authorize delivery; identity, framing and content checks still apply. No private reasoning is used as a final answer. Repeated `browser.response_source_fallback` observations are summarized by state, first/last observation time and count in `browser.response_source_fallback_summary`; this does not change model waits or extraction deadlines. These records explain the locally observed failure, not necessarily why the upstream service produced it.

The click uses Playwright's default post-input checks. The previous `noWaitAfter: true` option also skipped the hit-target interceptor result in the installed Playwright version: an overlay appearing during input could suppress the click while the call returned normally. Removing that option restores the check under the existing click timeout. A returned call still requires independent acceptance evidence; neither this fix nor a synthetic overlay reproduction establishes the cause of an older 60-second timeout.

Suspension accounting uses a monotonic clock and samples it when a stage checks its deadline, so a resumed timeout can see the pause before the periodic callback runs. Model verification checks the requested mode as well as the family/version; harmless repeated header labels or Unicode spacing do not permit substituting a different mode or effort.

### A cancelled native task leaves its browser page busy

Check the exact native thread/turn and the Interrupt hook result. An empty Web queue does not prove that Codex has stopped running tools. After the helper has settled, cancellation releases only that response's retained page; compaction or revised history also releases superseded pages before starting the next conversation. A late cancellation cannot close a newer owner of the same page.

On Windows, setup installs an explicitly quoted shell command with a small shared interrupt entry point, avoiding the full CLI startup within Codex's three-second hook deadline. For an existing installation, apply the connection configuration and restart the corresponding Codex to load the updated hook. Preserve a failed or timed-out hook result for diagnosis; do not force-unlock another task's page.

### Web compaction reports `context_length_exceeded`

**Check:** the complete compaction input exceeds the inline browser transport budget. Web2Harness preserves the original context and reports a non-retryable error; reconnecting the same request replays that error without another browser submission.

**Action:** explicitly enable **Context as File** for a supported model, or reduce context through Codex, then retry. Web2Harness does not enable file transport automatically or trim history to fit. Confirm that compaction completes and the task continues before treating the issue as resolved.

### Native compaction returns `404 Not Found`

**Check:** identify the selected model, effective route, and the `[features].remote_compaction_v2` setting. A native upstream compaction failure is separate from a Web context-length limit. The `native_compaction_upstream_failed` diagnostic records the route, model, HTTP status, and available request identifiers.

**Action:** retain the diagnostic and identify which application owns the setting before changing it. Web2Harness deliberately manages `remote_compaction_v2 = false` to bound retained Web image history; do not flip that managed value as a general repair. Investigate conflicting or leftover external overrides through the route owner. Do not create duplicate configuration tables or change production settings for a DEV test.

**Verify:** native compaction completes through the intended route and the task continues with preserved context. If it still fails, report the effective setting, model, failure time, and safe log. Increasing a Web budget or repeatedly applying configuration does not establish a native compaction fix.

### Previous images reappear, or an attachment is incomplete

**Check and action:** Codex includes prior task images in its conversation context, and the bridge preserves them all. More than ten images in one submission produces an explicit limit error. Reattachment in the same task is expected. Start a new task if previous images should be excluded. For incomplete attachments or images belonging to a different Codex task, preserve the failing trace and identify the attachment stage.

Do not replace inline images with arbitrary local filesystem paths; model-only and compaction turns do not gain unrestricted file access.

**Verify:** the intended images are accepted for the correct task. Starting a new task excludes its predecessor's image context.

### Browser image generation never returns an image

**Check and action:** image generation inside ChatGPT is not a supported Web turn type. Its lifecycle differs from text completion. Use Codex's native Image Gen tool where available; its `/v1/images/generations` and `/v1/images/edits` requests are forwarded to the native backend with Codex authorization. Diagnose native authentication, allowance, and upstream failures on that path separately.

**Verify:** the native image tool returns an actual image result. The ChatGPT connector supplies neither native image credentials nor extra allowance.

<a id="support-report"></a>

## Collect a support report

New structured events carry schemaVersion/eventId, source component, process identity and sequence; applicable operations add traceId/requestId/operationId, outcome, durationMs and error codes. Model-selection events distinguish the requested values from verified values and record a failed pre-send check; tool events distinguish queued, delivered and returned results. HTTP closure is a transport observation, not proof of model completion. Child stderr alone does not establish warning severity. Existing records may lack these fields; do not infer execution or root cause from a missing record. Permissions beyond observed sandbox/approval evidence remain unknown.

The diagnostic bundle defaults to all related retained records. Choose the last 24 hours or a custom date/time range if useful; viewing filters do not affect export. Start with `summary.txt`, then correlate request/session identifiers in `timeline.jsonl`. `snapshot.json` describes export-time state, while `manifest.json` reports coverage and missing/corrupt/truncated sources. Raw conversations, tool input/output, and screenshots are excluded; request focused reproduction evidence when the bundle is insufficient.

The desktop logger also keeps bounded structural failure context in `failure-context.jsonl`: at most 32 recent request histories, 48 records / 32 KiB per history, expiring from memory after 30 minutes of inactivity. The first binding and recent observations are retained; discarded records and evicted owners are counted. Interruption/error snapshots use the existing 4 MiB rotation and shared 7-day / 100 MiB retention policy and are collected before ordinary launcher logs. They exclude prose, tool payloads and browser credentials. Write failures mark bundle coverage as partial. CLI-only operation has the correlation events but requires its supervising process to retain stderr; the desktop recorder cannot recover events never received.

After one focused reproduction, select **Usage & Diagnostics → Logs → Export diagnostics**, or use the startup diagnostic export if blocked there. Review the export and screenshots before sharing. Include:

- Web2Harness version, installation method, operating system, and architecture;
- Codex Desktop or CLI version, and regular or DEV profile;
- account tier, active mode, interaction method, and exact model;
- reproduction steps, expected and actual results, complete final error, and failure time;
- whether a new task reproduces the error and whether actual tools executed;
- relevant handoff, model-switch, or compaction details; and
- the safe log exported immediately after that attempt.

Keep raw logs, credentials, API keys, Tunnel IDs, browser state, private prompts, sensitive tool results, configuration backups, and private absolute paths out of public reports. Screenshots complement the error and log; they rarely identify the failing layer alone. Use the [private vulnerability-reporting procedure](release.md#vulnerability-reporting) for suspected vulnerabilities.
