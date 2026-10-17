## 简体中文

Web2Harness 2.3.1（`v2.3.1`）修复 Windows 彻底卸载被正常数据目录阻断的问题，并减少安装记录的重复写入。

- **完整数据清理**：取消功能子目录名称白名单，清理已验证的核心、桌面和安装器缓存专属根目录内全部普通内容；`licensing`、`shared_proto_db`、`lockfile` 及未来新增目录不再因名称未知而阻断卸载。需要保留的项目和导出文件应放在这些专属目录之外。
- **归属与重试**：默认根目录缺失归属标记时，可由匹配的现存安装记录确认归属；已删除目录直接跳过，部分清理失败后可重试。自定义目录缺标记、标记损坏或冲突、安装记录缺失时仍拒绝完整清理，并提供恢复或保留数据卸载提示。保留受保护路径、链接检查及 Codex 认证、历史和无关配置保护。
- **安装记录**：安装与启动仍检查一致性，但内容未变化时不再重写记录；缺失标记仍可按安装登记规则修复。
- **下载入口**：中英文 README 的三个按钮直接链接 Windows x64 EXE、macOS Apple silicon DMG 和 Linux x64 AppImage。本次版本记录和下载地址在发布前同次提交，发布后链接一致时不再产生额外 README 提交。

### 验证范围与已知限制

修复已通过隔离的 Node 安装相关回归76项、内嵌 Bun 回归79项、核心和桌面类型检查，以及独立安装/卸载辅助程序构建。覆盖新增数据目录、缺失/损坏/冲突标记、自定义路径、已删除根目录、链接保护、普通保留数据卸载、部分清理失败重试和安装记录幂等写入。修复前失败与后续通过分别保留。发布冻结的完整验证、原生制品与包冒烟结果以本版本 CI 为准；跳过检查不计为通过。

完整人工安装、覆盖升级、客户激活和勾选清理数据的实际卸载尚未完成验收。本次发布保留该验证缺口，不以文件系统夹具、helper 构建或 CI 安装/启动冒烟替代。未改动的浏览器、模型和工具能力复用上一版有效证据；既有物理输入、长上下文容量/召回及跨平台账号交互等未执行项仍未被本次修复验证。

发布提供 Windows x64、macOS arm64/x64、Linux x64/arm64 的七个包及 `checksums.txt`。工作流在对应平台构建并校验资产清单与 SHA-256；Windows 未做证书签名，macOS 为 ad-hoc 签名，未作 Developer ID 签名或公证。

旧版卸载器不会因网页发布而自动修复。关闭应用后用本版安装包覆盖安装，以更新内置卸载器，再按需要选择保留或清理数据。不要通过手动清空目录或改写归属标记绕过错误。仅删除程序文件不会解除 Codex 集成，也不会清理远端 ChatGPT 历史、连接器、隧道或 API key。

## English

Web2Harness 2.3.1 (`v2.3.1`) fixes Windows full-data uninstall being blocked by ordinary application directories and avoids redundant installation-record writes.

- **Full-data cleanup**: Removes the child-name allowlist and cleans all ordinary contents of the verified dedicated core, desktop and installer-cache roots. `licensing`, `shared_proto_db`, `lockfile` and future directories no longer block uninstall because of their names. Keep projects and exports you want to retain outside these dedicated roots.
- **Ownership and retries**: An existing matching installation record can establish ownership when a marker is missing at an exact default root. Already removed roots are skipped, and partial cleanup can be retried. Missing markers at custom roots, damaged/conflicting markers and missing installation records still block full cleanup with recovery or keep-data guidance. Protected paths, link checks, Codex authentication/history and unrelated settings remain protected.
- **Installation records**: Installation and startup still check consistency but no longer rewrite unchanged records. Missing markers remain repairable through registration.
- **Downloads**: Both READMEs link directly to the Windows x64 EXE, macOS Apple silicon DMG and Linux x64 AppImage. This release's history entries and download URLs are committed together before publication; matching links require no extra README commit afterward.

### Validation scope and known limitations

The fix passed 76 isolated Node installation-related tests, 79 embedded-Bun tests, core/launcher typechecks and independent setup/uninstall helper builds. Coverage includes new data directories, missing/damaged/conflicting markers, custom paths, removed roots, link protection, keep-data uninstall, partial-cleanup retries and idempotent registration. Pre-fix failures and successful retests are retained separately. Refer to this version's CI for complete freeze verification, native artifacts and package smoke; skipped checks are not passes.

Full manual installation, overwrite upgrade, customer activation and actual uninstall with data cleanup remain unexecuted. Publication retains this validation gap; filesystem fixtures, helper builds and CI installation/startup smoke do not replace it. Unchanged browser, model and tool behavior reuses valid evidence from the preceding release. Previously unexecuted physical-input, long-context capacity/recall and cross-platform account checks are not established by this fix.

The release provides seven packages plus `checksums.txt` for Windows x64, macOS arm64/x64 and Linux x64/arm64. The workflow builds on matching platforms and validates asset inventory and SHA-256 digests. Windows packages are not certificate-signed; macOS uses ad-hoc signing without Developer ID signing or notarization.

Publishing this version does not update an older uninstaller already on disk. Close the application and install this version over it to replace the embedded uninstaller, then choose whether to preserve or remove data. Do not manually clear directories or rewrite ownership markers to bypass errors. Removing program files alone does not disconnect Codex integration or remove remote ChatGPT history, connectors, tunnels or API keys.
