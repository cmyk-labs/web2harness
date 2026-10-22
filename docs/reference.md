# Configuration and model reference

[English](reference.md) | [简体中文](reference.zh-CN.md) · [Project documentation](../README.md#documentation)

This manual defines configuration fields, model entries, context budgets, data locations, and command interfaces. For initial connection and routine operation, use the [user guide](user-guide.md). Design rationale and authority boundaries are covered in [architecture](architecture.md).

Defaults apply to new configurations; existing explicit settings follow the loading and application rules below. Model tables describe this repository's routing and operational budgets, not an OpenAI service availability matrix or API model specification.

**Contents**

- [Configuration ownership and application](#configuration-ownership)
- [Runtime and launcher settings](#runtime-settings)
- [Standalone queue controls](#standalone-request-queue)
- [HTTP request body limits](#http-body-limits)
- [Model catalog and reasoning effort](#models)
- [Context and transport budgets](#context-budgets)
- [Responses transport and continuation](#responses-transport)
- [Attachment reference resolution](#input-references)
- [Profiles and data locations](#data-locations)
- [Environment overrides](#environment-overrides)
- [Command interfaces](#commands)
- [Selection and failure handling](#selection-and-failure-handling)
- [Implementation references](#implementation-references)

<a id="configuration-ownership"></a>

## Configuration ownership and application

| Layer | Owner and purpose | How changes take effect |
| --- | --- | --- |
| Runtime configuration | `config.json` in the selected Web2Harness home; browser host, tool mode, capabilities, transport, tunnel and local endpoint | Launcher setup or the supported setup command validates and writes the configuration. A running runtime does not watch arbitrary JSON edits. |
| Launcher preferences | `launcher-state.json` in Electron user data; language, window behavior and UI state | Use **Preferences**. Runtime-related preferences call the runtime controller; their copies in launcher state are not an independent runtime configuration. |
| Codex integration | Managed route settings and integration journal for the selected Codex home | Setup, connection controls, and subagent protocol controls update the integration. Follow the client restart/catalog verification indication. |
| Browser session | The selected browser profile and its authenticated ChatGPT session | Sign in through that profile. A configuration file does not grant account capabilities or supply a browser login. |

In **Connection & Models**, selecting a tool mode changes the draft. **Apply configuration** runs setup. Preferences such as Context as File have their own controls and apply through the runtime controller. Finish or cancel active turns before changing runtime transport or interaction settings; the launcher rejects those changes while its browser is busy. Changes that alter the model catalog require the corresponding Codex client to refresh or restart.

The CLI `setup` parser defaults to Native Tools whenever no mode flag is supplied, including when an existing configuration uses another mode. Specify the intended mode on each setup invocation. Existing optional preferences are generally preserved when neither member of their flag pair is supplied. `--auto-approve-tool-calls` is an exception: omitting it in the regular CLI setup supplies `false`.

Native Tools setup manages `[features].standalone_web_search = true` so supported Codex clients execute their native `web.run` through `/v1/alpha/search`. It preserves the user's `web_search` mode, domain filters and location. The integration journal records the previous flag and restores it on disconnect, removal or a mode change; conflicting user edits are reported. Existing installations require reapplying Native Tools configuration and restarting Codex. This does not add support for arbitrary hosted `web_search` Responses declarations; see [compatibility and limits](native-tools-compatibility.md).

<a id="runtime-settings"></a>

## Runtime and launcher settings

Runtime configuration and launcher preferences own the fields below. Identifiers are used in configuration files and commands; the interface uses readable mode names.

<a id="runtime-modes"></a>

### Runtime modes and interaction

The defaults in these tables describe a new runtime configuration. Setup may retain existing values, and the desktop launcher selects `browserHost: "launcher"` for its embedded browser.

| Setting | Default | Allowed values and effect |
| --- | --- | --- |
| `mode` | `native-tools` | `native-tools`: turn structured browser responses into tool calls executed by Codex. `mcp-bridge`: relay connector calls through a tunnel into the active Codex task. `browser-only`: browser model responses without local tools or a tunnel. |
| `browserInteractionMode` | `automatic` | `automatic`: browser automation selects, submits and observes the ChatGPT turn. `manual`: the UI's **Zero Risk** mode; the user selects the model, pastes and submits, while the connector carries turn/tool/completion messages. Requires `mode: "mcp-bridge"` and `browserHost: "launcher"`. |
| `subagentProtocol` | `compatibility-v1` | `compatibility-v1`: use the V1 collaboration surface for the task's native and Web catalog entries, retaining explicitly disabled native capabilities. `native`: follow the native catalog's collaboration protocol. A protocol change requires Codex and launcher restart. |
| `mcpHandoffProtocol` | `web2harness-handoff-v1` when absent | Explicit MCP handoff version: `web2harness-handoff-v1` or `web2harness-handoff-v2`. V2 derives submission identity in the host and uses versioned submission tools. It does not change model, effort, connector, tool authority or interaction mode. Apply only after active resources settle, restart the runtime/helper and tunnel worker, then refresh and inspect the connector catalog. |
| `browserHost` | `managed-chrome` | `managed-chrome`: use the configured Chrome executable and stored session. `launcher`: attach to the launcher's owned browser through its descriptor. |
| `autoApproveToolCalls` | `false` | Boolean. Opts into automatic clicks on browser **Allow once** prompts. English and Chinese approval cards are recognized; the default waits for a per-request decision and never selects **Always allow**. It does not replace Codex sandbox or approval policy. |
| `zeroRiskProEnabled` | `false` | Boolean. In manual mode, also publish the Pro-specific manual model entry. The user must select Pro in ChatGPT for each turn; the launcher cannot verify that selection. |

Automatic and manual MCP configurations use separate tunnel IDs and connector identities. The regular automatic connector is `Codex Native2`; the DEV automatic connector is `Codex Native2 DEV`; the manual connector is `Codex Zero Risk`. The active `appName` and `tunnel` must match the chosen interaction mode. A successful check for one interaction path does not verify the other.


<a id="request-scheduling"></a>

### Global Web request scheduling

Edit the independent **Runtime parameters → Request scheduling** page and choose **Save settings**. Restore defaults changes only the draft until saved. Values belong to the current Launcher's `launcher-state.json`, not individual sessions.

| Parameter | Default | Choices | Application |
| --- | --- | --- | --- |
| Concurrent Web turns | 4 | 1–5 | Applies to new dispatches; lowering it does not terminate running work |
| Queue timeout | 30 minutes | 5, 10, 15, 30, 60 minutes | Determines the deadline of newly queued requests only |
| Minimum send interval | 3 seconds | Integer 1–60 seconds | Controls actual automatic-send permits, not manual clicks |

Sessions, models, main agents and child agents sharing one Launcher browser environment use the same queue. DEV and production are independent. Standalone managed Chrome uses a separate profile-owned queue with the same scheduler implementation, defaults and ranges; it does not join or control the Launcher queue. Fair dispatch rotates sessions and prioritizes requests waiting at least 60 seconds. Each queue allows at most 64 waiting requests and a 256 MiB estimated waiting-body budget, separate from the [HTTP body budget](#http-body-limits). Neither budget is a process memory cap or a Codex child-agent limit. Resource overflow fails explicitly.

Waiting does not occupy a Web slot; execution deadlines start after admission. Pause stops new dispatches while admitted work continues. Cancelling active work retains its slot until physical cleanup. Rate limits and uncertain sends pause dispatch; stop remaining work, check the cause and explicitly confirm recovery. Old requests are not automatically resent.

Launcher redacted receipts live in the application home's `runtime/request-queue.json`, limited to 4096 entries and 24 hours, without prompts, tool arguments or lease secrets. Unfinished work becomes interrupted after restart, without automatic replay. Use runtime logs and diagnostic bundles for longer-term investigation.

<a id="browser-execution-parameters"></a>

### Browser retention and execution parameters

The same **Runtime parameters** form also saves the following Launcher-owned settings. Explicitly saved user values are preserved when defaults change. They share the scheduling form's explicit save, draft recovery, revision conflict checks and saved/applied feedback.

| Setting | Default | Choices | Scope |
| --- | --- | --- | --- |
| Tab retention target | 5 tabs | 5, 8, 12, 16 | When a new task needs a tab, reclaim an older eligible idle tab at this target. Running and tool-wait tabs remain protected; this is not an execution concurrency limit or a strict total cap. |
| Idle tab retention | 30 minutes | 5, 15, 30, 60, 120 | Completed tabs without pending tool results. Time starts from task activity, not viewing or selecting the tab. |
| Web inactivity timeout | 15 minutes | 2, 5, 10, 15, 30 | Adapter silence watchdog; not the total duration of a task. |
| Attachment processing timeout | 5 minutes | 2, 3, 5, 10 | Automatic mode only. Per-file, per-attempt upload/processing confirmation. An explicit ordinary failure gets one attachment retry after 3 seconds; explicit HTTP 429 quota errors return immediately. Input readiness, card visibility and send readiness have independent limits. |
| Failure retry limit | 3 retries | 0, 1, 2, 3 | Collapsed Advanced settings. Additional attempts after the first, only for explicitly retryable failures. Zero disables those retries; transport reconnects are not new attempts. |
| Manual request submission timeout | 60 seconds | 60, 120, 300 | Manual mode only; time to paste, send and confirm submission. |
| Manual compaction submission timeout | 120 seconds | 120, 300, 600 | Manual mode only; independent of the subsequent compaction generation period. |

Execution values are captured for new requests; an existing retry sequence keeps its original limit. Retention duration is captured when a tab next becomes retained; editing it does not shorten existing deadlines. Manual submission retries keep the original deadline, which ends once submission is confirmed. Waiting-for-tool-result tabs retain their separate 24-hour protection and the total task-tab ceiling remains 32. Reclaiming a tab does not delete ChatGPT history or sign out, but continuation may need to rebuild its page/context.

Values and per-field `user`/`default` sources live in `launcher-state.json`. Only valid values explicitly marked `user` survive default migrations; absent or other sources use current defaults. The private, process-bound Launcher descriptor publishes validated execution settings to the shared runtime for subsequent requests without a service restart. In Launcher mode these controls own the effective `stallTimeoutSec`; standalone managed Chrome retains its existing config/defaults and does not read another Launcher's settings.

**Restore defaults** remains a draft until saved. Saving it restores `default` provenance for these execution settings, including values already equal to the current default, so later default migrations apply. Editing an individual setting afterwards marks only that setting `user`; matching the default number does not imply default provenance. Unsaved drafts retain this intent.

<a id="independent-operation-timeouts"></a>

### Independent operation timeouts

Automatic browser workflows do not have a shared preparation or whole-task deadline. Each operation below starts its own clock when it begins; time spent in earlier operations is not subtracted. Cancellation, process exit and connection loss still stop owned work. Compound callers await their bounded child operations without an additional shorter cap.

| Operation | Default limit |
| --- | --- |
| Queue admission | 30 minutes; no Web execution slot while queued |
| Browser connection, page navigation, composer readiness | 120 seconds each |
| Model control hydration / menu state / final family confirmation | 120 / 30 / 15 seconds |
| Ordinary UI action / onboarding action | 60 seconds each |
| Composer locate / Escape, focus, select-all, delete / empty-state verification | 60 / 30 each / 60 seconds |
| Prompt write / readback / exact-text confirmation | 60 / 60 / 30 seconds |
| File input readiness / upload and processing / attachment card / send readiness | 60 seconds / 5 minutes per file / 120 seconds per card / 120 seconds |
| Explicit attachment failure recovery | Remove only the failed attachment, wait 3 seconds, retry once with a fresh processing timeout; explicit HTTP 429 is not retried |
| Native upstream WebSocket connection / physical cleanup / backpressure | 120 / 120 / 30 seconds independently; request and input queue 64 MiB each, individual output event 16 MiB, output buffer 32 MiB |
| Send visible / enabled / click / acknowledgement / late reconciliation | 60 / 120 / 60 / 120 / 30 seconds; never automatically click again after an uncertain send |
| Internal Send activation acknowledgement | 60 seconds; expiry prevents a later click |
| Missing response DOM / final-content extraction | 120 seconds each; extraction starts only after normal generation completion |
| Public-source CDP operation / individual response DOM or control read / observer detach | 120 / 120 / 30 seconds each; no shared allowance across reads |
| Compaction generation / settlement / previous owner release | 15 minutes / 120 seconds / 120 seconds; generation starts at confirmed submission |
| Remote attachment DNS / connection and headers / body | 30 / 60 / 120 seconds; every file and redirect receives fresh applicable limits |
| Helper startup / helper process cleanup | 30 / 120 seconds; browser operations retain their own limits |
| Passkey browser startup / page load / human confirmation / result verification | 60 seconds / 120 seconds / 15 minutes / 120 seconds |
| Maintenance configuration item / downloaded file / component readiness / verification | 60 seconds / 5 minutes / 120 seconds / 120 seconds |
| Tunnel log inspection / metrics inspection | 10 seconds each |
| WebSocket cleanup | 30 seconds per connection, concurrently |

The 15-minute inactivity watchdog is reset by meaningful adapter progress; it is not a total duration allowance. Ordinary generation has no absolute default deadline. An explicitly configured `chatgptWeb.turnTimeoutMs` limits generation starting at submission, excluding preparation and compaction, whose stages are timed separately. Recovery attempt counts, explicit user settings, native tools and native `wait` semantics are unchanged.

Web context migration is opt-in per request: `X-Web2Harness-Reasoning-Migration: visible-history` restarts reasoning from visible history; absent or `strict` retains strict encrypted-context checks. This does not decode native ciphertext. Compaction, agent messages and encrypted tool results still require their original complete source. See [context compatibility](native-tools-compatibility.md#data-contracts). An ended stream with no public answer receives a separate 120-second read-only reconciliation window after activity stops, then `chatgpt_public_answer_missing`; it does not resend the generation.

<a id="standalone-request-queue"></a>

### Standalone queue controls

With `browserHost: "managed-chrome"`, the canonical `storageStatePath` identifies one queue owner across processes. Filesystem aliases and Windows path casing resolve to the same owner; other runtimes join it through authenticated loopback transport. Distinct canonical profiles and Launcher environments remain independent. Joining does not create another execution pool.

Private state lives in `<canonical storageStatePath>.request-queue/`: `owner.json` holds the owner identity and transport credential; `receipts.json` holds settings, pause/send state and redacted receipts (4096 entries, 24 hours). Do not publish the owner descriptor. Retained request IDs cannot execute again.

The CLI reads the selected home's runtime configuration and prints JSON. These commands reject Launcher-hosted configuration; use its UI instead.

| Command | Contract |
| --- | --- |
| `browser queue status` | Read persisted receipts without contacting or starting a browser. `ownerPresent` reports a descriptor's presence, not verified liveness. |
| `browser queue configure --concurrency N --timeout-minutes N --send-interval-seconds N` | Supply all three integer settings once, using the ranges above. Requires an unowned queue; saves settings for the next standalone runtime. It does not update a running owner. |
| `browser queue recover --confirm-browser-stopped` | Offline recovery after the old runtime and its owned browsers have stopped. Refuses a live or unverifiable owner; marks unfinished receipts failed with `runtime_restarted_outcome_unknown`, clears pause/uncertain-send state, and preserves receipts without replay. |

A lost owner, stale lock or unfinished receipt never triggers automatic takeover or recovery. PID death or heartbeat expiry cannot prove browser cleanup. Unknown sends and rate limits pause dispatch; investigate and stop the owned runtime/browser before explicit recovery. The recovery command does not stop processes or resend work. Start fresh requests only after resolving the cause.

<a id="http-body-limits"></a>

### HTTP request body limits

Each Responses service shares one **256 MiB estimated allocation budget** across `/v1/responses` and `/v1/responses/compact`, including native passthrough. Separate service instances have separate budgets. This fixed protection is independent of Web execution slots and queue waiting-body accounting.

| Limit | Value | Rejection |
| --- | --- | --- |
| Encoded request body | 64 MiB per request | HTTP 413 `request_body_too_large` |
| Decoded JSON body | 128 MiB per request | HTTP 413 `request_body_too_large` |
| JSON container nesting | 512 levels | HTTP 413 `request_body_too_large` |
| Aggregate allocation estimate | 256 MiB per service | HTTP 503 `request_body_overloaded`, `retryable: true`, `Retry-After: 1` |

Identity and zstd encoding are supported. Incremental accounting covers reader/decoder costs, zstd windows, retained encoded bytes and estimated JSON strings/structures and copies before parsing; dense JSON and compression cannot bypass it. The aggregate estimate can reject a request below the individual size limits. It is **not a hard RSS cap** or a measurement of total process memory.

Reservations remain charged while requests wait, execute and deliver responses; a disconnect does not release execution memory before cleanup settles. Parsing/decompression failures and cancellation release their reservations after reader/decoder cleanup. HTTP 503 indicates body admission overload, not queue recovery or permission to replay an uncertain browser send.

<a id="conversation-and-attachments"></a>

### Conversation and attachment settings

| Setting | Default | Effect and constraints |
| --- | --- | --- |
| `useSavedChats` | `false` | Task conversations use Temporary Chat by default. `true` saves them in ChatGPT history. MCP connector verification follows this selection; account inspection still uses an empty Temporary Chat. Explicit choices are retained, including when Temporary Chat does not offer plugins. This setting is separate from conversation reuse. |
| `experimentalFreshConversationPerTurn` | `false` | `false` allows eligible launcher-hosted Sol/Pro conversations to be reused with Native Tools or MCP Bridge. `true` starts a new browser conversation for each automatic turn. Browser-only and Luna use different continuity paths. Manual setup rejects an explicit request to enable it. See [conversation state](architecture.md#conversation-state-and-compaction). |
| `experimentalContextFiles` | `true` in supported automatic modes | Enables experimental Context as File transport for large context. Smaller input can remain inline. Unavailable in manual mode. |
| `experimentalContextTripleBudget` | `false` | Opt-in with file transport: triples each configured standard window (default Fast/non-Fast: 240000/816000), with 95% usable and 90% compaction. Message/account limits stay unchanged. Disabling files clears it. |
| `experimentalSkillAttachments` | `false` | Sends selected skill content as text attachments. Unavailable in manual mode. |

File transport changes delivery only, not the selected context budget. Switching to manual mode clears file and skill attachments; manual setup still rejects login inspection and unsupported features.

<a id="endpoint-and-browser"></a>

### Endpoint, browser and internal fields

These fields support runtime integration and diagnostics. Prefer setup over editing them directly.

| Setting | Default or generated value | Validation and purpose |
| --- | --- | --- |
| `host` | `127.0.0.1` | Only this IPv4 loopback address is accepted for the Responses listener. |
| `port` | `17841` in the regular profile | Integer from `1` to `65535`; DEV selects its own port. The local Responses base is `http://127.0.0.1:<port>/v1`. |
| `contextWindow` | `256000` | Positive safe integer for the generic provider configuration. Web model catalog windows and preflight budgets are resolved per route; this field does not override the [model budget policy](#context-budgets). |
| `stallTimeoutSec` | Unset; effective default `900` seconds | Positive finite number. The bridge rounds upward and clamps to `1`–`3600` seconds of adapter silence before reporting `upstream_stall_timeout`. This is not a total turn duration limit. |
| `chromeExecutablePath` | macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; Windows: `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe` with `C:\Program Files` fallback; Linux: `/usr/bin/google-chrome` | Nonempty executable path used by the managed browser/login path; override through `--chrome`. |
| `headed` | `true` | Boolean controlling the managed browser's visible-window setting. |
| `storageStatePath` | `<home>/browser/storage-state.json` | Nonempty session-file path for the managed browser. The launcher's persistent browser partition has its own session storage. |
| `browserHostDescriptorPath` | Supplied by the launcher | Required absolute path for `browserHost: "launcher"`. Setup expands `~` and resolves relative input before validation and saving. Describes the owning browser process and private control endpoint. |
| `brokerSocketPath` | Unix: `<home>/runtime/turn-broker.sock`; Windows: `\\.\pipe\web2harness-<home hash>` | Absolute Unix socket or valid Windows named-pipe endpoint, according to the platform. Windows identity derives from the resolved home. |
| `controlToken` | Generated from 32 random bytes | Private base64url control credential; parser requires at least 40 characters from letters, digits, `_` and `-`. |
| `runtimeCommand` | Current durable runtime executable and optional entry point | Nonempty string array with an absolute existing executable. Absolute command paths must not point into temporary directories. |
| `solAvailable` / `extraHighAvailable` / `proAvailable` | Initial `true` / `false` / `false`; setup reads account capabilities | Boolean observations, not entitlement switches. Extra High and Pro require Sol. Missing Extra High data must be probed before it is exposed. |
| `version` / `releaseVersion` | Schema `5` / current package version | Managed metadata. Supported previous schemas normalize on load; normal setup persists the migrated configuration. Unsupported schemas fail validation. |
| `purpose` | Absent for regular setup; DEV setup writes `dev-harness` | Optional purpose marker; no other value is accepted. Profile ownership also depends on paths, descriptor and process checks. |
| `acknowledgedUnofficialAt` | Recorded by setup | Timestamp of the required unofficial-browser-automation acknowledgement. |

<a id="tunnel"></a>

#### Tunnel object

When `mode` is `"mcp-bridge"`, a valid active `tunnel` object is required. `automaticTunnel` and `manualTunnel` retain their respective configurations; when present, the selected one must equal `tunnel`, and their tunnel IDs must differ.

| Field | Accepted value |
| --- | --- |
| `tunnelId` | `tunnel_` followed by exactly 32 lowercase hexadecimal characters |
| `runtimeKeyFile` | Absolute path to a private file containing the tunnel runtime credential |
| `binaryPath` | Absolute path to the managed tunnel-client executable |
| `profileDir` | Absolute path to the tunnel-client profile directory |
| `profileName`, `alias` | Nonempty strings containing only letters, digits, `.`, `_` and `-` |

Setup handles the active tunnel configuration and managed credential files. For DEV MCP Bridge, local names and paths do not establish remote isolation: the [development procedure](development.md#mcp-bridge-isolation) requires website verification of DEV ownership and the actual connector binding, with authorized creation of fresh DEV resources when ownership cannot be established.

<a id="launcher-preferences"></a>

### Launcher preferences

| Preference | Default | Effect |
| --- | --- | --- |
| `language` | Unset before onboarding | `en` or `zh-CN`; launcher interface language. It does not change ChatGPT's language. |
| `autoStart` | `true` in regular launcher state | **Start automatically at sign-in** launches Web2Harness in the background after signing in to the desktop account, not before sign-in. Tasks still require activation. DEV disables this control and starts explicitly. |
| `keepRunningOnClose` | `true` | Closing the window hides it when a tray is available; otherwise the normal close behavior applies. |
| `showBrowserDuringTurns` | `true` | Shows the browser when an automatic task starts. Manual turns show their browser independently of this preference. |
| `sidebarOpen` / `sidebarWidth` | `true` / `252` | Saved sidebar layout. Width is constrained to `240`–`420`. |

Both **Preferences** and **Runtime parameters** allow editing, saving and available default restoration without a valid license. Language and window/startup preferences take effect immediately. Conversation and execution settings are stored separately in `pendingSettings` while unlicensed or not configured; active runtime values stay unchanged. After activation and connection setup, use **Apply saved settings** while tasks are idle. Successfully applied items are cleared; failures retain the remaining items for retry. Context-budget application still requires restarting the corresponding Codex. Mode/platform restrictions, validation and revision checks remain in force. Connection application, service startup and new tasks still require activation.

Setup completion, catalog verification, browser checks and restart indicators are launcher-maintained status fields. They are not configuration shortcuts to mark a failed check as passed.

<a id="models"></a>

## Model catalog and reasoning effort

Web2Harness adds account-eligible Web entries to the authenticated native Codex catalog. Native models keep their native routes; Web entries use the signed-in ChatGPT browser session.

<a id="model-identifiers"></a>

### Model identifiers and names

| Concept | Example | Meaning |
| --- | --- | --- |
| Codex model ID | `chatgpt-web/gpt-6-pro` | Exact route identifier used by Codex and saved tasks. Use this value where a command requests a model ID. |
| Display name | `GPT-6 Pro (Web)` | Human-readable model picker label. It is not the route ID. |
| Browser model family | `6` | Selects and verifies the intended ChatGPT family independently of reasoning effort. |
| Internal adapter model | `gpt-5.6-sol` | Shared implementation identity for the Sol/Pro browser adapter and context policy. A route's `modelFamily` selects the actual browser family; this internal name does not imply that a GPT-6 request is sent to GPT-5.6. |
| Reasoning effort | `max` | A supported value within the selected route. Available values depend on the route and account capabilities. |

Native IDs without the `chatgpt-web/` prefix keep their native route. A Web ID, its browser label and a similarly named native/API model do not establish equivalent context capacity, service tier, response behavior or availability.

Automatic Web entries advertise text and image input; manual entries advertise text only. Tool access is selected separately: Native Tools returns validated browser tool requests to Codex, MCP Bridge relays connector calls through a tunnel, and Browser-only provides no local tools. Changing a model ID does not change the tool mode.

<a id="automatic-catalog"></a>

### Automatic-mode catalog

The launcher records `solAvailable`, `extraHighAvailable` and `proAvailable` from the authenticated browser. The model resolver uses those observations to construct the catalog. `solAvailable: false` selects the Luna-only catalog; `proAvailable: true` enables Pro entries. Extra High requires its own positive observation.

| Model ID | Display name | Catalog condition | Efforts; default |
| --- | --- | --- | --- |
| `chatgpt-web/gpt-5.6-luna` | GPT-5.6 Luna · Ordinary / Think (Web) | `solAvailable: false` | `low` = Ordinary, `medium` = Think; default `low` |
| `chatgpt-web/gpt-5.6-sol-instant` | GPT-5.6 Sol · Fast (Web) | Sol available; separate Fast entry | Fixed `low` |
| `chatgpt-web/gpt-5.6-sol` | GPT-5.6 Sol (Web) | Sol available | `medium`, `high`; `xhigh` if observed; default `high` |
| `chatgpt-web/gpt-5.6-pro` | GPT-5.6 Sol Pro (Web) | Sol and Pro available | Fixed `max` |
| `chatgpt-web/gpt-6-sol-instant` | GPT-6 · Fast (Web) | Sol available; separate Fast entry | Fixed `low` |
| `chatgpt-web/gpt-6-sol` | GPT-6 (Web) | Sol available | `medium`, `high`; `xhigh` if observed; default `high` |
| `chatgpt-web/gpt-6-pro` | GPT-6 Pro (Web) | Sol and Pro available | Fixed `max` |

GPT-5.6 Sol and GPT-6 provide Fast, Medium, High and Extra High subject to the account and budget rules below. The two Pro entries use fixed `max`. GPT-6 uses the same local account/effort budget policy as GPT-5.6, with separate Fast and non-Fast budgets. The picker accepts both `6` and `GPT-6` labels and verifies the requested family from the active header and slider announcements before sending. The new Chinese composer’s “停止” button also proves active generation, preventing false Pro timeouts before an assistant node appears.

Catalog gating records general Sol/Extra High/Pro capability, not a separate availability flag for every model family. Before submitting a named automatic route, the adapter selects and verifies both the browser family and effort. A generic Pro label alone is insufficient. Failure to verify the requested family produces `model_version_unavailable` and leaves the pending message unsent; the adapter does not silently substitute another family.

`browser.model_verification_failed` distinguishes observation failure from selection mismatch. It records the requested family/effort, radio count and checked state, numeric slider position/target, and description-match predicates without retaining picker text. The exact Simplified Chinese labels `即时`, `中`, `高` and `极高` are recognized as Instant (`low`), Medium (`medium`), High (`high`) and Extra High (`xhigh`) in both slider announcements and active headers, including mixed English/Chinese observations. The existing `Pro` (`max`) label remains supported. Unknown or conflicting descriptions still fail verification. A matching slider alone cannot establish the selected model; the same strict checks still apply.

Failure correlation uses independent WebSocket, HTTP and physical-attempt IDs plus hashed task/turn references. Helper IPC carries only validated correlation and interruption references; `helperRequestId` is separate from HTTP `requestId`. `firstEventId` identifies the first locally observed interruption, not a proven external root cause. Model verification retains up to 32 distinct structural observations. The desktop failure recorder retains up to 32 histories of 48 records / 32 KiB, with 30-minute idle expiry and explicit loss counts; its snapshots use normal managed log retention and diagnostics export. See [fault diagnosis and coverage](troubleshooting.md#support-report).

<a id="instant-grouping"></a>

#### Fast grouping

Existing `chatgpt-web/gpt-5.6-sol-instant` and `chatgpt-web/gpt-6-sol-instant` slugs remain unchanged, display as Fast, and stay separate with fixed `low`. Ordinary entries offer `medium`, `high` and account-available `xhigh`, sharing the non-Fast budget with fixed-`max` Pro. Equal window values do not merge Fast into ordinary entries.

<a id="effort-mapping"></a>

#### Effort mapping

| Codex effort | Automatic Sol/Pro browser selection | Constraint |
| --- | --- | --- |
| `low` | Fast (web Instant), slider position `0` | Fixed effort of the separate Fast entry. |
| `medium` | Medium, position `1` | Standard Sol thinking option. |
| `high` | High, position `2` | Default for the main Sol row. |
| `xhigh` | Extra High, position `3` | Requires `extraHighAvailable: true`. |
| `max` | Pro, position `4` | The named Pro rows support only this effort. |

Luna uses its Ordinary/Think mapping from the catalog table rather than this five-position Sol mapping. New Pro route IDs use `max`; `ultra` is retained only as the technical effort of an older compatibility route. Effort names describe browser controls, not independent underlying models or a native Codex Fast tier.

<a id="manual-catalog"></a>

### Manual-mode catalog

Manual interaction publishes manual profiles instead of the automatic family entries. The launcher calls this **Zero Risk** mode. It requires MCP Bridge and the embedded launcher browser; see [Configuration](#runtime-settings).

| Model ID | Display name | Availability and responsibility |
| --- | --- | --- |
| `chatgpt-web/zero-risk` | ChatGPT Web — Zero Risk | Default manual entry. The user chooses the browser model and submits each incremental prompt. |
| `chatgpt-web/zero-risk-pro` | ChatGPT Web — Zero Risk Pro | Added only when `zeroRiskProEnabled: true`. The user must select ChatGPT Pro each turn to match the larger configured budget. |

Both profiles expose technical effort `low` and text input only. That value does not select Instant or any other ChatGPT model. Manual mode does not inspect the selected browser model or refresh account capabilities; the Pro-specific entry is an explicit user setting, not a detected entitlement. Context as File and skill attachments are unavailable.

<a id="saved-task-compatibility"></a>

### Saved-task compatibility

Compatibility route IDs remain resolvable when the current account and interaction mode allow them. They are hidden from the ordinary picker.

| Compatibility ID | Preserved selection |
| --- | --- |
| `chatgpt-web/light` | Sol adapter Instant |
| `chatgpt-web/medium` | Sol adapter Medium |
| `chatgpt-web/high` | Sol adapter High |
| `chatgpt-web/extra-high` | Sol adapter Extra High, account-gated |
| `chatgpt-web/pro` | Sol adapter Pro; technical Codex `ultra` maps to browser `max` |
| `chatgpt-web/luna` | Luna Ordinary, Luna-only accounts |
| `chatgpt-web/think` | Luna Think, Luna-only accounts |
| `chatgpt-web/gpt-5.6-sol-instant` | GPT-5.6 Sol Fast, fixed `low`; unchanged slug |
| `chatgpt-web/gpt-6-sol-instant` | GPT-6 Fast, fixed `low`; unchanged slug |

The older fixed routes preserve their original adapter bindings and do not acquire the newer named routes' model-family pinning. Use named current routes for explicit family selection. Unsupported reasoning values on named routes are rejected rather than silently remapped.

<a id="context-budgets"></a>

## Context and transport budgets

Three limits serve different purposes:

1. **Catalog context window**: the window advertised by the Web model entry and used by the adapter's input preflight.
2. **Automatic compaction threshold**: the task-history level at which Codex should compact before a later browser turn.
3. **Browser message limit**: the separate token or character envelope of one submitted browser message.

The source of truth is [the context policy](../src/models/chatgpt-web-context.ts). These are configured operational budgets. File upload acceptance, a native/API model specification, or a successful small prompt does not establish a larger usable browser context.

Web entries use the standard policy below, with an optional triple budget on supported routes. Native Codex model rows retain their own metadata; no native model, tool, history or progress contract is replaced.

<a id="standard-context-budgets"></a>

### Standard catalog budgets

Fast/non-Fast standard context windows default to 80,000/272,000 tokens. Usable capacity (95%) and auto-compaction thresholds (90%) are read-only derived values. Supported routes offer triple budgets, with default windows of 240,000/816,000. Luna and manual profiles use non-Fast budgets; technical low does not mean Fast. Triple applies only to automatic Sol/Pro routes supporting file transport.

| Budget | Context window | Effective percentage | Usable UI capacity | Auto-compaction threshold |
| --- | ---: | ---: | ---: | ---: |
| Fast standard | 80,000 tokens | 95% | 76,000 tokens | 72,000 tokens |
| Non-Fast standard | 272,000 tokens | 95% | 258,400 tokens | 244,800 tokens |
| Fast triple | 240,000 tokens | 95% | 228,000 tokens | 216,000 tokens |
| Non-Fast triple | 816,000 tokens | 95% | 775,200 tokens | 734,400 tokens |

The table shows defaults; usable capacity is 95% of the selected window and compaction is 90%, both read-only derived values. Native Codex still triggers compaction, without trimming canonical history, replacing tools or manufacturing progress. A tool-result batch can cross the threshold; subsequent requests must still satisfy the total window and transport limits. Refresh the model catalog and restart the corresponding Codex after upgrading.

This is a local declared budget, not a guarantee of each web model's physical capacity. Isolated authenticated DEV checks on GPT-6 and GPT-5.6 Sol Extra High verified native automatic compaction near 254k total estimated tokens, distributed facts and post-compaction tools. Separate isolated DEV checks of GPT-6 and GPT-5.6 Sol Fast used the 80,000-token policy, reported 76,000 usable tokens, and passed synthetic distributed-fact recall plus native tool execution after automatic compaction. These bounded checks do not establish equivalent capacity or recall for other workloads, efforts or accounts. Upload acceptance does not establish full use of all content. Single-message and account limits remain independent.

<a id="message-budgets"></a>

Responses usage is host-estimated (`estimated: true`), not a provider billing receipt. It includes the selected MCP v1/v2 handoff contract and an automatic/manual binding placeholder with the host handle's shape, plus the complete context and attachment accounting. Real random handles, browser processing and platform overhead can differ. Simulator occupancy uses the same estimator and explicit protocol/file preferences. Byte counts, estimated tokens, upload completion and the model reading the whole context are separate observations; none grants tool authority.

### Single-message transport budgets

| Automatic route/account policy | Explicit visible-message token cap | Inline character cap |
| --- | ---: | ---: |
| Sol Instant without Pro capability | No separate cap; context preflight applies | 211,256 |
| Sol Medium/High/available Extra High without Pro capability | No separate cap; context preflight applies | 1,048,572 |
| Pro-account Sol Instant | 103,000 | 545,000 |
| Pro-account Sol Medium/High/available Extra High | 103,000 | 500,000 |
| GPT-5.6 Sol Pro or GPT-6 Pro | 104,000 | 1,635,000 |

An input must satisfy every applicable limit. Input estimates include visible text, context-file content, selected skill attachments, the `8192` platform reserve and image reserves. Each image reserves `4096` tokens, or `8192` for `detail: "original"`. Encoded audio bytes are not counted as text tokens; Web does not expose their actual context cost, so local usage excludes that unknown cost while upload/memory and Web-side limits still apply. Character and token limits are independent; a message can fit its token budget and still exceed its character cap. The character check uses JavaScript string length.

Visible-text planning budgets are independent of the total window: without images, 32807 tokens for non-Pro Instant, 81807 for non-Pro thinking, 103000 for Pro-account ordinary Sol and 104000 for Pro. Image reserves are subtracted from these allowances. These are transport planning boundaries, not compaction triggers.

<a id="context-files"></a>

### Context as File and the selected context budget

In **Runtime parameters → Context budget**, choose only **Standard budget** or **Triple budget**. Fast (Instant/low) and non-Fast (medium/high/xhigh/Pro) windows are fixed at 80k/272k for standard and 240k/816k for triple (1k = 1,000 tokens). Values are read-only; usable capacity (95%) and auto-compaction (90%) are derived automatically. Triple still requires Context as File and supported mode/account capabilities. Legacy custom windows normalize to the fixed values while preserving a valid standard/triple choice; reapply configuration and restart the corresponding Codex for a stale catalog. Restore defaults changes only the draft. Busy or queued tasks reject saves; idle saves synchronize runtime and catalog transactionally. The 32 KiB file-transport threshold is independent. Budgets do not guarantee actual web capacity or complete recall.

CLI `setup` and `dev setup` select the mode with `--standard-context-budget` or `--context-triple-budget`. The retired `--fast-context-window` and `--standard-context-window` flags explicitly fail, including numeric and `default` arguments. Configuration, model catalogs and browser preflight all use fixed windows.

With Context as File enabled, the complete serialized context stays inline up to 32 KiB (32768 UTF-8 bytes). Above that boundary it becomes one integrity-checked TXT attachment. Size includes JSON escapes, roles, tools and results, not just the latest user text. Every owned attachment must finish processing before Send; failures stop submission without falling back to the full inline prompt. The threshold changes transport only, leaving the selected window and compaction threshold unchanged.

File transport and budget record contextPreferenceSources.files/budget separately. Only explicit user choices survive; other sources use files on plus standard budget, subject to mode support. Routine synchronization does not mark user intent. Triple multiplies the fixed standard windows by three: Fast/non-Fast windows are 240000/816000, with 95% usable and 90% compaction. Disabling files clears triple and its provenance. Manual mode and Luna do not support file transport.

<a id="luna-continuity"></a>

### Luna continuity and browser boundary

Luna Ordinary and Think share the configured non-Fast window (default 272000) and its 90% compaction threshold (default 244800), using native Codex compaction without private rolling checkpoints. Equivalent live capacity has not been calibrated for Luna, and file transport remains unavailable. Actual web input rejection is reported without trimming history or selecting another model.

<a id="native-context-preservation"></a>

### Native Codex context preservation

Web2Harness creates Web entries from a native catalog template, then assigns the Web route's own context metadata. Web rows have their native-template `comp_hash` removed and do not inherit native speed/service tiers. Their catalog `supported_in_api: true` means the local bridge implements those IDs; it does not claim that OpenAI's public API offers them.

Native rows retain their native `context_window`, compaction metadata and budgets. The integration does not write a Web budget into the user's top-level `model_context_window` or `model_auto_compact_token_limit`. If the user already set a positive `model_context_window`, catalog augmentation can raise a native row's advertised `max_context_window` to preserve that explicit override; it does not lower a larger maximum or change the native row's context/compaction fields. Codex remains responsible for applying its own configuration.

The `compatibility-v1` subagent setting separately changes collaboration metadata for native and Web rows; context preservation does not imply that every native catalog field is byte-for-byte unchanged.

<a id="responses-transport"></a>

### Responses transport and continuation

These are unreleased source contracts; published **2.4.0 is unchanged**. The updated `runtime-bundle-verified` build and relocation smoke passed. The failed DEV run is retained. Authenticated CLI resume/cancellation/recovery and the public-PDF URL, independent prefill-lane and natural-boundary steering component checks passed. These component results do not certify remote-image live input, raw media or Codex file-tool end-to-end execution. See the [evidence limits](native-tools-compatibility.md#evidence).

| Interface | Contract |
| --- | --- |
| WebSocket `response.create` | Shares HTTP Responses dispatch. Named `stream_id` and the default lane each run FIFO; different lanes may run concurrently. Defaults: 16 active responses, 32 named lanes plus default, 128 queued requests / 64 MiB. These are connection limits, not additional Web execution slots. |
| `previous_response_id` | Lineage is independent of lane name. A bounded process-local cache is partitioned by incoming authorization/account/organization/project digest. Scope is not authentication. Cache misses require complete original history, including tool results, without re-execution. |
| WebSocket / prepared history | Memory-only, including descendants later continued over HTTP; excluded from unrelated snapshot flushes. Cache bounds: one hour, 1,000 entries, 64 MiB UTF-8 item data. No restart durability or upstream ZDR certification. |
| Web `generate:false` | Validation and memory-only request-state preparation, with a resumable empty response and zero input/output/total token usage. No model/browser/tool execution, URL download or KV-cache warming. Unsupported provider file IDs fail; native prewarm returns `unsupported_native_prewarm`. |
| `response.steer` | Natural-completion continuation for supported ordinary automatic GPT-6 Native Tools requests. Accepted means queued; successor `response.created` commits input. Automatic successors preserve original model/effort/tools/settings. Earlier output-item interruption is not implemented. |
| Required tool results / approval | Steering stays pending. A matching explicit create on the same connection/lane supplies the results/decisions and retains its own settings; accepted input is prepended once. Recognition of a hosted approval shape does not implement its hosted tool. |
| Cancellation | Disconnect cancels only owned connection work; native precise turn interrupt has its own identity/authority checks. No documented Responses `response.cancel` client frame was established; do not import Realtime or background HTTP cancellation semantics. |

Queue/lane/steering limits fail explicitly (`websocket_queue_full`, `websocket_stream_limit_reached`, `too_many_pending_steers`). The steering budget defaults to 64 pending submissions / 8 MiB with a 10-second validation deadline. `steering_required_input_missing` leaves accepted input pending without starting a model request. Background/non-streaming Web generation, unsupported steering routes and native prewarm remain explicit boundaries. The original model/effort are never changed to make these checks pass.

<a id="input-references"></a>

### Attachment reference resolution

Remote `input_image.image_url` and `input_file.file_url` are resolved only after shared history/context/model/effort/tool/control validation. The server derives exact URL grants from validated task input and binds them to task/provider/account scope; arbitrary metadata is not a grant. Preparation retains unresolved original references without DNS/HTTP; generation resolves before normal attachment validation. Native passthrough bypasses this Web-only path.

Only public HTTPS on port 443 is supported. All DNS answers must be public; the socket is pinned to a checked address with hostname/TLS verification. No authorization headers, cookies, browser identity, ambient credentials or proxies are forwarded. Each redirect requires a separate exact scoped URL grant. Inline and remote image/file attachments in the expanded request share a limit of 10 attachments and 50,000,000 total content bytes, including both inline and downloaded bytes; each attachment is limited to 20,000,000 bytes. Repeated inline files with the same filename and data count once; images and URL references are counted individually. DNS, connection/headers and each file body have independent 30-, 60- and 120-second limits. Each of at most three redirects starts fresh limits; shared request allocation reservations and cancellation also apply. The resolver can enforce lower download budgets but cannot raise built-in ceilings.

Original bytes and supported specific MIME types are preserved. Ambiguous octet-stream/ZIP MIME, unsupported charset/HTTP compression, unsupported audio formats and raw video are rejected. Inline Codex input_audio supports WAV, MP3/MPEG, OGG Opus/Vorbis, FLAC, audio-only M4A/MP4 and WebM through the original-byte attachment path, including native tool results. Public HTTPS audio URLs use the same authorized resolver and no-download preparation; bare PCM and AAC-only streams remain unsupported. `unsupported_provider_file_reference` applies to provider `file_id` in both preparation and generation: no compatible authenticated Codex/ChatGPT file service is established. The API Files endpoint alone is not that contract. No transcription, frame extraction or guessed endpoint is used as an equivalent fallback. See [attachment boundaries](native-tools-compatibility.md#data-contracts).

Automatic Web model entries declare audio input so Codex can forward audio tool results. This declaration enables transport; it does not establish successful Web processing or audio understanding. Manual entries remain text-only and native model declarations are preserved. See the [current media acceptance limits](investigations/2026-10-20-capability-followup/README.md).

<a id="data-locations"></a>

## Profiles and data locations

`~` denotes the current user's home. Paths below are locations, not cleanup instructions.

| Data | Regular profile | Isolated DEV profile |
| --- | --- | --- |
| Web2Harness home | `~/.web2harness/` | `~/.web2harness-dev/` |
| Runtime configuration | `<home>/config.json` | `<DEV home>/config.json` |
| Codex home | `CODEX_HOME`, otherwise `~/.codex/` | `<DEV home>/codex-home/` |
| Electron user data | `Web2Harness/` under Electron's OS application-data directory | `<DEV home>/launcher/` |
| Launcher preferences | `<Electron user data>/launcher-state.json` | `<DEV home>/launcher/launcher-state.json` |
| Persistent browser partition | `persist:web2harness-chatgpt` | `persist:web2harness-dev-chatgpt` |
| Browser host descriptor | `<home>/runtime/launcher-browser.json` | `<DEV home>/runtime/launcher-browser.json` |
| Saved-chat naming ledger | `conversation-history.json` beside the browser host descriptor | Same filename beside the DEV descriptor |
| Managed Chrome session file | `<home>/browser/storage-state.json` by default | Profile-specific; not copied from the regular profile |
| Managed automatic tunnel key | `<home>/secrets/tunnel-runtime-automatic.key` | Same relative path within the DEV home |
| Managed manual tunnel key | `<home>/secrets/tunnel-runtime-zero-risk.key` | Same relative path within the DEV home |
| Named DEV workspace | Not applicable | `<DEV home>/workspaces/<name>/` |
| DEV chat and transport state | Not applicable | `<DEV home>/chats/` and `<DEV home>/runtime/dev-chat/` |

Browser sessions, tunnel keys, configuration control tokens and descriptors are private data. Keep raw diagnostics, browser state and configuration backups outside tracked documentation. See [Security](architecture.md#security-boundaries) for boundaries and [Development](development.md) for isolated testing.

DEV rejects overlap with production data, uses an independent browser login and Codex home, and allocates a loopback port other than the regular default `17841`. Start it with `bun run dev:launcher`; inspect `bun run src/cli.ts dev status --json` for the active profile and endpoint. Do not point a test at the regular profile or copy production credentials.

<a id="environment-overrides"></a>

## Environment overrides

Overrides apply to the process receiving them. These are supported launch overrides, not an inventory of internal test variables.

| Variable | Scope and effect |
| --- | --- |
| `WEB2HARNESS_HOME` | Regular core home; CLI `--home PATH` selects the same scope for that invocation. Supports `~` expansion. |
| `WEB2HARNESS_DEV_HOME` | Independent DEV root; must not overlap production directories. DEV rejects `--home`. |
| `CODEX_HOME` | Regular Codex home. DEV sets its own child environment to `<DEV home>/codex-home`. |
| `WEB2HARNESS_LAUNCHER_DATA_DIR` | Regular Electron user-data directory. DEV selects `<DEV home>/launcher` instead. |
| `WEB2HARNESS_CODEX_EXECUTABLE` | Explicit Codex executable or npm JavaScript entry for DEV executable discovery. |
| `WEB2HARNESS_LAUNCHER_EXECUTABLE` | Explicit packaged launcher for DEV. It must support the DEV profile. An empty, missing or unusable explicit path fails without selecting another installation; without this override, a source checkout can use its launcher development script. |
| `WEB2HARNESS_BUN` | Durable installed Bun executable for runtime discovery. Temporary executables are rejected for installed runtime commands. |
| `WEB2HARNESS_REPOSITORY` | Explicit `OWNER/REPOSITORY` release source. Packaged metadata may provide the launcher fallback. Invalid explicit values do not fall back silently. See [Release](release.md) for installer requirements. |

Do not change global environment variables to redirect a test into a production profile. DEV commands construct their isolated child environment themselves.

<a id="commands"></a>

## Command interfaces

The installed executable is `web2harness`. From a source checkout, replace it with `bun run src/cli.ts`. The Linux desktop entry is `web2harness-desktop`.

| Command | Purpose and side effects |
| --- | --- |
| `--help`, `--version` | Print CLI help or version. |
| `doctor --json` / `status --json` | Run diagnostic checks and return structured results; nonzero exit when the report is not healthy. |
| `route status` | Inspect whether the managed Codex route is installed and active. |
| `route connect` / `route disconnect` | Activate or restore managed route settings; restart Codex when changed. |
| `subagents status` | Inspect the configured collaboration protocol and route state. |
| `subagents compatibility-v1` / `subagents native` | Change the protocol; restart Codex and the launcher. |
| `browser check` | Check the configured browser engine or launcher browser. Manual mode checks host liveness without ChatGPT DOM inspection. |
| `browser queue status`, `configure …`, `recover --confirm-browser-stopped` | Inspect saved standalone receipts, configure the next runtime, or explicitly recover a stopped owner. Managed Chrome only; see [standalone queue controls](#standalone-request-queue). |
| `setup [options]` | Validate and configure runtime, account capabilities and Codex integration. This changes the selected environment. |
| `login` | Run the supported browser-login flow; launcher-owned login remains under launcher control. |
| `serve` | Start the selected runtime's Responses server in the foreground. |
| `service status` / `tunnel status` | Inspect service or tunnel state for the selected environment. |
| `service install`, `start`, `restart`, `stop`, `cancel-turns` | Change service lifecycle or cancel active turns. Availability depends on the runtime's platform and owner. |
| `tunnel start`, `restart`, `stop`, `key-import` | Change tunnel lifecycle or import a private runtime key. |
| `open tunnels`, `open runtime-keys`, `open connectors` | Open the corresponding settings URL on macOS; print it on other platforms. |
| `uninstall --yes [--keep-data]` | Restore managed Codex integration and remove the installation; optionally retain private data. Launcher-owned integrations must be removed through launcher Settings so its runtime can be drained safely. |
| `dev launcher`, `dev status --json`, `dev setup`, `dev codex -- …`, `dev chat NAME`, `dev list` | Use the isolated development profile. Follow [Development](development.md) before live tests. |

<a id="setup-options"></a>

### Setup option groups

| Options | Target and constraints |
| --- | --- |
| `--native-tools`, `--browser-only`, `--mcp-bridge` | Mutually exclusive runtime modes; default is `--native-tools`. |
| `--automatic-browser-interaction`, `--zero-risk-browser-interaction` | Mutually exclusive interaction modes; manual requires MCP Bridge and the launcher descriptor. |
| `--port NUMBER`, `--chrome PATH`, `--browser-host-descriptor PATH` | Endpoint and browser selection. A descriptor selects the launcher host; a Chrome override without a descriptor selects managed Chrome. |
| `--subagent-protocol compatibility-v1\|native` | Select the collaboration protocol. |
| `--handoff-protocol web2harness-handoff-v1\|web2harness-handoff-v2` | Explicit MCP contract for regular or DEV setup. Omission preserves an existing selection; new configurations use v1. Specify `--mcp-bridge` when configuring MCP. |
| `--refresh-account-capabilities`, `--login` | Recheck account capabilities or refresh managed-browser login; unavailable in manual mode. Launcher session login is controlled in its UI. |
| `--tunnel-id ID`, `--runtime-key-file PATH` | Supply MCP Bridge credentials for the selected interaction path. |
| `--saved-chats` / `--temporary-chats` | Set `useSavedChats`. |
| `--fresh-conversation` / `--retained-conversation` | Set automatic conversation reuse. |
| `--context-files` / `--no-context-files` | Set Context as File transport. |
| `--context-triple-budget` / `--standard-context-budget` | Select triple or standard budget; triple requires file transport. |
| `--skill-attachments` / `--inline-skills` | Set selected-skill attachment transport. |
| `--zero-risk-pro` / `--zero-risk-default` | Add or remove the Pro-specific manual entry; only configurable in manual mode. |
| `--auto-approve-tool-calls` | Enable browser Allow once clicks. |
| `--replace-codex-route` | Explicitly allow reversible replacement of existing Responses or Voice route settings. |
| `--restart-service` | Permit the setup flow to restart the project daemon when needed. |
| `--acknowledge-unofficial` | Supply setup's required acknowledgement. Without it, an interactive prompt is required. |

Each on/off option pair is mutually exclusive. Do not run regular setup or service commands as a development test against the user's active installation.

<a id="selection-and-failure-handling"></a>

## Selection and failure handling

After applying configuration or refreshing account capabilities, refresh the corresponding Codex model catalog as indicated by the launcher. A saved capability observation can become stale when the account or browser UI changes. Editing `proAvailable` or another capability field cannot unlock the service.

For isolated command-line use, select the exact route ID, for example:

```bash
bun run dev:codex -m chatgpt-web/gpt-5.6-sol
bun run dev:codex -m chatgpt-web/gpt-6-pro
```

These commands start real DEV Codex sessions and require the [development setup and isolation procedure](development.md). Their presence in this reference is not evidence that the current account supports either entry.

| Symptom | Meaning and next action |
| --- | --- |
| Cannot find Instant | Existing instant slugs display Fast with fixed `low`; ordinary entries expose non-Fast thinking efforts. |
| `low` rejected on the Sol row | Refresh the model catalog and restart the corresponding Codex; check account capability and the requested model ID. |
| Extra High absent | No positive Extra High observation is stored; refresh capabilities in automatic mode. |
| Pro row has no lower effort choices | Named Pro routes are fixed at `max` by design. |
| `model_version_unavailable` | Requested browser family/effort could not be verified; inspect the browser selection and supported UI language before retrying. |
| `context_length_exceeded` | An applicable token, character or total input limit was exceeded. Reduce input or compact supported routes; file transport does not remove all limits. |
| Web row exists in the main picker but a child override is unavailable | The client's child-model override roster may be narrower than its main catalog. Check the actual offered override values and selected subagent protocol. |

<a id="implementation-references"></a>

## Implementation references

The following modules define the contracts in this reference. For directory ownership and change procedures, use the [development repository map](development.md#repository-map).

| Contract | Implementation |
| --- | --- |
| Configuration and commands | [Runtime schema and defaults](../src/config.ts), [setup application rules](../src/setup.ts), [CLI parser](../src/cli.ts). |
| Persisted schema migration | [Shared migration](../launcher/shared/config-migration.cjs), a pure module used by both Bun and the desktop; validation and file writes remain with their callers. |
| Profiles and desktop preferences | [Launcher profiles](../launcher/electron/profile.cjs), [launcher state](../launcher/electron/state.cjs), [DEV profile](../src/dev/profile.ts), [DEV commands](../src/dev/cli.ts). |
| Runtime controls | [Stall watchdog](../src/stall-timeout.ts), [tunnel storage](../src/runtime/tunnel.ts). |
| Request scheduling | [Shared scheduler](../launcher/shared/request-scheduler.cjs), [Launcher owner](../launcher/electron/runtime/request-queue.cjs), [standalone owner](../src/browser/standalone-request-queue.ts), [CLI controls](../src/browser/standalone-queue-command.ts), [cross-process transport](../src/browser/standalone-queue-transport.ts). |
| HTTP body admission | [Streaming reader](../src/http-body.ts), [service allocation budget](../src/http-body-budget.ts), [zstd window guard](../src/http-body-zstd.ts), [endpoint lifecycle](../src/server.ts). |
| Model identity and availability | [Route registry](../src/models/chatgpt-web-model-registry.ts), [account-aware resolution](../src/models/chatgpt-web-models.ts), [model types](../src/models/chatgpt-web-model-types.ts). |
| Context and compaction budgets | [Context and transport policy](../src/models/chatgpt-web-context.ts), [input estimation and Luna boundary](../src/adapters/chatgpt-web/prompt/input-tokens.ts), [source preservation](../src/adapters/chatgpt-web/prompt/source-context.ts). |
| Catalog and selection validation | [Catalog augmentation](../src/models/model-catalog.ts), [native context override reading](../src/codex/integration-document.ts), [browser family verification](../src/adapters/chatgpt-web/browser/model-selection.ts). |

[Project documentation](../README.md#documentation) · [User guide](user-guide.md) · [Troubleshooting](troubleshooting.md)


## Local usage and allowance references

Usage & Diagnostics counts **Web sends from this app**. Automatic mode records each observed, accepted submission once, including tool-result follow-ups and compaction. Native tool calls alone do not add a send. Context as File and the selected context budget do not multiply the count. Other devices, browsers and pre-tracking activity are excluded; these records cannot determine official remaining allowance or reset time.

The total above the model table counts all recorded models over the last seven days. GPT-5.6 Sol, GPT-5.6 Sol Pro, GPT-6 and GPT-6 Pro have separate rolling 24-hour/7-day totals. The windows overlap. Each model combines all thinking levels and send purposes; there is no separate effort table. The Pro total includes both Pro families and legacy records known to be Pro with an unidentified family. These records also keep their own row. Ledger metadata retains verified effort and purpose for diagnostics; old records retain their IDs and timestamps, with unavailable dimensions unknown. Token usage remains an estimate and is not an official bill.

A private, bounded usage outbox records send activation separately from acceptance. Unconfirmed activation is shown separately and never counted as accepted. Accepted receipts are retried with the same ID and reconciled after restart; a lost acknowledgement cannot duplicate usage or trigger another Web send. An unavailable account or corrupt record is reported as a gap. Manual mode pauses automatic recording/reconciliation and retains history. Records and pending items expire after seven days; the outbox holds at most 2,000 items, and the ledger at most 20,000 receipts across 64 accounts. Receipt metadata contains no prompts or authentication. Storage failure can still prevent recording; it must not replay an accepted request.

**Model allowance references** are a separate, manually selected reference view. It starts without an assumed price tier; recognizing a Pro category does not prove its price tier. Each numeric rule retains its source, source type, check date, reference period and verification status in the bundled policy data. The interface shows only model, period and count, with unknown values as `-`; the check date and “For reference only” appear below the table. Local usage likewise puts its brief scope, last-recorded time and any pending/error status below its table. The Pro $200 view retains the requested reference from 2026-10-30 and offers an earlier historical view. Notice transcripts and historical carry-forward values remain unconfirmed in the policy metadata. Passing a listed date does not independently verify a rule. Unknown counts, including ordinary GPT-6, are not inferred from Pro counts. Sources are reviewed before changing bundled policy; local counts do not generate official percentages, balance alerts or quota enforcement.
