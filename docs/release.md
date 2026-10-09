# Release manual

[English](release.md) | [简体中文](release.zh-CN.md) · [Documentation](../README.md#documentation)

Follow this manual to prepare, build, validate, publish, and recover a release candidate, and to report and handle security issues. Each candidate requires reproducible native artifacts, runtime and installer checks, authenticated account acceptance, and accurate publication metadata. CI, fixture results, and historical releases do not replace candidate-specific acceptance. This manual states requirements, not completed test results; routine source work is covered by the [development manual](development.md).

**Contents**

- [Validation environments and evidence](#validation-evidence)
- [Version and source preparation](#source-preparation)
- [Native target matrix](#native-target-matrix)
- [Runtime and packaging checks](#runtime-packaging)
- [Startup and integrity checks](#startup-integrity)
- [Authenticated runtime acceptance](#authenticated-runtime)
- [Windows installation, recovery, and uninstall](#windows-installation)
- [Platform account acceptance](#platform-acceptance)
- [Signing, licenses, and checksums](#signing-checksums)
- [Publication and updater visibility](#publication)
- [Withdrawal and rollback](#rollback)
- [Security maintenance and vulnerability reports](#security-maintenance)

<a id="validation-evidence"></a>

## Validation environments and evidence

Use the [standard isolated test procedure](development.md#standard-isolated-test-procedure) for development and account-bound runtime checks. Use a disposable VM or dedicated test OS for clean installation, upgrade, repair, uninstall, updater, and system-service acceptance. Give it independent Codex and browser state. Never install a test route into the user's normal Codex, modify their desktop installation, or use its credentials.

| Evidence class | What it establishes | What remains separate |
| --- | --- | --- |
| Core and launcher fixtures | Deterministic behavior under controlled dependencies. | Real browser/account behavior and OS installer transactions. |
| Relocated runtime smoke | Embedded runtime, required resources, basic HTTP and lifecycle contracts after relocation. | Authenticated tool execution and installer recovery. |
| Native package smoke | Package starts and produces the expected readiness marker on the tested OS. | Interactive login, real Codex turns, upgrade/repair/uninstall coverage. |
| Authenticated DEV acceptance | Real browser/model/tool behavior in the isolated shared runtime. | Installed package, updater, service, and system integration gates. |
| Disposable-OS acceptance | Actual installer and installed application behavior for the tested scenario. | Other untested platforms, versions, account plans, or architectures. |

For each candidate, record version, source commit/tag, artifact SHA-256, OS version/architecture, clean/upgrade path, previous installed version, Codex version, ChatGPT plan, enabled mode, and each result. Keep passed, failed, and not-executed checks separate. Include redacted failure logs and reproduction steps; never publish cookies, tunnel IDs, API keys, bearer tokens, credentials, or prompt contents. Keep raw evidence and production baselines in ignored local storage.

Any required failed or unexecuted gate blocks a stable release. A public preview must name its incomplete/failed gates, user-visible limitation, and recovery path. Dependency audit failures remain visible independently of functional checks. Historical results never substitute for a candidate's own evidence.

<a id="source-preparation"></a>

## Version and source preparation

1. Choose the version and synchronize root/launcher manifests, `src/version.ts`, installer defaults, and other fields enforced by `scripts/check-version.ts`. A release tag must equal `v` plus the root package version.
2. Use the pinned Bun `1.4.0` and both frozen lockfiles. Record the source revision and keep candidate builds separate from unrelated local changes.
3. Run `bun run verify` and inspect every stage. It stops at the first failure; later stages are unexecuted until run separately.
4. Confirm the intended repository identity in launcher metadata. The release workflow passes its repository to packaging. Installer scripts require an explicit `WEB2HARNESS_REPOSITORY` and reject missing/invalid configuration before installation work.
5. Preserve earlier candidate artifacts before rebuilding. Packaging replaces matching generated files in `launcher/artifacts`; use an owned build workspace and do not treat that directory as an evidence archive.

```bash
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run check-version
bun run verify
bun run build
bun run launcher:build
bun run app:package
```

`build` writes `dist/runtime`. `app:package` rebuilds the launcher and its embedded runtime, prepares platform helpers, then creates distributables in `launcher/artifacts`. It does not publish them; the wrapper passes `--publish never` to electron-builder. The package manifest's nominal `release` output directory is overridden by the wrapper's temporary staging directory.

<a id="native-target-matrix"></a>

## Native target matrix

The [release workflow](../.github/workflows/release.yml) builds these targets on matching native runners. Cross-OS packaging is rejected because each launcher contains a native Bun runtime.

| Native target | Workflow runner | Installer suffix | Update archive suffix |
| --- | --- | --- | --- |
| Windows x64 | `windows-latest` | `-win-x64.exe` | Uses the installer |
| macOS arm64 | `macos-15` | `-mac-arm64.dmg` | `-mac-arm64.zip` |
| macOS x64 | `macos-15-intel` | `-mac-x64.dmg` | `-mac-x64.zip` |
| Linux x64 | `ubuntu-latest` | `-linux-x64.AppImage` | Uses the AppImage |
| Linux arm64 | `ubuntu-24.04-arm` | `-linux-arm64.AppImage` | Uses the AppImage |

Filenames begin with `web2harness-${version}`. Publish exactly these seven packages and `checksums.txt`; GitHub adds two source archives automatically. Do not upload separate runtime archives, installer scripts or license files. Licenses remain inside every package, and installer scripts remain in the versioned source. The configured macOS minimum is 13.0. A build target is not a claim that interactive acceptance has passed on every supported OS version.

The macOS terminal installer extracts the runtime from its architecture's desktop ZIP, checks its SHA-256 and version, and preserves the embedded licenses. It downloads the complete ZIP but installs only the runtime. Each native macOS job runs `node launcher/scripts/smoke-cli-install.cjs` against the actual package with isolated paths and fixture downloads: fresh installation, repeat installation, checksum rejection and license preservation must pass.

Windows CI prepares an AVX2-independent Bun using `scripts/prepare-windows-baseline-bun.ps1`. The selected embedded executable must report the pinned version; `WEB2HARNESS_EMBEDDED_BUN`, when used, must be an absolute path. Do not update global Bun to change a candidate's embedded runtime.

Linux builds prepare compatible libnotify and an owned AppImage toolset using the workflow's preparation scripts. arm64 requires an absolute `APPIMAGE_TOOLS_PATH` and compatible `libnotify.so.4`. Retain the AppImage symbol/ABI checks, including the x64 current-Arch container check. Package smoke uses `xvfb-run`. Provision these dependencies on the build host or disposable test OS, not by changing the user's working machine for acceptance.

<a id="runtime-packaging"></a>

## Runtime and packaging checks

### Relocatable bundle

`scripts/build-runtime-bundle.ts` builds the CLI and browser helper, installs production dependencies, embeds Bun, and writes a manifest with file hashes and bundle identity. Validate the relocated bundle, not just the source tree:

```bash
bun run smoke
```

The smoke checks version identity, manifest, absence of ephemeral build paths, tokenizer/Playwright/MCP/Markdown resources, helper loading, HTTP fallback and failure behavior, authenticated lifecycle control, and graceful shutdown. Keep executable resources and licenses in the pruned bundle. A helper that loads successfully is not evidence that native installation or a real tool turn works.

### Windows embedded Bun regression

Windows `app:package` includes `launcher`'s `build:runtime`, which runs `scripts/build-windows-helpers.ts`. That script builds the independent setup/uninstall helpers and runs the shared installation, runtime-deployment and uninstall suites with the exact Bun binary embedded in the package:

```powershell
& .\launcher\build\runtime\runtime\bun.exe test ./launcher/tests/installation/windows-install.test.cjs ./launcher/tests/installation/runtime-install.test.cjs ./launcher/tests/installation/windows-uninstall.test.cjs
```

This gate is mandatory and stops package creation on failure. `bun run verify` runs launcher tests under Node; that result does not replace the embedded-Bun gate. Verify fresh deployment, same-version replacement/repair, copy and receipt failures, repeated cancellation, and retry after a setup process exits without rollback. Do not replace these tests with helper load-only probes. Fixtures still do not satisfy actual NSIS acceptance.

### Native package smoke

Run the candidate on its matching test OS:

```bash
bun run app:smoke
```

On Windows this command executes the actual NSIS installer silently with `/S /currentuser` and looks up its installation registration. It must run only in a disposable VM or dedicated test OS. Isolated runtime environment variables do not isolate the installer transaction. Package readiness markers must identify the expected version/platform and verified installed runtime.

Installation and application startup use the same temporary data directories. On failure, the harness exports command results and the application logs through the shared log sanitizer to `output/package-smoke/` before removing its temporary workspace. It excludes browser profiles, credentials and environment dumps. If export fails, the workspace is retained and its path is printed. CI and release builds upload these diagnostic reports for seven days; inspect the fatal log and failure report before retrying. A successful smoke run removes its temporary workspace without publishing diagnostics.

The startup check allows 45 seconds for the application to start, verify its runtime, and exit through the normal shutdown sequence. Windows silent installation has a separate 120-second limit; the embedded runtime version check has a 30-second limit. A readiness marker alone is insufficient: a failed or stalled shutdown must fail the check.

Windows update acceptance must also exercise the in-app path on the disposable OS. Check the blue sidebar action, active-task blocking, download failure and retry, then the independent installer progress window in English and Chinese. The update path must skip configuration and finish pages and reopen the app exactly once after success; failure/cancellation must preserve recovery behavior. Test both an older updater such as 1.0.1 (which still invokes silent installation) and the new visible updater. Manual installation and `/S /currentuser` must retain their normal behavior.

During replacement, inspect both desktop and Start Menu shortcut icons and confirm their icon files remain available outside the application directory. Test a user-deleted shortcut, an unrelated same-name target, rollback after icon migration, same-version repair, and full-data uninstall. Review `setup-timings.jsonl` for backup, application replacement and runtime verification/copy durations. Source tests, private `.lnk` fixtures and a successful NSIS compilation do not establish Explorer rendering, wizard flow or real update acceptance.

Shell entry points must be committed with Git mode `100755`. Linux workflows check executable permissions immediately after checkout. When reinitializing a repository on Windows, explicitly restore the executable bits; local Windows checks cannot verify POSIX execution permissions.

<a id="startup-integrity"></a>

## Startup and integrity checks

- Measure shortcut-to-visible-window, runtime-ready, and ChatGPT-ready separately. Show the local startup screen during preparation; workspace/onboarding must not flash early. Transition in the same window after initialization and snapshot completion, without an artificial minimum delay. Runtime-dependent IPC must reject early calls.
- Verify saved/system language, stage-local progress/file counts, activity for stages without measurable totals, and reduced-motion behavior. Normal warm launches must not display a complete installation step list.
- Verify stage timings and repair reasons in logs. Failures stop progress and offer expandable details, safe log export, and restart. Exercise log export cancellation/failure. Quitting during preparation must finish the installation transaction before exit.
- Fresh deployment hashes source and temporary copy once each, commits atomically, and rolls back if the receipt fails. Access/disk failures must be explicit. A corrupt source must not enter repeated full-tree hash retries. Test delayed file readiness without repeated scans.
- A warm launch compares package/installed manifest and receipt identity and checks four startup entries: Bun, CLI, browser helper, and command launcher. It must not walk `node_modules`. Test missing receipts, damaged entries, and changed bundle identity at the same version.
- Installation, upgrade, repair, and explicit diagnostics must validate the complete bundle. A receipt is not a cryptographic signature or protection against another process running as the same user. Non-entry dependency corruption is not covered by lightweight startup checks.
- Failed full diagnostics mark the installation for repair. Windows production startup requests rerunning the installer and must not deploy/repair executable files. Other platforms retain their next-launch repair flow. Never replace executable files while tasks are running.
- Removing Codex integration must retain installed versions/receipts, so the next launch uses the warm path, while configuration and integration credentials are still removed.

<a id="authenticated-runtime"></a>

## Authenticated runtime acceptance

Use isolated DEV for shared-runtime acceptance; repeat installed-app flows on the disposable test OS where required. Use independently obtained credentials. Verify account-visible capabilities rather than inferring support from a model label or a native Codex catalog row.

Before every release, including previews, run the applicable mandatory [capability acceptance cases CAP-001–CAP-005](acceptance-tests.md#release-requirements) on the current candidate and record all passes before pushing a publication-triggering tag or publishing. Preview status does not waive these cases. Add or update cases for new or changed target capabilities. Prompts, evidence criteria, and the candidate result template live in that document; `verify` and release CI do not automatically execute or enforce this manual gate.

### Native Tools

1. Complete [CAP-001–CAP-005](acceptance-tests.md): real parallel reads, native patch and readback, same-cell waiting, and three real parallel child agents with a parent summary, plus explicit model/effort selection, shared budget checks and local receipt recovery. Retain file, tool-event, and read-only boundary evidence.
2. Cancel an active task, confirm terminal cancellation and no active turns, then run a new task without restarting the daemon. Cancelled turns must not revive.
3. Inject a bounded DOM observation timeout into one verified DEV page; confirm it rebinds the same owned page and continues without repeating tools.
4. Interrupt only the owned DEV target/transport for a bounded interval. Require correct continuation or an explicit terminal failure, and record actual outcome, duration, and scope.
5. Exercise automatic compaction, summary installation, and continued native tools in the same daemon. If a child-only threshold is lowered, record that fact; it does not establish default-window capacity or stress tolerance.
6. Compare production config/auth hashes and process identities before/after. Missing or expired test credentials are an unexecuted/failed check, not a product pass.

### Conversation and model behavior

- With Reuse conversation and Save to history, prove at least two actual tool-result round trips plus a later user message use the same ChatGPT conversation ID. Replaying an identical Responses request must not submit a duplicate browser message. Test New each turn separately; history persistence and conversation reuse are independent.
- New configurations and missing history preferences default to Temporary Chat in UI and core configuration. Existing explicit true/false values survive setup and upgrade. Account inspection remains temporary and must not change reuse behavior.
- On a Pro-capable account, verify the supported rows: `GPT-5.6 Sol (Web)`, `GPT-5.6 Sol Pro (Web)`, `GPT-6 (Web)`, and `GPT-6 Pro (Web)`. Both ordinary models default to High. Low/Medium/High/account-supported Extra High must select the correct browser effort; Pro uses fixed Max.
- When account budgets differ, keep Instant separate: Thinking retains 90k/80k and Instant 41k/32k context/compaction budgets. Hidden Instant identifiers must continue old tasks. Reject Max/Ultra on ordinary Sol rather than silently selecting another model. Preserve native model rows, efforts, and budgets.
- Launcher and Codex catalog must agree on supported/default efforts. Verify both GPT-6 routes against the actual `6` or `GPT-6` browser family label. A “Latest” label, slider position, or native Codex model alone does not establish browser family support. See the [model reference](reference.md).

### MCP Bridge and manual interaction

Verify the [DEV tunnel and connector binding](development.md#mcp-bridge-isolation) before any MCP Bridge test. Native Tools evidence does not establish MCP Bridge acceptance.

- Configure the verified independent connector, run **Verify runtime**, and complete an actual local-tool turn. Repeat with Pro when available.
- Clean setup must offer both interaction modes and default to With Automation. In Zero Risk, restart Codex and verify exactly one generic Web model, a retained conversation receiving only the next prompt, and compaction completing through MCP before a fresh manual conversation receives the compacted continuation.
- Inspect the copied manual prompt: it may contain the current `request_id`, but no surface nonce, capability token, or prompt-level lifecycle commands. Returning to Automatic must restore the account-visible catalog.
- Close an active launcher tab to cancel, then separately cancel with the launcher action. Neither cancelled turn may recreate a tab or keep the runtime busy.
- Quit during an active turn using the explicit cancellation path, reopen, and verify the saved browser session and Codex route remain valid.
- Verify Codex Voice can create a WebRTC call while Responses use the local bridge. Disconnect must restore both exact previous route assignments; reconnect must reuse existing private MCP credentials.

<a id="windows-installation"></a>

## Windows installation, recovery, and uninstall

![Windows setup prepares or reuses a runtime, recovers uncommitted transactions, and leaves startup to check readiness](../assets/diagrams/installation.svg)

Run these cases on a disposable Windows test OS, including interactive and silent setup. Do not count static compilation, fixture success, or a readiness marker as a pass for these scenarios.

| Scenario | Required result |
| --- | --- |
| Fresh install, upgrade, same-version repair | Runtime deployment finishes before installer success. First launch only checks readiness, initializes the browser, and enters the workspace; no full-tree hash/copy in the launcher. |
| Valid receipt with damaged non-entry dependency | Rerunning setup detects and repairs damage through complete bundle validation. |
| Copy/runtime failure, busy files, insufficient disk, interrupted setup | Previous program files, runtime/receipt, registration, and shortcuts recover. Failed recovery retains evidence and can recover on the next installer run. |
| Cancellation at each available wizard stage, then retry | Pending installs recover first; a committed install survives closing the finish page. |
| Upgrade from the previous public release | Launcher/browser state, Codex settings, and MCP configuration survive. Ordinary production Codex data remains unchanged. |
| Ordinary uninstall | Data checkbox starts unchecked and is not remembered. Preserve settings, login, runtime; disconnect only Web2Harness and remove its autostart entry. Reinstall requires explicit integration setup and must not silently reconnect archived configuration. |
| Uninstall with explicit data cleanup | Remove owned core/desktop data, NSIS installer cache, and installation record. Preserve Codex auth/history, unrelated configuration, and native cached model rows/metadata. |
| Upgrade/overwrite and silent upgrade | Preserve data/integration without a cleanup page. Generic `--delete-app-data` is rejected; silent ordinary uninstall retains data. |
| Failed uninstall preparation or busy program files | Stop before removal; restore busy program files and keep uninstall registration available for retry. |

Cover active launcher/tasks, orphan runtime drain, changed routes/hooks, missing/corrupt ownership, custom roots, unknown files, junctions, permissions/locks, and partial-cleanup retry. Include empty and populated desktop `secrets` and `passkey-login` directories created by credential and login transfers: ordinary uninstall preserves them, while explicit data cleanup removes them. Links at or inside these directories must stop cleanup before integration or data changes. Never terminate an unverified process. The uninstall helper must work from its private temporary directory even when the installed runtime is unavailable; normal/failed startup must remain reachable after it exits.

<a id="platform-acceptance"></a>

## Platform account acceptance

Windows 11 x64 acceptance must use the packaged candidate and a real account on the disposable test OS: embedded Bun startup, independent embedded-browser login, Temporary Chat composer, model-route installation/catalog refresh without native-model loss, a Browser-only streamed turn, the runtime gates above, and upgrade from the previous public release.

On macOS, repeat login, catalog, Browser-only, MCP Bridge, compaction, manual interaction, cancellation, restart, and route/Voice restoration on the oldest supported OS or closest maintained test machine. Record any coverage gap. Packaging and signing verification remain separate gates.

Linux requires native packaging smoke. Before claiming interactive Linux support, run login, catalog, Browser-only, MCP Bridge, compaction, and manual interaction under a supported desktop session. Record architecture, OS, display server, and package format. Do not extend x64 interactive results to arm64 without evidence.

<a id="signing-checksums"></a>

## Signing, licenses, and checksums

macOS packaging verifies the extracted `.app` and embedded runtime with `codesign --verify --deep --strict`. When no `CSC_LINK` or `CSC_NAME` is supplied, the packaging wrapper uses ad-hoc macOS signing and disables identity auto-discovery. A passing integrity check does not establish Developer ID signing or notarization. Record the actual identity/notarization status of the distributed candidate; do not promise a certificate-backed signature absent evidence. Apply the same evidence rule to Windows signing.

Include the root license, required `LICENSES` files, and generated `THIRD_PARTY_NOTICES.txt`. Runtime preparation copies the complete license directory; distribution checks must confirm it survives packaging. Keep the existing license text and attribution files unchanged when editing product naming or documentation.

The publish workflow gathers platform packages, rejects duplicate, missing, unexpected or empty files, and creates `checksums.txt` locally with seven SHA-256 entries. It uploads eight assets to a draft, compares the exact inventory and GitHub digests against the local files, and only then publishes. A mismatch must fail; never rewrite expected checksums from uploaded bytes to hide a discrepancy.

Installers and the updater require the expected platform asset and checksum entry and reject mismatches. Checksums verify bytes against the published manifest; they do not replace platform signing or the release acceptance gates. Do not publish guessed download URLs or enable installation instructions before the actual assets and manifest are available.

<a id="publication"></a>

## Publication and updater visibility

The tag workflow can publish automatically after its build jobs; manual account/installer evidence is not automatically enforced by a green workflow. Complete the required evidence before stable publication.

- A draft is unpublished; a pre-release is a public preview. Updater and default launcher installers query `/releases/latest`; previews are excluded. Source and DEV runs keep updates disabled.
- Suffix tags such as `v1.0.0-rc.1` are published as pre-releases automatically. Existing drafts retain their pre-release flag. Ordinary reruns cannot replace a published release.
- To test a final-version tag without exposing it to the stable updater, create its draft with **Set as a pre-release** checked before pushing the tag. Do not briefly publish stable and change the flag afterward.
- Promotion uses the existing validated binaries: clear **Set as a pre-release** and select **Set as latest release**, or publish a newer validated stable version. Changed binaries require a new version.
- Launchers require a newer version, matching platform asset, and checksum manifest. Version 1.1.0 checks at startup, every six hours, and through **About → Check for updates**. Older launchers check at startup; restart them to discover a new publication.

An exceptional preview replacement requires explicit maintainer authorization and a forced tag update. All native builds and checks must finish first. The workflow archives the old metadata and assets for 30 days, deletes the preview without deleting its tag, uploads and verifies a new draft, then republishes with preview status preserved. Stable and immutable releases cannot use this path. Record the old and new revisions and digests; the same version does not trigger an automatic update. If publication fails after deletion, recover from the archived files and metadata. Update `.github/release-notes.md` for each candidate before tagging; remove candidate-specific replacement text when it no longer applies.

Release notes must identify version/tag, supported and tested targets, signing status, important behavior/configuration changes, validation gaps, known issues, and recovery steps. Provide installation links only for files present in that release. Configured repository metadata alone is not evidence that a release exists.

<a id="rollback"></a>

## Withdrawal and rollback

If a candidate is faulty, stop its promotion and correct its public status/notes. Withdrawing a release or marking it as a preview does not roll back clients that already installed it. The updater offers newer versions; do not claim automatic downgrade.

Preserve the affected binaries, checksums, source revision, and redacted failure evidence. Reproduce recovery in the disposable test OS. Confirm that installer transaction rollback restores program files, runtime/receipt, registration, shortcuts, and route ownership without overwriting unrelated Codex data. Do not replace active executables or restore a user's production configuration from a test backup.

Prefer a new corrected version for distributed recovery. If manual reinstall of a known-good version is necessary, validate that exact path and its state compatibility before documenting it. Publish the concrete recovery procedure and residual limitations; do not replace artifacts under an already published version to conceal a failed candidate.

<a id="security-maintenance"></a>

## Security maintenance and vulnerability reports

This section covers private reports, sensitive evidence, exposure response, and dependency review. Runtime trust boundaries and technical limitations are maintained in the [architecture manual](architecture.md#security-boundaries).

<a id="vulnerability-reporting"></a>

### Report a vulnerability

Check the [repository security page](https://github.com/cmyk-labs/web2harness/security) for an available private reporting channel. If none is available, ask the [maintainer](https://github.com/cmyk-labs) for a private contact method without publishing exploit details or sensitive data. This manual does not assert that private reporting is currently enabled. Ordinary functional defects follow the [contribution process](development.md#contributing).

A useful private report contains:

- Application version or commit, operating system, and affected integration mode.
- Preconditions and minimal reproduction steps.
- Expected behavior and the observed boundary violation.
- Potential impact, including the data or operations exposed.
- Redacted supporting evidence and any temporary mitigation already applied.

Arrange disclosure privately. Do not publish credentials, working access tokens, user data, or a proof of concept that exposes an active account while arranging disclosure. Handle attachments as follows:

| Information | Handling requirement |
| --- | --- |
| Browser profile, cookies, and storage | Keep private; do not upload, synchronize, or attach them to a report. |
| API keys, tunnel credentials, and control tokens | Do not place them in issue text, command examples, screenshots, or source control. |
| Task context, prompts, tool results, and attachments | Review for personal, account, and project information before sharing. |
| Configuration, descriptors, and local backups | Treat as sensitive; they can contain credentials and private paths. |
| Diagnostic export | Use **Export safe log**, then inspect the export before sending it. Do not substitute raw logs. |

Diagnostic collection steps are maintained in the [support-report procedure](troubleshooting.md#support-report).

<a id="suspected-exposure"></a>

### Respond to suspected exposure

1. Stop affected tasks and disconnect the relevant integration through its documented controls.
2. Revoke or renew exposed browser sessions and credentials using the responsible account's controls.
3. Retain redacted evidence in private storage. Do not copy secrets into a public report.
4. Identify the affected version and configuration, then use the private reporting process above.

For functional recovery without evidence of exposure, follow [troubleshooting](troubleshooting.md). Do not remove data directories as a general diagnostic step.

<a id="dependency-security"></a>

### Maintain dependency security

Dependency review covers both core and desktop manifests and lockfiles. Before removing a security-related version override, evaluate current audit results and affected integration tests. Keep exact dependency versions in manifests and lockfiles rather than maintaining a duplicate policy table. The [development checks](development.md#automated-checks) list the audit commands.

Apply the [candidate evidence requirements](#validation-evidence) to security fixes, including tool boundaries, runtime integrity, and applicable platform acceptance. A previous successful audit or test does not establish current security status. [Signing and checksum requirements](#signing-checksums) remain separate from dependency audits.
