# Development manual

[English](development.md) | [简体中文](development.zh-CN.md) · [Documentation](../README.md#documentation)

Use this manual to prepare the source environment, propose and implement changes, submit pull requests, run isolated tests, and maintain project documentation and assets. [AGENTS](../AGENTS.md) defines automated work boundaries; the [release manual](release.md) covers candidate packages, publication, and security maintenance. Follow the [standard isolated test procedure](#standard-isolated-test-procedure) before starting application or real-account tests. Run commands from the repository root unless stated otherwise.

**Contents**

- [Source environment](#source-environment)
- [Repository map](#repository-map)
- [Contributing and review](#contributing)
- [Change workflow](#change-workflow)
- [Automated checks](#automated-checks)
- [DEV profile and startup](#dev-profile)
- [Standard isolated test procedure](#standard-isolated-test-procedure)
- [Real tasks and simulator](#real-codex-tasks)
- [Naming and compatibility](#naming-and-compatibility)
- [Documentation and asset maintenance](#documentation-and-assets)

<a id="source-environment"></a>

## Source environment

Use an existing checkout or obtain the source from the repository identified in the [project README](../README.md).

| Dependency | Requirement |
| --- | --- |
| Git | Source control and review of the working tree. |
| Bun | Exactly `1.4.0`, as pinned by `packageManager`, `engines.bun`, and `@types/bun` in `package.json`. |
| Node.js | Version 22.12.0 or later; CI uses Node 24. Required by the launcher test runner, Electron packaging tools, and browser helper checks. |
| Codex CLI | Required for real tool acceptance; DEV launches it with an isolated child environment. |
| ChatGPT account | Required only for authenticated browser acceptance. Sign in independently in DEV. |
| Native build host | Desktop packages must be built on the target operating system; see the release target matrix. |

Check the existing tools before installing or updating anything. Development permission does not authorize changing global installations or machine settings.

```bash
git --version
bun --version
node --version
codex --version
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run check-version
```

The root and launcher have separate lockfiles and dependency trees. Keep both installs frozen for routine work. Update dependencies and lockfiles deliberately when the change requires it.

The launcher pins its packaging tool and applies a versioned download compatibility patch. Bun applies the checked-in patch during installation; do not replace it with an unrecorded edit under `node_modules`. See the [patch maintenance notes](../launcher/patches/README.md) before updating packaging dependencies. The download regression suite checks integrity rejection, HTTP errors, timeouts, and proxy routing without production resources.

<a id="repository-map"></a>

## Repository map

| Location | Responsibility |
| --- | --- |
| `src/cli.ts` | Command dispatch and CLI options. |
| `src/server.ts`, `src/responses/` | Responses API, SSE and JSON output, shared response encoding, request state, and lifecycle. |
| `src/config.ts`, `src/setup.ts` | Configuration validation and setup. |
| `src/models/` | Model identity, account capability and reasoning-effort policy, context budgets, and catalog construction. |
| `src/codex/` | Codex configuration integration, journal and restoration, hooks, native routing, and model-cache maintenance. |
| `src/browser/` | Browser login and session storage, plus the client for the launcher's browser host. |
| `src/runtime/` | Service lifecycle, tunnel management, and owned process control. |
| `src/adapters/chatgpt-web/` | ChatGPT turn coordination; browser, conversation, prompt, and tool modules have separate subdirectories. |
| `src/dev/` | DEV profile isolation, real Codex launch, and the explicit simulator. |
| `src/platform/windows/` | Packaged Windows setup and uninstall helper entry points. |
| `launcher/src/` | Renderer entry, application composition, IPC contracts, localization, and base styles. |
| `launcher/src/features/` | Workspace pages, startup, browser interaction, limits, and application shell. Each feature owns its components, hooks, and styles. |
| `launcher/src/components/`, `launcher/src/lib/` | Reusable visual elements and renderer support functions, without feature-specific page ownership. |
| `launcher/electron/` | Electron entry points, IPC, and application state; browser, runtime, installation, limits, and common support have separate subdirectories. |
| `launcher/shared/` | Pure configuration migration shared by the Bun runtime and desktop; contains no Electron dependency. |
| `assets/` | Shared brand, README, demonstration and diagram assets, including editable sources. |
| `launcher/packaging/` | Windows installer hooks and the Linux AppImage launch script. |
| `tests/`, `launcher/tests/` | Core Bun and launcher Node tests, grouped by implementation responsibility; cross-cutting core checks remain at the test root. |
| `scripts/`, `launcher/scripts/` | Build, verification, packaging, and focused smoke tools. |
| `.github/workflows/` | CI and native release workflows. |
| `docs/` | Maintained manuals, references, and architecture documentation. |
| `dev-notes/`, `output/` | Local development records and ignored evidence; not product instructions. |

Use the [architecture overview](architecture.md) to follow the request path and [configuration reference](reference.md) for the meaning of runtime options.

Group source files by responsibility and use file names that identify their role. Keep executable maintenance tools under `scripts/`; keep assets and their editable sources under root `assets/`. A file named for one React component uses PascalCase, and a React Hook file uses `useXxx.ts`; other modules use descriptive lowercase names separated by hyphens. Preserve runtime-specific extensions and established public commands, package identities, and stored paths. A directory move must update imports, build entry points, tests, and documentation together.

The `launcher/shared/` location is a packaging boundary, not an Electron API boundary. The desktop package includes it directly; the Bun build bundles the same migration module. Keep that module independent of Electron, filesystem writes, and application startup so both consumers apply one configuration migration contract.

<a id="contributing"></a>

## Contributing and review

For a defect, follow [troubleshooting](troubleshooting.md) and prepare a minimal reproduction with the exact version, environment, expected behavior, and observed result. Use the repository's issue channel when available. Report suspected vulnerabilities privately through the [vulnerability-reporting procedure](release.md#vulnerability-reporting).

Discuss substantial features, new providers, and core architecture changes with the maintainer before implementation. Keep each submission focused on a defined problem. Explain why associated refactoring or dependency changes are necessary; handle unrelated work separately.

Implement the change using the workflow and checks below. When preparing a pull request:

1. Describe the problem and resulting behavior, with a reproducible before/after example where useful.
2. Explain compatibility, configuration, lifecycle, and data-handling impacts. Update affected English and Chinese documentation and diagrams together.
3. List validation evidence and remaining limitations, distinguishing passed, failed, skipped, and unexecuted checks.
4. Include only the source, tests, documentation, and intended assets needed for the change. Exclude generated release packages, unrelated edits, credentials, browser state, raw logs, and private paths or backups.
5. Use the [English PR template](../.github/PULL_REQUEST_TEMPLATE.md) or [Chinese PR template](../.github/PULL_REQUEST_TEMPLATE.zh-CN.md), and redact examples and diagnostic attachments.

Review covers correctness, scope, compatibility, maintainability, and evidence. Address applicable findings and keep the description and documentation aligned with the final implementation. Code approval and successful packaging do not authorize publication; follow the [release manual](release.md) for release readiness and publication.

<a id="change-workflow"></a>

## Change workflow

1. Inspect the working tree and preserve unrelated changes. Define the behavior being changed and the components that own it.
2. Create or update `dev-notes/worklog/YYYY-MM-DD-topic.md` when work begins. Record objective, scope, status, decisions, results, unresolved issues, and next steps. Update it at meaningful milestones and before handoff. Keep the local development-note index current.
3. Change the shared implementation. DEV must use the same Responses server, browser adapter, model catalog, tool relay, retry, compaction, and lifecycle implementation as regular operation. Do not create a simplified DEV execution path to make a test pass.
4. Run the [checks required for the change](#change-validation). Preserve existing audit failures in the record; an unrelated functional pass does not clear them.
5. Update English and Simplified Chinese formal documents together when behavior changes. Keep historical investigations and incident details in dated local records, with raw logs and baselines in ignored `output/`.
6. For execution or browser behavior changes, run the isolated acceptance procedure. For installer, updater, or service changes, use a disposable VM or dedicated test OS as required by the release manual.
7. Review the final diff. Report changed behavior, checks passed, checks failed, checks not executed, and remaining risks separately.

Do not commit credentials, cookies, browser profiles, raw prompt contents, unredacted logs, local configuration backups, or production baselines. Store copied historical test source as text, such as `.test.ts.txt`, so test discovery cannot execute it.

Development records under `dev-notes/` remain outside Git. Formal documentation must explain current behavior without relying on a private worklog. Follow [AGENTS](../AGENTS.md) when maintaining these records during automated work.

<a id="design-requirements"></a>

### Design requirements

| Requirement | Acceptance condition |
| --- | --- |
| Product scope | The change serves ChatGPT web model integration with Codex. |
| Explicit selection | Model, effort, route, and connector selection remain explicit; unsupported requests produce an error. |
| Tool authority | Tools originate from the active Codex task and remain subject to its sandbox and approvals. |
| Mode boundaries | Browser-only has no local tool capability. Available Web efforts retain the same task-bound MCP capability in MCP Bridge. |
| Environment isolation | DEV uses the shared implementation with separate data, credentials, endpoints, and verified process ownership. |
| Platform support | Changes preserve supported native packaging and state which platforms were actually tested. |
| Documentation | Changed behavior is reflected in both language versions and affected diagrams. |

### Desktop visual system

Maintain colors, typography, dimensions and motion durations in `launcher/src/tokens.css`. The interface uses graphite surfaces with neutral gray buttons and selection states. Green, orange and red convey healthy, warning and error states. Selection also uses a background, border or marker rather than color alone. Keep page headings, controls and content spacing consistent; place feature-specific styles beside their components.

Review both languages, wide and narrow windows, long content, errors and disabled states, as well as keyboard focus, hidden navigation and the system reduced-motion preference. Run `node launcher/scripts/smoke-workspace.mjs` to exercise the UI with an independent browser and mocked IPC; set `WORKSPACE_SMOKE_OUTPUT` to the task's evidence directory. Capture screenshots after page and sidebar transitions have settled. These checks do not establish authenticated ChatGPT, native embedded-browser or installer acceptance.

<a id="automated-checks"></a>

## Automated checks

| Command | What it checks |
| --- | --- |
| `bun run check-version` | Version, Bun pin, release identity, and required metadata consistency. |
| `bun run typecheck` | Core TypeScript. |
| `bun run test` | Core tests under `./tests`. |
| `bun run launcher:typecheck` | Launcher TypeScript. |
| `bun run launcher:test` | Launcher fixtures under the Node test runner. |
| `bun run audit` / `bun run launcher:audit` | Root and launcher dependency advisories. |
| `bun run build` | Relocatable runtime bundle in `dist/runtime`. |
| `bun run launcher:build` | Launcher typecheck and renderer build. |
| `bun run smoke` | Relocated runtime and resource checks using isolated smoke data. |
| `bun run verify` | Version check, both audits, typechecks, tests, renderer build, temporary runtime build, notices generation, and runtime smoke. |

`verify` stops at the first failure. If it fails, record the failing stage and explicitly identify later stages that did not run. Run independently useful remaining checks separately when appropriate; do not describe a partial run as a full verification pass. It does not perform all platform packaging or authenticated release gates.

The core command runs `bun test ./tests`, restricting recursive discovery to the maintained core test tree. Desktop tests use `launcher/scripts/test.cjs`, which recursively collects only `.test.cjs` files under `launcher/tests/` and passes that list to Node. These entry points do not scan generated packages, evidence directories, or other source copies. Keep new tests in the matching responsibility group without merging the Bun and Node execution boundaries.

Use explicit relative paths for focused Bun tests:

```bash
bun test ./tests/adapters/chatgpt-web/conversation/retained-compaction.test.ts
node --test launcher/tests/installation/runtime-install.test.cjs
```

Avoid bare test-name filters that could discover source copies under ignored directories. On Windows with Bun 1.4.0, await broker I/O before assertions and use `node:assert/strict`'s `rejects` for pipe failures. Bun promise matchers can hang inside pipe callbacks. Preserve result/error assertions and run affected cases separately as well as in the full suite.

`bun run app:package` builds a native desktop artifact. `bun run app:smoke` is a platform package check, and on Windows it actually runs the NSIS installer. Run installer-bearing checks only in a disposable VM or dedicated test OS. See [release validation](release.md) before using either command for acceptance.

<a id="change-validation"></a>

### Verification by change type

| Change | Required evidence |
| --- | --- |
| Application behavior | Relevant regression tests and `bun run verify`; explain every failed or unexecuted check. |
| Tool execution, continuation, or cancellation | Authenticated DEV task evidence using the shared implementation, including relevant command/file results and lifecycle state. |
| Browser integration | Observed DOM or protocol evidence and a reproducible fixture; do not broaden selectors on speculation. |
| Desktop UI | Type/build checks, affected tests, and a rendered review in an isolated profile. |
| Packaging or installation | Tests with the embedded runtime, native package validation, and disposable-OS acceptance under the [release procedure](release.md). |
| Documentation only | Link/anchor checks, equivalent bilingual examples, source verification of changed claims, and visual review of affected diagrams. Run affected documentation-dependent checks. |
| Dependencies | Both lockfiles and dependency audits, plus affected integration and packaging checks. |

Simulators, fixtures, static package inspection, and real operating-system acceptance establish different kinds of evidence. State which were performed; an earlier successful audit or release does not establish that the current change passes. See the [release evidence table](release.md#validation-evidence) for the limits of each category.

### Runtime validation priorities

Test the layer affected by the change. Startup checks must distinguish visible-window time, runtime readiness, and ChatGPT readiness. A warm-start receipt is an integrity optimization, not a signature or a full dependency scan. Windows production startup must report installer repair requirements rather than deploy a runtime itself.

Conversation changes need real tool-result rounds, later user turns, replay protection, cancellation, and compaction coverage. Reuse and Save to history are independent settings; model/effort changes and a new compaction epoch may require a new browser page. Model changes must verify actual account/browser support and preserve native Codex catalog rows. Use the detailed [release checklist](release.md) for acceptance criteria and the [troubleshooting guide](troubleshooting.md) for diagnosis.

<a id="dev-profile"></a>

## DEV profile and startup

Start runtime development with:

```bash
bun run dev:launcher
bun run src/cli.ts dev status --json
```

In a source checkout, the first command starts the working-tree Electron application and shared runtime with the development profile. It does not install over the desktop application. `bun run app` starts the regular source application and is not a development acceptance entry point.

An explicit `WEB2HARNESS_LAUNCHER_EXECUTABLE` can select a separate packaged executable. It must contain the DEV implementation being tested. A packaged CLI launches its selected launcher with `--dev-profile`. After changing loaded runtime or browser-helper code, rebuild as needed, fully close only the verified DEV instance, reopen it, and confirm readiness. Persistent helpers keep their loaded code across requests.

Confirm the window is labelled **Web2Harness DEV**. Sign in to ChatGPT independently, run the browser smoke test, and apply the DEV configuration in **Connection & Models**. New configurations default to **Native Tools**. Use **Automatic** interaction for native tools; **Zero Risk** requires MCP Bridge. Finish active tasks before changing tool mode. Applying configuration refreshes the DEV route and runtime. Switching back to Native Tools stops the tunnel while retaining private MCP profiles.

DEV setup writes the route and interrupt hook only into DEV's Codex home. It supervises the same daemon implementation and allocates its own loopback port. A busy selected port is an error, not permission to stop another process. Profiles still using the unbound legacy `17841` DEV setting require setup in the DEV window; the runtime refuses to bind that legacy port and does not probe or control it.

The default layout is:

```text
~/.web2harness-dev/
├── config.json
├── codex-home/          # DEV Codex configuration, file credentials, sessions, caches
├── launcher/            # DEV Electron data, ChatGPT login, logs, window state
├── workspace/           # default working directory for dev codex
├── workspaces/<name>/   # dedicated real Codex chat fixtures
├── chats/<name>.json    # simulator history only
├── runtime/             # descriptors, ownership, diagnostics
└── tunnel/              # optional DEV tunnel
```

`WEB2HARNESS_DEV_HOME` selects a different DEV root. Overlap with production paths is rejected, including nested paths and symlink/junction aliases. Browser partitions, instance locks, broker endpoints, and supervision state are separate. The server requires the DEV descriptor and matching DEV bridge/Codex homes before binding. DEV does not automatically install/update the desktop app or enable login startup; production integration removal is disabled in its UI.

<a id="standard-isolated-test-procedure"></a>

## Standard isolated test procedure

![DEV and regular operation share code while keeping identities, data, endpoints, and fixtures separate](../assets/diagrams/isolation.svg)

This is the required contract for development, regression, and live acceptance. Isolation changes configuration, credentials, browser data, endpoints, process ownership, and fixture workspaces; the runtime implementation remains shared.

1. **Capture the baseline before live testing.** Record hashes of production Codex configuration and authentication, production bridge configuration existence/hash, and relevant process IDs, executable paths, start times, and service identities. Include configured non-default production paths. Record absent files/processes as absent. Never print credential contents. Save raw evidence only in ignored `output/` or private DEV storage.
2. **Run applicable automated checks.** Use explicit test paths and temporary test homes. Optional headless DOM checks use fresh temporary browser profiles. Record audit failures independently of functional results and attempt the applicable verification gates.
3. **Start and verify DEV ownership.** Use `bun run dev:launcher` and inspect `dev status --json`. Validate the current descriptor, `development` profile, PID, executable, DEV userData, both DEV homes, and independently allocated loopback listener. A familiar port, old log, title, or PID alone does not prove ownership. Complete independent DEV login if required.
4. **Load the changed code and verify readiness.** Rebuild and restart only DEV after runtime/helper changes. Confirm the DEV doctor/readiness result and browser smoke before a real task. Do not test through a persistent daemon running stale code.
5. **Prepare an owned fixture.** Put inputs under `DEV_HOME/workspaces/NAME` and use `bun run dev:chat` or `bun run dev:codex` with that explicit working directory and an available Web model. Keep Codex sandbox and approval enforcement enabled. Do not target the user's working project or production data.
6. **Prove the changed behavior.** Execution changes require read → native patch → command assertion → final response evidence, including tool events and the resulting file. Lifecycle/cancellation changes require an active DEV cancellation, terminal cancellation with zero active turns, and a new real Codex request without restarting the service. Continuation/compaction changes additionally require the relevant real continuation/compaction path. Bound fault injection to one verified DEV browser target or owned transport. MCP tests also require the remote-isolation checks below.
7. **Compare the production boundary.** Recheck baseline hashes and process identities. Investigate differences; do not restore or overwrite production from a backup. Do not compare active history or log files, which may legitimately change. Cancel/close only verified owned test resources. Preserve existing work and evidence.
8. **Record the result and handoff.** Update the worklog with actual outcomes and remaining issues. Separate automated, fixture-browser, simulated, and authenticated live checks. Mark each as passed, failed, or not executed; process exit code zero and a model's success claim alone are not live end-to-end evidence.

### Protected production boundary

The installed Web2Harness application and every working Codex session are protected. Development permission does not authorize controlling them or changing their configuration, authentication, routes, hooks, browser profile, services, or processes. Never temporarily install a DEV route into production, copy production authentication, or use historical production-testing commands.

Do not change global Codex/Bun/Electron installations, OS credentials, system sandbox users, services, firewall, proxy, DNS, shared network settings, or unrelated projects to make a test pass. Do not disconnect the computer or change a shared browser context for fault injection. Do not cancel by process name, sweep ports, or kill a process tree without verified DEV ownership.

No bulk deletion or general workspace cleanup is authorized. Fixture teardown may remove only individually owned temporary artifacts created by that test, after checking resolved paths. Preserve existing profiles, workspaces, and evidence. Installer, updater, clean-install, upgrade, and system-service tests that cannot preserve these boundaries require a disposable VM or dedicated test OS.

DEV credentials are independently obtained and file-based. Never copy production authentication, MCP configuration, plugins, history, or active task IDs. Windows sandbox overrides, if needed, belong only to the DEV child command; do not disable sandbox enforcement or change machine/production settings.

Isolation does not reserve physical capacity. CPU, memory, bandwidth, and account quotas may still be shared. Run authenticated acceptance sequentially, keep workloads bounded, and avoid stress tests while the user is working.

<a id="mcp-bridge-isolation"></a>

### MCP Bridge isolation

Before enabling MCP Bridge, obtain explicit user confirmation that the selected tunnel ID is DEV and inspect the actual selected connector binding from the independently logged-in DEV browser. Both must match. A DEV path, alias, or connector display name alone does not establish remote isolation.

If a supplied destination is identified as production, stop only the owned DEV connection immediately and verify its exit. Record possible remote impact separately from local file/process checks. Resume with Native Tools until a correct DEV destination is confirmed; never reuse stale MCP configuration during recovery.

<a id="real-codex-tasks"></a>

## Real tasks and simulator

DEV uses the installed Codex CLI. `WEB2HARNESS_CODEX_EXECUTABLE` can select a native executable or npm JavaScript entry when discovery is unavailable. Arguments are passed without shell interpolation.

```bash
bun run dev:codex --version
bun run dev:codex login
bun run dev:chat acceptance
bun run dev:chat acceptance --model gpt-5.6-sol "Read notes.txt and summarize its contents."
bun run dev:codex resume
```

The example model must be available on the DEV account; check the [model reference](reference.md). Named real chats use `DEV_HOME/workspaces/NAME`. Without a message, they open the Codex TUI; with a message, they run `codex exec`. Reusing a name reuses files, not automatically a conversation. Use Codex resume for continuation.

`dev codex -- ...` forwards Codex arguments verbatim. Its default working directory is `DEV_HOME/workspace`; an explicit `--cd` selects another dedicated fixture. This does not grant extra filesystem permission or disable the sandbox. Native Codex commands without an explicit Web model retain normal model selection.

An offline real-Codex relay fixture is available as `bun run scripts/smoke-dev-codex.ts`. It uses a fixture browser and fake test authentication, requires an actual patch file, and does not read production credentials. `--expect-read-only` checks a sandbox rejection round trip where writes are unavailable; it is not successful write acceptance. Neither form proves authenticated ChatGPT execution.

On Windows, a supported restricted-token sandbox can be selected for this DEV child only if the elevated sandbox cannot initialize:

```powershell
bun run scripts/smoke-dev-codex.ts --windows-sandbox=unelevated
bun run dev:codex -a never -c 'windows.sandbox="unelevated"' exec --sandbox workspace-write --model chatgpt-web/gpt-5.6-sol --cd C:/absolute/dev/fixture "Your test task"
```

<a id="simulator"></a>

### Explicit simulator and experiments

```bash
bun run dev:chat browser-lab --simulate
bun run dev:chat smoke --simulate "Reply with exactly: DEV READY"
bun run src/cli.ts dev list
```

Only `--simulate` uses `DevChatDriver` and simulated tool receipts. Every simulated tool result reports `simulated: true` and `side_effects_performed: false`; it cannot prove actual patch or command execution. With MCP Bridge, the simulator connects to the daemon-owned DEV broker as a client; exiting it leaves the daemon and tunnel running.

| Simulator command | Purpose |
| --- | --- |
| `/status` | Inspect the simulator session. |
| `/fill 30000` | Add inert context locally. |
| `/send-fill 12000` | Send generated context through the real browser. |
| `/compact` | Exercise browser compaction; unavailable for Luna's rolling checkpoint. |
| `/model high` | Change the simulator model selection. |
| `/reset yes` | Reset the named simulator chat. |
| `/help`, `/exit` | Show commands or leave the simulator. |

Configure Context as File, Skills as files, reuse/history preferences, and interaction mode in DEV preferences using the same settings as regular operation. Context as File defaults off; Standard is the default budget, and Triple requires explicit selection. Its upload threshold remains 80% of the ordinary single-message token or character budget. File contents remain part of token accounting. Automatic interaction is required and Luna is unsupported. See the [configuration reference](reference.md) for the complete contract.

DEV setup supports `--context-files` / `--no-context-files` and `--context-triple-budget` / `--standard-context-budget`. Change only the isolated profile and restart its Codex client to refresh the catalog. Browser experiments still consume real account quota.

<a id="naming-and-compatibility"></a>

## Naming and compatibility

| Use | Canonical value |
| --- | --- |
| Product name | **Web2Harness** |
| Repository and core package | `web2harness` |
| CLI command | `web2harness` |
| Repository | `cmyk-labs/web2harness` |
| Repository folder display name | `Web2Harness` |
| Desktop package | `web2harness-launcher` |
| Linux desktop command | `web2harness-desktop` |
| Environment variable prefix | `WEB2HARNESS_` |
| Regular core home | `~/.web2harness` |
| DEV core home | `~/.web2harness-dev` |
| Regular Electron userData name | `Web2Harness` under the OS application-data directory |
| Regular browser partition | `persist:web2harness-chatgpt` |
| DEV browser partition | `persist:web2harness-dev-chatgpt` |
| Regular / DEV window identity | `Web2Harness` / `Web2Harness DEV` |
| Application ID | `dev.web2harness.launcher` |
| Windows installer GUID | `8b7be269-ac7f-4ab6-82e9-71408ffa370b` |
| Windows application folder / executable basename | `Web2Harness` |
| Daemon service identity | `io.github.web2harness.daemon` |
| Desktop artifact pattern | `web2harness-${version}-${os}-${arch}.${ext}` |

Retain the digit **2** and exact capitalization of the product name. Use lowercase package/command names in technical contexts. The Linux desktop command and CLI are different entry points. Runtime archive names and platform architecture aliases are defined in the [release matrix](release.md#native-target-matrix).

Treat application IDs, installer GUIDs, service labels, storage roots, browser partitions, and environment prefixes as compatibility boundaries. Do not rename them as a documentation cleanup or infer that a renamed label authorizes reading another application's data. DEV identity and data remain separate under the [isolation procedure](development.md#standard-isolated-test-procedure).

### Technical terminology

| Term | Meaning in documentation |
| --- | --- |
| Web2Harness | The project and application. |
| Launcher | The desktop control surface and embedded browser host. |
| Runtime / daemon | The supervised local service implementing the Responses bridge. |
| Native Tools | The mode in which the real Codex client executes its native tools. |
| MCP Bridge | The mode using the configured connector and tunnel for tool transport. |
| Browser-only | The limited browser conversation mode without local tool execution. |
| Automatic / Zero Risk | Interaction mode labels; use the exact UI label when giving steps. |
| DEV | The isolated development profile, not a different implementation. |

Keep configuration keys, CLI flags, model IDs, file paths, and API fields literal in both languages. Translate explanatory prose and diagram labels. Use **ChatGPT** and **Codex** with their established spelling; distinguish account-visible browser capabilities from native Codex capabilities. See the [model reference](reference.md) and [usage guide](user-guide.md).

Use one reader-facing mode name in explanatory prose and comparison tables. Reserve machine values and flags for configuration definitions, constraints and command examples. Do not append an identifier or a translated synonym to a display name unless the text is specifically explaining that mapping.

MCP Bridge is the current mode name. Legacy serialized mode values belong only in the centralized migration module and its migration tests. New configuration, CLI options, runtime branches, and user-facing text use the current name. Unrelated third-party interfaces and license text are outside this mode-naming rule.

<a id="documentation-and-assets"></a>

## Documentation and asset maintenance

Documents use task-oriented headings, concise operational prose, code fences for executable commands, and tables for parallel properties or comparisons. Explain prerequisites, expected results, failure handling, and verification where they affect the task. The project README retains its existing hero, logo, slogans, introductory brand copy, download buttons, and language entry points. Preserve these assets and their visual design exactly during documentation maintenance. The restrained technical style below applies to manuals and technical diagrams; it does not redesign the README brand area or application icon.

Use the same information order in English and Simplified Chinese. Each manual links to its language pair and the README documentation entry, and provides a short page-local contents list with stable anchors. Update both versions together when a procedure, identifier, default, or limitation changes. A translation must preserve warnings, conditions, and evidence limits rather than shorten them away.

Use the following palette for maintained documentation diagrams:

| Element | Color |
| --- | --- |
| Canvas | White `#FFFFFF` |
| Primary titles and key boundaries | Navy `#18324F` |
| Main text | Dark gray `#334155` |
| Secondary text | Gray `#64748B` |
| Neutral component fill | Light gray `#F4F6F8` |
| Borders and secondary connectors | Gray `#CBD5E1` |

Give component boundaries and arrows a clear operational meaning. Use readable labels, consistent alignment, sufficient spacing, and restrained line weights. Avoid gradients, glow, decorative textures, and unrelated accent colors. Do not rely on color alone to distinguish trust boundaries or execution paths. Keep diagrams understandable when printed or viewed in grayscale.

Architecture diagrams should identify the participating process/service, transport, and direction of flow. Sequence diagrams should state which component owns an action and where tool results return. Use a legend only when symbols or line styles need explanation. Label environment boundaries explicitly so DEV and regular operation cannot be confused. The [architecture manual](architecture.md) owns the technical content.

Keep the six primary manuals—usage, troubleshooting, reference, architecture, development, and release—directly under `docs/`. Maintain each detailed rule in the manual that owns its subject and link to it elsewhere. README provides direct links to contribution requirements in this manual and vulnerability reporting in the release manual. Technical trust boundaries belong in the architecture manual; AGENTS governs automated work. Do not add separate documents that duplicate these sections or only redirect readers. Dated evidence in `dev-notes/` does not replace current instructions.

Keep assets by purpose in root `assets/brand/`, `assets/readme/`, `assets/demos/` and `assets/diagrams/`; maintain diagram JSON with its SVG. Generators belong in `scripts/`, and platform installation and launch scripts belong in `launcher/packaging/`. Do not duplicate assets in individual modules. Renderer imports select the required icons and videos. Explicit Electron packaging mappings retain the installed `assets/` paths for application/tray icons and the Linux runner, without bundling README demonstrations, diagram sources or documentation assets.

Demonstrations should reflect supported behavior. When an older recording is temporarily retained, label its potentially outdated interface and model names and replace it after rerecording. An older recording does not establish current-version acceptance.

<a id="technical-diagrams"></a>

### Technical diagrams

The manuals use six diagrams in English and Simplified Chinese. Checked-in SVGs are standalone images; readers need no diagram application or generation tools.

| File stem | Question answered |
| --- | --- |
| `system-context` | Where does inference occur, and who executes local tools? |
| `components` | Which component owns each responsibility and tool transport? |
| `request-sequence` | How do tool requests, execution results, and final answers return? |
| `conversation` | When is a web conversation reused, and how is compaction separate? |
| `installation` | What happens during installation, recovery, and a normal Windows launch? |
| `isolation` | How do regular use and DEV share code while keeping state and ownership separate? |

Maintain the JSON files under [`assets/diagrams/sources/`](../assets/diagrams/sources/). The [generator](../scripts/render-technical-diagrams.mjs) renders each source directly to its matching SVG; do not edit SVG independently. It has no diagram-framework dependency and does not infer relationships or add lifecycle transitions.

```bash
node scripts/render-technical-diagrams.mjs
node scripts/render-technical-diagrams.mjs --check
node scripts/render-technical-diagrams.mjs --check --preview
```

Generation and byte-for-byte consistency checks require Node.js only. Preview also uses the repository's `playwright-core` and an installed Chrome/Chromium; `DIAGRAM_BROWSER` can select an existing executable. It launches an independent headless browser context without user authentication, blocks network requests, checks actual text bounds, and writes PNG previews and validation results to ignored `output/docs-diagrams-v2/`.

| Source field | Meaning |
| --- | --- |
| `schemaVersion`, `kind`, `locale` | Source format, diagram purpose, and authored language. |
| `title`, `description` | Visible title and accessible description. |
| `width`, `height` | Canvas dimensions; check readability at normal document width. |
| `groups` | Named environment or responsibility boundaries with explicit rectangles. |
| `nodes` | Components or steps with titles, body lines, rectangles, and optional visual roles. |
| `edges` | Explicit endpoint IDs and orthogonal points; optional labels, direction, and line style. |
| `lifelines` | Vertical participant lines for sequence diagrams. |
| `notes` | Visible conditions, exclusions, and line-style explanations. |

Labels use center coordinates and a maximum text width; wrapping must preserve the complete label. Arrows must reach the relevant node or boundary, and a group-level arrow applies to that scope. Explain solid and dashed lines. A bidirectional channel does not grant shared execution authority. Put conditions on branches instead of using a footnote to correct an unconditional arrow.

Keep IDs, geometry, relationships, and conditions aligned between languages. Translate explanatory text while preserving product names, code identifiers, paths, and protocols. Compare the diagram against its manual and the implementation modules identified in the [architecture manual](architecture.md); check endpoints, directions, component ownership, return paths, and exception handling. Regenerate both languages, run the consistency check, and inspect previews at normal document width. Resolve source or layout failures without hiding overflow or making text unreadable. Update adjacent explanations and alternative text when scope changes, and maintain JSON and SVG together. Successful rendering establishes neither semantic correctness nor runtime acceptance.

<a id="application-assets"></a>

### Application assets

| Asset | Purpose and invariant |
| --- | --- |
| [`brand-mark.json`](../assets/brand/brand-mark.json) | Canonical vector outline of the H mark. Preserve its geometry. |
| [`app-icon.svg`](../assets/brand/app-icon.svg) | White H mark on a black plate, 22% corner radius, transparent exterior corners. |
| [`icon.png`](../assets/brand/icon.png) | Main 1254 × 1254 RGBA application icon. |
| [`icon.ico`](../assets/brand/icon.ico) | Windows icon with 16, 24, 32, 48, 64, 128, and 256 px RGBA layers. |
| [`iconTemplate.png`](../assets/brand/iconTemplate.png), [`iconTemplate@2x.png`](../assets/brand/iconTemplate@2x.png) | Transparent macOS tray templates at 18 and 36 px. |

The documentation palette does not recolor the application icon. Preserve the existing logo identity, proportions, transparent corners, and platform-specific asset conventions. Do not substitute another mark or treat a checkerboard background as alpha transparency.

Regenerate the main raster icon and ICO from their maintained source:

```bash
node scripts/render-icons.mjs
```

The script requires the repository's `playwright-core` and an installed Chrome browser; `CHROME_PATH` can select an existing executable. It uses a fresh browser context rather than saved login state, checks the canonical H path, verifies transparent corners and icon layers, and writes validation artifacts under ignored `output/rounded-icon`. It does not regenerate the tray templates. Review generated images at small and large sizes before committing asset changes.

### Identity checks

For naming or visual changes, verify that both languages use the same identifiers, diagram labels match the implementation, icons retain the canonical mark, and package metadata still agrees with the [release manual](release.md). Run `bun run check-version` when changing package or release identity metadata, and applicable launcher tests for asset/configuration changes.

Keep the root [`LICENSE`](../LICENSE) and attribution files under [`LICENSES`](../LICENSES) intact. Naming and visual edits must not alter copyright notices or license terms. Release packages must retain the required license material.
