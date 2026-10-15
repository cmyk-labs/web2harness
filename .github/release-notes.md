## 简体中文

Web2Harness 2.1.0 发布候选，尚未发布。

- **全局网页请求队列**：所有受支持工具模式共享并发名额，可设置并发数、排队超时和发送间隔；查看任务状态并取消等待或执行中的任务。
- **多代理工具交接**：父任务等待子代理期间释放网页名额，保留会话归属；改进工具发现、异步结果交接、取消和重试边界。
- **输入准备与错误提示**：保留会话发送前清空并核实输入，逐轮核对显式模型、思考档位和连接器；区分发送前输入故障与容量限制。
- **长上下文附件**：启用「上下文作为文件」后，超过 32 KiB UTF-8 的完整上下文通过 TXT 附件传递，输入框保留处理要求；确认附件处理完成后才发送，短上下文继续内联。
- **模型目录与队列显示**：改进客户端取消后的目录请求复用；会话筛选只显示当前筛选范围内有任务的会话，补全入队模型标签并统一队列文字样式。
- **MCP 完成判断**：观察到本轮工具调用、但本地尚无交接活动时，使用既有宽限期等待；到期明确失败，不把说明文字当作成功完成，也不自动重发。
- **压缩超限提示**：完整内联压缩输入超限时返回明确的上下文长度错误，重连保持原始处理建议，避免重复提交；不裁剪历史或自动改变文件传输设置。
- **诊断与资源限制**：补充队列、工具和浏览器请求关联，限制并发请求正文的总内存占用，保留脱敏诊断。
- **候选验证**：新增源码身份与验收记录门禁，以及独立于发布的五平台候选构建与校验文件。

### 候选状态

当前候选仍在验收中。自动化回归、认证 DEV 和 Windows 候选包检查分别记录结果。本轮按维护者决定不验收跨平台构建、安装、升级、下载和卸载，未执行项不算通过。发布前必须完成当前候选适用的发布检查并获得维护者确认；本说明不沿用历史版本的发布后验收安排。

历史上曾出现网页发起工具调用、远端未交到本地的情况，发生概率和远端原因仍未确定，根因调查及修复按维护者决定暂缓。本轮完成判断保护只覆盖可识别的当前绑定且本地零活动场景，不代表远端投递问题已修复。遇到明确交接失败时保留诊断，核对任务实际执行状态后再决定下一步。

计划制品为 Windows x64、macOS arm64/x64、Linux x64/arm64 的七个包及 checksums.txt。Windows 未做证书签名；macOS 使用 ad-hoc 签名，未作 Developer ID 签名或公证。构建和包冒烟不等于各平台真实账号或人工安装验收。

出现问题时从「用量与诊断 → 运行日志」导出相关日期的诊断包，分享前检查其中信息。显示的是本应用保留的日志和本地计数，不是官方剩余额度。

## English

Web2Harness 2.1.0 release candidate; not published.

- **Shared web-request queue**: Supported tool modes share concurrency capacity, with configurable concurrency, queue expiry and send intervals, task status and cancellation.
- **Multi-agent tool handoff**: Parent waits release browser capacity while preserving conversation ownership. Improves tool discovery, asynchronous delivery, cancellation and retry boundaries.
- **Input preparation and errors**: Clears and verifies retained-chat input before submission, checks explicit model, effort and connector choices each round, and distinguishes input failures before submission from capacity limits.
- **Long-context attachments**: With Context as File enabled, complete contexts larger than 32 KiB in UTF-8 use a TXT attachment while the composer contains processing instructions. Sending waits for attachment processing; shorter contexts remain inline.
- **Model catalog and queue display**: Improves catalog-request reuse after client cancellation, limits session options to sessions with jobs in the current filter scope, completes queued model labels, and aligns queue typography.
- **MCP completion handling**: When a current-round tool call is observed but no local handoff activity exists, waits within the existing grace period and fails explicitly on expiry, without accepting explanatory prose as success or automatically resending.
- **Compaction limits**: Oversized inline compaction returns an explicit context-length error and preserves the original recovery advice on reconnect without resubmitting, trimming history or automatically changing file-transfer settings.
- **Diagnostics and resource limits**: Correlates queue, tool and browser requests, bounds aggregate request-body memory, and preserves redacted diagnostics.
- **Candidate validation**: Adds source identity and acceptance-evidence gates, plus five-target candidate builds and checksums that run independently of publication.

### Candidate status

Acceptance is still in progress. Record automated regression, authenticated DEV and Windows candidate-package checks separately. Cross-platform build, installation, upgrade, download and uninstall acceptance is excluded from this batch by the maintainer; unexecuted checks are not passes. Publication requires completion of applicable current-candidate release checks and maintainer confirmation. Historical post-publication acceptance arrangements do not apply.

Historical tool calls were issued by the browser without reaching the local broker. Their frequency and remote cause remain unknown; investigation and repair of that cause are deferred by the maintainer. The new completion guard covers identifiable current bindings with no local activity and does not repair remote delivery. On an explicit handoff failure, retain diagnostics and check actual task execution before deciding how to proceed.

The planned inventory is seven Windows x64, macOS arm64/x64 and Linux x64/arm64 packages plus checksums.txt. Windows packages are not certificate-signed. macOS uses ad-hoc signing without Developer ID signing or notarization. Builds and package smoke checks do not establish real-account or manual installation acceptance on every platform.

For problems, export the relevant date range from **Usage & diagnostics → Runtime logs** and review the bundle before sharing. Displayed logs and counts cover this application's retained local records, not an official remaining allowance.
