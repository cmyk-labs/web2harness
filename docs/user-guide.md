# User guide

[English](user-guide.md) | [简体中文](user-guide.zh-CN.md) · [Documentation](../README.md#documentation)

This manual follows the application lifecycle: prepare an installation, connect Codex, run tasks, then update or remove the integration. Start with Native Tools unless your workflow requires MCP Bridge. Detailed settings, model mappings, and context budgets are in the [reference](reference.md); failures are covered in [troubleshooting](troubleshooting.md).

**Contents**

- [Requirements and distribution](#requirements)
- [Install and start](#installation)
- [First connection](#first-connection)
- [Daily use](#daily-use)
- [Tool modes](#tool-modes)
- [Conversation preferences](#conversation-preferences)
- [Models and subagents](#models-and-subagents)
- [Usage and diagnostics](#diagnostics)
- [Runtime controls](#runtime-controls)
- [About the project](#about)
- [Updates](#update)
- [Disconnection and removal](#disconnect-and-uninstall)

<a id="requirements"></a>

## Requirements and distribution

Desktop installers are available from the [1.0.0 preview release](https://github.com/cmyk-labs/web2harness/releases/tag/v1.0.0). Choose the installer matching your operating system and processor; one installer is sufficient. Review its validation and signing limitations before use. Formal installer acceptance is tracked separately in the [release manual](release.md).

| Requirement | Details |
| --- | --- |
| ChatGPT account | Sign in inside the Web2Harness browser. Available Web models follow this account's capabilities. |
| Codex client | Use a working ChatGPT sign-in in Codex so it can request the integrated model catalog. This is a separate session from the launcher browser. |
| Network and local access | Allow access to ChatGPT and the required OpenAI endpoints, and writes to application data and the selected Codex configuration. Source installation also needs access to dependency registries. |
| Source tools | Git, Bun **1.4.0**, Node.js **22.12.0 or later**, and Codex CLI for source command workflows. |
| Desktop build targets | Windows x64; macOS arm64 and x64 on macOS 13 or later; Linux x64 and arm64. Build targets do not imply published or interactively accepted packages. See the [release target matrix](release.md#native-target-matrix). |

Native Tools requires no tunnel, connector, or inference API key. MCP Bridge additionally requires a tunnel, a regular API key with **Tunnels Read + Use** permissions, and connector access in the intended ChatGPT account and workspace.

Finish tasks in the Codex client before applying a route change. If another router or wrapper controls that route, choose one route owner; composition with another route manager is not supported. The [architecture manual](architecture.md) explains how project data and tool permissions cross component boundaries.

Ordinary users may install and use the application on their own workstation. Development and regression work must use the isolated DEV profile. Installer, updater, and removal acceptance requires a disposable VM or dedicated test OS; see the [development procedure](development.md#standard-isolated-test-procedure).

<a id="installation"></a>

## Install and start

### Select a download

| Device | Installer |
| --- | --- |
| Windows x64 | `web2harness-1.0.0-win-x64.exe` |
| macOS Apple silicon | `web2harness-1.0.0-mac-arm64.dmg` |
| macOS Intel | `web2harness-1.0.0-mac-x64.dmg` |
| Linux x64 | `web2harness-1.0.0-linux-x64.AppImage` |
| Linux arm64 | `web2harness-1.0.0-linux-arm64.AppImage` |

Verify the download against `checksums.txt` in the same release. On macOS, open the DMG and copy Web2Harness to Applications. On Linux, grant the AppImage execute permission and launch it from a supported desktop session. Windows installation is described below.

The macOS ZIPs support updates and terminal-only installation; they are not additional prerequisites for DMG users. Source code archives are for developers. Advanced users can obtain [installation scripts from the versioned source](https://github.com/cmyk-labs/web2harness/tree/v1.0.0/scripts). Set `WEB2HARNESS_REPOSITORY=cmyk-labs/web2harness` explicitly. The macOS terminal script downloads the complete desktop ZIP and installs only its embedded runtime and licenses; it does not install the desktop application. To use the preview with the desktop scripts, also set `WEB2HARNESS_VERSION=1.0.0`, since automatic stable-version discovery excludes previews.

### Existing source checkout

Run the following from the repository root:

```bash
git --version
bun --version
node --version
codex --version
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run app
```

Check the required versions before installing. Both dependency installations must succeed; preserve the first failure and resolve the reported cause before continuing. Do not delete lockfiles to force installation. The startup command also checks the locked dependencies before opening the desktop interface.

The expected result is a completed startup screen and the regular Web2Harness workspace. This profile can configure the user's Codex installation. To change the software or validate a fix, use `bun run dev:launcher`, verify the **Web2Harness DEV** label and runtime ownership, and follow the [development manual](development.md) with independent DEV credentials.

### Windows package

For an available release or a controlled acceptance build:

1. Obtain the matching installer and its verification information. Confirm version and architecture; a source checkout alone does not establish the package's authenticity or signing status.
2. Finish affected tasks and choose **Exit** from the target application's tray menu. Closing its window may leave it running.
3. Run the installer as the current user. Windows uses a per-user installation without elevation. Choose a dedicated application directory; protected paths and directories containing unrecognized application files are rejected.
4. Wait for **Preparing and verifying application components** to complete. Do not start Web2Harness while setup or recovery is running.
5. Open the application and complete the connection procedure below.

Setup reports success after application files, the verified private runtime, and installation registration are ready. A registered Windows installation checks readiness during normal startup rather than deploying the runtime again. Missing or damaged runtime files require repair through the matching installer.

For repair, exit the affected application and rerun its installer. Setup retains recovery information and attempts rollback if replacement fails. If recovery also fails, preserve that information and rerun the installer before starting Web2Harness. Do not delete recovery directories or edit ownership records to bypass a failure. See [installation recovery](troubleshooting.md#startup-and-installation).

<a id="first-connection"></a>

## Connect Codex for the first time

On first use, choose the interface language. The welcome page invites you to Star the [project repository](https://github.com/cmyk-labs/web2harness); this is optional. **Star on GitHub** opens the repository in your default browser. Return to **Continue setup**, or choose **Skip and start setup** without opening GitHub. The app does not verify Stars or require a GitHub account. Once setup begins, the welcome page does not appear on ordinary restarts.

Browser login, local configuration, and Codex catalog verification are separate checks. Complete them in order:

1. Open **Connection & Models** and select **Native Tools** with **Automatic** interaction.
2. Select **Open browser** and sign in to ChatGPT there. A login in another browser does not transfer automatically.
3. Return to **Connection & Models** and select **Check connection**. Resolve any login dialog or browser check failure before continuing.
4. Select **Apply configuration**. This prepares the runtime and writes the Codex integration. Selecting a mode alone does not activate it.
5. Refresh the affected Codex client's model catalog. If it remains stale, finish its tasks, fully quit that client and its associated background process, then reopen it while keeping Web2Harness running.
6. Confirm that the launcher reports that Codex has read the Web catalog. Select a **(Web)** model and one of its available efforts in Codex.
7. Try a small read-only task: “List this project's top-level files and explain its main entry point.” Confirm the answer returns and inspect any actual tool results in Codex.

Connection is complete when the browser check passes, the intended configuration is active, the catalog is verified, and a task completes. A subsequent model-turn error should be diagnosed at that layer; repeatedly applying a verified route does not repair it.

Keep Web2Harness running while the integration is active. Native Codex models also use the configured local route. To use Codex without the launcher, [remove the integration](#disconnect-and-uninstall) and restart the affected Codex client.

<a id="daily-use"></a>

## Run and continue tasks

Choose the intended project and a **(Web)** model in Codex, then select an effort offered for it. Enter the task normally. During automatic interaction, Web2Harness submits the applicable context to ChatGPT and returns responses to Codex. Leave the task's browser page available; navigating, editing, or closing it can interrupt the turn.

Review tool approvals in Codex. Tools remain restricted to the active task's tool access, sandbox, and approval policy. Confirm file changes and command output before treating a task as complete. Continue in the same Codex task when its history is relevant; start a new task when previous context or images should be excluded.

Use Codex's task controls for deliberate interruption. **Runtime controls → Cancel active Codex turn** can affect multiple active turns in the selected runtime profile. Check that scope before using it. During development, control only turns and processes whose DEV ownership has been verified.

| Launcher page | Purpose |
| --- | --- |
| **Overview** | Check the active configuration, readiness, and next incomplete setup step. |
| **Browser** | Sign in, observe automatic execution, or perform a manual handoff. |
| **Connection & Models** | Check connectivity, apply modes and credentials, and inspect model or connector readiness. |
| **Preferences** | Set conversation history, reuse, window behavior, and optional experimental features. |
| **Usage & Diagnostics** | Inspect observed usage, run diagnostics, control runtime turns, and export safe logs. |

The sidebar language control changes the launcher language. It does not change ChatGPT's website language. **Preferences** also controls background operation after window close, showing the browser when tasks start, and launch at system sign-in. DEV starts explicitly and does not offer sign-in autostart.

<a id="tool-modes"></a>

## Choose a tool mode

The tool mode selects the path to Codex tools. The interaction method selects who sends the browser prompt.

| Mode | Interaction | Execution and setup |
| --- | --- | --- |
| **Native Tools**, default | Automatic | Codex executes validated model tool requests. Requires browser login, a passed connection check, applied configuration, and a verified catalog. |
| **MCP Bridge** | Automatic | A ChatGPT connector reaches the active Codex task through a tunnel and local MCP server. Adds tunnel credentials and verified connector binding. |
| **MCP Bridge** | Manual, labelled Zero Risk | The operator sends prompts and MCP carries task responses and tool requests. Uses its own credentials and operator-verified remote binding. |
| **Browser-only**, CLI | Automatic | Returns model responses without local tool execution. Requires the CLI configuration and browser session, with no MCP tunnel. |

Finish active tasks before changing mode or interaction. Select the new values in **Connection & Models**, complete their prerequisites, and choose **Apply configuration**. Until application succeeds, **Active configuration** remains authoritative. Follow any catalog-refresh or client-restart instruction. Manual interaction is available only with MCP Bridge.

<a id="mcp-bridge"></a>

### Configure automatic MCP Bridge

Start with a working automatic browser session and Codex catalog. Review the remote tool boundary in the [architecture manual](architecture.md).

1. Select **MCP Bridge** and **Automatic**. If needed, complete **Prepare model catalog** and refresh it in Codex.
2. Open **View credential setup guide**. Create the tunnel and a regular key with **Tunnels Read + Use**, then enter the **Tunnel ID** and **API key**. The key authenticates the tunnel; it is not an inference key.
3. Select **Apply configuration** and wait for the local tunnel to connect before creating the remote connector.
4. Enable ChatGPT **Developer Mode**. Create a new connector with the exact displayed name: **Codex Native2** for the regular automatic profile. Select the matching tunnel, **Authentication: None**, and **Allow all actions**. Connector, tunnel, and key must belong to the intended account and ChatGPT workspace.
5. Select **Verify connector binding** in the launcher and resolve failed checks. Run a small Codex task and inspect its actual tool result.

A running local tunnel alone does not prove a correct remote binding. Workspace policy can restrict connector access. When replacing credentials, use **Replace credentials**, apply the new values, and verify the corresponding binding. Automatic and manual interaction retain separate connection profiles.

DEV MCP testing additionally requires independent login, credentials, and tunnel resources, explicit confirmation that the tunnel belongs to DEV, and verification of the actual DEV connector binding. Names alone do not establish isolation; follow the [development procedure](development.md#standard-isolated-test-procedure).

<a id="manual-handoff"></a>

### Perform a manual handoff

Apply MCP Bridge with **Manual** interaction using its separate tunnel and key. Create the displayed **Codex Zero Risk** connector and personally confirm the remote tunnel binding, then run **Check local runtime**. The connector name is shared by regular and DEV profiles; it does not prove isolation. The local check does not verify the remote binding.

1. Start a task using the manual Web model entry in Codex.
2. At the handoff prompt, use the prepared clipboard text; select **Copy prompt** again if needed.
3. In the launcher browser, choose the model and effort, attach **Codex Zero Risk**, paste the prompt, and send it. Add any task images yourself; this mode does not transfer them automatically.
4. Only after sending in ChatGPT, select **Sent** in the launcher. Wait for the connector to bind the active task.
5. Repeat the handoff and confirm the model, effort, and connector for each subsequent turn.

The application neither operates nor inspects the ChatGPT page in this mode. Browser usage inspection, automatic context-file and skill uploads, and automatic **New each turn** behavior are unavailable. The optional **Manual Pro model** advertises a larger context profile; enable it only with the required account access and manually select Pro each turn. The application cannot verify that choice, and the larger budget does not work with every effort. See the [model reference](reference.md).

The handoff succeeds when MCP binds the active task and a response returns to Codex. If it waits indefinitely, record the last completed handoff step. “Zero Risk” is the mode's label; account limits and Codex tool permissions still apply.

<a id="conversation-preferences"></a>

## Set conversation and context preferences

Change these settings after active turns finish. Saving a chat and reusing its conversation are independent choices.

| Preference | Default and behavior |
| --- | --- |
| **Conversation reuse → Reuse conversation** | Default. Eligible automatic Sol/Pro routes in Native Tools or MCP Bridge retain the browser conversation associated with a verified Codex task. This reduces repeated context; compaction begins a new context epoch. |
| **Conversation reuse → New each turn** | Off. Eligible automatic Sol/Pro routes create a new browser chat and resend the applicable context each turn. Useful when a connector disappears on follow-up messages, with more transfer and potentially longer waits. Inactive for manual interaction. |
| **Chat history → Save to history** | On for new configurations. Saves tasks to ChatGPT history, where memory and custom instructions may apply. Upgrades preserve an existing explicit **Temporary** choice. |
| **Context as File (Experimental)** | Off. Sends sufficiently large context as a text attachment and keeps small context inline. Requires automatic interaction and is unavailable for Luna. |
| **Context budget → Triple** | Experimental and off. Available with context-file transport; advertises larger context and compaction budgets. Restart the affected Codex client after changing it. It does not increase allowance or guarantee complete model use of the content. |
| **Skills as files (experimental)** | Off. Uploads explicitly selected Codex skills as named text files during automatic interaction. Other skills load through tools. Skills and images share attachment limits. |

Luna uses rolling checkpoints. Browser-only does not retain browser conversations, and manual interaction follows the operator's handoff. Their continuity differs from retained Sol/Pro routes; see the [architecture manual](architecture.md).

Both saved and temporary chats send prompts, files, and images to ChatGPT. Disabling history does not make processing local. Task images come from Codex's conversation context; earlier images can be attached again, with at most the newest ten complete images retained by the bridge. Start a new Codex task to exclude earlier task images.

Browser-based image generation is not a supported Web turn. Codex's native Image Gen tool follows its own native backend path, authentication, and allowance. Uninstalling Web2Harness does not remove conversations already saved in ChatGPT.

<a id="models-and-subagents"></a>

## Change models and use subagents

Inspect **Connection & Models → Web models** for the current account's model IDs and efforts, then make the selection in Codex. After account capabilities change, recheck the browser, apply configuration, and refresh the catalog. Local capability fields cannot unlock account features. Exact mappings and context budgets belong to the [reference](reference.md).

Keep Web2Harness as route owner when switching a task between Web and native Codex models. Its native route converts Web checkpoints while preserving native encrypted history. An external router can bypass that conversion. Preserve task history if a switch fails and use [routing diagnostics](troubleshooting.md#codex-routing-and-catalog).

**Compatibility V1** is the default subagent protocol for delegation between native and Web models. **Native** preserves Codex's native protocol settings. Under V2, Web-to-Web delegation uses an explicit plaintext marker; unreadable native encrypted task content is rejected. Child agents retain their selected model, tools, sandbox, and approval rules.

Where the CLI is installed:

```bash
web2harness subagents status
web2harness subagents compatibility-v1
web2harness subagents native
```

`status` reads the setting; the other commands change it. After a change, restart the affected Codex client and start a new task. Begin conservatively with one active agent task. The browser's five-tab ceiling is a local limit, not a safe account concurrency quota. Stop retries when ChatGPT reports an account limit; additional tabs or larger context budgets do not increase allowance.

<a id="diagnostics"></a>

## Inspect usage and diagnostics

**Usage & Diagnostics → Usage** reports sends observed by this application over a rolling seven-day period, starting when tracking is enabled. External activity or earlier sends can be missing. Shared and model-specific windows overlap; do not add them together. Unattributed Pro messages are listed separately. This is not an official remaining-quota or reset-time display. Manual interaction does not inspect browser usage, although existing local records remain visible.

For a failure, run **Usage & Diagnostics → Health checks → Run doctor**, then follow the earliest failed check. After one useful reproduction, select **Logs → Export safe log**. If startup is blocked, use the startup page's details and diagnostic export. Review the exported content before sharing and follow the [support-report checklist](troubleshooting.md#support-report).

<a id="runtime-controls"></a>

## Runtime controls

Open **Workspace → Runtime controls** in the sidebar to review the active mode, connection readiness and observed activity. The page separates task control from integration management. Usage, health checks and logs remain under **Usage & Diagnostics**.

- **Cancel active Codex turn** stops requests handled by Web2Harness and their browser turns, keeping the integration configuration. The control shows progress while cancellation runs and reports failures.
- **Remove Codex integration** uses the existing confirmation dialog to disconnect Web2Harness and restore the previous model route. Finish active tasks first. Apply connection settings again before using Web models. This action is unavailable in DEV.

Activity reflects the current browser and application observations; it does not establish that other Codex clients are idle. Unknown or unavailable state is reported explicitly.

<a id="about"></a>

## About the project

The GitHub icon beside **Web2Harness** in the sidebar opens the current project repository. **About** presents the project slogan, capabilities, version, operating system and license. Its operating diagram shows how Codex, Web2Harness and ChatGPT Web exchange requests and results, with a brief explanation of each tool mode. Documentation, GitHub and project-license links open in the system browser. Third-party notices remain in the repository and distribution; there is no separate shortcut on this page.

When a release is available, the update action appears on **About**. Preferences remains focused on conversations, window behavior and experimental features. Overview and Diagnostics continue to show connection and runtime status.

<a id="update"></a>

## Update an installation

Finish active tasks and record the current version, installation method, and mode. Preserve necessary configuration and diagnostic evidence locally.

| Installation | Update procedure |
| --- | --- |
| Source checkout | Close the affected launcher. Obtain the intended revision while preserving local changes, install both locked dependency sets, and run `bun run app`. Source runs do not enable automatic updates. |
| Packaged application | When a release is available, use the offered update action or matching platform package. Confirm the replacement starts and reports the expected version. |
| Registered Windows package | Follow the Windows installer procedure above. Runtime preparation is part of setup completion. A failed deployment with attempted recovery is not a successful update. |

After the update, check the browser connection and active mode, follow catalog-refresh instructions, and review the history preference before a sensitive task. Formal release and installer validation remain separate from ordinary use; developers must use the isolated environments specified in the [release manual](release.md).

<a id="disconnect-and-uninstall"></a>

## Disconnect and uninstall

### Restore Codex without removing application data

1. Finish active tasks that use the integration.
2. In the regular launcher, select **Runtime controls → Remove Codex integration**, confirm and wait for completion.
3. Restart the affected Codex client and verify it works with the restored route before removing application files.

This restores the route recorded before Web2Harness took ownership. If another tool changed it, restoration can refuse to overwrite that configuration; use [route troubleshooting](troubleshooting.md#codex-routing-and-catalog). Production integration removal is unavailable in DEV.

CLI `web2harness route disconnect` temporarily restores the prior route. Restart the affected Codex client afterward. Starting the launcher reconnects an installed integration, so temporary disconnection does not permanently remove it.

### Remove the application and choose data retention

For a Windows package, finish tasks, exit through the tray, and run the platform uninstaller. It restores the managed Codex integration and offers **Also delete all Web2Harness local data**, unchecked by default.

| Choice | Result |
| --- | --- |
| Leave the option unchecked | Keep local data and settings in a disconnected state. The Codex integration is removed. |
| Select the option | Remove only verified installation-owned data roots: settings, launcher browser sign-in, cache, logs, and installed runtimes. Codex login, Codex chats, projects, and unrelated settings remain outside the cleanup scope. |

If ownership, route restoration, or file removal cannot be verified, the uninstaller reports failure and stops further removal. Resolve that condition and retry. For source or other platforms, first remove the Codex integration, then quit and remove the application using its normal installation procedure. Identify the active data paths in the [reference](reference.md) before considering any data deletion; deleting program files alone does not prove that routing or local data was removed.

Local uninstall does not delete ChatGPT history or revoke remote connectors, tunnels, or API keys. Remove those separately in the appropriate account settings if they are no longer needed. At completion, verify that Codex uses the intended route and that the chosen local-data retention policy was honored.
