# 开发手册

[English](development.md) | [简体中文](development.zh-CN.md) · [文档导航](../README.zh-CN.md#documentation)

本手册说明源码环境准备、提出与实施变更、提交 PR、隔离测试，以及项目文档和资源维护。自动化工作边界见 [AGENTS](../AGENTS.zh-CN.md)，候选安装包、发布验收与安全维护见[发布手册](release.zh-CN.md)。所有应用启动和真实账户测试均须先遵守[标准隔离测试流程](#standard-isolated-test-procedure)。除非另有说明，命令在仓库根目录执行。

**本页内容**

- [源码环境](#source-environment)
- [仓库结构](#repository-map)
- [参与贡献与评审](#contributing)
- [代码变更流程](#change-workflow)
- [自动检查](#automated-checks)
- [DEV 配置与启动](#dev-profile)
- [标准隔离测试流程](#standard-isolated-test-procedure)
- [真实任务与模拟器](#real-codex-tasks)
- [命名与兼容性](#naming-and-compatibility)
- [文档与资源维护](#documentation-and-assets)

<a id="source-environment"></a>

## 源码环境

使用已有检出目录，或从[项目 README](../README.zh-CN.md)中标识的仓库获取源码。

| 依赖 | 要求 |
| --- | --- |
| Git | 管理源码并检查工作区差异。 |
| Bun | 必须为 `1.4.0`，与 `package.json` 中的 `packageManager`、`engines.bun` 和 `@types/bun` 一致。 |
| Node.js | 22.12.0 或更新版本；CI 使用 Node 24。启动器测试、Electron 打包工具和浏览器 helper 检查需要使用。 |
| Codex CLI | 真实工具验收需要；DEV 为其设置独立子进程环境。 |
| ChatGPT 账户 | 仅登录态浏览器验收需要；必须在 DEV 中独立登录。 |
| 原生构建主机 | 桌面包必须在目标操作系统上构建，具体见发布目标矩阵。 |

安装或更新前，先检查已有工具。开发授权不包含修改全局安装或机器设置。

```bash
git --version
bun --version
node --version
codex --version
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run check-version
```

根目录和启动器分别维护锁文件与依赖树。常规开发保持冻结安装；确需变更依赖时，再有意识地更新依赖和锁文件。

启动器固定打包工具版本，并应用版本化的下载兼容补丁。Bun 在安装时自动应用仓库内的补丁；不要用未记录的 `node_modules` 修改替代。更新打包依赖前，先阅读[补丁维护说明](../launcher/patches/README.zh-CN.md)。下载回归测试使用隔离资源，检查完整性拒绝、HTTP 错误、超时与代理路由。

<a id="repository-map"></a>

## 仓库结构

| 位置 | 职责 |
| --- | --- |
| `src/cli.ts` | CLI 命令分发和参数。 |
| `src/server.ts`、`src/responses/` | Responses API、SSE 与 JSON 输出、共用响应编码、请求状态和生命周期。 |
| `src/config.ts`、`src/setup.ts` | 配置校验和初始化。 |
| `src/models/` | 模型身份、账户能力与推理强度策略、上下文预算及目录生成。 |
| `src/codex/` | Codex 配置集成、日志与恢复、hook、原生路由及模型缓存维护。 |
| `src/browser/` | 浏览器登录与会话存储，以及启动器浏览器宿主的客户端。 |
| `src/runtime/` | 服务生命周期、隧道管理及自有进程控制。 |
| `src/adapters/chatgpt-web/` | ChatGPT 轮次编排；浏览器、会话、提示和工具模块分别放在对应子目录。 |
| `src/dev/` | DEV 隔离、真实 Codex 启动和显式模拟器。 |
| `src/platform/windows/` | Windows 安装与卸载辅助程序入口。 |
| `launcher/src/` | 渲染器入口、应用组装、IPC 契约、本地化与基础样式。 |
| `launcher/src/features/` | 工作区页面、启动、浏览器交互、用量限制和应用外壳；各功能维护自己的组件、Hook 与样式。 |
| `launcher/src/components/`、`launcher/src/lib/` | 可复用视觉元素和渲染器支撑函数，不承担具体功能页面的职责。 |
| `launcher/electron/` | Electron 入口、IPC 和应用状态；浏览器、运行时、安装、用量限制和公共支撑分别放在对应子目录。 |
| `launcher/shared/` | Bun 运行时与桌面共用的纯配置迁移模块，不依赖 Electron。 |
| `assets/` | 统一维护品牌、首页、演示和图示素材及可编辑源文件。 |
| `launcher/packaging/` | Windows 安装器钩子和 Linux AppImage 启动脚本。 |
| `tests/`、`launcher/tests/` | 核心 Bun 测试和启动器 Node 测试，按实现职责分组；跨模块的核心检查保留在测试根目录。 |
| `scripts/`、`launcher/scripts/` | 构建、验证、打包和专项冒烟工具。 |
| `.github/workflows/` | CI 和各平台原生发布流程。 |
| `docs/` | 持续维护的手册、参考资料和架构说明。 |
| `dev-notes/`、`output/` | 本地开发记录和忽略的证据，不作为产品说明。 |

请求路径见[架构总览](architecture.zh-CN.md)，运行选项含义见[配置参考](reference.zh-CN.md)。

源文件按职责归类，文件名说明承担的角色。可执行维护工具放在 `scripts/`，素材及其可编辑源文件放在根目录 `assets/`。以单个 React 组件命名的文件使用 PascalCase，React Hook 文件使用 `useXxx.ts`，其他模块使用连字符分隔的小写描述性名称。保留与运行环境相关的扩展名，以及现有对外命令、包身份和存储路径。移动目录时一并更新导入、构建入口、测试与文档。

`launcher/shared/` 的位置用于满足打包边界，不表示它可以依赖 Electron API。桌面包直接包含此目录，Bun 构建将同一个迁移模块打入运行包。该模块应独立于 Electron、文件写入和应用启动逻辑，使两个调用方遵守同一配置迁移规则。

<a id="contributing"></a>

## 参与贡献与评审

缺陷报告应先按[故障排查](troubleshooting.zh-CN.md)定位，提供最小复现、准确版本、运行环境、预期行为和实际结果。仓库问题渠道可用时，通过该渠道提交。疑似漏洞按照[漏洞报告流程](release.zh-CN.md#vulnerability-reporting)私密报告。

较大功能、新增提供方和核心架构调整应在实现前与维护者讨论。每次提交围绕明确问题，说明附带重构或依赖调整的必要性，无关工作单独处理。

按下文流程实施和验证变更。准备 PR 时：

1. 说明问题及变更后的行为，适用时提供可复现的前后对照。
2. 说明兼容性、配置、生命周期和数据处理的影响，同步更新受影响的中英文文档与图示。
3. 列出验证证据与剩余限制，分别标识通过、失败、跳过和未执行的检查。
4. 仅包含本次变更所需的源码、测试、文档和预期素材，排除生成的发布包、无关改动、凭据、浏览器状态、原始日志、私有路径及备份。
5. 使用[英文 PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)或[中文 PR 模板](../.github/PULL_REQUEST_TEMPLATE.zh-CN.md)，对示例和诊断附件脱敏。

评审关注正确性、范围、兼容性、可维护性和证据。处理适用的评审意见，使变更说明和文档与最终实现一致。代码通过评审或打包成功不代表获准发布；发布就绪条件和发布操作遵循[发布手册](release.zh-CN.md)。

<a id="change-workflow"></a>

## 代码变更流程

1. 检查工作区并保留无关修改，明确要改变的行为和负责该行为的组件。
2. 开始工作时创建或更新 `dev-notes/worklog/YYYY-MM-DD-topic.md`，记录目标、范围、状态、决策、结果、未解决问题及下一步。在重要里程碑和交接前继续更新，并维护本地开发记录索引。
3. 修改共享实现。DEV 必须使用与常规运行相同的 Responses 服务、浏览器适配器、模型目录、工具中继、重试、压缩和生命周期实现，不得为通过测试另建简化执行路径。
4. 执行[变更所需的检查](#change-validation)。保留已有 audit 失败记录；其他功能通过不代表 audit 问题已解决。
5. 行为变化时同步更新英文和简体中文正式文档。历史调查与事故详情写入带日期的本地记录，原始日志和基线保存在忽略的 `output/` 中。
6. 执行或浏览器行为变更必须按隔离流程验收。安装器、更新器和服务变更按发布手册使用一次性虚拟机或专用测试系统。
7. 检查最终差异，分别报告行为变化、通过项、失败项、未执行项和剩余风险。

不得提交凭据、Cookie、浏览器配置、原始提示词、未脱敏日志、本地配置备份或生产基线。复制留存的测试源码应使用 `.test.ts.txt` 等文本扩展名，避免被测试发现机制执行。

`dev-notes/` 中的开发记录不纳入 Git。正式文档应独立说明当前行为，不依赖私有工作日志。自动化工作中的记录维护须遵守[仓库协作规则](../AGENTS.zh-CN.md)。

<a id="design-requirements"></a>

### 设计要求

| 要求 | 验收条件 |
| --- | --- |
| 产品范围 | 变更服务于 ChatGPT 网页模型与 Codex 的集成。 |
| 明确选择 | 模型、思考强度、路由和连接器选择保持明确；不支持的请求返回错误。 |
| 工具权限 | 工具来自当前 Codex 任务，并受其沙箱和审批约束。 |
| 模式边界 | 仅浏览器模式不具备本地工具能力；MCP Bridge 中各可用 Web 档位保留相同的任务绑定能力。 |
| 环境隔离 | DEV 使用共享实现，隔离数据、凭据和端点，并验证进程归属。 |
| 平台支持 | 保留受支持的原生打包方式，明确实际测试的平台。 |
| 文档维护 | 行为变化同步到中英文文档及受影响的图示。 |

### 桌面视觉规范

颜色、字号、尺寸和动效时长统一在 `launcher/src/tokens.css` 中维护。界面采用深灰背景、中性灰按钮和选中状态；绿色、橙色、红色分别表达正常、警告和错误。选中状态同时提供底色、边框或标记，不仅依赖颜色。各页面使用一致的标题层级、控件尺寸和内容边距，功能专属样式与对应组件放在同一模块。

首次进入界面统一使用居中内容列，短窗口允许滚动。工作区内容左对齐，页面标题24px、正文14px、控件36px、左右边距32px（窄窗口20px）。概览使用步骤流程图保持展开；关于和授权管理先显示简要信息，补充原理及授权更新表单按需打开。

界面变更须检查中英文、宽窄窗口、长内容、错误和禁用状态，以及键盘焦点、隐藏导航和系统减少动效设置。运行 `node launcher/scripts/smoke-workspace.mjs` 可通过独立浏览器和模拟 IPC 验证界面；用 `WORKSPACE_SMOKE_OUTPUT` 指定本次证据目录。截图须在页面切换和侧栏动画结束后采集。这类检查不代表真实 ChatGPT、原生嵌入浏览器或安装器验收。

<a id="automated-checks"></a>

## 自动检查

| 命令 | 检查内容 |
| --- | --- |
| `bun run check-version` | 版本、Bun 固定版本、发布身份和必要元数据的一致性。 |
| `bun run typecheck` | 核心 TypeScript。 |
| `bun run test` | `./tests` 下的核心测试。 |
| `bun run launcher:typecheck` | 启动器 TypeScript。 |
| `bun run launcher:test` | Node 测试运行器中的启动器夹具。 |
| `bun run audit` / `bun run launcher:audit` | 根目录与启动器依赖安全公告。 |
| `bun run build` | 在 `dist/runtime` 构建可迁移运行时包。 |
| `bun run launcher:build` | 启动器类型检查和渲染器构建。 |
| `bun run smoke` | 使用独立冒烟数据检查迁移后的运行时和资源。 |
| `bun run verify` | 版本检查、两处 audit、类型检查、测试、渲染器构建、临时运行时构建、许可声明生成和运行时冒烟。 |

`verify` 在首个失败处停止。失败时记录具体阶段，并明确后续哪些阶段未执行。适当情况下单独执行仍有价值的剩余检查；部分通过不得表述为完整验证通过。该命令不包含全部平台打包与登录态发布门禁。

核心命令执行 `bun test ./tests`，递归发现范围限定在持续维护的核心测试树。桌面测试通过 `launcher/scripts/test.cjs`，只递归收集 `launcher/tests/` 下的 `.test.cjs` 文件，再将清单交给 Node。这些入口不扫描生成包、证据目录或其他源码副本。新增测试放入对应职责分组，保留 Bun 与 Node 各自的执行边界。

专项 Bun 测试使用明确的相对路径：

```bash
bun test ./tests/adapters/chatgpt-web/conversation/retained-compaction.test.ts
node --test launcher/tests/installation/runtime-install.test.cjs
```

避免使用可能匹配忽略目录内源码副本的裸测试名称过滤器。在 Windows 的 Bun 1.4.0 下，先等待 broker I/O 完成再断言；管道失败使用 `node:assert/strict` 的 `rejects`。Bun 的 Promise matcher 在管道回调中可能挂起。保留结果与错误断言，既运行受影响的单独用例，也运行完整套件。

`bun run app:package` 构建原生桌面包。`bun run app:smoke` 执行平台包检查，在 Windows 上会真实运行 NSIS 安装器。包含安装行为的检查只能在一次性虚拟机或专用测试系统中运行。用于验收前先阅读[发布验证](release.zh-CN.md)。

<a id="change-validation"></a>

### 按变更类型验证

| 变更类型 | 所需证据 |
| --- | --- |
| 应用行为 | 相关回归测试及 `bun run verify`，解释每项失败或未执行检查。 |
| 工具执行、续接或取消 | 在共享实现上进行已认证 DEV 任务验收，包含相关命令／文件结果和生命周期状态。 |
| 浏览器集成 | 实际观察到的 DOM 或协议证据，以及可复现夹具；不得猜测性扩大选择器。 |
| 桌面界面 | 类型／构建检查、受影响测试，以及隔离配置下的渲染检查。 |
| 打包或安装 | 内置运行时测试、原生包验证，以及[发布流程](release.zh-CN.md)规定的一次性操作系统验收。 |
| 仅文档 | 链接／锚点检查、等价的双语示例、变更陈述的源码核对及受影响图示的视觉检查，并运行受影响的文档依赖检查。 |
| 依赖 | 两份锁文件和依赖审计，以及受影响的集成与打包检查。 |

模拟器、夹具、安装包静态检查和真实操作系统验收属于不同证据类别，须明确实际执行的类别。此前审计或版本发布成功不能证明本次变更通过。各类证据的适用范围见[发布证据表](release.zh-CN.md#validation-evidence)。

### 运行时验证重点

根据改动层次选择验证。启动检查应区分窗口可见、运行时就绪和 ChatGPT 就绪时间。热启动回执是完整性检查优化，不是签名或完整依赖扫描。Windows 生产启动应报告重新运行安装器的修复要求，不得自行部署运行时。

对话变更需要真实工具结果往返、后续用户消息、重放保护、取消和压缩覆盖。对话复用与 Save to history 相互独立；切换模型/档位或进入新压缩周期可能需要新浏览器页面。模型变更必须确认真实账户/浏览器支持，并保留原生 Codex 模型条目。验收标准见[发布清单](release.zh-CN.md)，诊断步骤见[故障排查](troubleshooting.zh-CN.md)。

<a id="dev-profile"></a>

## DEV 配置与启动

先运行 `bun run scripts/prepare-license-dev.ts` 准备绑定本机的测试授权，再设置输出的 `WEB2HARNESS_DEV_HOME` 和 `WEB2HARNESS_LICENSE_KEYS_FILE`。DEV 使用共享运行时和相同的激活检查。应用首先显示激活页，再进入语言选择，详见[离线授权](licensing.zh-CN.md)。测试及 `bun run verify` 自行准备临时测试资源。

运行时开发从以下命令开始：

```bash
bun run dev:launcher
bun run src/cli.ts dev status --json
```

源码检出中的首条命令以 development 配置启动工作区 Electron 应用和共享运行时，不会覆盖安装桌面应用。`bun run app` 使用常规应用配置，不是开发验收入口。

可用 `WEB2HARNESS_LAUNCHER_EXECUTABLE` 显式指定单独的打包可执行文件，但它必须包含要测试的 DEV 实现。打包 CLI 通过 `--dev-profile` 启动所选启动器。修改已加载的运行时或浏览器 helper 后，按需重建，完整关闭且仅关闭已核实归属的 DEV，再启动并检查就绪状态。持久 helper 会跨请求保留旧代码。

确认窗口标记为 **Web2Harness DEV**。独立登录 ChatGPT，执行浏览器冒烟，在 **Connection & Models** 应用 DEV 配置。新配置默认**原生工具**；原生工具使用 **Automatic** 交互，**Zero Risk** 需要 MCP Bridge。切换工具模式前先结束活动任务。应用配置会刷新 DEV 路由和运行时；切回原生工具会停止隧道并保留私有 MCP 配置。

DEV 仅向其独立 Codex home 写入路由和中断 hook，监管相同的 daemon 实现，并分配独立回环端口。端口被占用应明确失败，不能停止其他进程来腾出端口。仍使用旧无绑定 `17841` 配置的 DEV 需要在 DEV 窗口重新初始化；运行时拒绝绑定该旧端口，也不会探测或控制它。

默认目录如下：

```text
~/.web2harness-dev/
├── config.json
├── codex-home/          # DEV Codex 配置、文件凭据、会话、缓存
├── launcher/            # DEV Electron 数据、ChatGPT 登录、日志、窗口状态
├── workspace/           # dev codex 默认工作目录
├── workspaces/<name>/   # 真实 Codex 命名任务的专用夹具
├── chats/<name>.json    # 仅模拟器历史
├── runtime/             # 描述符、归属和诊断
└── tunnel/              # 可选 DEV 隧道
```

`WEB2HARNESS_DEV_HOME` 可指定其他 DEV 根目录。系统拒绝与生产目录重叠，包括嵌套路径和符号链接/junction 别名。浏览器分区、单实例锁、broker 端点和监管状态均独立；服务绑定前要求 DEV 描述符与 DEV bridge/Codex home 一致。DEV 不自动安装或更新桌面应用，不启用登录自启；界面禁用生产集成移除。

<a id="standard-isolated-test-procedure"></a>

## 标准隔离测试流程

![DEV 与常规运行共享实现，分别维护身份、数据、端点和测试工作区](../assets/diagrams/isolation.zh-CN.svg)

以下是开发、回归和真实验收的强制约定。隔离配置、凭据、浏览器数据、端点、进程归属和夹具工作区，运行时实现继续共享。

1. **真实测试前记录基线**。 保存生产 Codex 配置/认证哈希、生产 bridge 配置的存在性/哈希，以及相关进程 PID、可执行路径、启动时间和服务身份。包含非默认生产路径。不存在的文件/进程应记为不存在。不得输出凭据内容；原始证据仅保存在忽略的 `output/` 或私有 DEV 存储中。
2. **执行适用的自动检查**。 使用明确测试路径和临时测试 home；可选无头 DOM 检查使用全新临时浏览器配置。audit 失败与功能结果独立记录，并尝试适用验证门禁。
3. **启动并核实 DEV 归属**。 使用 `bun run dev:launcher` 和 `dev status --json`，核对当前描述符、`development` 配置、PID、可执行文件、DEV userData、两处 DEV home 和独立分配的回环监听。熟悉的端口、旧日志、标题或 PID 本身不能证明归属。需要时完成独立 DEV 登录。
4. **加载当前代码并确认就绪**。 运行时/helper 变更后重建并只重启 DEV。先确认 DEV doctor/就绪结果和浏览器冒烟，再运行真实任务；不得通过仍加载旧代码的持久 daemon 验收。
5. **准备自有夹具**。 输入放在 `DEV_HOME/workspaces/NAME`，通过 `bun run dev:chat` 或 `bun run dev:codex` 使用该明确目录和账户可用的 Web 模型。保留 Codex 沙箱和审批，不得把用户工作项目或生产数据作为测试目标。
6. **证明受影响行为**。 执行变更需要“读取 → 原生补丁 → 命令断言 → 最终答复”的证据，包含工具事件和结果文件。生命周期/取消变更需要取消活动 DEV 任务、确认终态取消且活动任务为零，然后不重启服务发起新的真实 Codex 请求。续接/压缩变更还要验证相应真实路径。故障注入限制在一个已核实的 DEV 浏览器目标或自有传输中。MCP 测试还必须满足下述远端隔离要求。
7. **比较生产边界**。 复核基线哈希和进程身份；发现差异应调查，不得用备份还原或覆盖生产。不要比较可能正常变化的活动历史/日志。仅取消或关闭已确认归属的测试资源，保留已有工作和证据。
8. **记录结果并交接**。 更新工作日志，记载实际结果和剩余问题。分别列出自动、夹具浏览器、模拟和登录态真实检查，并标注通过、失败或未执行。退出码为零或模型声称成功均不能单独证明真实端到端结果。

### 受保护的生产边界

已安装的 Web2Harness 和所有正在工作的 Codex 会话均受保护。开发授权不包含控制这些会话，或修改其配置、认证、路由、hook、浏览器配置、服务与进程。不得临时向生产写入 DEV 路由、复制生产认证或使用历史生产测试命令。

不得为通过测试修改全局 Codex/Bun/Electron、系统凭据、系统沙箱用户、服务、防火墙、代理、DNS、共享网络设置或无关项目。故障注入不得断开整机网络或修改共享浏览器上下文。不得按进程名取消、扫端口清理，或在未验证 DEV 归属时终止进程树。

不授权批量删除或通用工作区清理。夹具收尾只能在核实解析后的路径后，移除该测试创建、明确归属的单个临时工件。保留已有配置、工作区和证据。无法满足上述边界的安装、更新、全新安装、升级与系统服务测试必须使用一次性虚拟机或专用测试系统。

DEV 凭据必须独立获取并使用文件存储。不得复制生产认证、MCP 配置、插件、历史或活动任务 ID。需要 Windows 沙箱覆盖项时，只应用于 DEV 子命令；不得禁用沙箱或修改机器/生产设置。

隔离不代表独占硬件。CPU、内存、带宽和账户额度仍可能共享。登录态验收应串行、限制工作量，用户工作期间避免压力测试。

<a id="mcp-bridge-isolation"></a>

### MCP Bridge 隔离

启用 MCP Bridge 前，必须取得用户明确确认：所选隧道 ID 属于 DEV；同时从独立登录的 DEV 浏览器读取实际选中连接器绑定。两者必须一致。DEV 路径、别名或显示名称本身不能证明远端隔离。

如果给定目标后来被确认为生产，应立即停止且仅停止自有 DEV 连接并验证退出。可能的远端影响与本地文件/进程检查分开记录。在确认正确 DEV 目标前使用原生工具恢复；恢复时不得沿用陈旧 MCP 配置。

<a id="real-codex-tasks"></a>

## 真实任务与模拟器

DEV 使用已安装的 Codex CLI。发现失败时可通过 `WEB2HARNESS_CODEX_EXECUTABLE` 指定原生可执行文件或 npm JavaScript 入口。参数不通过 shell 插值。

```bash
bun run dev:codex --version
bun run dev:codex login
bun run dev:chat acceptance
bun run dev:chat acceptance --model gpt-5.6-sol "Read notes.txt and summarize its contents."
bun run dev:codex resume
```

示例模型必须在 DEV 账户上可用，参见[模型参考](reference.zh-CN.md)。真实命名任务使用 `DEV_HOME/workspaces/NAME`。不带消息时打开 Codex TUI，带消息时运行 `codex exec`。复用名称只复用文件，不会自动续接对话；续接使用 Codex resume。

`dev codex -- ...` 原样转发参数，默认目录为 `DEV_HOME/workspace`；显式 `--cd` 可选择其他专用夹具。这不增加文件权限，也不关闭沙箱。未明确指定 Web 模型的原生 Codex 命令保留正常模型选择行为。

`bun run scripts/smoke-dev-codex.ts` 提供离线真实 Codex 中继夹具：使用夹具浏览器和虚假测试认证，要求生成实际补丁文件，不读取生产凭据。`--expect-read-only` 用于验证不能写入时的沙箱拒绝往返，不算写入验收成功；两种形式均不能证明登录态 ChatGPT 执行。

在 Windows 上，如果提权沙箱无法初始化，可仅为当前 DEV 子进程选择受支持的受限令牌沙箱：

```powershell
bun run scripts/smoke-dev-codex.ts --windows-sandbox=unelevated
bun run dev:codex -a never -c 'windows.sandbox="unelevated"' exec --sandbox workspace-write --model chatgpt-web/gpt-5.6-sol --cd C:/absolute/dev/fixture "Your test task"
```

<a id="simulator"></a>

### 显式模拟器与实验设置

```bash
bun run dev:chat browser-lab --simulate
bun run dev:chat smoke --simulate "Reply with exactly: DEV READY"
bun run src/cli.ts dev list
```

仅 `--simulate` 使用 `DevChatDriver` 和模拟工具回执。每个模拟结果均标注 `simulated: true`、`side_effects_performed: false`，不能证明真实补丁或命令执行。使用 MCP Bridge 时，模拟器作为客户端连接守护进程拥有的 DEV 轮次代理；退出模拟器不会停止守护进程或隧道。

| 模拟器命令 | 用途 |
| --- | --- |
| `/status` | 查看模拟会话状态。 |
| `/fill 30000` | 在本地增加惰性上下文。 |
| `/send-fill 12000` | 通过真实浏览器提交生成上下文。 |
| `/compact` | 验证原生 Codex 浏览器压缩，包含 Luna。 |
| `/model high` | 更改模拟器模型。 |
| `/reset yes` | 重置命名模拟会话。 |
| `/help`、`/exit` | 显示命令或退出。 |

在 DEV 偏好设置中配置 Context as File、Skills as files、复用/历史偏好和交互模式，其行为与常规运行相同。Context as File 默认关闭，预算默认 Standard，Triple 必须明确选择。上传阈值始终为普通单条消息 token 或字符预算的 80%，附件内容仍计入 token。此功能需要 Automatic，且不支持 Luna。完整约定见[配置参考](reference.zh-CN.md)。

DEV setup 支持 `--context-files` / `--no-context-files` 和 `--context-triple-budget` / `--standard-context-budget`。仅修改隔离配置，并重启其 Codex 客户端以刷新目录。浏览器实验仍消耗真实账户额度。

<a id="naming-and-compatibility"></a>

## 命名与兼容性

| 用途 | 标准值 |
| --- | --- |
| 产品名称 | **Web2Harness** |
| 仓库与核心包 | `web2harness` |
| CLI 命令 | `web2harness` |
| 仓库 | `cmyk-labs/web2harness` |
| 仓库目录显示名 | `Web2Harness` |
| 桌面包 | `web2harness-launcher` |
| Linux 桌面命令 | `web2harness-desktop` |
| 环境变量前缀 | `WEB2HARNESS_` |
| 常规核心目录 | `~/.web2harness` |
| DEV 核心目录 | `~/.web2harness-dev` |
| 常规 Electron userData 名称 | 操作系统应用数据目录下的 `Web2Harness` |
| 常规浏览器分区 | `persist:web2harness-chatgpt` |
| DEV 浏览器分区 | `persist:web2harness-dev-chatgpt` |
| 常规 / DEV 窗口标识 | `Web2Harness` / `Web2Harness DEV` |
| Application ID | `dev.web2harness.launcher` |
| Windows 安装器 GUID | `8b7be269-ac7f-4ab6-82e9-71408ffa370b` |
| Windows 应用目录 / 可执行文件基础名 | `Web2Harness` |
| daemon 服务标识 | `io.github.web2harness.daemon` |
| 桌面工件模式 | `web2harness-${version}-${os}-${arch}.${ext}` |

保留数字 **2** 和产品名称的准确大小写。包名和命令使用小写。Linux 桌面命令与 CLI 是不同入口。运行时归档名称和平台架构别名见[发布矩阵](release.zh-CN.md#native-target-matrix)。

应用 ID、安装器 GUID、服务标签、存储目录、浏览器分区和环境变量前缀都是兼容性边界，不得作为文档整理的一部分改名，也不得从名称调整推断已获准读取其他应用数据。DEV 身份和数据始终遵守[隔离流程](development.zh-CN.md#standard-isolated-test-procedure)。

### 技术术语

| 术语 | 文档中的含义 |
| --- | --- |
| Web2Harness | 项目和应用。 |
| 启动器 / Launcher | 桌面控制界面及嵌入浏览器宿主。 |
| 运行时 / daemon | 实现 Responses bridge 的受监管本地服务。 |
| 原生工具 | 真实 Codex 客户端执行其原生工具的模式。 |
| MCP Bridge | 通过已配置连接器和隧道传输工具的模式。 |
| 仅浏览器 | 不执行本地工具的有限浏览器对话模式。 |
| Automatic / Zero Risk | 交互模式标签；操作步骤使用准确 UI 标签。 |
| DEV | 隔离开发配置，不是另一套实现。 |

两种语言均原样保留配置键、CLI 参数、模型 ID、路径和 API 字段，翻译解释文字与图表标签。**ChatGPT** 和 **Codex** 保持标准拼写；区分账户可见的浏览器能力与原生 Codex 能力。参见[模型参考](reference.zh-CN.md)和[使用指南](user-guide.zh-CN.md)。

解释性正文和比较表格中，每种模式只使用一个面向读者的名称。机器值和参数保留在配置定义、约束和命令示例中；除非专门解释映射关系，否则不要在显示名称旁追加标识符或另一语言的同义名称。

当前模式统一使用 MCP Bridge。旧配置模式值仅允许出现在集中迁移模块及对应迁移测试中；新配置、CLI、运行分支和面向用户的文字使用当前名称。无关的第三方接口和许可原文不受该模式命名规则影响。

<a id="documentation-and-assets"></a>

## 文档与资源维护

文档使用面向任务的标题、简洁操作说明、可执行命令代码块，以及用于并列属性或比较的表格。与任务有关时说明前置条件、预期结果、失败处理和验证方法。项目 README 保留现有横幅、标志、标语、品牌介绍、下载按钮和语言入口。文档维护时须原样保留这些资源与视觉设计。下述克制的技术风格适用于手册和技术图示，不用于重新设计 README 品牌区或应用图标。

英文与简体中文使用相同信息顺序。每份手册链接语言配对页和 README 文档入口，并提供简短页内目录与稳定锚点。流程、标识、默认值或限制变化时同步更新两种语言。翻译必须保留警示、条件和证据边界，不得为缩短内容而删除。

持续维护的文档图表采用以下配色：

| 元素 | 颜色 |
| --- | --- |
| 画布 | 白色 `#FFFFFF` |
| 主标题与关键边界 | 海军蓝 `#18324F` |
| 正文 | 深灰 `#334155` |
| 次要文字 | 灰色 `#64748B` |
| 中性组件填充 | 浅灰 `#F4F6F8` |
| 边框与次要连线 | 灰色 `#CBD5E1` |

组件边界和箭头必须有明确运行含义。保持标签清晰、对齐一致、留白充分、线宽克制。避免渐变、发光、装饰纹理和无关强调色。信任边界和执行路径不能仅靠颜色区分，打印或灰度查看时仍应可理解。

架构图应标识参与进程/服务、传输方式及流向。时序图说明动作归属和工具结果返回位置；仅在符号或线型需要解释时增加图例。明确标注环境边界，防止混淆 DEV 和常规运行。技术内容由[架构手册](architecture.zh-CN.md)维护。

`docs/` 直接存放使用、排障、参考、架构、开发和发布六份主手册。一项规则在负责该主题的手册中完整说明，其他位置使用链接。README 直接链接本手册的贡献要求和发布手册的漏洞报告流程；技术信任边界归架构手册，AGENTS 规定自动化工作边界。不另建重复正文或仅供跳转的独立文档。`dev-notes/` 保存带日期的开发证据，不替代当前操作说明。

配套的[能力验收用例](acceptance-tests.zh-CN.md)同样直接放在 `docs/`，集中维护可复用提示词、通过条件和结果模板；发布要求链接该文档，不复制用例正文。目标能力变化时同步扩展两个语言版本，带日期的执行结果仍保存在候选版本证据中。

资源按用途归入根目录 `assets/brand/`、`assets/readme/`、`assets/demos/` 和 `assets/diagrams/`，图示 JSON 与 SVG 一起维护。生成工具放在 `scripts/`，平台安装与启动脚本放在 `launcher/packaging/`。不要在各模块复制一份素材。桌面渲染器通过构建引用需要的图标和视频；Electron 打包配置明确映射应用图标、托盘图标与 Linux 启动脚本，保持包内 `assets/` 路径，不携带 README 演示、图示源文件或文档素材。

演示素材应与当前功能相符。暂时保留旧录屏时，必须明确标注其界面与模型名称可能过时，待重录后替换；不得把旧录屏当作当前版本验收证据。

<a id="technical-diagrams"></a>

### 技术图示

手册使用六类技术图，每类维护英文与简体中文两份。仓库中的 SVG 是独立图片，读者无需图表应用或生成工具。

| 文件名 | 回答的问题 |
| --- | --- |
| `system-context` | 模型在哪里推理，由谁执行本地工具？ |
| `components` | 各组件负责什么，工具请求经哪些组件传递？ |
| `request-sequence` | 工具请求、执行结果和最终回答如何返回？ |
| `conversation` | 何时复用网页会话，压缩为何是独立流程？ |
| `installation` | Windows 安装、失败恢复和正常启动分别做什么？ |
| `isolation` | 常规使用与 DEV 如何共享代码，同时隔离状态与资源归属？ |

维护 [`assets/diagrams/sources/`](../assets/diagrams/sources/) 中的 JSON 文件。[生成器](../scripts/render-technical-diagrams.mjs)直接将各图源渲染为对应 SVG，不单独修改 SVG。生成器不依赖图表框架，不推断关系，也不自动补充生命周期连线。

```bash
node scripts/render-technical-diagrams.mjs
node scripts/render-technical-diagrams.mjs --check
node scripts/render-technical-diagrams.mjs --check --preview
```

生成与逐字节一致性检查只需要 Node.js。预览还使用仓库的 `playwright-core` 和已安装的 Chrome/Chromium；`DIAGRAM_BROWSER` 可选择已有可执行文件。它启动无用户认证的独立无头浏览器上下文，阻止网络请求，检查实际文字边界，并将 PNG 预览与验证结果写入忽略的 `output/docs-diagrams-v2/`。

| 图源字段 | 含义 |
| --- | --- |
| `schemaVersion`、`kind`、`locale` | 图源格式、图示用途和内容语言。 |
| `title`、`description` | 可见标题及供辅助技术读取的图示描述。 |
| `width`、`height` | 画布尺寸，需按文档正常显示宽度检查可读性。 |
| `groups` | 环境或职责分组的名称与矩形边界。 |
| `nodes` | 组件或步骤的标题、说明、矩形及可选视觉角色。 |
| `edges` | 明确的起止标识、正交路径，以及可选标签、方向和线型。 |
| `lifelines` | 时序图中各参与者的垂直生命线。 |
| `notes` | 可见的条件、例外或线型解释。 |

标签使用中心坐标和最大文字宽度，换行必须保留完整语义。箭头应到达相关节点或边界，从分组引出的箭头适用于该分组范围。说明实线和虚线的含义。双向通道不代表组件共享执行权限。条件应写在分支上，不依靠脚注纠正无条件箭头所表达的错误流程。

中英文的标识、几何布局、关系和条件保持一致。翻译解释文字，保留产品名、代码标识、路径和协议名。对照所在手册及[架构手册](architecture.zh-CN.md)列出的实现模块，核实连线起止、方向、组件归属、返回路径和异常处理。重新生成两种语言，执行一致性检查，并按文档正常显示宽度查看预览。修正图源或布局问题，不通过隐藏溢出或过度缩小文字来通过检查。图示范围变化时同步调整相邻解释和替代文字，JSON 与 SVG 一并维护。渲染成功不代表语义正确，也不代表通过运行验收。

<a id="application-assets"></a>

### 应用资源

| 资源 | 用途和不变量 |
| --- | --- |
| [`brand-mark.json`](../assets/brand/brand-mark.json) | H 标记的标准矢量轮廓，保留其几何形状。 |
| [`app-icon.svg`](../assets/brand/app-icon.svg) | 黑色底板上的白色 H 标记，22% 圆角，外部四角透明。 |
| [`icon.png`](../assets/brand/icon.png) | 主应用图标，1254 × 1254 RGBA。 |
| [`icon.ico`](../assets/brand/icon.ico) | Windows 图标，含 16、24、32、48、64、128、256 px RGBA 层。 |
| [`iconTemplate.png`](../assets/brand/iconTemplate.png)、[`iconTemplate@2x.png`](../assets/brand/iconTemplate@2x.png) | 18 和 36 px 透明 macOS 托盘模板。 |

文档配色不用于重染应用图标。保留已有 logo 身份、比例、透明四角和各平台资源约定，不得替换其他标记，也不得把棋盘格当成 alpha 透明。

从维护的源文件重新生成主 PNG 和 ICO：

```bash
node scripts/render-icons.mjs
```

脚本需要仓库的 `playwright-core` 和已安装 Chrome；`CHROME_PATH` 可选择已有可执行文件。它使用全新浏览器上下文而非保存的登录状态，检查标准 H 路径、透明四角和图标层，并把验证工件写入忽略的 `output/rounded-icon`。该脚本不重新生成托盘模板。提交资源变更前检查大小尺寸下的实际效果。

### 身份检查

命名或视觉变更应核对双语标识一致、图表标签与实现一致、图标保留标准标记、包元数据仍符合[发布手册](release.zh-CN.md)。包或发布身份元数据变化时运行 `bun run check-version`；资源/配置变更运行适用启动器测试。

保持根目录 [`LICENSE`](../LICENSE) 和 [`LICENSES`](../LICENSES) 下的归属文件完整。命名和视觉调整不得修改版权声明或许可条款，发布包必须保留必要许可材料。
