# Evidence index · 证据索引

[English report](README.md) · [中文报告](README.zh-CN.md)

All paths below are relative to ignored `output/2026-10-19-r16-live/`. Raw records stay local and are not included in Git. Hashes identify the reviewed artifacts; they are not a mandatory acceptance manifest or a substitute for inspecting the evidence.

下列路径均相对忽略目录`output/2026-10-19-r16-live/`。原始记录仅留本机，不进入Git。哈希标识本次核验的文件，不新增强制验收清单，也不能代替证据内容。

## Chain · 对应关系

1. Each task directory retains `invocation.private.json`, `codex-events.private.jsonl`, `proof.private.json`, and native verification. The patch case also retains the owned fixture and actual assertion/file-change events. 启动参数、真实工具事件、原生回执与文件结果相互对应。
2. Completed public captures retain only the permitted public projection. Reports identify the exact capture sequence matched to the CLI/native final. 完整公开响应与最终正文逐字核对，不保存隐藏推理正文。
3. `parallel-review-web/parallel-verification.private.json` relates creation/closure, child reports, native blocking intervals and queue samples; `tools-*.private.json` preserves actual tool receipts. 不是根据模型自述认定并行或联网成功。
4. `parallel-review-web/source-channel-failure.private.json`, `page-channel-failure.private.json`, and `channel-replay-{before,after}.private.json` connect the channel defect to the same five captured structural events. `channel-before.log` and `channel-after.log` preserve regression failure and success. 现场前缀不补造尾流。
5. `public-observations-diag/001-control-headers.private.json` identifies the URL control type without its opaque payload; `report-resume-2` and `public-observations-r3/002-*` contain the successful recurrence. 控制事件类型与修复后的真实重复出现相对应。
6. `channel-resume/acceptance-review.private.json` explicitly limits the generic receipt verifier's result; `postfix-final/acceptance-review.private.json` additionally checks exact requested Markdown and a complete public source. 部分证据与后续独立通过分别保存。
7. Production `boundary-{before,after}.private.json`, their comparison, frozen project summaries and `health-final.private.json` establish the isolation/cleanup result. 生产基线、源码冻结及活动数归零分别核对。

## Reviewed artifact hashes · 已核验文件哈希

| Artifact · 文件 | SHA-256 |
| --- | --- |
| `tool-roundtrip-2/verification.json` | `ce79f23d8f0d66a99b448ee5ce149ba5ea2836f58342b61db258e6f1865a6fdf` |
| `read-only-analysis-2/verification.json` | `d2394364020bba596eb0861a5ca3138318ac44e010e208da39e24de0bb9c30c9` |
| `cancel-recover/verification.private.json` | `d5dd8178aaf9377d14a54491b32cd5ca8d982bc6d7830bf56bfcf8c17f0d441b` |
| `parallel-review-web/parallel-verification.private.json` | `8e1b4f333c1a1609e22c19c1eab9bc01c70ccffd34efde214277eed2b5654122` |
| `report-resume-2/verification.json` | `658b33c6a319c562a069854ebf35979a53342bf03fd0dd74ef8bf8536b7ff2fc` |
| `postfix-final/acceptance-review.private.json` | `f6e433779e25544e584fbee9d7f4239466deaa85cece0982227ba10c05871b6e` |
| `channel-resume/acceptance-review.private.json` | `1b99b5c83315441e72bc6a9bf2343ca46ed850d9b234d1eb09a22c8ff0453c17` |
| `boundary-comparison.private.json` | `0b7fdfbe8df280629a21ffa50bb268161aaacbb2cf8b115cbe1f040c42580212` |
| `project-r3-summary.json` | `b0684b0a4a48c88116580d33464f2d55627b2acae0c99e5f605395314ce0ed7e` |
| `project-r4-summary.json` | `b0684b0a4a48c88116580d33464f2d55627b2acae0c99e5f605395314ce0ed7e` |
