# Change proposal

[English](PULL_REQUEST_TEMPLATE.md) | [简体中文](PULL_REQUEST_TEMPLATE.zh-CN.md)

## Problem and resulting behavior

<!-- Identify the defect or requirement, relevant issue, and behavior after this change. -->

## Scope and implementation

<!-- Name the affected components. Explain compatibility, configuration, data, and lifecycle implications. State why any refactoring or dependency change is necessary. -->

## Validation evidence

| Check | Environment / version | Result | Evidence or reason not run |
| --- | --- | --- | --- |
| | | | |

<!-- Distinguish automated tests, browser fixtures, authenticated DEV tasks, native package inspection, and disposable-OS acceptance. Do not present one as proof of another. Include observed DOM evidence for browser integration changes. -->

## Submission checks

- [ ] The change follows the [contribution requirements](../docs/development.md#contributing) and has no unrelated changes.
- [ ] Model, effort, route, and connector selection remain explicit; failures do not report unverified success.
- [ ] Tool authority and mode boundaries remain intact.
- [ ] Applicable checks passed, or failures and unexecuted checks are stated above.
- [ ] Execution changes were tested using the shared implementation through real Codex tasks in isolated DEV.
- [ ] Installer, updater, and service acceptance, where applicable, used a disposable VM or dedicated test operating system.
- [ ] Production configuration, authentication, browser profiles, and working processes were not changed for testing.
- [ ] Changed behavior, examples, and diagrams are reflected in both documentation languages.
- [ ] The submission excludes credentials, browser state, private paths, raw logs, and generated release artifacts.

<!-- For a non-applicable check, state why in the validation table. -->

## Remaining work and release considerations

<!-- List known limitations, platform/account checks not completed, migration requirements, and rollback considerations. -->
