# Configuration and model reference

[English](reference.md) | [简体中文](reference.zh-CN.md) · [Project documentation](../README.md#documentation)

This manual defines configuration fields, model entries, context budgets, data locations, and command interfaces. For initial connection and routine operation, use the [user guide](user-guide.md). Design rationale and authority boundaries are covered in [architecture](architecture.md).

Defaults apply to new configurations; existing explicit settings follow the loading and application rules below. Model tables describe this repository's routing and operational budgets, not an OpenAI service availability matrix or API model specification.

**Contents**

- [Configuration ownership and application](#configuration-ownership)
- [Runtime and launcher settings](#runtime-settings)
- [Model catalog and reasoning effort](#models)
- [Context and transport budgets](#context-budgets)
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
| `browserHost` | `managed-chrome` | `managed-chrome`: use the configured Chrome executable and stored session. `launcher`: attach to the launcher's owned browser through its descriptor. |
| `autoApproveToolCalls` | `false` | Boolean. Opts into automatic clicks on browser **Allow once** prompts. It does not replace Codex sandbox or approval policy. |
| `zeroRiskProEnabled` | `false` | Boolean. In manual mode, also publish the Pro-sized manual model entry. The user must select Pro in ChatGPT for each turn; the launcher cannot verify that selection. |

Automatic and manual MCP configurations use separate tunnel IDs and connector identities. The regular automatic connector is `Codex Native2`; the DEV automatic connector is `Codex Native2 DEV`; the manual connector is `Codex Zero Risk`. The active `appName` and `tunnel` must match the chosen interaction mode. A successful check for one interaction path does not verify the other.

<a id="conversation-and-attachments"></a>

### Conversation and attachment settings

| Setting | Default | Effect and constraints |
| --- | --- | --- |
| `useSavedChats` | `true` | Task conversations use ChatGPT history. `false` selects Temporary Chat. An explicit `false` is retained when loading configuration. This setting is separate from conversation reuse. |
| `experimentalFreshConversationPerTurn` | `false` | `false` allows eligible launcher-hosted Sol/Pro conversations to be reused with Native Tools or MCP Bridge. `true` starts a new browser conversation for each automatic turn. Browser-only and Luna use different continuity paths. Manual setup rejects an explicit request to enable it. See [conversation state](architecture.md#conversation-state-and-compaction). |
| `experimentalContextFiles` | `false` | Enables experimental Context as File transport for large context. Smaller input can remain inline. Unavailable in manual mode. |
| `experimentalContextTripleBudget` | `false` | With Context as File enabled, multiply the applicable automatic Sol/Pro catalog context and compaction budgets by three. Does not increase a single browser message limit, an account quota, or underlying model capacity. Disabling Context as File clears this setting. |
| `experimentalSkillAttachments` | `false` | Sends selected skill content as text attachments. Unavailable in manual mode. |

The file transport and larger context budget are separate choices. Requesting the larger budget without file transport fails setup. Switching to manual mode clears file transport, its larger budget and skill attachments. Manual setup rejects `--login`, capability refresh and explicit requests to enable these unsupported features.

<a id="endpoint-and-browser"></a>

### Endpoint, browser and internal fields

These fields support runtime integration and diagnostics. Prefer setup over editing them directly.

| Setting | Default or generated value | Validation and purpose |
| --- | --- | --- |
| `host` | `127.0.0.1` | Only this IPv4 loopback address is accepted for the Responses listener. |
| `port` | `17841` in the regular profile | Integer from `1` to `65535`; DEV selects its own port. The local Responses base is `http://127.0.0.1:<port>/v1`. |
| `contextWindow` | `256000` | Positive safe integer for the generic provider configuration. Web model catalog windows and preflight budgets are resolved per route; this field does not override the [model budget policy](#context-budgets). |
| `stallTimeoutSec` | Unset; effective default `300` seconds | Positive finite number. The bridge rounds upward and clamps to `1`–`3600` seconds of adapter silence before reporting `upstream_stall_timeout`. This is not a total turn duration limit. |
| `chromeExecutablePath` | macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; Windows: `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe` with `C:\Program Files` fallback; Linux: `/usr/bin/google-chrome` | Nonempty executable path used by the managed browser/login path; override through `--chrome`. |
| `headed` | `true` | Boolean controlling the managed browser's visible-window setting. |
| `storageStatePath` | `<home>/browser/storage-state.json` | Nonempty session-file path for the managed browser. The launcher's persistent browser partition has its own session storage. |
| `browserHostDescriptorPath` | Supplied by the launcher | Required absolute path for `browserHost: "launcher"`. Describes the owning browser process and private control endpoint. |
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

Setup handles the active tunnel configuration and managed credential files. For DEV MCP Bridge, local names and paths do not establish remote isolation: the [development procedure](development.md) requires explicit DEV tunnel confirmation and verification of the actual connector binding.

<a id="launcher-preferences"></a>

### Launcher preferences

| Preference | Default | Effect |
| --- | --- | --- |
| `language` | Unset before onboarding | `en` or `zh-CN`; launcher interface language. It does not change ChatGPT's language. |
| `autoStart` | `true` in regular launcher state | Controls OS login startup through the launcher. DEV disables this control and starts explicitly. |
| `keepRunningOnClose` | `true` | Closing the window hides it when a tray is available; otherwise the normal close behavior applies. |
| `showBrowserDuringTurns` | `true` | Shows the browser when an automatic task starts. Manual turns show their browser independently of this preference. |
| `sidebarOpen` / `sidebarWidth` | `true` / `252` | Saved sidebar layout. Width is constrained to `240`–`420`. |

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

The launcher records `solAvailable`, `extraHighAvailable` and `proAvailable` from the authenticated browser. The model resolver uses those observations to construct the catalog. `solAvailable: false` selects the Luna-only catalog; `proAvailable: true` selects the Pro-account budget policy and enables Pro entries. Extra High requires its own positive observation.

| Model ID | Display name | Catalog condition | Efforts; default |
| --- | --- | --- | --- |
| `chatgpt-web/gpt-5.6-luna` | GPT-5.6 Luna · Ordinary / Think (Web) | `solAvailable: false` | `low` = Ordinary, `medium` = Think; default `low` |
| `chatgpt-web/gpt-5.6-sol-instant` | GPT-5.6 Sol · Instant (Web) | Sol available, and Instant cannot share the Sol row's context budget | Fixed `low` |
| `chatgpt-web/gpt-5.6-sol` | GPT-5.6 Sol (Web) | Sol available | `medium`, `high`; `xhigh` if observed; `low` if its budget matches; default `high` |
| `chatgpt-web/gpt-5.6-pro` | GPT-5.6 Sol Pro (Web) | Sol and Pro available | Fixed `max` |
| `chatgpt-web/gpt-6-pro` | GPT-6 Pro (Web) | Sol and Pro available | Fixed `max` |

The current registry contains no GPT-6 Instant, Medium, High or Extra High route. The GPT-6 Pro route uses the existing Pro compatibility budget; its full browser capacity has not been calibrated separately.

Catalog gating records general Sol/Extra High/Pro capability, not a separate availability flag for every model family. Before submitting a named automatic route, the adapter selects and verifies both the browser family and effort. A generic Pro label alone is insufficient. Failure to verify the requested family produces `model_version_unavailable` and leaves the pending message unsent; the adapter does not silently substitute another family.

<a id="instant-grouping"></a>

#### Instant grouping

One Codex catalog row has one context contract: context window, effective window percentage and automatic compaction threshold. Efforts are grouped only when all three values agree.

| Account policy | Instant behavior |
| --- | --- |
| Pro capability observed | Instant and ordinary Sol thinking use the same `111193` context window and `95000` compaction threshold. `low` appears within `chatgpt-web/gpt-5.6-sol`; the standalone Instant ID remains resolvable for saved tasks but is hidden from the normal picker. |
| Sol available without Pro capability | Instant uses `41000` / `32000`; Medium and High use `90000` / `80000`. The catalog exposes a separate Instant entry and omits `low` from the main Sol row. |

If a caller requests `low` on the main Sol row when the budgets differ, the request is rejected with guidance to select the standalone Instant entry. The implementation does not shrink the thinking budget to combine these choices.

<a id="effort-mapping"></a>

#### Effort mapping

| Codex effort | Automatic Sol/Pro browser selection | Constraint |
| --- | --- | --- |
| `low` | Instant, slider position `0` | Within the Sol row only when budgets match; otherwise select Instant's separate row. |
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

Both profiles expose technical effort `low` and text input only. That value does not select Instant or any other ChatGPT model. Manual mode does not inspect the selected browser model or refresh account capabilities; the Pro-sized entry is an explicit user setting, not a detected entitlement. Context as File and skill attachments are unavailable.

<a id="saved-task-compatibility"></a>

### Saved-task compatibility

Compatibility route IDs remain resolvable when the current account and interaction mode allow them. They are hidden from the ordinary picker, except for standalone Instant when a distinct budget requires it.

| Compatibility ID | Preserved selection |
| --- | --- |
| `chatgpt-web/light` | Sol adapter Instant |
| `chatgpt-web/medium` | Sol adapter Medium |
| `chatgpt-web/high` | Sol adapter High |
| `chatgpt-web/extra-high` | Sol adapter Extra High, account-gated |
| `chatgpt-web/pro` | Sol adapter Pro; technical Codex `ultra` maps to browser `max` |
| `chatgpt-web/luna` | Luna Ordinary, Luna-only accounts |
| `chatgpt-web/think` | Luna Think, Luna-only accounts |
| `chatgpt-web/gpt-5.6-sol-instant` | Named GPT-5.6 Sol Instant, including when hidden by grouping |

The older fixed routes preserve their original adapter bindings and do not acquire the newer named routes' model-family pinning. Use named current routes for explicit family selection. Unsupported reasoning values on named routes are rejected rather than silently remapped.

<a id="context-budgets"></a>

## Context and transport budgets

Three limits serve different purposes:

1. **Catalog context window**: the window advertised by the Web model entry and used by the adapter's input preflight.
2. **Automatic compaction threshold**: the task-history level at which Codex should compact before a later browser turn.
3. **Browser message limit**: the separate token or character envelope of one submitted browser message.

The source of truth is [the context policy](../src/models/chatgpt-web-context.ts). These are configured operational budgets. File upload acceptance, a native/API model specification, or a successful small prompt does not establish a larger usable browser context.

<a id="standard-context-budgets"></a>

### Standard catalog budgets

Values are tokens. This table has Context as File's optional triple budget disabled.

| Route/account policy | Context window | Auto-compaction threshold | Effective window percentage |
| --- | ---: | ---: | ---: |
| Sol Instant without Pro capability | 41,000 | 32,000 | 78% |
| Sol Medium/High, and available Extra High, without Pro capability | 90,000 | 80,000 | 89% |
| Pro-account Sol Instant/Medium/High/available Extra High | 111,193 | 95,000 | 85% |
| GPT-5.6 Sol Pro or GPT-6 Pro | 112,193 | 95,000 | 85% |
| Manual default profile | 123,000 | 96,000 | 78% |
| Manual Pro-sized profile | 336,579 | 285,000 | 85% |
| Luna Ordinary/Think | 28,000 | 22,000 | 79% |

The effective percentage is `round(autoCompactTokenLimit / contextWindow × 100)`. Codex uses this metadata in its context indicator, so the UI need not display the raw window as its working budget.

Pro-account windows include an `8192`-token platform reserve plus one token for the adapter's exclusive context ceiling: `103000 + 8192 + 1` for ordinary Sol and `104000 + 8192 + 1` for Pro. The one-message boundaries are inclusive; context preflight requires estimated total input to remain below the context window.

The manual profiles use three times their per-turn reference budget because a visible conversation spans sequential incremental turns. This does not enable Context as File or guarantee that any manually selected model accepts that amount of history.

<a id="message-budgets"></a>

### Single-message transport budgets

| Automatic route/account policy | Explicit visible-message token cap | Inline character cap |
| --- | ---: | ---: |
| Sol Instant without Pro capability | No separate cap; context preflight applies | 211,256 |
| Sol Medium/High/available Extra High without Pro capability | No separate cap; context preflight applies | 1,048,572 |
| Pro-account Sol Instant | 103,000 | 545,000 |
| Pro-account Sol Medium/High/available Extra High | 103,000 | 500,000 |
| GPT-5.6 Sol Pro or GPT-6 Pro | 104,000 | 1,635,000 |

An input must satisfy every applicable limit. Input estimates include visible text, context-file content, selected skill attachments, the `8192` platform reserve and image reserves. Each image reserves `4096` tokens, or `8192` for `detail: "original"`. Character and token limits are independent; a message can fit its token budget and still exceed its character cap. The character check uses JavaScript string length.

For Sol/Pro, the ordinary visible-text budget is the smaller of the explicit message token cap and `standard context window − platform reserve − image reserve − 1`. With no image reserve, this yields `32807` tokens for non-Pro Instant, `81807` for non-Pro thinking, `103000` for Pro-account ordinary Sol and `104000` for Pro. These derived values are transport planning budgets, not additional compaction thresholds.

<a id="context-files"></a>

### Context as File and triple budget

`experimentalContextFiles` changes how sufficiently large context is sent. `experimentalContextTripleBudget` is a separate opt-in that takes effect only with file transport. For the automatic Sol/Pro policies, it multiplies the context window and compaction threshold by three while retaining the effective percentage. For example, ordinary Pro-account Sol becomes `333579` / `285000`, and a Pro route becomes `336579` / `285000`.

The triple budget does not multiply the visible-message token cap, character cap or account usage quota; per-image token reserves remain unchanged. It does not multiply Luna's browser budget. Manual mode rejects file transport and uses its own fixed budgets. A successful upload does not prove that all uploaded context was used by the browser model.

<a id="luna-continuity"></a>

### Luna continuity and browser boundary

Luna advertises a `28000` context window and `22000` automatic compaction threshold, leaving headroom inside the measured browser budget. Both Ordinary and Think use the shared native Codex compaction path. Private rolling checkpoints no longer replace original history.

The browser preflight still enforces the `28000`-token total estimated request budget, including reserves. Oversize input fails explicitly; it is never silently trimmed. Codex can compact completed history, but an individual oversized item may still require the user to reduce it. Context as File and the triple budget do not extend Luna.

<a id="native-context-preservation"></a>

### Native Codex context preservation

Web2Harness creates Web entries from a native catalog template, then assigns the Web route's own context metadata. Web rows have their native-template `comp_hash` removed and do not inherit native speed/service tiers. Their catalog `supported_in_api: true` means the local bridge implements those IDs; it does not claim that OpenAI's public API offers them.

Native rows retain their native `context_window`, compaction metadata and budgets. The integration does not write a Web budget into the user's top-level `model_context_window` or `model_auto_compact_token_limit`. If the user already set a positive `model_context_window`, catalog augmentation can raise a native row's advertised `max_context_window` to preserve that explicit override; it does not lower a larger maximum or change the native row's context/compaction fields. Codex remains responsible for applying its own configuration.

The `compatibility-v1` subagent setting separately changes collaboration metadata for native and Web rows; context preservation does not imply that every native catalog field is byte-for-byte unchanged.

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
| `WEB2HARNESS_LAUNCHER_EXECUTABLE` | Explicit packaged launcher for DEV. It must support the DEV profile; without this override, a source checkout can use its launcher development script. |
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
| `--refresh-account-capabilities`, `--login` | Recheck account capabilities or refresh managed-browser login; unavailable in manual mode. Launcher session login is controlled in its UI. |
| `--tunnel-id ID`, `--runtime-key-file PATH` | Supply MCP Bridge credentials for the selected interaction path. |
| `--saved-chats` / `--temporary-chats` | Set `useSavedChats`. |
| `--fresh-conversation` / `--retained-conversation` | Set automatic conversation reuse. |
| `--context-files` / `--no-context-files` | Set Context as File transport. |
| `--context-triple-budget` / `--standard-context-budget` | Set larger or standard budgets; larger requires file transport. |
| `--skill-attachments` / `--inline-skills` | Set selected-skill attachment transport. |
| `--zero-risk-pro` / `--zero-risk-default` | Add or remove the Pro-sized manual entry; only configurable in manual mode. |
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
| Instant is absent as a separate row | On the Pro-account budget policy, choose `low` under GPT-5.6 Sol. |
| `low` rejected on the Sol row | This account has a distinct Instant budget; select the standalone Instant ID. |
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
| Model identity and availability | [Route registry](../src/models/chatgpt-web-model-registry.ts), [account-aware resolution](../src/models/chatgpt-web-models.ts), [model types](../src/models/chatgpt-web-model-types.ts). |
| Context and compaction budgets | [Context and transport policy](../src/models/chatgpt-web-context.ts), [input estimation and Luna boundary](../src/adapters/chatgpt-web/prompt/input-tokens.ts), [source preservation](../src/adapters/chatgpt-web/prompt/source-context.ts). |
| Catalog and selection validation | [Catalog augmentation](../src/models/model-catalog.ts), [native context override reading](../src/codex/integration-document.ts), [browser family verification](../src/adapters/chatgpt-web/browser/model-selection.ts). |

[Project documentation](../README.md#documentation) · [User guide](user-guide.md) · [Troubleshooting](troubleshooting.md)
