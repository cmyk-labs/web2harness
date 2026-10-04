## 简体中文

Web2Harness 1.0.2（`v1.0.2`，2026-10-05）改善更新提示与 Windows 快捷方式图标，并修复套餐参考下拉框。

- 侧栏新增蓝色更新按钮，显示目标版本及下载／安装状态；「关于」页保留相同入口，活动任务期间不可更新。
- Windows 更新使用独立安装进度窗口，展示真实阶段，跳过重复配置与完成页，成功后自动重新打开应用。备份、应用替换、运行组件复制／校验等耗时保存在本地，保留完整性校验和失败回滚。
- 快捷方式使用应用目录之外的持久图标文件，避免替换 EXE 时图标资源临时缺失；仅调整指向本安装的已有快捷方式。
- 套餐参考下拉列表改为深色背景，修复白底浅字；默认参考 Pro $200，仍可手动切换，不改变账户识别、本地用量或公开上限数字。

### 升级与下载

**从 1.0.1 升级到此版本的那一次，旧更新程序仍采用静默安装；新的独立进度窗口用于此后的更新。** 图标恢复不等于安装已经完成，请等待应用重新打开。

Assets 中选择匹配的安装包：Windows x64 使用 `.exe`；macOS Apple silicon 使用 `mac-arm64.dmg`，Intel 使用 `mac-x64.dmg`；Linux 使用对应 x64 或 arm64 的 `.AppImage`。两个 macOS `.zip` 用于自动更新和终端安装，无需与 DMG 一起下载。`checksums.txt` 提供七个包的 SHA-256。许可随包附带；安装脚本在本版本源码 `scripts/` 目录。GitHub 的 Source code 是源码，不是安装包。

### 验证范围

本版本为正式版，维护者已确认人工验收通过。源码完整验证通过：873 项核心、455 项桌面测试通过（另有 26／4 项条件跳过）；界面检查 217 项、Windows 内嵌 Bun 安装相关测试 67 项通过。中英文展开菜单已检查。发布工作流另外要求五个原生目标完成完整检查、打包和包启动验证；具体结果见本次 Actions。

人工验收结论由维护者确认，不扩展为每种系统、架构、账号和模式均已验证，也不将自动测试、私有快捷方式 fixture 或编译结果等同于 CI 分发二进制的逐项人工验收。Windows 安装包未签名；macOS 使用临时签名，没有 Developer ID 或公证。若更新失败，请保留诊断记录并按安装器提示恢复。正式版可在重启已安装应用后通过更新检查获取，也可从本页手动下载。

## English

Web2Harness 1.0.2 (`v1.0.2`, 2026-10-05) improves update feedback and Windows shortcut icons, and fixes the plan-reference dropdown.

- A blue sidebar update button shows the target version and download/install states. About retains the same action; updates are disabled during active tasks.
- Windows updates show a separate installer window with actual installation stages, skip repeated configuration and the finish page, and reopen the app after success. Local timings cover backup, application replacement and runtime copy/verification. Integrity checks and failure rollback remain in place.
- Shortcuts use persistent icon files outside the replaced application directory, avoiding temporary loss of the icon resource when the EXE is replaced. Only existing shortcuts targeting this installation are adjusted.
- The plan-reference dropdown now has a dark background with readable text. It defaults to Pro $200 and supports manual selection without changing account identification, local usage or published limit values.

### Updating and downloads

**The update from 1.0.1 to this version still uses the older updater's silent installation flow. The separate progress window applies to subsequent updates.** An icon returning to normal does not establish installation completion; wait for the app to reopen.

Choose one matching installer from Assets: `.exe` for Windows x64; `mac-arm64.dmg` for Apple silicon or `mac-x64.dmg` for Intel Macs; the matching x64 or arm64 `.AppImage` for Linux. The two macOS `.zip` files support automatic updates and terminal installation; DMG users do not need both. `checksums.txt` covers all seven packages. Licenses are included inside packages, and installer scripts remain in this version's source under `scripts/`. GitHub's Source code downloads are not installers.

### Validation scope

This is a stable release. The maintainer has confirmed that manual acceptance passed. Full source verification passed: 873 core and 455 desktop tests, with 26 and four conditional skips respectively; 217 UI checks and 67 Windows embedded-Bun installation tests also passed. Expanded menus were inspected in both languages. The release workflow additionally requires full checks, native packaging and package startup validation on all five targets; see the current Actions run for results.

Manual acceptance is maintainer-confirmed; it does not establish coverage of every OS, architecture, account and mode, or equate automated tests, private shortcut fixtures or compilation with individual manual checks of CI-built binaries. Windows installers are unsigned; macOS uses ad-hoc signing without Developer ID or notarization. If an update fails, retain diagnostics and follow installer recovery instructions. Restart the installed application to check for this stable update, or download manually from this page.
