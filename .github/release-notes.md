## 简体中文

Web2Harness 2.5.2（`v2.5.2`）改进网页发送可靠性、故障证据和队列状态展示。

- **点击优先，条件Enter兜底**：先检查发送按钮是否可操作。仅在实际输入前确认按钮被遮挡、仍可见且可用、没有阻断模态层时，才改用聚焦发送按钮后按一次Enter；发送前再次核验状态。实际点击或Enter一旦执行，结果未知时不重复发送。
- **可靠的发送判定**：保留点击后的命中检查，避免晚到遮挡导致无输入却返回成功。输入返回、获得许可和服务端接受分别记录；没有接受证据时继续保留未知结果保护。
- **完整失败证据**：输入动作结束后立即读取有界探针，保留原始错误及按钮可见性、命中和事件摘要。探针停止监听后结果仍可读取，安装或读取失败明确记为不可用；新增诊断不保存提示词或输入正文。
- **清晰的队列进度**：区分预检查、等待发送许可、正在发送、等待确认和结果复核，提供阻塞任务日志入口；展示状态不改变发送许可或接受判定。
- **上游兼容改进**：迁移并适配暂停计时和模型标题精确匹配，保留显式模型与推理强度检查。沿用Codex原生指令、完整上下文、工具参数、子任务与等待语义、权限及审批规则。

### 验证范围与已知限制

真实Chrome DOM夹具覆盖正常点击、遮挡Enter兜底、延迟可用、模态阻挡、失焦和取消等边界。隔离的认证DEV使用GPT-6/high及Native Tools，验证了受控遮挡下单次Enter产生一个生成请求，后续真实命令、文件补丁与原生最终答案交付；另验证了Enter被阻止后取消时没有生成请求、工具执行或最终答案。概览页后台轮次通过，但不等同于操作系统最小化或真实失焦验收。

原2.5.1会话点击超时的底层原因、此前七次附件超时及一条不完整进度句的来源仍未完全证实，本版本不宣称全部根治。已经执行输入但结果未知时不会用Enter重发。既有Web模型协议兼容限制及偶发发送、缺正文、音频识别风险继续保留。

本版本源码完整验证、五个原生构建目标及新包完整性由对应CI检查；跳过和未执行项不计为通过。既有不受影响的证据继续沿用。本轮未重新完成macOS/Linux认证DEV、真实最小化/失焦、远程MCP Bridge、人工安装/升级/卸载、物理输入和跨DPI验收；CI包冒烟不能替代这些结果。

发布目标为Windows x64、macOS arm64/x64、Linux x64/arm64的七个包及`checksums.txt`。Windows无证书签名；macOS为ad-hoc签名，未作Developer ID签名或公证。遇到异常请保留诊断日志并按故障排查说明处理。

## English

Web2Harness 2.5.2 (`v2.5.2`) improves browser sending reliability, failure evidence and queue progress visibility.

- **Click first, guarded Enter fallback**: Check Send actionability before actual input. Only a covered button that remains visible and enabled, without a blocking modal, can select one Enter on the focused Send button; recheck state before input. Once an actual click or Enter has been attempted, an unknown outcome never triggers another send.
- **Reliable send classification**: Retain the post-click hit check so a late overlay cannot produce a successful return without input. Record input return, permit grant and server acceptance separately; missing acceptance evidence retains the unknown-outcome guard.
- **Preserved failure evidence**: Read the bounded probe immediately after input settles, retaining original errors and button visibility, hit and event summaries. Results survive listener expiry; installation or read failures are explicitly unavailable. New diagnostics do not store prompts or input text.
- **Clear queue progress**: Distinguish preflight, waiting for a permit, sending, waiting for acknowledgement and reconciliation, with links to blocking-task logs. Display progress cannot grant a permit or establish acceptance.
- **Adapted upstream improvements**: Port suspension timing and exact model-header matching while retaining explicit model and effort checks. Preserve native Codex instructions, full context, tool arguments, child-task and wait semantics, permissions and approvals.

### Validation scope and known limitations

Real Chrome DOM fixtures cover normal clicks, covered-button Enter fallback, delayed readiness, modal blocking, focus loss and cancellation. Isolated authenticated DEV with GPT-6/high and Native Tools confirmed one generation request from one Enter under a controlled overlay, followed by real commands, file patches and native final-answer delivery. Cancellation after prevented Enter produced no generation request, tool execution or final answer. An Overview-panel background round passed, but does not establish operating-system minimization or actual focus-loss acceptance.

The underlying cause of the original 2.5.1 click timeout, seven earlier attachment timeouts and one incomplete progress sentence remains unproven; this release does not claim to eliminate all of them. Input already attempted with an unknown outcome is never resent through Enter. Existing Web-model protocol limitations and intermittent send, missing-answer and audio-recognition risks remain.

The corresponding CI checks full source verification, five native build targets and new-package integrity; skipped and unexecuted checks are not passes. Valid unaffected evidence is reused. Authenticated macOS/Linux DEV, real minimization/focus loss, remote MCP Bridge, manual installation/upgrade/uninstall, physical input and cross-DPI acceptance were not completed again in this round; CI package smoke does not replace those results.

Release targets are seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization. Preserve diagnostic logs after errors and follow the troubleshooting instructions.
