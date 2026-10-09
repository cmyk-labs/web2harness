## 简体中文

Web2Harness 1.2.0（`v1.2.0`）更新 Web 模型适配、本地用量统计和浏览器稳定性。

- **模型与思考档位**：适配 GPT-5.6 Sol、GPT-5.6 Sol Pro、GPT-6、GPT-6 Pro；普通模型提供账号支持的思考档位，Pro 固定对应档位。兼容网页中的 6/GPT-6 名称及独立版本菜单，发送前核实模型与强度。
- **通用三倍预算**：保留跨模型的三倍上下文及压缩预算，模型可用档位与单条消息边界保持独立。
- **本地使用次数**：显示总次数及模型维度统计，合并思考档位；以网页接受的发送回执记录工具往返及压缩发送，去重并恢复待补记记录。官方限额参考单独展示，未知数值显示 -，说明统一置于表后。
- **浏览器稳定性**：统一自动任务页与首页视口，减少切页、隐藏、缩放和其他任务结束对模型菜单的干扰。保留中文 Pro 页面正在生成的识别。
- **回复与公式**：稳定匹配重复段落、文件预览移动和空段落加载；保留 KaTeX 原始公式与代码语言。已发送内容真实变化仍明确报错。
- **默认临时聊天**：新配置及缺少历史偏好的配置默认使用临时聊天，保留已有明确的保存历史选择。
- **依赖安全**：更新 MCP SDK、proxy-addr 和 source-map-js，保留本地原生打包补丁。

### 升级与验证

保留已有模型、工具模式、账号和历史偏好。原生工具、文件上下文与通用预算继续使用本项目实现。安装包和更新可用性以实际发布资产为准。

本版本的三平台源码 CI、CAP-001～005，以及 Windows 独立 DEV 中的自动 MCP、原生工具读写、压缩续聊、请求重放去重和路由恢复已通过。Codex Voice 使用 v3 协议建立了真实 WebRTC 连接；该检查不包含麦克风采集或音频质量。Windows 候选包的嵌入 Bun 回归 67 项通过；维护者已确认补充人工验收完成并批准发布。

发布目标为 Windows x64、macOS arm64/x64、Linux x64/arm64；各原生包由对应平台 CI 构建和检查。认证交互自动验收覆盖 Windows，macOS/Linux 的认证交互未由本次自动验收独立复现。Windows 包未做证书签名，macOS 使用 ad-hoc 签名，未作 Developer ID 签名或公证。

退出活动 MCP 任务时，后台进程可能需要超时收尾后才完全退出。手动模式的剪贴板交接曾在自动验收环境受阻，该记录保留，不作为自动验收通过项。若遇到模型或连接器检查失败，请保留报错并检查对应选择、登录和插件工具定义；不要反复提交同一消息。安装或更新出现问题时保留配置及诊断信息，后续修复以新版本分发，不覆盖已有发布资产。

## English

Web2Harness 1.2.0 (`v1.2.0`) updates Web model integration, local usage accounting, and browser stability.

- **Models and efforts**: Supports GPT-5.6 Sol, GPT-5.6 Sol Pro, GPT-6, and GPT-6 Pro, with account-supported efforts for ordinary models and fixed Pro effort. Recognizes both 6/GPT-6 labels and separate version menus; verifies family and effort before sending.
- **Shared triple budget**: Retains the cross-model triple context and compaction budget. Available efforts and single-message boundaries remain independent.
- **Local usage**: Shows the total and per-model counts, combining efforts. Accepted-send receipts cover tool round trips and compaction sends, with deduplication and pending delivery recovery. Policy references stay separate, unknown values show -, and concise notes follow each table.
- **Browser stability**: Keeps consistent viewports for automatic primary/task pages across tab changes, hiding, zoom, and other tasks finishing. Preserves active-generation detection on Chinese Pro pages.
- **Responses and formulas**: Aligns repeated paragraphs, moving file previews, and empty paragraphs that later hydrate. Preserves KaTeX source and code languages; genuine changes to delivered content still fail explicitly.
- **Temporary Chat default**: New configurations and missing history preferences use Temporary Chat. Existing explicit history choices are preserved.
- **Dependency security**: Updates the MCP SDK, proxy-addr, and source-map-js while retaining native packaging patches.

### Updating and validation

Existing model, tool-mode, account, and history preferences are retained. Native Tools, Context as File, and shared budgets keep this project's implementation. Package and update availability depend on actual published assets.

This candidate passed source CI on all three operating systems, CAP-001–005, and isolated Windows DEV checks for automatic MCP, native tool reads and patches, compaction continuation, exact-request replay deduplication, and route restoration. Codex Voice established a real WebRTC connection using protocol v3; microphone capture and audio quality were not tested. The Windows candidate passed all 67 embedded-Bun regressions. The maintainer confirmed completion of supplementary manual acceptance and authorized publication.

Release targets are Windows x64, macOS arm64/x64, and Linux x64/arm64, built and checked by native-platform CI. Automated authenticated interaction acceptance covers Windows; it did not independently reproduce authenticated macOS/Linux interaction. Windows packages are not certificate-signed. macOS uses ad-hoc signing without Developer ID signing or notarization.

Quitting an active MCP task can require timeout cleanup before the background process fully exits. Clipboard handoff in manual mode was blocked in the automated acceptance environment; that record remains and is not counted as an automated pass. If model or connector checks fail, retain the error and check the selected model, login, and plugin tool definitions instead of repeatedly submitting the same message. Preserve configuration and diagnostics if installation or updating fails; distributed fixes use a new version rather than replacing published assets.
