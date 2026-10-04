## 简体中文

Web2Harness 1.0.1（`v1.0.1`，2026-10-05）修复保存历史时的会话复用，并完善用量记录与健康检查。

- 保存聊天使用时间在前、固定任务名、对话／压缩独立编号的统一名称；只在首次创建时命名，保留后续手动改名。
- 增量发送前核验远端对话 ID，修复工具往返后页面尺寸失效导致重复新建聊天的问题；上下文压缩可建立并命名独立摘要和后续聊天。
- 自动记录实际 Web 发送轮次，包含工具结果续发和压缩，按模型展示滚动 24 小时／7 天统计并保留漏记提示。官方公开上限单独展示，注明参考来源、生效日期及待确认内容；本地滚动统计不代表官方周期或剩余额度。
- 健康检查改用易懂名称和“通过／无需使用／需注意／未通过”状态，原始诊断可展开查看；生产版检查应用配置，DEV 检查独立开发配置。

### 下载说明

在下方 Assets 选择适合设备的安装包：Windows x64 使用 `.exe`；macOS Apple silicon 使用 `mac-arm64.dmg`，Intel 使用 `mac-x64.dmg`；Linux 使用对应 x64 或 arm64 的 `.AppImage`。

两个 macOS `.zip` 用于自动更新和终端安装，无需与 DMG 一起下载。`checksums.txt` 提供七个包的 SHA-256。许可文件随包附带；安装脚本保留在本版本源码的 `scripts/` 目录，不再单独上传。GitHub 自动提供的 Source code 是源码，不是安装包。

### 验证与限制

本版本为正式版。维护者已确认人工验收通过。发布工作流另外要求五个平台目标通过完整自动检查、原生打包和包启动检查；macOS 还验证从桌面 ZIP 提取终端运行时、重复安装、哈希拒绝和许可保留。逐项结果见本次 Actions 运行。

源码完整验证通过（核心 873 项、桌面 449 项；条件跳过分别为 26 和 4 项），界面检查 204 项通过。隔离 DEV 中已验证 GPT-6 Pro/max 的真实工具往返、会话复用、手动名称保留及压缩命名；两个模型共 7 次实际发送计为 7 轮，重启后记录保留。这些是共享运行时验收，不是发布安装包的完整人工验收。

人工验收结论由维护者确认；本记录不将其扩展为每种系统、架构、账号和模式都已验证，也不将共享运行时测试等同于 CI 分发二进制的逐项人工检查。Windows 安装包未签名；macOS 使用临时签名，不代表 Developer ID 签名或公证。遇到问题先停止任务并保留诊断记录；恢复需要此前自行保存且已验证的安装包，降级与数据兼容性须先验证，完整清理前备份所需 Web2Harness 数据。正式版进入默认更新通道；重新启动已安装的应用后检查更新，也可从本页手动下载安装。

## English

Web2Harness 1.0.1 (`v1.0.1`, 2026-10-05) fixes saved-conversation reuse and improves usage recording and health checks.

- Saved chats have a timestamp-first name, a stable task name and separate dialogue/compaction sequence numbers. Naming occurs once and preserves later manual renames.
- Remote conversation IDs are checked before incremental sends. Tool round trips restore the owned page viewport, fixing unintended new chats. Compaction can create named summary and continuation chats.
- Actual Web sends are recorded automatically, including tool-result continuations and compaction, with per-model rolling 24-hour/seven-day counts and persistent missing-record warnings. Published policy references show sources, effective dates and uncertainty separately; local rolling counts do not establish official periods or remaining allowances.
- Health checks display readable names and Passed / Not required / Needs attention / Failed statuses, with expandable original diagnostics. Production checks application configuration; DEV checks its isolated development configuration.

### Downloads

Choose one installer from Assets: `.exe` for Windows x64; `mac-arm64.dmg` for Apple silicon or `mac-x64.dmg` for Intel Macs; the matching x64 or arm64 `.AppImage` for Linux.

The two macOS `.zip` files support automatic updates and terminal installation; DMG users do not need both formats. `checksums.txt` covers all seven packages. Licenses are included inside packages. Installer scripts remain in this version's source under `scripts/`, without separate uploads. GitHub's automatic Source code links contain source, not installers.

### Validation and limitations

This is a stable release. The maintainer has confirmed that manual acceptance passed. Publication additionally requires full automated verification, native packaging and package startup checks on all five targets. macOS also checks terminal runtime extraction from the desktop ZIP, repeat installation, hash rejection and license preservation. See the current Actions run for individual results.

Source verification passed: 873 core and 449 desktop tests, with 26 and four conditional skips respectively, plus 204 UI checks. Isolated DEV acceptance covered real GPT-6 Pro/max tool round trips, conversation reuse, manual-name preservation and compaction naming. Seven actual sends across two models produced seven recorded turns and survived restart. This validates the shared runtime, not complete manual acceptance of the published installers.

Manual acceptance is maintainer-confirmed; this record does not extend that confirmation to every OS, architecture, account and mode, or equate shared-runtime tests with individual manual checks of CI-built binaries. Windows installers are unsigned; macOS uses ad-hoc signing without Developer ID or notarization. If a problem occurs, stop tasks and retain diagnostics. Recovery requires a previously retained and validated installer; verify downgrade/data compatibility first and back up required Web2Harness data before complete cleanup. This release enters the default update channel: restart the installed application to check for updates, or download and install manually from this page.
