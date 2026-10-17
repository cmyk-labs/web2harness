## 简体中文

Web2Harness 2.4.0（`v2.4.0`）修复隐藏窗口无法唤起的问题，新增运行时回收和存储管理，并精简安装包。

- **窗口唤起**：托盘、桌面快捷方式及第二实例打开请求直接恢复并显示主窗口；首次启动同时处理页面加载完成和显示就绪事件，避免只等待单次事件而一直隐藏。保留隐藏自启动和用户主动关闭到托盘的行为。
- **旧版本回收**：后台保留当前运行时和最近一个有效回退版本，额外保留正在使用、配置或恢复事务引用的版本。未知、损坏或含不安全链接的目录不会自动删除；进程盘点不完整或安装恢复未完成时延期处理。
- **存储与缓存**：在“用量与诊断 → 存储与缓存”查看占用，任务空闲时清理网页资源和代码缓存，保留登录 Cookie、Local Storage、IndexedDB 等必要站点数据；重复清理和忙碌时操作会被阻止。
- **日志与安装包**：辅助日志统一纳入轮转和保留预算，并支持诊断导出。安装包保留英文、简体中文资源，移除经过审核的依赖测试文件；保留安装修复、运行和回退所需的独立运行时。

### 验证范围与已知限制

已完成核心/桌面完整自动验证、补充定向回归、双语及窄窗存储页面检查、真实 Electron 本地站点缓存与窗口检查，以及共享实现的独立 DEV 启动、存储接口和第二实例唤起检查。Cookie、Local Storage 和 IndexedDB 保留已在本地测试站点验证；DEV 未登录 ChatGPT，不能据此认定真实账号清理后登录保持已验收。发布冻结验证、五个原生构建目标和包冒烟结果以本版本 CI 为准，跳过项不计为通过。

同条件 Windows 开发测试包从 222.3 MiB 降至 212.8 MiB，减少约 9.46 MiB（4.26%）；正式包大小以本次资产为准，其他平台收益未作等量承诺。此开发测试包不作为发布制品。

真实客户激活、覆盖升级后的窗口恢复、完整人工安装/卸载、其他平台交互与服务运行、认证 ChatGPT 缓存清理仍未完成验收。本次发布保留这些验证缺口，不以文件系统夹具或 CI 安装/启动冒烟替代。未改动的模型和工具能力复用既有有效证据，既有长上下文及跨平台账号交互等未执行项仍未被本轮验证。

发布提供 Windows x64、macOS arm64/x64、Linux x64/arm64 的七个包及 `checksums.txt`，按目标原生构建并核验资产和 SHA-256。Windows 未做证书签名；macOS 为 ad-hoc 签名，未作 Developer ID 签名或公证。

现有数据和配置沿用，缓存清理无需退出登录。自动回收只处理通过检查的旧运行时，不代表整个数据目录容量固定。遇到窗口仍无法显示，可从托盘退出后重新启动；升级或清理失败时保留日志，使用本版安装包修复，不要手动删除运行时、恢复记录或归属标记。

## English

Web2Harness 2.4.0 (`v2.4.0`) fixes hidden-window activation, adds runtime retention and storage management, and reduces package size.

- **Window activation**: Tray, desktop shortcut and second-instance requests directly restore and show the main window. Initial startup handles both page-load completion and display readiness instead of depending on one event. Hidden autostart and intentional close-to-tray behavior remain available.
- **Old runtime cleanup**: Background maintenance retains the current runtime and one recent valid rollback, plus versions referenced by active processes, configuration or recovery transactions. Unknown, damaged or unsafely linked directories are not automatically removed. Incomplete process inventory or unfinished installation recovery defers cleanup.
- **Storage and cache**: Usage & diagnostics → Storage & cache displays disk usage and clears web-resource and code caches while tasks are idle. Login cookies, Local Storage, IndexedDB and other necessary site data are retained. Concurrent cleanup and busy-state requests are rejected.
- **Logs and packaging**: Auxiliary logs now share rotation and retention budgets and are included in diagnostic exports. Packages retain English and Simplified Chinese resources and remove audited dependency test files. Separate runtimes required for installation repair, execution and rollback remain included.

### Validation scope and known limitations

Completed checks include full core/launcher automated verification, additional targeted regressions, bilingual and narrow-window storage UI checks, real Electron checks with a local test site, and isolated DEV checks of shared startup, storage IPC and second-instance activation. Cookie, Local Storage and IndexedDB retention was verified on the local test site. DEV was signed out of ChatGPT, so this does not establish authenticated-account retention after cleanup. Refer to this version's CI for freeze verification, five native build targets and package smoke; skipped checks are not passes.

Under matching conditions, Windows development test packages decreased from 222.3 MiB to 212.8 MiB, about 9.46 MiB (4.26%). Published assets determine final sizes; equivalent savings are not claimed for other platforms. Those development-key packages are not release artifacts.

Real customer activation, window recovery after an installed upgrade, full manual installation/uninstall, interactive behavior and services on other platforms, and authenticated ChatGPT cache cleanup remain unexecuted. This release retains those gaps; filesystem fixtures and CI installation/startup smoke do not replace them. Unchanged model and tool behavior reuses valid existing evidence. Previously unexecuted long-context and cross-platform account checks remain unverified.

The release provides seven packages for Windows x64, macOS arm64/x64 and Linux x64/arm64, plus `checksums.txt`. Native builds verify the asset inventory and SHA-256 values. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization.

Existing data and configuration remain in use, and cache cleanup does not require signing out. Automatic reclamation applies only to verified old runtimes; it does not impose a fixed size on the entire data directory. If a window still cannot be shown, quit from the tray and reopen. Preserve logs after upgrade or cleanup failures and repair with this version's installer instead of manually deleting runtimes, recovery records or ownership markers.
