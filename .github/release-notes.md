## 简体中文

Web2Harness 1.2.0（候选）更新 Web 模型适配、本地用量统计和浏览器稳定性。

- **模型与思考档位**：适配 GPT-5.6 Sol、GPT-5.6 Sol Pro、GPT-6、GPT-6 Pro；普通模型提供账号支持的思考档位，Pro 固定对应档位。兼容网页中的 6/GPT-6 名称及独立版本菜单，发送前核实模型与强度。
- **通用三倍预算**：保留跨模型的三倍上下文及压缩预算，模型可用档位与单条消息边界保持独立。
- **本地使用次数**：显示总次数及模型维度统计，合并思考档位；以网页接受的发送回执记录工具往返及压缩发送，去重并恢复待补记记录。官方限额参考单独展示，未知数值显示 -，说明统一置于表后。
- **浏览器稳定性**：统一自动任务页与首页视口，减少切页、隐藏、缩放和其他任务结束对模型菜单的干扰。保留中文 Pro 页面正在生成的识别。
- **回复与公式**：稳定匹配重复段落、文件预览移动和空段落加载；保留 KaTeX 原始公式与代码语言。已发送内容真实变化仍明确报错。
- **默认临时聊天**：新配置及缺少历史偏好的配置默认使用临时聊天，保留已有明确的保存历史选择。
- **依赖安全**：更新 MCP SDK、proxy-addr 和 source-map-js，保留本地原生打包补丁。

### 升级与验证

保留已有模型、工具模式、账号和历史偏好。原生工具、文件上下文与通用预算继续使用本项目实现。安装包和更新可用性以实际发布资产为准。

本候选正在执行发布验收；尚未确认完整 CAP-001～005、各平台安装升级和认证 MCP 门槛通过。此前版本或开发轮次的通过不代表本候选通过。正式发布前更新此段为实际结果。

## English

Web2Harness 1.2.0 (candidate) updates Web model integration, local usage accounting, and browser stability.

- **Models and efforts**: Supports GPT-5.6 Sol, GPT-5.6 Sol Pro, GPT-6, and GPT-6 Pro, with account-supported efforts for ordinary models and fixed Pro effort. Recognizes both 6/GPT-6 labels and separate version menus; verifies family and effort before sending.
- **Shared triple budget**: Retains the cross-model triple context and compaction budget. Available efforts and single-message boundaries remain independent.
- **Local usage**: Shows the total and per-model counts, combining efforts. Accepted-send receipts cover tool round trips and compaction sends, with deduplication and pending delivery recovery. Policy references stay separate, unknown values show -, and concise notes follow each table.
- **Browser stability**: Keeps consistent viewports for automatic primary/task pages across tab changes, hiding, zoom, and other tasks finishing. Preserves active-generation detection on Chinese Pro pages.
- **Responses and formulas**: Aligns repeated paragraphs, moving file previews, and empty paragraphs that later hydrate. Preserves KaTeX source and code languages; genuine changes to delivered content still fail explicitly.
- **Temporary Chat default**: New configurations and missing history preferences use Temporary Chat. Existing explicit history choices are preserved.
- **Dependency security**: Updates the MCP SDK, proxy-addr, and source-map-js while retaining native packaging patches.

### Updating and validation

Existing model, tool-mode, account, and history preferences are retained. Native Tools, Context as File, and shared budgets keep this project's implementation. Package and update availability depend on actual published assets.

Release acceptance is in progress. Full CAP-001–005, platform installation/upgrade, and authenticated MCP gates have not yet been confirmed for this candidate. Earlier development or release passes do not establish a current pass. Replace this paragraph with actual results before publication.
