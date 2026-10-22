## 简体中文

Web2Harness 2.5.5（`v2.5.5`）改进网页交互恢复、工具交付和并发任务隔离，并补齐真实 MCP 与 Zero Risk 验收。

- **发送与模型恢复**：点击失败后执行一次 Enter 兜底；已有接受证据时不重复发送。发送期间并行观察接受状态，明确输入结束与远端接受的区别；模型菜单可作有界恢复，始终保留指定模型和思考强度。
- **响应与工具交付**：补充公开 final 候选、协议校验和交付失败的安全诊断；支持没有正文的有效 MCP 工具回合，改进中文工具确认识别。保留 Codex 原生工具、沙箱、审批及上下文边界，不用模型成功声明代替真实执行。
- **队列与故障隔离**：仅状态查询在连接重置时进行一次受限重连；改进取消后的物理资源结算、可证明的单页面故障隔离，以及手动 MCP 错误重连，避免错误恢复另开网页。
- **可选 MCP v2**：新增明确选择的 `web2harness-handoff-v2`，提交身份由宿主根据当前回合和准确调用派生，相同提交复用回执。缺省和既有 v1 选择保持兼容，不在当前回合自动降级或切换协议。切换前等待活动资源结算，随后重启运行时及隧道 worker，并刷新检查连接器工具目录。
- **桌面与上下文**：Electron 升级至 43.8.3；完善交付阶段展示、故障证据和与所选契约一致的上下文估算。token 数仍为估算，不宣称已证明整体性能提升。

### 验证范围与已知限制

既有隔离认证 DEV 证据覆盖 Native Tools 读取、补丁、命令断言及最终回复，取消后恢复、四页面并发与单目标隔离，以及 MCP Automatic／Zero Risk 各 v1/v2 的真实工具链。另有新独立主会话实际委派三个 GPT-6（Web）高子 agent 完成审核和汇总：109 次模型请求成功交付，全部子报告完整回传。维护者选择本次复用该结果；版本准备前源码与该验收候选一致。本轮不重复运行该完整任务，也不把它视为 MCP／Zero Risk 同任务或全平台验收。

此前验收的初次失败、受控故障、同线程显式续跑和局部工具输入错误均保留；后续通过不改写历史。候选完整源码验证与依赖审计、五个原生目标构建和新包完整性以对应发布检查为准，跳过及未执行项不计通过。

发布准备修复源码指纹对 NSIS 包含文件和打包补丁换行格式的误判，并为多轮上下文恢复集成用例设置明确的有限测试时限，保留全部功能断言。Windows CI 首轮的默认五秒超时失败另行留证。

历史模型强度 unknown、缺少公开 final、部分点击／附件超时等底层原因仍未全部证实。最新静态审核提出的候选风险未在本次发布准备中逐项动态复现或自动应用；不宣称所有网页问题已根治。维护者已知的人工安装／升级／卸载、系统服务、其他操作系统认证、物理输入和跨 DPI 验收缺口继续保留；CI 包冒烟不能替代这些检查。

遇到问题时记录版本和时间，通过“用量与诊断 → 日志 → 导出诊断包”保留现场。升级不会自动清除未知发送暂停；先在运行控制确认发送状态，再明确恢复，避免盲目重发。MCP v2 工具缺失时刷新并检查连接器目录，不通过改用 v1 工具绕过当前协议。

发布目标为 Windows x64、macOS arm64/x64、Linux x64/arm64 的七个包及 `checksums.txt`。Windows 无证书签名；macOS 为 ad-hoc 签名，未作 Developer ID 签名或公证。

## English

Web2Harness 2.5.5 (`v2.5.5`) improves browser recovery, tool delivery and concurrent-task isolation, with authenticated MCP and Zero Risk acceptance evidence.

- **Sending and model recovery**: Apply one Enter fallback after click failure, suppressing another send when acceptance evidence already exists. Observe acceptance during input and distinguish input settlement from remote acceptance. Bound model-menu recovery while preserving the explicitly selected model and effort.
- **Response and tool delivery**: Add safe diagnostics for public final candidates, protocol validation and delivery failures. Support valid MCP tool turns without response text and improve Chinese tool-confirmation recognition. Preserve native Codex tools, sandbox, approvals and context boundaries; a model success statement is not execution evidence.
- **Queue and fault isolation**: Retry only a status query once after a connection reset. Improve physical resource settlement after cancellation, provable per-page fault isolation and manual MCP error reconnection without opening another browser conversation.
- **Optional MCP v2**: Add explicit selection of `web2harness-handoff-v2`. The host derives submission identity from the current round and exact calls; identical submissions reuse their receipt. Defaults and existing v1 selections remain compatible, without automatic protocol downgrade or switching within a round. Settle active resources before changing the protocol, then restart the runtime and tunnel worker and refresh and inspect the connector catalog.
- **Desktop and context**: Update Electron to 43.8.3. Improve delivery-stage presentation, failure evidence and context estimates for the selected contract. Token counts remain estimates; no overall performance improvement is claimed from these checks.

### Validation scope and known limitations

Existing isolated authenticated DEV evidence covers Native Tools reads, patches, command assertions and final replies, recovery after cancellation, four concurrent pages and single-target isolation, and real tool chains for MCP Automatic and Zero Risk using both v1 and v2. A separate new main session delegated three GPT-6 (Web) high agents and aggregated their reviews: all 109 model requests were delivered, with complete child reports returned. The maintainer chose to reuse this result; source identity before version preparation matched that candidate. This complete task is not rerun for this release and does not establish the same task in MCP/Zero Risk or acceptance on every platform.

Earlier initial failures, controlled faults, explicit continuation in the same thread and local tool-input errors remain recorded; later success does not overwrite them. Full candidate source verification and dependency audits, five native build targets and new-package integrity are established by the corresponding release checks. Skipped and unexecuted checks are not passes.

Release preparation corrects source fingerprints for line-ending differences in NSIS includes and packaging patches, and gives the multi-turn context-recovery integration case an explicit bounded test timeout while preserving every functional assertion. The first Windows CI failure at the default five-second timeout remains recorded.

The underlying causes of historical unknown-effort observations, missing public finals and some click/attachment timeouts remain unproven. Candidate risks from the latest static review were not individually reproduced or automatically applied during release preparation; this release does not claim to eliminate every browser issue. Known gaps in manual installation/upgrade/uninstall, system services, authenticated operation on other operating systems, physical input and cross-DPI acceptance remain. CI package smoke does not replace those checks.

After an error, record the version and time and export a diagnostic bundle from Usage & diagnostics → Logs. Upgrade does not automatically clear an unknown-send pause: review send state in Runtime controls before explicitly recovering, without blindly resending. If MCP v2 tools are missing, refresh and inspect the connector catalog instead of switching to v1 tools within the current protocol.

Release targets are seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization.
