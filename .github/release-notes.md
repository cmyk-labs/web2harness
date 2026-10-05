## 简体中文

Web2Harness 1.1.1（`v1.1.1`，2026-10-05）修复 Codex 上下文与工具在网页桥接中的结构差异，并建立每次发布的真实能力验收基线。

- **原始上下文保留**：保留角色、顺序、内容块、调用关联和工具结果原文；简短桥接职责、Codex 原始上下文和桥接输出协议分别组织。普通转发不再删除旧规则、替换形似句柄的正文或静默裁剪历史和图片。
- **工具身份与调用范围**：保留命名空间树、原始工具名、函数/自定义工具类型、参数规格和 custom 格式；传输路由索引留在桥接内部。顶层工具与 exec 内导出不再混同，原始 exec 脚本和 wait 参数不被桥接包装或改写。JSON/SSE 使用原始调用身份，并在执行前校验完整工具批次及 tool_choice。
- **会话续接与压缩边界**：仅在已完成的原始输入前缀匹配时增量续接；历史或指令变化时重建会话。移除桥接私有 Luna 摘要替换，使用 Codex 压缩路径；Luna 标准上下文/压缩阈值调整为 28k/22k。容量不足、未知语义或不可解码的跨后端内容明确报错。
- **发布验收**：新增 CAP-001 并行读取与补丁、CAP-002 15 秒同 cell 等待续接、CAP-003 三个真实子 agent 并行只读分析。每次发布重新执行并保留调用与产物证据。
- **并行页面稳定性**：新建或续接自动任务时，不再切走当前正在运行的标签页，避免页面尺寸变化关闭模型菜单而使任务失败；仍可手动切换标签页。

### 升级与下载

MCP Bridge 的工具定义已更新。升级后按提示刷新所选连接器的工具定义，并重启受影响的 Codex 客户端；旧 wire_name 工具调用会明确拒绝，不自动猜测映射。Native Tools 无需 MCP 连接器。已安装应用可检查更新；源码和 DEV 不启用应用内更新。

从 Assets 选择匹配的 Windows x64 `.exe`、macOS Apple silicon/Intel `.dmg` 或 Linux x64/arm64 `.AppImage`。两个 macOS `.zip` 用于自动更新和终端安装。`checksums.txt` 覆盖七个包，许可随包附带。

### 验证范围与限制

Windows x64 上完整 `bun run verify` 通过：核心 892 通过 / 26 跳过，桌面 461 通过 / 4 跳过，均无失败；类型检查、依赖审计、构建和可迁移运行包冒烟通过。独立登录 DEV 使用 GPT-6 Pro、Native Tools 重新执行 CAP-001～003，原生调用、同 cell 续接、三个并行只读子 agent、父任务汇总与关闭及文件产物均已核验，432 个被测源码文件无变更。首次 CAP-003 暴露自动切页问题，修复并补回归后重新通过全部三项；首次失败和部分源码截取命令的非零结果保留在验收记录中。生产配置/认证文件哈希及原有进程身份前后未变。

五个原生目标的验证、打包、包启动及上传摘要检查由本标签的发布工作流执行。未执行专用隧道认证 MCP、跨模型压缩后认证续聊，以及各平台逐项人工安装、升级、修复和卸载验收；已有离线契约不代替这些检查。Windows 安装包未签名；macOS 使用临时签名，没有 Developer ID 或公证。

网页中的结构化上下文仍不等于原生 API 角色通道，不保证不同模型具有完全相同行为；私有加密状态和不支持的内容不会伪装成完整传输。若升级或启动失败，保留安全诊断并按[故障排查手册](https://github.com/cmyk-labs/web2harness/blob/v1.1.1/docs/troubleshooting.zh-CN.md)处理，不删除账户或配置目录。

## English

Web2Harness 1.1.1 (`v1.1.1`, 2026-10-05) fixes structural differences in bridged Codex context and tools and establishes live capability acceptance for every release.

- **Original context**: Retains roles, ordering, content blocks, call associations, and original tool results. The brief bridge role, original Codex context, and transport output protocol are separate. Ordinary forwarding no longer removes old instructions, rewrites handle-like text, or silently trims history and images.
- **Tool identity and scope**: Preserves namespace trees, original names, function/custom kinds, parameter specifications, and custom formats. Routing keys stay inside the bridge. Top-level tools remain distinct from exec exports; original exec scripts and wait parameters are not wrapped or rewritten. JSON/SSE retain original call identities, with whole-batch and tool_choice validation before dispatch.
- **Continuation and compaction boundaries**: Incremental continuation requires a verified completed input prefix; changed history or instructions rebuild the conversation. Removes private Luna summary replacement in favor of Codex compaction, with a standard 28k/22k context/compaction budget. Insufficient capacity, unknown semantics, and undecodable cross-backend content fail explicitly.
- **Release acceptance**: Adds CAP-001 parallel reads and patching, CAP-002 a 15-second task with same-cell waiting, and CAP-003 three real child agents performing parallel read-only analysis. Each release reruns these cases and retains call and artifact evidence.
- **Parallel browser stability**: Starting or resuming an automatic task no longer switches away from a running selected tab, preventing viewport changes from dismissing its model menu and failing the turn. Explicit tab selection remains available.

### Updating and downloads

MCP Bridge tool definitions have changed. Refresh the selected connector's tool definitions after upgrading and restart affected Codex clients as prompted. Legacy wire_name calls fail explicitly rather than being guessed into new identities. Native Tools requires no MCP connector. Installed applications can check for updates; source and DEV runs disable in-app updates.

Choose the matching Windows x64 `.exe`, macOS Apple silicon/Intel `.dmg`, or Linux x64/arm64 `.AppImage` from Assets. The two macOS `.zip` files support automatic updates and terminal installation. `checksums.txt` covers seven packages; licenses are included.

### Validation scope and limitations

Full `bun run verify` passed on Windows x64: core 892 passed / 26 skipped, desktop 461 passed / 4 skipped, with no failures; type checks, dependency audits, builds, and relocatable-runtime smoke passed. An independently authenticated DEV profile reran CAP-001–003 using GPT-6 Pro and Native Tools, verifying native calls, same-cell continuation, three parallel read-only child agents, parent aggregation and closure, and file artifacts. All 432 inspected source files remained unchanged. The first CAP-003 attempt exposed the automatic-tab-switch defect; after the fix and regression tests, all three cases passed again. The initial failure and nonzero statuses from some source-excerpt commands remain in the acceptance record. Production configuration/authentication hashes and pre-existing process identities were unchanged.

This tag's release workflow performs verification, packaging, package startup, and uploaded-digest checks on all five native targets. Dedicated-tunnel authenticated MCP, authenticated continuation after cross-model compaction, and individual manual installation, upgrade, repair, and uninstall scenarios on every platform were not performed; offline contracts do not replace these checks. Windows installers are unsigned; macOS uses ad-hoc signing without Developer ID or notarization.

Structured context in a web conversation is not a native API role channel and cannot guarantee identical model behavior. Private encrypted state and unsupported content are not presented as fully transferred. If updating or startup fails, retain safe diagnostics and follow the [troubleshooting manual](https://github.com/cmyk-labs/web2harness/blob/v1.1.1/docs/troubleshooting.md); do not delete account or configuration directories.
