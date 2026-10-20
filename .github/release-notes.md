## 简体中文

Web2Harness 2.5.0（`v2.5.0`）改进网页正文交付、原生工具与媒体兼容、操作超时和窗口布局。

- **最终正文交付**：等待本轮网页生成完成后读取完整最终回答；区分正常完成、取消、上游错误和缺少公开正文。保存会话可在原轮次内只读复核，不重新发送生成请求或重复工具。
- **独立操作时限**：外层任务和各子步骤分别计时，取消跨步骤共享总预算；保留取消、队列归属与原始错误。
- **上传恢复**：普通“上传未成功”会移除失败附件，等待3秒后重传一次；再次失败保留原始错误，明确的HTTP 429额度错误直接返回。
- **原生能力**：增加Codex独立搜索路径、Office附件、原始音频传输和结构化结果校验，完善WebSocket预填、续接、取消及自然完成边界的追加指令。工具仍由Codex按任务权限和审批执行。
- **媒体与工具续答**：实际验证原生下载图片后查看、WAV/MP3/M4A/WebM/OGG音频续答、双参考图编辑、严格Schema结果，以及工具等待期间追加任务要求。
- **窗口布局**：小窗口保留缩小适配，大窗口增加内容空间而不放大控件；简介与信息区域同宽，浏览器标签栏和地址栏放到统一窗口标题栏下方。

### 验证范围与已知限制

共享实现已具备隔离DEV的读取、补丁、命令、取消/续接、压缩、并行子任务及上述媒体能力证据，各项按原测试范围保留。最新界面通过113项双语布局和85项原生窗口展示检查。源码完整验证、各原生构建目标及新包完整性以本版本对应检查结果为准；跳过和未执行项不计为通过。

Web模型不等同于原生模型服务的全部协议能力。原生加密推理无损迁移、缺少实际服务绑定的provider文件ID及托管工具、裸PCM和原始视频仍不支持。所测Codex客户端会提前拒绝直接HTTPS图片输入，并可能省略原始FLAC；原生下载后查看图片和已验证音频格式有独立成功证据。JSON Schema采用提示与最终校验，不宣称网页后端提供API受约束解码。

历史偶发发送、缺正文及音频识别失败保留为已知风险，不宣称全部根治。Windows物理输入、跨DPI、其他系统交互及实际安装/升级/卸载的覆盖须按独立验收记录审阅，展示夹具和构建成功不能替代这些验收。

正式发布目标为Windows x64、macOS arm64/x64、Linux x64/arm64的七个包及`checksums.txt`，须在对应原生平台构建。Windows未做证书签名；macOS为ad-hoc签名，未作Developer ID签名或公证。保留现有数据、配置及显式模型/强度选择，遇到错误请保留诊断日志，不手动删除认证或恢复记录。

## English

Web2Harness 2.5.0 (`v2.5.0`) improves final-answer delivery, native tool and media compatibility, operation timeouts, and window layout.

- **Final-answer delivery**: Read the complete final answer after the current web generation finishes. Distinguish completion, cancellation, upstream errors and missing public answers. Saved conversations can be rechecked read-only within the same turn without resending generation or repeating tools.
- **Independent operation limits**: Outer tasks and individual steps use separate timeouts instead of one shared cross-step deadline. Cancellation, queue ownership and original errors remain intact.
- **Upload recovery**: Remove an ordinary failed attachment, wait three seconds and retry once. Preserve the original error after another failure; explicit HTTP 429 quota failures return directly.
- **Native capabilities**: Add Codex standalone search, Office attachments, original-audio transport and structured-output validation; improve WebSocket prefill, continuation, cancellation and steering at natural completion boundaries. Codex continues to execute tools under the task's permissions and approvals.
- **Media and tool continuation**: Live checks cover native image download followed by viewing, WAV/MP3/M4A/WebM/OGG audio continuation, editing with two reference images, strict Schema results and additional instructions during a pending tool call.
- **Window layout**: Compact windows retain scaling down; larger windows add space without enlarging controls. About text uses its section width, and browser tabs and address controls sit beneath the shared window titlebar.

### Validation scope and known limitations

The shared implementation has isolated DEV evidence for read, patch, command execution, cancellation/continuation, compaction, parallel child tasks and the media paths above. Each result retains its original scope. The latest interface passed 113 bilingual layout checks and 85 native window presentation checks. Refer to this version's corresponding results for full source verification, native builds and new-package integrity; skipped or unexecuted checks are not passes.

Web models do not implement every native model-service protocol. Lossless migration of native encrypted reasoning, provider file IDs and hosted tools without actual service bindings, raw PCM and raw video remain unsupported. The tested Codex client rejects direct HTTPS image input before it reaches the bridge and can omit raw FLAC. Native download-then-view and the tested audio formats have separate successful evidence. JSON Schema uses prompting and final validation, not an assertion of API-constrained decoding by the web backend.

Historical intermittent send, missing-answer and audio-recognition failures remain known risks; they are not all claimed to be resolved. Review separate evidence for Windows physical input, cross-DPI behavior, other operating systems and actual installation/upgrade/uninstall. Presentation fixtures and successful builds do not establish those results.

Formal release targets are seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`, built on matching native platforms. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization. Existing data, configuration and explicit model/effort selection remain in use. Preserve diagnostic logs after errors rather than manually deleting authentication or recovery records.
