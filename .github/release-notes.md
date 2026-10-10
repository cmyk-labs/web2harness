## 简体中文

Web2Harness 2.0.0（`v2.0.0`）优化桌面工作区和问题排查体验。

- **桌面布局**：统一欢迎页、设置、关于和用量页面的字号、间距与控件对齐；名称旁显示版本，使用流程图保持展开，模式对照表补充执行能力与权限说明。
- **用量展示**：保留总次数和模型维度列表，统一两张表的高度、列宽及操作区，简短说明放在表格外。
- **原始日志**：直接查看脱敏后的 JSON，支持格式化、自动换行、级别/来源筛选、全文关键词搜索、复制和同次请求关联；复制反馈不再推挤界面。
- **渐进加载**：后台索引、缓存搜索结果和游标分页，避免把全部日志一次性塞入页面。每页可选25、50、100、200条，默认100并记住选择；超长日志仍受单页大小限制。
- **诊断包导出**：支持全部保留日志、最近24小时或自定义日期范围，汇集事件时间线、摘要、导出时状态与文件清单。查看器筛选不会缩小导出范围。
- **诊断覆盖**：补全浏览器、模型选择、工具传递、运行时及更新过程的关键事件，保留耗时与关联标识；报告采集缺失和部分结果，并统一脱敏。

### 使用与验证

初次使用和从旧版升级请按[使用手册](https://github.com/cmyk-labs/web2harness/blob/v2.0.0/docs/user-guide.zh-CN.md)完成配置。已有模型、工具模式、账号和聊天历史偏好继续保留。下载时选择与系统和架构匹配的一个安装包，并核对 `checksums.txt`。

发布目标为 Windows x64、macOS arm64/x64、Linux x64/arm64，各平台安装包由原生CI构建并检查。Windows包未做证书签名；macOS使用ad-hoc签名，未作Developer ID签名或公证。平台构建和包冒烟不等于各平台真实账号与人工安装验收。

Windows安装、升级、实际激活、卸载及原生ZIP保存流程由维护者安排在发布后人工验收，本次发布不将这些项目列为已通过。

出现问题时从「用量与诊断 → 运行日志」导出相应日期的诊断包，发送前检查其中信息。界面显示的是本应用保留的日志和本地计数；它们不是官方剩余额度。安装或更新失败时保留配置及诊断证据，不要反复覆盖安装目录；修复通过后续新版本分发。

## English

Web2Harness 2.0.0 (`v2.0.0`) refines the desktop workspace and troubleshooting experience.

- **Desktop layout**: Aligns typography, spacing and controls across welcome, settings, about and usage pages. Shows the version beside the product name, keeps the workflow diagram expanded, and clarifies execution capabilities and permissions in the mode comparison.
- **Usage views**: Retains the total and per-model breakdown, aligns both tables and their controls, and moves concise notes below the panels.
- **Raw logs**: Displays redacted JSON with formatting, word wrap, level/source filters, full-text search, copying and related-request filtering. Copy feedback no longer shifts the layout.
- **Progressive loading**: Background indexing, cached search matches and cursor paging avoid loading the entire history into the page. Choose 25, 50, 100 or 200 records per page; the default is 100 and the preference is saved. Long records remain subject to the page byte limit.
- **Diagnostic bundles**: Exports all retained logs, the last 24 hours or a custom date range, including a timeline, summary, export-time state and file manifest. Viewer filters do not restrict the export.
- **Diagnostic coverage**: Adds key events for browser work, model selection, tool delivery, runtime and updates, with timing and correlation fields. Reports missing sources and partial results, with shared redaction.

### Use and validation

Follow the [user guide](https://github.com/cmyk-labs/web2harness/blob/v2.0.0/docs/user-guide.md) for first use and upgrades. Existing model, tool-mode, account and chat-history preferences are retained. Choose one package matching your OS and architecture and check `checksums.txt`.

Release targets are Windows x64, macOS arm64/x64 and Linux x64/arm64, built and checked by native CI. Windows packages are not certificate-signed. macOS uses ad-hoc signing without Developer ID signing or notarization. Builds and package smoke checks do not establish real-account or manual installation acceptance on every platform.

The maintainer has scheduled manual Windows installation, upgrade, actual activation, uninstall and native ZIP-save acceptance after publication. These checks are not reported as passed for this release.

For problems, export the relevant date range from **Usage & diagnostics → Runtime logs** and review the bundle before sharing. Displayed logs and counts cover this application's retained local records, not an official remaining allowance. Preserve configuration and diagnostics after an installation or update failure instead of repeatedly overwriting the installation; fixes are distributed in subsequent versions.
