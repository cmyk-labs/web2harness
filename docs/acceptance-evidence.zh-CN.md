# 候选验收证据

[English](acceptance-evidence.md) | [简体中文](acceptance-evidence.zh-CN.md)

范围及复用遵循[验收协议](acceptance-protocol.zh-CN.md)，行为遵循[能力目录](acceptance-tests.zh-CN.md)。schema 2支持检查点覆盖、共享执行和累计有效性评审，并兼容schema 1。检查器验证一致性，不鉴定实际工具执行，仍须经复核的真实证据。

## 候选身份

变更稳定后运行 `bun run scripts/acceptance-evidence.ts snapshot output/candidate.json`。快照包含已跟踪及新增未忽略的产品、测试、构建、工作流、文档和资源文件，归一文本CRLF/LF。`sourceId`标识排序的路径/内容哈希清单，提交号用于溯源。`.github/acceptance/`排除在摘要外以避免回执循环，不得在其中放实现。

服务通过 `/healthz` 报告启动时源码身份，运行包另保留 `bundleId` 和逐文件哈希。已加载实现变化后仅重启已确认DEV。仅文档或验收工具变化不要求重启正常应用，保留实际加载身份并评审差异。哈希证明身份，不证明归属、执行或全部能力失效。

原快照归档到证据根目录内。检查器重算摘要，要求路径可移植、排序唯一，并比较原执行到目标每个新增、修改和删除文件；不能只看最后一次提交或中间继承目标。

## schema-2覆盖清单

`scripts/acceptance/catalog.ts`维护稳定检查点ID、能力映射、标准、允许层级/模式及保守依赖范围。清单不能遗漏检查点、自带更小目录或静默豁免。多项检查可共用执行，一项检查可满足多个CAP/Q，复合能力保留其余缺口。

| 字段 | 内容 |
| --- | --- |
| `schemaVersion` | `2` |
| `candidate` | 目标实际sourceId/version及溯源gitCommit |
| `catalogHash` | 当前受版本控制检查点目录的摘要 |
| `archives` | 迁移保留且绑定哈希的原清单 |
| `executions` | 不可变执行或历史映射记录引用 |
| `reviews` | 针对目标候选的有效性评审引用 |
| `coverage` | 目录每个检查点恰好一行 |
| `issues` | 带时间的未解决/已解决问题及受影响检查点 |

文件引用包含 `path` 和 `sha256`，相对清单目录，须为目录内普通JSON文件且字节哈希匹配，不含绝对/穿越/反斜杠路径或符号链接。原凭据、日志、rollout和浏览器状态留在忽略的 `output/`，证据存储仅包含经复核的脱敏记录。

覆盖行包含 `checkId`、`status: covered`、`runId`及必要时的 `reviewId`。跨候选复用和解决已记录失败必须有评审。缺口行包含 `checkId`、事实性 `reason`，没有通过执行选择，状态为 `needs-evidence`、`needs-review`、`blocked`、`owner-operated`或 `failed`，均不能通过发布。版本2不提供逐行不适用豁免，真实范围变化须评审并修改目录/要求。

## 执行记录

记录包含 `schemaVersion: 2`、`kind: execution`、唯一 `id`、`source`快照引用、`recordedAt`、`actor`、`platform`、`environment`及 `observations`。记录时间不能早于观察。各观察包含：

- `checkId`、对应 `criteriaHash`、`outcome`（pass/fail/blocked）及真实 `at` 时间。
- `layer`（fixture/authenticated-dev/native-package）及明确允许的 `mode`（native-tools/automatic-mcp/manual-mcp/desktop/not-applicable）。桌面证据不代表模型任务。
- 真实 `model`、`effort`、事实性 `summary`和非空哈希绑定的 `evidence`引用；夹具/桌面元数据不适用时明确说明。
- 非夹具证据另需与原快照相同的 `loadedSourceId`及 `runtimeSha256`。原生包须有 `artifactSha256`，制品检查还须属于当前候选。

同一记录可有多个观察，每个检查点只出现一次，各自保留模式/层级。仅部分满足属于缺口。标准摘要变化须重新评估，给旧执行附新摘要不代表它验证了新要求。

## 有效性评审

评审包含 `schemaVersion: 2`、`id`、`runId`、`targetSourceId`、`reviewer`、`at`、`checkIds`、`changes`、`environment`及可选 `resolvedFailures`，时间不能早于观察。检查器从原执行快照计算累计差异；`changes`须恰好含这些路径及匹配的 `before`/`after`哈希（不存在为null）、`impact`和具体 `reason`。

- `unrelated`仅限该检查点依赖范围外。
- `reviewed-unaffected`须有非空 `support`引用，解释实际修改的代码/契约、未受影响的行为及相关补充证据。
- 行为受影响、影响未知或测试判定失效时不能继承，应选择合适新执行或保留缺口。

环境评审要求 `status: unchanged`及事实理由，或 `revalidated`及证据引用。环境有效性未知时不能继承。历史功能观察不代表新做外部就绪探测，前提及发布冒烟按协议刷新。

后来的失败观察阻止引用更早通过。较早失败须在 `resolvedFailures` 中记录失败 `runId`、`checkId`及与所选后续成功有关的解决理由。问题记录要求唯一 `id`、`at`、`status`、`reason`及受影响 `checkIds`。未解决问题阻止相关检查点；已解决问题另须 `resolutionReason`及 `resolutionRunId`，提供晚于问题的逐项通过确认。保留失败，较新时间或反复重试本身不能解释解决。

## 命令与结果

```bash
bun run scripts/acceptance-evidence.ts snapshot output/candidate.json
bun run scripts/acceptance-evidence.ts report .github/acceptance/current.json
bun run scripts/acceptance-evidence.ts check .github/acceptance/current.json
```

`report`输出本次执行/继承/缺口状态、理由及CAP/Q汇总。零退出仅表示报告结构有效，仍可能有缺口，不代表可发布。`check`在证据无效或必需缺口时非零退出，继续作为CI发布门禁。检查点比例不是开发完成度。[发布手册](release.zh-CN.md)的实际制品、平台、安装及发布授权要求独立适用。

<a id="checker-compatibility"></a>

## 旧格式兼容与迁移

schema 1保留候选完全一致、最大尝试编号整项通过的校验。新覆盖使用schema 2。替换 `current.json` 前逐字节归档旧清单和引用回执，保留更早历史；不改写原身份，不声称新认证执行。

`kind: legacy-mapping`记录还要求 `mappingRationale`。各观察的 `legacy`包含 `manifest`、`caseId`、`attempt`及 `receipt`，manifest/receipt为文件引用。检查器绑定原行、回执、源码、结果、时间、模式、模型、力度及运行时身份。后续历史尝试失败使更早所选通过失效；导入失败仍须评审解决。

原真实用例明确汇总独立执行夹具时，可设置 `legacy.fixtureSubset: true`、具体 `fixtureRationale`及mode为 `not-applicable`，提取仅夹具观察。原元数据留在归档行。这只缩小到已有夹具结果，不把夹具升级为真实证据或创造观察；映射前须复核原夹具证据。

迁移辅助脚本和原始差异放入忽略的 `output/`。替换当前清单前验证草稿，不明历史覆盖保持needs-review/needs-evidence。CI验证完整性和一致性，实际结果及影响分析真实性仍由操作者负责。
