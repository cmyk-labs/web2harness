## 简体中文

Web2Harness 将 ChatGPT Web 模型接入 Codex，保留原生工具、任务权限和现有工作流。

- 根据账号能力提供 Web 模型及思考强度；默认使用原生工具，支持 MCP Bridge 和仅浏览器模式。
- 支持会话复用、默认保存聊天历史、上下文管理，以及中英文桌面工作区、连接设置、运行控制和诊断。
- Windows 在安装阶段准备运行环境，重复启动执行轻量检查；完整卸载识别应用自建目录并保护 Codex 数据。

### 下载说明

在下方 Assets 选择适合设备的安装包：Windows x64 使用 `.exe`；macOS Apple silicon 使用 `mac-arm64.dmg`，Intel 使用 `mac-x64.dmg`；Linux 使用对应 x64 或 arm64 的 `.AppImage`。

两个 macOS `.zip` 用于自动更新和终端安装，无需与 DMG 一起下载。`checksums.txt` 提供七个包的 SHA-256。许可文件随包附带；安装脚本保留在本版本源码的 `scripts/` 目录，不再单独上传。GitHub 自动提供的 Source code 是源码，不是安装包。

### 验证与限制

本版本为预发布版。当前发布工作流要求五个平台目标通过完整自动检查、原生打包和包启动检查；macOS 还验证从桌面 ZIP 提取终端运行时、重复安装、哈希拒绝和许可保留。逐项结果见本次 Actions 运行。

本候选包的真实账号交互及安装、升级、修复、完整卸载人工验收尚未完成；自动测试不替代这些验收。Windows 安装包未签名；macOS 使用临时签名，不代表 Developer ID 签名或公证。建议先在独立测试环境验证。恢复需要此前自行保存且已验证的安装包；完整清理前备份所需 Web2Harness 数据。预发布版不会进入默认稳定版更新通道。

本次按维护者要求重新发布 1.0.0，精简分发文件；同版本安装不会触发自动升级。旧发布元数据和文件保存在本次 Release 工作流的备份工件中，保留 30 天。

## English

Web2Harness connects ChatGPT web models to Codex while retaining native tools, task permissions and the existing workflow.

- Account-aware Web models and reasoning efforts; Native Tools by default, with MCP Bridge and Browser-only modes.
- Conversation reuse, saved history by default, context management, and an English / Simplified Chinese desktop workspace with connection settings, runtime controls and diagnostics.
- Runtime preparation during Windows setup and lightweight warm-start checks. Complete uninstall recognizes application-owned directories and protects Codex data.

### Downloads

Choose one installer from Assets: `.exe` for Windows x64; `mac-arm64.dmg` for Apple silicon or `mac-x64.dmg` for Intel Macs; the matching x64 or arm64 `.AppImage` for Linux.

The two macOS `.zip` files support automatic updates and terminal installation; DMG users do not need both formats. `checksums.txt` covers all seven packages. Licenses are included inside packages. Installer scripts remain in this version's source under `scripts/`, without separate uploads. GitHub's automatic Source code links contain source, not installers.

### Validation and limitations

This is a pre-release. Publication requires full automated verification, native packaging and package startup checks on all five targets. macOS additionally checks terminal runtime extraction from the desktop ZIP, repeat installation, hash rejection and license preservation. See the current Actions run for individual results.

Authenticated account interaction and manual installation, upgrade, repair and complete-uninstall acceptance remain unexecuted for this candidate; automated checks do not replace them. Windows installers are unsigned; macOS uses ad-hoc signing without Developer ID or notarization. Validate in an isolated environment first. Recovery requires a previously retained and validated installer; back up required Web2Harness data before complete cleanup. Pre-releases are excluded from the default stable update channel.

Version 1.0.0 is republished at the maintainer's request with a reduced asset inventory. Existing installations at the same version will not update automatically. Previous publication metadata and files are retained for 30 days in this Release workflow's backup artifact.
