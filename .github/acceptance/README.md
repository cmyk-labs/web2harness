# Historical acceptance records · 历史验收记录

The JSON files in this directory are preserved historical records from the retired automated acceptance checker. They are not inputs to CI or publication. In particular, `current.json` retains its historical name and source identity; it does not describe the current release decision. Preserve original outcomes, failures, hashes and review references. Do not rewrite them to mark a later candidate as passing.

Capability acceptance is reviewed manually using the [acceptance cases](../../docs/acceptance-tests.md) and [release manual](../../docs/release.md). Record the actual scope, evidence, unresolved issues and maintainer decisions; existing evidence may be reused after reviewing relevant changes.

本目录JSON为已移除的自动验收检查器所留下的历史记录，不再作为CI或发布输入。`current.json`保留历史名称和原源码身份，不代表当前版本的发布结论。保留原结果、失败、哈希和评审引用，不得改写为后续候选通过。

能力验收由维护者依据[验收用例](../../docs/acceptance-tests.zh-CN.md)与[发布手册](../../docs/release.zh-CN.md)人工复核，记录实际范围、证据、未解决问题和维护者决定；评审相关变更后可复用已有证据。
