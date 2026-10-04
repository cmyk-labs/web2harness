# Packaging dependency patches

[English](README.md) | [简体中文](README.zh-CN.md)

## Electron artifact downloads

`app-builder-lib@26.15.3.patch` accompanies the launcher override of `@electron/get` to `5.1.0`. The released downloader uses Fetch and removes the `got` → `cacheable-request` → `http-cache-semantics` dependency chain affected by [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). The packaging tool remains pinned to a stable version. The dependency audit is unchanged and no advisory is suppressed.

The proxy initialization and abort-signal timeout changes are adapted from the MIT-licensed [electron-builder implementation at ec9135d](https://github.com/electron-userland/electron-builder/blob/ec9135d0626879479ffa4235006f06b14375cc43/packages/app-builder-lib/src/util/electronGet.ts). The patch also recognizes Fetch HTTP status and nested network errors during retries. It translates the pre-existing, explicit legacy `strictSSL: false` option to an Undici dispatcher; normal downloads continue to validate TLS certificates. Web2Harness does not enable that option.

The launcher declares Undici directly so proxy support does not depend on an optional dependency being installed. Node.js 22.12.0 or later is required for the downloader and CommonJS-to-ESM loading; CI uses Node 24. These are build-host requirements, not new requirements for users of the packaged desktop application.

## Maintenance

1. Keep the exact packaging-tool version, override, patch file, `patchedDependencies`, and lockfile together. Install with the pinned Bun version and `--frozen-lockfile`.
2. When updating electron-builder, inspect its released downloader integration. Remove the patch and override together only when the supported dependency chain no longer contains the affected cache and the Fetch integration is compatible.
3. Run `node --test launcher/tests/installation/build-download.test.cjs` from the repository root, both dependency audits, and `bun run verify`. Validate a fresh frozen install to establish that the checked-in patch is applied without local module edits.
4. Complete the native packaging and isolated installer gates in the [release procedure](../../docs/release.md) before publishing. Local download fixtures do not establish real installer acceptance.

Preserve upstream licensing. The patched file remains part of the MIT-licensed app-builder-lib package; the [upstream license](../../LICENSES/electron-builder-MIT.txt) is retained with this source checkout. The patch changes download compatibility only; it does not modify ChatGPT sessions, Codex routing, application configuration, or the installed desktop application.
