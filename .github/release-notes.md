## 简体中文

Web2Harness 2.5.6（`v2.5.6`）补齐中文模型档位识别，开放未授权时的参数配置，并改进附件与响应事件兼容。

- **中文模型档位**：将“即时／中／高／极高”正确识别为 low／medium／high／xhigh，继续严格核对所选模型家族和档位。
- **配置与授权**：授权码缺失或失效时，偏好设置和运行参数仍可编辑、保存及恢复默认。需要运行时支持的设置暂存，恢复有效授权并就绪后可在空闲时显式应用；执行任务、服务操作和应用设置仍受授权检查。
- **窗口与启动文案**：明确“关闭窗口后在后台运行”“自动任务开始时显示内置浏览器”和“开机启动（登录后）”。自启动发生在用户登录系统后，任务仍需有效授权。
- **附件识别**：识别附件身份时兼容悬停前隐藏的移除按钮，仍要求外层卡片可见且唯一，实际删除保留正常可操作性检查。
- **响应事件**：兼容五类已知元数据路径的顶层无值 `remove`，同步诊断保留与回放；未知路径、身份冲突及缺失完成证据仍拒绝。

### 验证范围与已知限制

候选已完成针对性单元、界面及隔离认证DEV验证。新的独立主会话实际委派三个GPT-6（Web）高子agent并自行汇总：70次请求全部原生交付，70次模型档位检查匹配，三份子报告和主报告均完整返回。版本准备仅更改版本与发布元数据，复用该实现的验收证据。完整源码验证、依赖审计、五目标原生构建和新包完整性以对应发布工作流结果为准；跳过与未执行项不计通过。

**以下审查问题尚未在本版本修复：** 应用待保存设置时可能与新任务入队交错；热应用失败后持久配置与运行组件可能不一致；响应数组补丁对等于数组长度的删除／替换索引校验不足。前两项为尚待故障注入确认的风险，第三项已由源码复核。请在确认任务空闲、暂停外部新任务提交后应用设置；若显示应用失败，先检查运行状态及诊断，再在空闲时明确重试，不将“保存成功”当作“全部运行组件已应用”。这些操作提示不代表上述风险已经消除。

历史附件超时及不支持响应事件的原始载荷不完整，本次修复针对独立复现的实现缺口，不宣称证明所有历史故障的唯一根因。审核agent的工具查询错误、环境限制及此前验收失败继续留档。本轮没有重新执行MCP／Zero Risk全组合、人工安装／升级／卸载、系统登录自启动或其它操作系统的认证验收；CI包冒烟不替代这些检查。

遇到问题时记录版本和时间，通过“用量与诊断 → 日志 → 导出诊断包”保留现场。未知发送状态应先检查再明确恢复，避免盲目重发。

发布目标为Windows x64、macOS arm64/x64、Linux x64/arm64的七个包及`checksums.txt`。Windows无证书签名；macOS为ad-hoc签名，未作Developer ID签名或公证。

## English

Web2Harness 2.5.6 (`v2.5.6`) recognizes Chinese model-effort labels, permits configuration without a valid license, and improves attachment and response-event compatibility.

- **Chinese effort labels**: Recognize 即时／中／高／极高 as low／medium／high／xhigh while retaining strict checks of the selected model family and effort.
- **Configuration and licensing**: Preferences and Runtime parameters remain editable, saveable and resettable when a license is missing or invalid. Settings that require a ready runtime are saved for explicit idle application after authorization and setup; task execution, service operations and applying settings remain license-gated.
- **Window and startup labels**: Clarify background operation after window close, showing the embedded browser when automatic tasks start, and startup after signing in to the computer. Starting the app at sign-in does not remove task licensing requirements.
- **Attachment identification**: Include remove controls hidden until hover when identifying a visible, unique attachment card. Actual removal retains normal actionability checks.
- **Response events**: Accept top-level valueless `remove` only for five known metadata paths, with matching evidence retention and replay. Unknown paths, identity conflicts and missing completion evidence remain rejected.

### Validation scope and known limitations

The candidate completed focused unit, UI and isolated authenticated DEV checks. A new independent main session delegated three GPT-6 (Web) high agents and aggregated their results: all 70 requests were delivered natively, all 70 model/effort checks matched, and all three child reports plus the main report arrived completely. Version preparation changes only version and release metadata and reuses acceptance evidence for the same implementation. Full source verification, dependency audits, five native build targets and new-package integrity are established by the release workflow results; skipped and unexecuted checks are not passes.

**Review findings remain unresolved in this version:** applying saved settings may interleave with a newly admitted task; a failed hot application may leave persisted settings and runtime components inconsistent; response-array patch validation permits a remove/replace index equal to the array length. The first two are risks awaiting fault injection; the third was confirmed by source inspection. Apply settings after confirming idle state and pausing external task submissions. If application fails, inspect runtime state and diagnostics before an explicit idle retry; saved settings do not prove every runtime component has applied them. These precautions do not establish that the risks are eliminated.

Historical attachment timeouts and unsupported response events lack complete original payloads. These fixes address independently reproducible implementation gaps, without claiming the unique cause of every historical failure. Agent tool-query errors, environment limitations and earlier acceptance failures remain recorded. This release does not rerun all MCP/Zero Risk combinations, manual installation/upgrade/uninstall, system-login startup or authenticated acceptance on other operating systems. CI package smoke does not replace those checks.

After an error, record the version and time and export a diagnostic bundle from Usage & diagnostics → Logs. Inspect an unknown-send state before explicitly recovering; do not blindly resend.

Release targets are seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization.
