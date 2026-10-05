## 简体中文

Web2Harness 1.1.0（`v1.1.0`，2026-10-05）补全原生 Code Mode、自定义工具与文件附件传递，并改善更新检查和运行日志。

- **Code Mode**：原生工具模式继承 Codex 模型目录的设置，支持 `exec` 编排工具、并行调用和 `wait` 续接；权限、沙箱与审批继续由 Codex 管理。
- **工具协议**：保留自定义工具的命名空间、输入格式和调用 ID，正确区分不同命名空间中的同名函数与自定义工具；JSON 与流式响应一致，有歧义的名称明确报错。
- **真实文件附件**：自动交互将客户端内联提供的 PDF、UTF-8 文本／源码及工具返回文件上传为真实附件；保留工具返回图片和 `original` 清晰度参数。此功能不新增桌面上传按钮。
- **更新检查**：新增「关于 → 检查更新」、上次检查时间、失败重试及每六小时自动检查；下载显示百分比或已下载大小，异步 SHA-256 校验减少界面阻塞。
- **运行日志**：显示中英文事件说明和严重级别，展开「技术详情」查看原始事件与完整字段；信息级别不等于操作成功。

### 升级与下载

升级后应用配置并按提示刷新 Codex 模型目录、重启受影响客户端，以加载 Code Mode 设置。1.0.2 等旧版用户可重启已安装应用检查此更新；手动检查和定时检查在升级到 1.1.0 后可用。源码与 DEV 保持禁用应用内更新。

在 Assets 中选择一个匹配的安装包：Windows x64 `.exe`；macOS Apple silicon `mac-arm64.dmg` 或 Intel `mac-x64.dmg`；Linux x64 或 arm64 `.AppImage`。两个 macOS `.zip` 用于自动更新和终端安装。`checksums.txt` 覆盖七个包；许可随包附带。GitHub 的 Source code 是源码，不是安装包。

### 验证范围与已知限制

维护者已确认当前验收并授权正式发布。源码完整验证通过：881 项核心测试、457 项桌面测试通过，另有 26／4 项条件跳过；界面夹具检查 219 项通过。独立登录 DEV 与真实 Codex 0.155.1 已验证 Code Mode 并行读取、图片返回、补丁写入及命令核验；真实网页已正确读取 TXT／PDF 附件中的独立校验文本。`exec`／`wait` 另通过真实 Codex 配合浏览器夹具验证。这些证据不等同于逐项人工验收分发安装包。

发布工作流要求 Windows x64、macOS arm64/x64、Linux x64/arm64 五个原生目标完成验证、打包和包启动检查，并核对七个包及校验清单的上传摘要；结果见本标签的 Actions。代理未执行各平台交互式安装、升级、修复、卸载及逐账号逐模式验收。Windows 安装包未签名；macOS 使用临时签名，没有 Developer ID 或公证。

文件须由调用方提供内联内容；远端 `file_id`、仅有本地路径、不支持的类型和无效内容明确报错。上下文、技能、文件和图片合计最多 10 个附件，单个输入文件／图片最多 20 MB，总计最多 50 MB，并受上下文预算限制。手动零风险模式不自动传输文件。完整混合多代理、跨模型压缩交接及中途交互增强不属于本版新增完成项，私有加密 V2 子代理内容仍不支持。

若更新或启动失败，请保留安全诊断记录并按照安装器与[故障排查手册](https://github.com/cmyk-labs/web2harness/blob/v1.1.0/docs/troubleshooting.zh-CN.md)处理；勿删除账户或配置目录。同版本重装与自动降级不属于已验证的恢复路径。

## English

Web2Harness 1.1.0 (`v1.1.0`, 2026-10-05) completes native Code Mode, custom-tool and file-attachment transport, and improves update checks and runtime logs.

- **Code Mode**: Native Tools inherits the Codex catalog setting, including `exec` orchestration, parallel calls and `wait` continuation. Codex retains permissions, sandboxing and approvals.
- **Tool protocol**: Preserves custom-tool namespaces, input formats and call IDs. Functions and custom tools sharing a name in different namespaces remain distinct in JSON and streaming responses; ambiguous names fail explicitly.
- **Real file attachments**: Automatic interaction uploads client-supplied inline PDF, UTF-8 text/source files and tool-result files as actual attachments. Tool-result images and the `original` fidelity hint are preserved. This does not add a desktop upload button.
- **Update checks**: Adds About → Check for updates, last-check time, retry and checks every six hours. Downloads show a percentage or downloaded size; asynchronous SHA-256 verification reduces UI blocking.
- **Runtime logs**: Readable English/Chinese event descriptions and severity levels, with original events and all fields under Technical details. An information-level event does not establish success.

### Updating and downloads

After upgrading, apply configuration and refresh the Codex model catalog or restart affected clients as prompted to load Code Mode settings. Users of 1.0.2 and older launchers can restart the installed app to discover this release; manual and periodic checks become available after upgrading to 1.1.0. Source and DEV runs keep in-app updates disabled.

Choose one matching installer from Assets: Windows x64 `.exe`; macOS Apple silicon `mac-arm64.dmg` or Intel `mac-x64.dmg`; Linux x64 or arm64 `.AppImage`. The two macOS `.zip` files support automatic updates and terminal installation. `checksums.txt` covers all seven packages; licenses are included. GitHub's Source code downloads are not installers.

### Validation scope and known limitations

The maintainer confirmed the current acceptance and authorized stable publication. Full source verification passed: 881 core and 457 desktop tests, with 26 and four conditional skips; 219 UI fixture checks passed. Independently authenticated DEV with real Codex 0.155.1 verified Code Mode parallel reads, image results, patch writes and command assertions. Real web requests correctly read independent verification text from TXT/PDF attachments. `exec`/`wait` also passed with real Codex and a fixture browser. These results do not establish individual manual acceptance of distributed installers.

The release workflow requires verification, packaging and package startup checks on Windows x64, macOS arm64/x64 and Linux x64/arm64, then verifies uploaded digests for seven packages and their checksum manifest; see this tag's Actions results. The agent did not perform each platform's interactive install, upgrade, repair, uninstall or every account/mode scenario. Windows installers are unsigned; macOS uses ad-hoc signing without Developer ID or notarization.

Files require caller-supplied inline content. Remote `file_id` references, local paths alone, unsupported types and invalid content fail explicitly. Context, skills, files and images share a ten-attachment limit; individual input files/images are limited to 20 MB and the total to 50 MB, subject to context budgets. Manual Zero Risk does not transfer files automatically. Complete mixed-agent orchestration, cross-model compaction handoff and mid-turn interaction enhancements are not completed additions in this release; private encrypted V2 subagent content remains unsupported.

If an update or startup fails, retain safe diagnostics and follow the installer and [troubleshooting manual](https://github.com/cmyk-labs/web2harness/blob/v1.1.0/docs/troubleshooting.md); do not delete account or configuration directories. Same-version reinstalls and automatic downgrades are not established recovery paths.
