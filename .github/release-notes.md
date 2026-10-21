## 简体中文

Web2Harness 2.5.1（`v2.5.1`）修复附件处理的失败分类、恢复与终态边界，并增加公开正文交付诊断。

- **准确区分失败**：读取处理状态失败、创建连接断开或缺少完成事件时，保留“结果未确认”，不据此删除附件并重新上传。永久性HTTP错误不重传；明确可恢复的上传失败仍只重试一次，429保留原始错误。
- **同请求有限恢复**：在当前尝试的剩余期限内，最多两次补读原处理响应；恢复不刷新网页、不重放上传或处理请求。保留既有独立操作时限及明确失败重试的独立处理额度。
- **可靠终态**：取消或超时后的迟到完成事件不能再改变结果，旧尝试及冲突文件身份不能被误记为当前成功。
- **诊断证据**：分别记录附件业务阶段与观察状态，增加公开正文从来源、转换到消息记录和输出回调的长度及指纹对照。新诊断不保存正文、工具参数或私有推理；回调返回不等于客户端确认。
- **Codex能力保持**：沿用原生指令、完整上下文、工具目录及参数、显式模型与推理强度、子任务与等待语义，以及任务权限和审批规则。
- **构建依赖修复**：将桌面构建工具Vite固定到6.4.4，修复发布前审计发现的launch-editor相关安全问题。

### 验证范围与已知限制

附件与原生交付定向回归已通过。隔离的认证DEV验证了真实处理连接中断、附件等待中取消，以及同实例随后执行2条原生命令和1次补丁；4轮正常请求各发送一次，3条公开进度在原生CLI回执中匹配。漏收事件、临时补读失败及迟到事件等特殊时序另有夹具证据，未逐项在认证账户注入。

此前七次附件超时的底层原因及一条不完整进度句的来源仍未完全证实，本版本不宣称全部根治。实时流和补读共享浏览器调试连接；连接共同不可用且没有有效完成证据时，仍返回结果未确认。既有Web模型协议兼容限制和偶发发送、缺正文、音频识别风险继续保留。

本版本源码完整验证、五个原生构建目标及新包完整性由对应CI检查；跳过和未执行项不计为通过。既有不受影响的验收证据继续沿用。实际人工安装、升级、卸载、物理输入、跨DPI和其他系统交互未在本轮重新验收，CI包冒烟不能替代这些结果。

发布目标为Windows x64、macOS arm64/x64、Linux x64/arm64的七个包及`checksums.txt`。Windows无证书签名；macOS为ad-hoc签名，未作Developer ID签名或公证。遇到异常请保留诊断日志，按故障排查说明处理，不手动删除认证或恢复记录。

## English

Web2Harness 2.5.1 (`v2.5.1`) fixes attachment failure classification, recovery and terminal-state handling, and adds public-text delivery diagnostics.

- **Accurate failure classification**: An unreadable processing state, a disconnected creation request or a missing completion event remains unconfirmed instead of triggering attachment removal and another upload. Permanent HTTP errors are not retried; explicitly recoverable upload failures retain one retry, and HTTP 429 preserves the original error.
- **Bounded recovery of the same request**: Read the original processing response at most twice within the current attempt's remaining deadline, without refreshing the page or replaying upload or processing requests. Existing independent operation limits and the processing allowance for an explicit failed-upload retry remain in place.
- **Reliable terminal states**: Late completion cannot reverse cancellation or timeout. Events from an older attempt or conflicting file identities cannot establish current success.
- **Diagnostic evidence**: Record attachment business stages separately from observation health, with public-text lengths and fingerprints across source, projection, message journal and output callback. These new diagnostics contain no prose, tool arguments or private reasoning; callback return does not imply client acknowledgement.
- **Codex capabilities preserved**: Keep native instructions, full context, tool definitions and arguments, explicit model and effort choices, child-task and wait semantics, and task permissions and approvals.
- **Build dependency fix**: Pin the desktop build tool Vite to 6.4.4 to address the launch-editor security advisories found during release verification.

### Validation scope and known limitations

Focused attachment and native-delivery regressions passed. Isolated authenticated DEV checks covered a real processing connection interruption, cancellation during attachment wait, and two native commands plus one patch in the same instance afterward. Each of four healthy requests sent once, and three public commentary messages matched actual Codex CLI receipts. Missing events, transient readback failures and late events also have fixture coverage; not every timing case was injected into an authenticated account.

The underlying causes of seven historical attachment timeouts and one incomplete progress sentence remain unproven; this release does not claim to eliminate all of them. Streaming and readback share the browser debugging connection. If both are unavailable and completion cannot be established, the result remains unconfirmed. Existing Web-model protocol limitations and intermittent send, missing-answer and audio-recognition risks remain.

The corresponding CI checks full source verification, five native build targets and new-package integrity; skipped and unexecuted checks are not passes. Valid unaffected acceptance evidence is reused. Manual installation, upgrade, uninstall, physical input, cross-DPI behavior and other operating-system interaction were not revalidated in this round; CI package smoke does not replace those results.

Release targets are seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization. Preserve diagnostic logs after errors and follow the troubleshooting instructions rather than manually deleting authentication or recovery records.
