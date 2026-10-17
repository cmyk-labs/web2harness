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
2. Check that a normal Temporary Chat opens; connection checks use it even for saved task conversations.
3. If personalization, connector, or model controls are missing, explicitly select **ChatGPT Settings → General → Language → English**, reload the launcher browser, and retry once. The launcher language does not change website labels.
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

**Verify:** an actual tool request reaches the intended Codex task and returns a result. A healthy tunnel alone is insufficient. DEV acceptance additionally requires explicit confirmation of the DEV tunnel and verification of its actual connector binding.

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

### Page preparation fails before the message is sent

`chatgpt_composer_unavailable`, `chatgpt_page_structure_unsupported` and `chatgpt_preparation_timeout` describe browser preparation, not model capacity. Sign-in, expired-session and browser-verification prompts keep their own errors. Generic service unavailability or HTTP 503 alone does not establish model overload.

A single two-second readiness probe expiring does not exhaust page preparation. The bridge continues waiting for that same DOM read within the original preparation deadline, without overlapping readiness probes or resending the request. It checks cancellation, the deadline and authentication again before accepting a ready composer. A rejected read retains its original error; a readiness deadline failure retains the observation timeout as its cause when available.

`chatgpt_browser_unresponsive` means an exclusive task page did not settle after its preparation or input deadline and a five-second cleanup grace. The application closes that task page and reports failure only after closure is confirmed; it does not resend the message. Other task pages and the sign-in homepage are retained. If closure cannot be confirmed, diagnostics report a cleanup failure instead. Retry the task after checking its tool results; a renderer stall alone does not establish a network fault.

Before typing a connector query or preparing a prompt without a connector, the bridge clears its owned draft through native editor deletion and verifies that no text or selected connector remains. It checks the current editor again if the page replaces it. An already verified connector with an empty draft can be reused. `prompt_attachment_integrity` means clearing or text verification failed; the bridge stops before sending that prompt. Cancellation still gets an independent, bounded cleanup. This does not add request retries or replace a retained conversation.

Automatic new conversations allow at most one preparation recovery, within one 90-second budget starting at initial Web dispatch. Navigation, observation, recovery and any subsequent queue wait share that deadline. The failed page is released before recovery re-enters the global queue. The native-round identity retains the budget across HTTP reconnects; generic retryable errors do not grant another preparation recovery. Existing conversations are not replaced by new chats for this recovery.

Recovery requires independent evidence that submission has not started: no Send activation, conversation request, user/assistant turn, Stop state or MCP activity. A `prepared` label alone is insufficient. Accepted or uncertain submissions keep their replay protection. Model, effort and connector selection are checked again before sending.

If preparation still fails, inspect the exact error and the owned ChatGPT page. Diagnostics include bounded page/transport categories and, when CDP streaming is available, response-event counts and visible-text lengths. They do not store response bodies, tool arguments or hidden reasoning. Unavailable or truncated stream evidence remains inconclusive; a model's claim that a safety check blocked a tool does not prove a platform rejection. Browser-controlled network polling is separate from this preparation budget.

### `Reconnecting`, `stream disconnected`, `ChatGPT failed`, or HTTP 502

**Check:** inspect the final detailed error after reconnect attempts. These messages can result from account limits, website errors, changed controls, a closed browser page, route conflicts, or an expired MCP tool deadline. A generic 502 does not identify a tunnel fault.

**Action:** if no account limit or other stopping condition applies, try once in a new Codex task. Record whether tools executed, whether ChatGPT showed a final answer, and whether the new task succeeded. Run diagnostics and export a safe log immediately. For `codex_tool_timeout`, inspect the actual tool and its turn-bound deadline before retrying.

**Verify:** a complete answer and expected tool results return to Codex. Identify any partial file changes from a failed attempt before requesting the same operation again.

### The Web answer exists but Codex reports `browser_stream_inconsistent`

**Check:** the final page structure could not be aligned with the observed answer. This is an answer-extraction failure; it does not by itself establish a network interruption. Native Tools buffers raw answer text until completion and tool-call validation, so this error does not imply that Codex already received the report.

**Recovery:** plain layout wrappers are normalized into semantic blocks. For an un-emitted native reply, a stable, completed snapshot of the same answer may replace the private buffer only if it preserves the complete known Markdown projection, including its pending tail, in order. This does not resend the prompt or execute tools again. Missing content, changed links, ambiguous ordering, or changes to already-delivered text still fail safely.

The normal completion path also checks that pending blocks remain covered. A temporarily missing tail gets up to five seconds of fresh observation after completion becomes visible. If coverage cannot be established, the request fails instead of returning a truncated answer or appending stale text.

Pending bold, italic or inline-code text may grow while ChatGPT recreates its nodes. Coverage distinguishes closing Markdown delimiters generated by serialization from actual text, so a partial formatted label can become its full label without a false missing-content error. This applies only to undelivered content; missing text, changed link targets and edits to committed blocks remain errors.

An unfinished underline or list marker can also temporarily turn a pending paragraph into a heading and back. An unfinished inline-code span can change the Markdown escaping of a Windows path when its closing backtick arrives. These cases are compared using the same content spelling while retaining actual text, links and block order; the final observed formatting is delivered. This does not bypass missing-content checks or replace Codex's compaction summary.

**Action:** for this error, the built-in browser keeps the failed page read-only for up to ten minutes; it can be closed manually or reclaimed earlier when tab space is needed. **Copy answer** copies the last visible assistant answer as unverified plain text. Check it before use: it is not automatically delivered to Codex. The failed page holds no execution slot or continuation entitlement, and cancellation and other errors still release their pages normally. If the page has already gone, the error does not promise recovery. Export diagnostics before retrying: `browser.markdown_conflict` records payload-free block/coverage and delivery metadata, and `browser.markdown_rebuilt` records a successful buffered recovery. Verify that Codex receives the complete answer once, with no missing or duplicated sections.

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

After one focused reproduction, select **Usage & Diagnostics → Logs → Export diagnostics**, or use the startup diagnostic export if blocked there. Review the export and screenshots before sharing. Include:

- Web2Harness version, installation method, operating system, and architecture;
- Codex Desktop or CLI version, and regular or DEV profile;
- account tier, active mode, interaction method, and exact model;
- reproduction steps, expected and actual results, complete final error, and failure time;
- whether a new task reproduces the error and whether actual tools executed;
- relevant handoff, model-switch, or compaction details; and
- the safe log exported immediately after that attempt.

Keep raw logs, credentials, API keys, Tunnel IDs, browser state, private prompts, sensitive tool results, configuration backups, and private absolute paths out of public reports. Screenshots complement the error and log; they rarely identify the failing layer alone. Use the [private vulnerability-reporting procedure](release.md#vulnerability-reporting) for suspected vulnerabilities.
