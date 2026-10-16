## 简体中文

Web2Harness 2.2.0（`v2.2.0`）汇总自 2.1.0 以来的桌面、登录、浏览器输入保护、运行参数与原生上下文恢复改进，并修复异常、配置和协议一致性问题。

- **窗口与布局**：默认窗口调整为 1000×660 DIP，最小为 900×600 DIP，并受屏幕工作区约束；迁移旧默认尺寸、记忆后续手动调整，保持整体等比缩放和手动侧栏状态，修正最大化背景与标题栏对齐。
- **登录恢复**：统一已有页面的认证检测与有界重试，处理导航中断和过期检测结果；连接页区分检测中、未登录与检测失败，提供明确原因及重新检测入口。
- **上下文默认值与来源**：支持的自动模式默认开启上下文文件传输、采用标准预算。升级只保留有效且明确标为 `user` 的文件和预算偏好；缺失或其他来源采用当前默认，包括旧配置中未标明来源的关闭或三倍选项。两项来源分别保存，手动模式与 Luna 的支持限制不变，32 KiB UTF-8 传输阈值与标准预算不变。
- **浏览器输入保护**：自动任务及保留会话页面默认只读，防止人工输入干扰任务。通过「取消只读」并确认可临时操作当前页，随时「恢复只读」；解除状态不落盘，下一轮自动获取页面时重新保护。
- **运行参数**：在既有请求调度设置之外，增加标签页保留目标、空闲清理、网页无进展、附件处理、重试预算及手动提交等待设置。保留显式保存、草稿恢复和冲突提示，新请求使用新参数；恢复默认即使数值未变，也能保存 `default` 来源，单项编辑只标记该项为 `user`。
- **关于页与介绍**：同步中英文产品说明，明确账号可用 Pro、原生工具、流式响应、图片和可选三倍预算的边界；展开工作原理时保持介绍布局稳定，调整推荐标记位置。
- **原生上下文恢复**：将本地前缀校验与网页传输表示分离，通过绑定当前尝试的控制信号，每轮至多一次在新页面重新发送完整上下文。保留 Codex 原始任务输入、工具权限及预算规则，显示双语恢复进度；改进重连复用及取消记录，防止已取消轮次被重新提交。
- **错误原因与诊断**：保留结构化状态、错误码、可重试性及原始 `cause`；本地诊断有界记录并脱敏原因链、聚合错误和网络元数据。浏览器 helper 错误可关联原始诊断，公共响应不附带内部调用栈。
- **工具控制**：统一工具选择到模型可见工具类型、命名空间和名称的转换，不泄露内部身份键；拒绝要求调用工具却提供空允许集合等无效控制，保留原始 Codex 输入。
- **响应终态**：JSON 与 SSE 共享终态和压缩资格判断，首个终态生效；截断、过滤、失败或提前结束的输出不能成为替换历史。
- **配置与桌面接口**：保存前按加载契约校验序列化配置，统一 UTF-8 BOM 读取并在保存时保留原 BOM 与偏好来源；初始化路径统一绝对化，显式无效的 DEV 启动路径明确失败。浏览器展示接口校验输入并明确启动期空状态。
- **更新进程启动检查**：更新后的重启及恢复启动等待进程创建或异步启动错误，记录失败并进入相应恢复流程；成功创建进程不等于应用已经就绪。

### 验证范围与已知限制

本候选已完成 `verify` 各阶段检查：核心测试 1245 通过、64 跳过，桌面测试 611 通过、4 跳过，双端依赖审计与类型检查、桌面构建、核心 CLI/helper 运行时构建和可迁移运行时冒烟通过。旧夹具失败修正后按受影响阶段续验，原始失败记录保留；界面和进程故障夹具与真实运行验收分别记录。

当前 Windows 独立认证 DEV 补验通过：原生读取 → 补丁 → 独立命令断言、显式调用真实 Codex 压缩后继续工具执行、取消后无重新提交且无需重启即可完成新任务，以及运行参数来源的保存、恢复默认和重新加载。未修改 Codex 本体；任务保持工作区写入沙箱。本轮前后生产配置、认证哈希及受保护进程和服务对照一致。此前登录恢复、窗口、输入保护、受控上下文重同步、图片及多代理的有效证据按原范围复用，历史失败与未决调查继续保留。

新增原生「取消只读」确认框及解除后的真实输入复测、IME/触控/拖放、真实手动 MCP 长等待和分钟级超时边界、自然发生的长上下文恢复及完整双压缩流程未完成本轮验收。安装、升级、实际用户激活、下载更新及卸载的完整人工验收仍按维护者安排后续进行，不列为已通过。未执行各平台完整真实账号交互验收；夹具、CI 构建和包冒烟不替代认证 DEV 或专用测试系统上的真实安装、更新与重启就绪检查。

历史上曾出现网页发起工具调用、远端未交到本地的情况，发生概率和远端原因仍未确定，根因调查及修复按维护者决定暂缓。既有 MCP 完成判断保护只覆盖可识别的当前绑定且本地零活动场景；本次原生上下文恢复也不代表远端投递问题已修复。遇到明确交接失败时保留诊断，核对任务实际执行状态后再决定下一步。

发布包含 Windows x64、macOS arm64/x64、Linux x64/arm64 的七个包及 `checksums.txt`。发布工作流在对应平台原生构建，执行自动化验证、安装包冒烟和平台检查，并在文件清单与 SHA-256 校验通过后公开制品。Windows 未做证书签名；macOS 使用 ad-hoc 签名，未作 Developer ID 签名或公证。

出现问题时从「用量与诊断 → 运行日志」导出相关日期的诊断包，分享前检查其中信息。登录检测失败可在连接页重新检测；上下文恢复明确失败后，先核对已执行的工具和文件结果再决定是否重试。显示的是本应用保留的日志和本地计数，不是官方剩余额度。

## English

Web2Harness 2.2.0 (`v2.2.0`) brings together desktop, login, browser input protection, runtime settings and native context recovery improvements since 2.1.0, with fixes for error, configuration and protocol consistency.

- **Window sizing and layout**: Sets the default window to 1000×660 DIP and the minimum to 900×600 DIP, subject to the display work area. Migrates old default sizes, remembers subsequent manual changes, preserves proportional scaling and manual sidebar state, and corrects maximized backgrounds and title-bar alignment.
- **Login recovery**: Unifies authentication checks and bounded retries on existing pages, handles interrupted navigation and stale probe results, and distinguishes checking, signed-out and failed states with reasons and a retry action.
- **Context defaults and provenance**: Supported automatic modes default to Context as File with the standard budget. Upgrades preserve only valid file and budget preferences explicitly marked `user`; absent or other sources adopt current defaults, including older off or triple values without a source marker. Each preference records its own source. Manual-mode and Luna restrictions, the 32 KiB UTF-8 transport threshold and standard budgets remain unchanged.
- **Browser input protection**: Automated task and retained-chat pages default to view-only to prevent manual input from interfering with tasks. Confirm **Exit view-only** to interact with the current page temporarily, or choose **Restore view-only**. The override is not persisted, and the next automatic acquisition protects the page again.
- **Runtime parameters**: Adds retained-tab targets, idle cleanup, web no-progress and attachment-processing timeouts, retry budgets and manual-submit waits alongside existing request scheduling. Preserves explicit saving, draft recovery and conflict feedback; new requests use new settings. Restoring defaults saves `default` provenance even when numbers are unchanged, while editing one setting marks only that setting `user`.
- **About and product descriptions**: Aligns English and Chinese descriptions of account-available Pro, native tools, streaming, images and the optional triple budget. Keeps the introduction layout stable when expanding How it works and refines recommendation placement.
- **Native context recovery**: Separates local prefix verification from the browser representation. A control signal bound to the current attempt can trigger one complete-context resend on a new page per turn. Preserves original Codex task input, tool permissions and budget rules, adds bilingual recovery progress, and improves reconnect reuse and cancellation records so cancelled turns are not resubmitted.
- **Error causes and diagnostics**: Preserves structured status, error codes, retryability and original causes. Local diagnostics retain bounded, redacted cause chains, aggregate errors and network metadata. Browser-helper errors can be correlated with their diagnostics without exposing internal stacks in public responses.
- **Tool controls**: Consistently converts tool choices to model-visible kinds, namespaces and names without exposing internal identity keys. Rejects invalid controls such as a required empty allowed-tools set while preserving the original Codex input.
- **Response completion**: JSON and SSE share terminal classification and compaction eligibility. The first terminal event is authoritative; truncated, filtered, failed or prematurely ended output cannot become replacement history.
- **Configuration and desktop interfaces**: Validates serialized configuration through the loading contract before saving, reads UTF-8 BOM consistently and preserves existing BOM and preference sources. Setup normalizes paths to absolute paths; an invalid explicit DEV launcher path fails clearly. Browser surface IPC validates input and explicitly represents an empty startup state.
- **Updater launch checks**: Relaunch and recovery wait for process creation or an asynchronous launch error, record failures and follow the appropriate recovery path. Creating a process does not establish application readiness.

### Validation scope and known limitations

All candidate `verify` stages passed: 1,245 core tests passed with 64 skipped, and 611 launcher tests passed with 4 skipped; both dependency audits and typechecks, the launcher build, CLI/helper runtime build and relocated-runtime smoke passed. After repairing stale fixtures, affected stages were rerun while preserving original failures. UI and process-failure fixtures are recorded separately from real runtime acceptance.

Current authenticated, isolated Windows DEV checks passed: native read → patch → independent command assertion, explicitly requested real Codex compaction followed by continued tool execution, cancellation without resubmission followed by a successful new task without restarting, and saving/resetting/reloading runtime-setting provenance. Codex itself was not modified; tasks retained the workspace-write sandbox. Production configuration/authentication hashes and protected process/service identities matched before and after this run. Valid earlier login, window, input-protection, controlled resynchronization, image and multi-agent evidence was reused within its original scope; historical failures and unresolved investigations remain recorded.

The new native **Exit view-only** confirmation and physical input after unlocking, IME/touch/drag-and-drop, real manual-MCP long waits and minute-scale timeout boundaries, naturally occurring long-context recovery and a complete two-compaction flow have not completed acceptance in this batch. Full manual installation, upgrade, actual customer activation, download/update and uninstall checks remain deferred for later maintainer-arranged validation and are not recorded as passed. Complete real-account interaction was not exercised on every platform. Fixtures, CI builds and package smoke do not replace authenticated DEV or actual installation, update and relaunch-readiness checks on a dedicated test OS.

Historical tool calls were issued by the browser without reaching the local broker. Their frequency and remote cause remain unknown; investigation and repair of that cause are deferred by the maintainer. The existing MCP completion guard covers identifiable current bindings with no local activity. Native context recovery in this release also does not repair remote delivery. On an explicit handoff failure, retain diagnostics and check actual task execution before deciding how to proceed.

The release contains seven packages plus `checksums.txt` for Windows x64, macOS arm64/x64 and Linux x64/arm64. The release workflow builds on matching native runners, runs automated verification, package smoke and platform checks, and publishes only after asset inventory and SHA-256 checks pass. Windows packages are not certificate-signed. macOS uses ad-hoc signing without Developer ID signing or notarization.

For problems, export the relevant date range from **Usage & diagnostics → Runtime logs** and review the bundle before sharing. Retry a failed login check from the connection page. After an explicit context-recovery failure, inspect completed tool and file results before deciding whether to retry. Displayed logs and counts cover this application's retained local records, not an official remaining allowance.
