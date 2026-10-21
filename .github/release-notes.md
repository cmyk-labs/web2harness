## 简体中文

Web2Harness 2.5.3（`v2.5.3`）修复浏览器检查误报、过时成功状态和队列恢复流程。

- **区分连接与发送验证**：已有队列暂停时，实际检查登录与页面，但不发送测试消息。明确显示发送验证被阻断及恢复入口，不再把队列阻断误报为浏览器连接或整体运行故障。
- **保留错误与正确状态**：跨帮助进程和界面保留结构化错误及诊断编号，分别记录主失败和清理失败。普通操作失败或取消不再污染浏览器健康；真实页面加载故障仍正常报错。
- **使过时检查失效**：区分通过、阻断、失败、取消和未执行。失败、认证变化或浏览器进程重启使当前证明失效，迟到结果不能恢复旧成功状态；历史成功单独保存。
- **可核对的队列恢复**：未解决暂停保留有界原因、时间和发送阶段摘要，普通回执过期后仍可核对。恢复拒绝过时确认，并要求没有活动任务或浏览器资源；保留独立的手动暂停，不重发旧请求。
- **保持Codex能力**：模型、推理强度、上下文、原生工具、权限、审批、等待和点击/Enter策略保持原有行为。

升级或重启不会自动解除未知发送暂停。在“运行控制”核对阻断原因并明确恢复后，再运行“检查浏览器连接”。恢复本身不代表真实发送验证通过。

### 验证范围与已知限制

隔离测试覆盖结构化错误、检查结果失效、账号身份范围、迟到结果、回执过期和恢复确认。双语界面专项11项及完整工作区326项通过。独立认证DEV验证了暂停时实际连接通过且没有新增发送、恢复后真实测试消息成功，以及GPT-6/high Native Tools的两条真实命令、一次文件补丁和完整最终答案交付。

完整源码验证、五个原生构建目标及新包完整性由对应CI检查；跳过和未执行项不计为通过。有效的既有证据继续沿用。本轮未重新完成人工安装/升级/卸载、跨平台认证、真实账号切换、远端MCP绑定、真实最小化/失焦、物理输入或跨DPI验收。用户手动DEV验收尚无结果；CI包冒烟不替代人工验收。

原始点击超时、历史七次附件超时及不完整进度句的底层原因仍未完全证实。本版本修复已证实的检查、状态和恢复缺口，不宣称这些历史故障全部根治。既有Web模型协议兼容限制及偶发发送、缺正文、音频识别风险继续保留。

发布目标为Windows x64、macOS arm64/x64、Linux x64/arm64的七个包及`checksums.txt`。Windows无证书签名；macOS为ad-hoc签名，未作Developer ID签名或公证。

## English

Web2Harness 2.5.3 (`v2.5.3`) fixes misleading browser checks, stale success state and queue recovery.

- **Separate connectivity from send verification**: When dispatch is paused, check the actual sign-in and page without sending a test message. Show blocked send verification and a recovery link instead of misreporting a browser or overall runtime failure.
- **Preserve errors and health state**: Carry structured errors and diagnostic references across helper and renderer boundaries, retaining primary and cleanup failures separately. Ordinary operation failures or cancellations no longer poison browser health; real page-load failures still report an error.
- **Invalidate stale checks**: Distinguish passed, blocked, failed, cancelled and not-run results. Failure, authentication changes or browser-process restart invalidate current proof; late results cannot revive old success. Historical success is retained separately.
- **Reviewable queue recovery**: Keep bounded reason, time and send-stage summaries for unresolved pauses after ordinary receipts expire. Reject stale confirmations and require no active tasks or browser resources. Preserve a separate manual pause and never replay old requests.
- **Preserve Codex capabilities**: Retain model, effort, context, native tools, permissions, approvals, wait semantics and click/Enter behavior.

Upgrade or restart does not automatically clear an unknown-send pause. Review the blocker in Runtime controls, explicitly recover, then run Check browser connection again. Recovery alone does not pass actual send verification.

### Validation scope and known limitations

Isolated tests cover structured errors, stale checks, account identity scope, late results, receipt expiry and recovery confirmation. The bilingual browser-check suite passed 11 checks and the full workspace suite passed 326. Independently authenticated DEV confirmed real connectivity without a new send while paused, a successful real test message after recovery, and GPT-6/high Native Tools execution with two real commands, one file patch and complete final-answer delivery.

The corresponding CI checks full source verification, five native build targets and new-package integrity; skipped and unexecuted checks are not passes. Valid existing evidence is reused. Manual installation/upgrade/uninstall, authenticated cross-platform operation, real account switching, remote MCP binding, real minimization/focus loss, physical input and cross-DPI acceptance were not repeated in this round. The user's manual DEV acceptance has no reported result; CI package smoke does not replace manual acceptance.

The underlying causes of the original click timeout, seven earlier attachment timeouts and an incomplete progress sentence remain unproven. This release fixes confirmed check, state and recovery gaps without claiming to eliminate all historical failures. Existing Web-model protocol limitations and intermittent send, missing-answer and audio-recognition risks remain.

Release targets are seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization.
