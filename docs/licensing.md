# Offline device licensing

[English](licensing.md) | [简体中文](licensing.zh-CN.md)

Version 2.0.0 requires activation, including when upgrading from 1.x. Activation appears before language selection and setup. The application verifies the saved license on startup and before new Web/MCP work; no publisher server is contacted. ChatGPT and connector features still need their own network connections.

## Customer flow

After activation, the Product license page shows the current status, expiry and device code. Select **Update license** to open the entry form. Cancelling clears the new entry and preserves the current license.

1. Open Web2Harness and copy the device code from the activation screen. A command-line alternative is `web2harness license device`; the separately built `Web2Harness-DeviceCode` executable needs no Bun installation.
2. Send that code to the publisher. Receive the signed license as text or a `.w2h` file.
3. Paste its contents and choose **Activate and continue**. Select the language and configure ChatGPT afterward. **License** in the application lets you view validity and import a renewal.

Run the device-code command on **the customer's computer**. When the `web2harness` CLI is installed and available:

```powershell
web2harness license device
```

Without the client installed, send the standalone device-code utility to the customer. On Windows, open PowerShell in its folder and run it (no Bun installation needed):

```powershell
.\Web2Harness-DeviceCode.exe
```

The customer sends the complete `W2D1-…` output to the publisher.

CLI import reads the license from standard input so it is not exposed in process arguments:

```powershell
Get-Content -Raw .\license.w2h | web2harness license import --stdin
web2harness license status --json
```

An invalid import preserves the existing license. Normal upgrades and disconnecting the Codex integration retain it. Explicit removal of all application data removes it.

## Validity and device changes

A license can be perpetual or time-limited. The activation screen and **Product license** show its expiry. Import a valid renewal to continue after expiry. Contact the publisher if a replacement computer or OS reinstallation changes the device code.

Licenses apply to their assigned device. Do not post them publicly or include them in support reports. Normal upgrades preserve the license; explicitly clearing all application data removes it.

## Source development and builds

DEV uses an independent test license. Run `bun run scripts/prepare-license-dev.ts`, set the printed `WEB2HARNESS_DEV_HOME` and `WEB2HARNESS_LICENSE_KEYS_FILE`, then run `bun run dev:launcher`. Tests and `bun run verify` prepare their own temporary test resources.

Release builds read the publisher-provided production public manifest from `WEB2HARNESS_LICENSE_KEYS_FILE`. The GitHub release workflow reads the same public configuration from the repository variable `WEB2HARNESS_LICENSE_PUBLIC_KEYS_JSON`. Missing or development configuration stops release packaging. This configuration contains no private keys, and test packages must not be distributed as releases. See the [release manual](release.md).

Build the customer device-code utility separately with `bun run license:device:build`; output is under `output/device-code/`. The issuer is privately maintained and is not part of the public repository or customer packages.
