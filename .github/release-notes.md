## 简体中文

Web2Harness 2.5.4（`v2.5.4`）修复公开进度尾段丢失，并补全后续故障定位所需的日志。

- **完整交付进度尾段**：成功完成且正文证据完整时，交付尚未输出的公开进度尾段；保持续接去重，不把失败或取消当作完成。
- **中断来源与传播**：记录本地首次观察到的中断及父事件引用，串联WebSocket、HTTP、任务/轮次、队列尝试和辅助进程；分别保留取消、关停、输入关闭、管道失败及进程退出证据。
- **模型校验历史**：区分aria描述与可见标题，记录模型/强度匹配条件、滑块状态、控件重建及状态变化；失败最多保留32个变化状态，不保存未知页面文本。
- **有界故障现场与导出**：桌面独立保存结构化故障上下文，保留首次绑定及近期观察，纳入现有诊断包；报告丢弃、淘汰和写入失败，不包含对话正文、工具载荷或凭据。
- **保持Codex能力**：模型、强度、上下文、原生工具、权限、审批、等待、重试及点击/Enter策略保持原有行为；严格模型校验不放宽。

### 验证范围与已知限制

确定性测试覆盖首因传播、独立错误、队列结算、helper真实子进程EOF/关停/取消/输出断管、模型状态历史、日志轮转与导出。真实Chrome模型夹具通过。认证隔离DEV确认主动取消及因果链，并在同一服务不重启的情况下完成GPT-6/xhigh的4次请求、2条原生命令、1次补丁和完整最终回答；实际诊断包包含首次中断及传播引用，覆盖完整。

完整源码验证、五个原生构建目标和新包完整性由对应CI检查。有效的既有验收证据继续沿用，跳过和未执行项不计通过。本轮未重新完成人工安装/升级/卸载、跨平台认证、远端MCP绑定、物理输入或跨DPI验收；CI包冒烟不替代这些检查。

历史连接重置、模型校验失败及更早点击/附件超时的底层原因仍未证实，不能宣称全部根治。日志证明本地观察和传播，不保证确定远端服务或网络设备的内部原因；强杀或已断开的日志管道仍可能丢失末尾记录。既有Web模型协议兼容及偶发发送、缺正文、音频识别限制继续保留。

遇到问题时记录版本与发生时间，在“用量与诊断 → 日志 → 导出诊断包”保留现场后检查具体错误。升级不会自动恢复未知发送暂停；在运行控制核对发送状态并明确恢复，不要盲目重发结果未知的请求。此前未保存的历史证据无法由本版本补回。

发布目标为Windows x64、macOS arm64/x64、Linux x64/arm64的七个包及`checksums.txt`。Windows无证书签名；macOS为ad-hoc签名，未作Developer ID签名或公证。

## English

Web2Harness 2.5.4 (`v2.5.4`) fixes missing public progress tails and adds evidence for diagnosing future failures.

- **Complete progress delivery**: Flush the remaining public progress tail after successful completion with complete text evidence. Preserve continuation deduplication and never treat failure or cancellation as completion.
- **Interruption origin and propagation**: Record the first locally observed interruption and parent-event references across WebSocket, HTTP, task/turn, queue attempts and helpers. Distinguish cancellation, shutdown, closed input, pipe failure and process exit.
- **Model verification history**: Separate aria descriptions from visible headers and record model/effort predicates, slider state, control remounts and state changes. Retain up to 32 changed states on failure without unknown page text.
- **Bounded failure context and export**: Retain structural failure context separately on desktop, preserving initial binding and recent observations in existing diagnostic bundles. Report dropped/evicted records and write failures; exclude conversation bodies, tool payloads and credentials.
- **Preserve Codex capabilities**: Keep model, effort, context, native tools, permissions, approvals, waits, retries and click/Enter behavior unchanged. Strict model verification remains enforced.

### Validation scope and known limitations

Deterministic tests cover first-event propagation, independent errors, queue settlement, real helper subprocess EOF/shutdown/cancellation/broken output, model history, log rotation and export. Real Chrome model fixtures passed. Authenticated isolated DEV confirmed cancellation and its causal chain, followed without a service restart by GPT-6/xhigh execution with four requests, two native commands, one patch and a complete final answer. The real diagnostic bundle retained the initial interruption and propagation references with complete coverage.

The corresponding CI checks full source verification, five native build targets and new-package integrity. Valid existing acceptance evidence is reused; skipped and unexecuted checks are not passes. Manual installation/upgrade/uninstall, authenticated cross-platform operation, remote MCP binding, physical input and cross-DPI acceptance were not repeated in this round. CI package smoke does not replace these checks.

The underlying causes of historical connection resets, model-check failures and earlier click/attachment timeouts remain unproven; this release does not claim to eliminate them all. Logs establish local observations and propagation, not necessarily the internal cause in a remote service or network device. Forced termination or a broken diagnostic pipe can still lose final records. Existing Web-model protocol limitations and intermittent send, missing-answer and audio-recognition risks remain.

If a problem occurs, record the version and time, export a diagnostic bundle from Usage & diagnostics → Logs, and inspect the specific error. Upgrade does not automatically clear an unknown-send pause: review send state in Runtime controls and explicitly recover without blindly resending an uncertain request. This release cannot reconstruct historical evidence that was never saved.

Release targets are seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization.
