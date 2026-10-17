## 简体中文

Web2Harness 2.3.0（`v2.3.0`）改进浏览器输入保护、上下文预算和 MCP 恢复，并修复网页回复完整性与原生 Codex 工具交付问题。现有模型路由 ID 保持不变。

- **默认禁止浏览器操作**：空闲首页、登录、手动及自动任务页面均默认保护；用户选择「恢复操作」并完成确认后，才可临时操作当前页。解除状态不落盘；新页面、重启及下一轮自动任务重新保护。登录弹窗的解除状态独立，自动化操作不受人工输入保护影响。
- **固定上下文预算**：运行参数仅提供标准／三倍两档，不再接受自定义窗口数值。Fast／非Fast标准窗口分别为80k／272k，支持三倍的自动Sol／Pro路由为240k／816k；95%可用容量与90%自动压缩阈值为派生值。旧自定义数值归一到固定值，保留有效预算模式。三倍仍为实验性预算，不改变单次网页消息限制，也不保证实际容量或完整召回；上下文文件传输及路由支持条件保持独立。
- **MCP冷却与有界恢复**：识别远端限流和连接错误，同一隧道／连接器共享冷却，优先遵循有效的Retry-After；缺失时使用有上限的退避与抖动。仅在满足安全重试条件时恢复，避免重放已发生工具活动的任务。保留取消和总重试预算，不以固定猜测值承诺官方请求配额。
- **真实就绪状态**：启动及代理恢复会核对隧道传输健康，通过后才恢复监控并报告就绪。认证失败等不可重试原因在清理同时失败时仍被保留，避免无效重试与误报恢复成功。
- **运行控制与诊断**：运行控制仅展示当前连接相关的未解决故障／冷却，历史接收记录和错误收纳到诊断。后续验证成功不再把旧失败当作当前故障；运行配置读取失败时，本地任务队列与取消入口仍可用。
- **回复与原生工具交付**：改进重复段落、公式和流式DOM的完整性检查；不完整回复明确失败并保留供审阅。修正模型检查与实际提交阶段的边界、队列中断原因和取消处理，保持显式模型／强度、原生工具、子任务及压缩流程。

### 验证范围与已知限制

本候选复用并复核已完成的核心与桌面回归、双端依赖审计和类型检查、界面／输入夹具、构建及可迁移运行时冒烟。冻结验证及各平台正式制品检查以此版本的CI记录为准；中间失败及修正后的复测分别保留，跳过项不计为通过。

独立Windows DEV已实际完成原生命令读取、补丁写入和独立命令逐字节回读；有效的真实子任务、压缩续接及MCP工具交接证据按累计影响复用。MCP实测完成两次命令、一次补丁及三次交接；此结果不能保证所有远端请求均成功。一次原生工具格式错误经既有纠错恢复，未改动模型或Codex本体来掩盖它。适用现场检查的生产配置、认证及受保护进程／服务对照无变化。

真实物理鼠标／触摸／输入法和原生解除确认框的完整人工复测、大窗口容量与召回、自然发生的长上下文压力及全模型／账号组合未完成验收。完整人工安装、升级、实际用户激活、下载更新、卸载与跨平台账号交互验收继续按维护者安排延期。自动化夹具、CI原生打包和包冒烟不替代这些人工或真实账号检查。

发布提供Windows x64、macOS arm64／x64、Linux x64／arm64的七个包及`checksums.txt`。工作流在对应平台构建，执行自动化验证、包冒烟与专项检查，核对文件清单和SHA-256后发布。Windows未做证书签名；macOS采用ad-hoc签名，未作Developer ID签名或公证。

升级后在任务空闲时应用配置，并重启对应Codex以刷新模型目录和预算。浏览器需要手动交互时选择「恢复操作」。遇到MCP认证或连接故障，先检查连接器绑定与凭据；导出相关日期的诊断并核对实际工具结果后，再决定是否重试。日志与本地计数不代表官方剩余额度。

## English

Web2Harness 2.3.0 (`v2.3.0`) improves browser input protection, context budgets and MCP recovery, and fixes web answer integrity and native Codex tool delivery. Existing model route IDs are unchanged.

- **Browser protection by default**: Idle home, sign-in, manual and automated task pages remain protected until you choose **Resume interaction** and confirm. The override applies to the current page and is not persisted; new pages, restarts and the next automatic turn restore protection. Sign-in popups have independent overrides. Automated operations remain available.
- **Fixed context budgets**: Runtime parameters offer Standard or Triple only, with no custom window values. Fast/non-Fast standard windows are 80k/272k; supported automatic Sol/Pro routes offer 240k/816k triple windows. Effective capacity (95%) and auto-compaction thresholds (90%) are derived values. Old custom numbers normalize to the fixed values while valid budget-mode choices survive. Triple remains experimental, does not increase single-message web limits and does not guarantee actual capacity or complete recall. Context-file transport and route eligibility remain separate conditions.
- **MCP cooldowns and bounded recovery**: Remote rate-limit and connection errors feed a shared cooldown for the same tunnel/connector. Valid Retry-After values take precedence; bounded backoff with jitter is used otherwise. Recovery requires safe retry conditions and avoids replaying tasks with observed tool activity. Cancellation and total retry budgets remain enforced. Local settings do not claim to represent an official request quota.
- **Verified readiness**: Startup and proxy recovery check tunnel transport health before restoring monitoring and reporting readiness. Non-retryable causes such as authentication failures survive simultaneous cleanup failures, preventing futile retries and false recovery success.
- **Runtime controls and diagnostics**: Runtime control shows unresolved failures/cooldowns for the current connection; historical receipts and errors live in diagnostics. Later verification distinguishes resolved historical failures. Local queue visibility and cancellation remain available if runtime configuration cannot be read.
- **Answers and native tools**: Improves integrity checks for repeated paragraphs, formulas and streaming DOM snapshots; incomplete responses fail explicitly and remain available for review. Corrects model-check/submission boundaries, queue interruption causes and cancellation handling while preserving explicit model/effort selection, native tools, subagents and compaction.

### Validation scope and known limitations

This candidate reuses and reviews completed core/launcher regressions, both dependency audits and typechecks, UI/input fixtures, builds and relocated-runtime smoke. Refer to this version's CI records for freeze validation and native artifact checks. Initial failures and successful retests are retained separately; skipped checks are not passes.

Isolated Windows DEV executed native command reads, a patch write and an independent byte-for-byte command readback. Valid real subagent, compaction-continuation and MCP handoff evidence is reused according to cumulative impact. The real MCP task completed two commands, one patch and three handoffs; that does not guarantee every remote request succeeds. An invalid native tool-call format recovered through existing correction, without modifying the model or Codex itself to conceal the failure. Applicable live checks found no changes in production configuration, authentication or protected processes/services.

Complete physical mouse/touch/IME and native unlock-confirmation checks, large-window capacity/recall, naturally occurring long-context stress and the full model/account matrix remain unexecuted. Full manual installation, upgrade, customer activation, download/update, uninstall and cross-platform account interaction remain deferred by the maintainer. Fixtures, native CI packages and package smoke do not replace these manual or authenticated checks.

The release contains seven packages plus `checksums.txt` for Windows x64, macOS arm64/x64 and Linux x64/arm64. The workflow builds on matching platforms, runs automated verification, package smoke and platform checks, then publishes after validating inventory and SHA-256 digests. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization.

After upgrading, apply configuration while tasks are idle and restart the corresponding Codex to refresh its catalog and budgets. Choose **Resume interaction** for manual browser actions. For MCP authentication or connection failures, check connector binding and credentials, export the relevant diagnostics and inspect actual tool results before retrying. Logs and local counts are not an official remaining allowance.
