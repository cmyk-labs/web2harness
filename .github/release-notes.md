## 简体中文

Web2Harness 2.1.0（`v2.1.0`）增加共享请求队列，改进多代理协作和长上下文传输。

- **全局网页请求队列**：所有受支持工具模式共享并发名额，可设置并发数、排队超时和发送间隔；查看任务状态并取消等待或执行中的任务。
- **多代理工具交接**：父任务等待子代理期间释放网页名额，保留会话归属；改进工具发现、异步结果交接、取消和重试边界。
- **输入准备与错误提示**：保留会话发送前清空并核实输入，逐轮核对显式模型、思考档位和连接器；区分发送前输入故障与容量限制。
- **长上下文附件**：启用「上下文作为文件」后，超过 32 KiB UTF-8 的完整上下文通过 TXT 附件传递，输入框保留处理要求；确认附件处理完成后才发送，短上下文继续内联。
- **模型目录与队列显示**：改进客户端取消后的目录请求复用；会话筛选只显示当前筛选范围内有任务的会话，补全入队模型标签并统一队列文字样式。
- **MCP 完成判断**：观察到本轮工具调用、但本地尚无交接活动时，使用既有宽限期等待；到期明确失败，不把说明文字当作成功完成，也不自动重发。
- **压缩超限提示**：完整内联压缩输入超限时返回明确的上下文长度错误，重连保持原始处理建议，避免重复提交；不裁剪历史或自动改变文件传输设置。
- **诊断与资源限制**：补充队列、工具和浏览器请求关联，限制并发请求正文的总内存占用，保留脱敏诊断。
- **开发构建**：支持独立于发布的五平台候选构建，保留源码身份及制品校验文件。

### 验证范围与已知限制

本轮约定的功能验收已完成，包含原生工具与自动MCP的主任务加三个子代理、真实读写与结果回读、长上下文附件、队列界面及诊断导出。自动化回归、认证DEV和原生包检查分别记录，既有有效证据经复核复用。

安装、升级、实际用户激活、下载更新及卸载的完整人工验收未在本轮执行，按维护者安排后续进行，不列为已通过。未执行各平台完整真实账号交互验收；CI构建和包冒烟不替代这些人工流程。

历史上曾出现网页发起工具调用、远端未交到本地的情况，发生概率和远端原因仍未确定，根因调查及修复按维护者决定暂缓。本轮完成判断保护只覆盖可识别的当前绑定且本地零活动场景，不代表远端投递问题已修复。遇到明确交接失败时保留诊断，核对任务实际执行状态后再决定下一步。

发布制品为 Windows x64、macOS arm64/x64、Linux x64/arm64 的七个包及 `checksums.txt`，由对应平台原生CI构建并检查。Windows未做证书签名；macOS使用ad-hoc签名，未作Developer ID签名或公证。

出现问题时从「用量与诊断 → 运行日志」导出相关日期的诊断包，分享前检查其中信息。显示的是本应用保留的日志和本地计数，不是官方剩余额度。

## English

Web2Harness 2.1.0 (`v2.1.0`) adds a shared request queue and improves multi-agent work and long-context transport.

- **Shared web-request queue**: Supported tool modes share concurrency capacity, with configurable concurrency, queue expiry and send intervals, task status and cancellation.
- **Multi-agent tool handoff**: Parent waits release browser capacity while preserving conversation ownership. Improves tool discovery, asynchronous delivery, cancellation and retry boundaries.
- **Input preparation and errors**: Clears and verifies retained-chat input before submission, checks explicit model, effort and connector choices each round, and distinguishes input failures before submission from capacity limits.
- **Long-context attachments**: With Context as File enabled, complete contexts larger than 32 KiB in UTF-8 use a TXT attachment while the composer contains processing instructions. Sending waits for attachment processing; shorter contexts remain inline.
- **Model catalog and queue display**: Improves catalog-request reuse after client cancellation, limits session options to sessions with jobs in the current filter scope, completes queued model labels, and aligns queue typography.
- **MCP completion handling**: When a current-round tool call is observed but no local handoff activity exists, waits within the existing grace period and fails explicitly on expiry, without accepting explanatory prose as success or automatically resending.
- **Compaction limits**: Oversized inline compaction returns an explicit context-length error and preserves the original recovery advice on reconnect without resubmitting, trimming history or automatically changing file-transfer settings.
- **Diagnostics and resource limits**: Correlates queue, tool and browser requests, bounds aggregate request-body memory, and preserves redacted diagnostics.
- **Development builds**: Supports five-target candidate builds independently of publication, with source provenance and artifact checksums.

### Validation scope and known limitations

The agreed functional acceptance is complete, covering a parent plus three children through Native Tools and Automatic MCP, real reads/writes and result readback, long-context attachments, queue UI and diagnostic export. Automated regression, authenticated DEV and native-package checks are recorded separately, with reviewed valid evidence reused.

Full manual installation, upgrade, actual customer activation, download/update and uninstall acceptance was not performed in this batch and remains for later maintainer-arranged checks; these are not recorded as passed. Complete real-account interaction was not exercised on every platform. CI builds and package smoke do not substitute for these manual flows.

Historical tool calls were issued by the browser without reaching the local broker. Their frequency and remote cause remain unknown; investigation and repair of that cause are deferred by the maintainer. The new completion guard covers identifiable current bindings with no local activity and does not repair remote delivery. On an explicit handoff failure, retain diagnostics and check actual task execution before deciding how to proceed.

The release inventory is seven Windows x64, macOS arm64/x64 and Linux x64/arm64 packages plus `checksums.txt`, built and checked on matching native CI runners. Windows packages are not certificate-signed. macOS uses ad-hoc signing without Developer ID signing or notarization.

For problems, export the relevant date range from **Usage & diagnostics → Runtime logs** and review the bundle before sharing. Displayed logs and counts cover this application's retained local records, not an official remaining allowance.
