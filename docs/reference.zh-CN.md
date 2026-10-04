# 配置与模型参考

[English](reference.md) | [简体中文](reference.zh-CN.md) · [项目文档](../README.zh-CN.md#documentation)

本手册集中说明配置字段、模型目录、上下文预算、数据位置和命令接口。首次连接及日常操作见[使用手册](user-guide.zh-CN.md)，设计依据和权限边界见[架构设计](architecture.zh-CN.md)。

默认值适用于新配置；现有明确设置按下文的加载和应用规则处理。模型表描述本仓库实现的路由与运行预算，不代表 OpenAI 服务可用性清单或 API 模型规格。

**本页内容**

- [配置归属与生效](#configuration-ownership)
- [运行时与启动器设置](#runtime-settings)
- [模型目录与推理强度](#models)
- [上下文与传输预算](#context-budgets)
- [环境与数据位置](#data-locations)
- [环境变量](#environment-overrides)
- [命令接口](#commands)
- [模型选择与失败处理](#selection-and-failure-handling)
- [实现依据](#implementation-references)

<a id="configuration-ownership"></a>

## 配置归属与生效

| 层级 | 归属与用途 | 生效方式 |
| --- | --- | --- |
| 运行配置 | 所选 Web2Harness 目录中的 `config.json`；记录浏览器宿主、工具模式、账户能力、传输、隧道及本地端点 | 启动器配置流程或支持的 setup 命令验证并写入配置。正在运行的服务不会监视任意 JSON 文件编辑。 |
| 启动器偏好 | Electron 用户数据中的 `launcher-state.json`；保存语言、窗口行为及界面状态 | 使用「偏好设置」。涉及运行时的选项会调用运行时控制器；启动器状态中的副本不是另一套独立运行配置。 |
| Codex 集成 | 所选 Codex 目录的受管理路由设置及集成日志 | 配置流程、连接控制和子代理协议控制会更新集成。按客户端重启或模型目录验证提示操作。 |
| 浏览器会话 | 所选浏览器配置及其已认证的 ChatGPT 会话 | 在该配置中登录。配置文件本身不会提供账户能力或浏览器登录状态。 |

在「连接与模型」中选择工具模式只会修改待应用选项，点击「应用配置」后才运行配置流程。Context as File 等偏好有各自的控制项，通过运行时控制器生效。修改运行时传输或交互设置前，先完成或取消正在执行的回合；浏览器忙碌时，启动器会拒绝这些修改。模型目录发生变化时，对应 Codex 客户端需要刷新或重启。

CLI 的 `setup` 解析器在未传入模式参数时始终采用原生工具，即使现有配置使用其他模式。每次调用 setup 都应明确指定需要的模式。大多数可选偏好在未传入对应开关时保留现值；`--auto-approve-tool-calls` 是例外，常规 CLI setup 未提供此参数时会传入 `false`。

<a id="runtime-settings"></a>

## 运行时与启动器设置

下列字段分别由运行时配置与启动器偏好管理。标识符用于配置文件和命令；界面中使用可读的模式名称。

<a id="runtime-modes"></a>

### 运行模式与交互方式

以下默认值适用于新建运行配置。配置流程可能保留已有值；桌面启动器会为内嵌浏览器选择 `browserHost: "launcher"`。

| 配置项 | 默认值 | 可选值与作用 |
| --- | --- | --- |
| `mode` | `native-tools` | `native-tools`：将结构化浏览器响应转换为 Codex 执行的工具调用。`mcp-bridge`：通过隧道将连接器调用转发到活动 Codex 任务。`browser-only`：仅浏览器模型响应，不提供本地工具或隧道。 |
| `browserInteractionMode` | `automatic` | `automatic`：浏览器自动化负责选择、提交及观察 ChatGPT 回合。`manual`：界面中的 **Zero Risk** 模式，由用户选择模型、粘贴并提交，连接器传递回合、工具及完成消息。要求 `mode: "mcp-bridge"` 且 `browserHost: "launcher"`。 |
| `subagentProtocol` | `compatibility-v1` | `compatibility-v1`：对任务中的原生与 Web 模型目录条目使用 V1 协作协议，保留原生明确禁用的能力。`native`：遵循原生模型目录的协作协议。切换协议后需要重启 Codex 和启动器。 |
| `browserHost` | `managed-chrome` | `managed-chrome`：使用配置的 Chrome 可执行文件与已保存会话。`launcher`：通过描述文件连接启动器拥有的浏览器。 |
| `autoApproveToolCalls` | `false` | 布尔值。允许自动点击浏览器中的 **Allow once** 提示，不替代 Codex 沙箱或审批策略。 |
| `zeroRiskProEnabled` | `false` | 布尔值。在手动模式中额外发布使用 Pro 预算的模型条目。用户必须在每个回合选择 ChatGPT Pro，启动器不能验证该选择。 |

自动和手动 MCP 配置使用不同的隧道 ID 与连接器身份。常规自动交互连接器为 `Codex Native2`，DEV 自动交互连接器为 `Codex Native2 DEV`，手动交互连接器为 `Codex Zero Risk`。当前 `appName` 和 `tunnel` 必须与所选交互方式一致。一条交互路径验证成功，不代表另一条也已验证。

<a id="conversation-and-attachments"></a>

### 会话与附件设置

| 配置项 | 默认值 | 作用与限制 |
| --- | --- | --- |
| `useSavedChats` | `true` | 任务会话使用 ChatGPT 历史记录；`false` 选择 Temporary Chat。加载配置时保留明确的 `false`。此设置与会话是否复用相互独立。 |
| `experimentalFreshConversationPerTurn` | `false` | `false` 允许原生工具或 MCP Bridge 复用启动器宿主上符合条件的 Sol／Pro 会话；`true` 为每个自动回合新建浏览器会话。仅浏览器与 Luna 使用其他连续性机制。手动配置流程拒绝显式启用。参见[对话状态](architecture.zh-CN.md#conversation-state-and-compaction)。 |
| `experimentalContextFiles` | `false` | 对较大上下文启用实验性的 Context as File 文件传输，较小输入仍可内联发送。手动模式不可用。 |
| `experimentalContextTripleBudget` | `false` | Context as File 开启后，将适用的自动 Sol／Pro 模型目录上下文与压缩预算乘以三。不增加单条浏览器消息限制、账户额度或底层模型容量。关闭 Context as File 会清除此设置。 |
| `experimentalSkillAttachments` | `false` | 将选中的 skill 内容作为文本附件发送。手动模式不可用。 |

文件传输与更大上下文预算是两项独立选择。未启用文件传输就请求更大预算会导致配置失败。切换到手动模式会清除文件传输、更大预算和 skill 附件设置。手动模式配置流程拒绝 `--login`、账户能力刷新，以及显式启用上述不支持功能的请求。

<a id="endpoint-and-browser"></a>

### 端点、浏览器与内部字段

这些字段用于运行时集成及诊断。应优先通过配置流程修改，避免直接编辑。

| 配置项 | 默认值或生成值 | 校验与用途 |
| --- | --- | --- |
| `host` | `127.0.0.1` | Responses 监听地址只接受此 IPv4 回环地址。 |
| `port` | 常规环境为 `17841` | `1` 至 `65535` 的整数；DEV 独立选取端口。本地 Responses 基地址为 `http://127.0.0.1:<port>/v1`。 |
| `contextWindow` | `256000` | 通用 provider 配置使用的正安全整数。Web 模型目录窗口与发送前预算按路由单独计算；此字段不覆盖[模型预算策略](#context-budgets)。 |
| `stallTimeoutSec` | 未设置；有效默认值为 `300` 秒 | 有限正数。桥接层向上取整，并限制在 `1`–`3600` 秒；适配器连续无事件超过该时间后报告 `upstream_stall_timeout`。它不是回合总时长限制。 |
| `chromeExecutablePath` | macOS：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；Windows：`%PROGRAMFILES%\Google\Chrome\Application\chrome.exe`，缺省根目录为 `C:\Program Files`；Linux：`/usr/bin/google-chrome` | 受管理浏览器及登录路径使用的非空可执行文件路径，可通过 `--chrome` 覆盖。 |
| `headed` | `true` | 布尔值，控制受管理浏览器是否显示窗口。 |
| `storageStatePath` | `<主目录>/browser/storage-state.json` | 受管理浏览器使用的非空会话文件路径；启动器持久浏览器分区单独保存会话。 |
| `browserHostDescriptorPath` | 启动器提供 | `browserHost: "launcher"` 时必需的绝对路径，描述浏览器所属进程及私有控制端点。 |
| `brokerSocketPath` | Unix：`<主目录>/runtime/turn-broker.sock`；Windows：`\\.\pipe\web2harness-<主目录哈希>` | 根据平台使用绝对 Unix socket 路径或有效 Windows 命名管道。Windows 身份从解析后的主目录派生。 |
| `controlToken` | 从 32 个随机字节生成 | 私有 base64url 控制凭据；解析器要求至少 40 个字符，且仅含字母、数字、`_` 和 `-`。 |
| `runtimeCommand` | 当前持久安装的运行时可执行文件及可选入口文件 | 非空字符串数组；首项必须是存在的绝对可执行文件路径。命令中的绝对路径不能位于临时目录。 |
| `solAvailable` / `extraHighAvailable` / `proAvailable` | 初始为 `true` / `false` / `false`；配置流程读取账户能力 | 账户能力观察值，不是权限开关。Extra High 和 Pro 均要求 Sol；Extra High 数据缺失时必须探测后才能显示。 |
| `version` / `releaseVersion` | 配置架构 `5` / 当前包版本 | 受管理元数据。支持的旧架构在加载时归一化，常规配置流程持久保存迁移后的配置；不支持的架构会校验失败。 |
| `purpose` | 常规配置缺省；DEV 配置流程写入 `dev-harness` | 可选用途标记，不接受其他值。环境归属还需结合路径、描述文件及进程检查。 |
| `acknowledgedUnofficialAt` | 配置流程记录 | 必需的非官方浏览器自动化声明确认时间。 |

<a id="tunnel"></a>

#### 隧道对象

`mode` 为 `"mcp-bridge"` 时，必须提供有效的当前 `tunnel` 对象。`automaticTunnel` 与 `manualTunnel` 各自保留配置；存在这些字段时，当前交互方式对应的对象必须与 `tunnel` 相同，且两种方式的隧道 ID 必须不同。

| 字段 | 接受的值 |
| --- | --- |
| `tunnelId` | `tunnel_` 后跟恰好 32 个小写十六进制字符 |
| `runtimeKeyFile` | 保存隧道运行凭据的私有文件绝对路径 |
| `binaryPath` | 受管理 tunnel-client 可执行文件的绝对路径 |
| `profileDir` | tunnel-client 配置目录的绝对路径 |
| `profileName`、`alias` | 仅含字母、数字、`.`、`_` 和 `-` 的非空字符串 |

配置流程管理当前隧道对象和凭据文件。DEV MCP Bridge 的远程隔离不能仅由本地名称及路径证明：[开发流程](development.zh-CN.md)要求明确确认隧道属于 DEV，并验证连接器的实际绑定。

<a id="launcher-preferences"></a>

### 启动器偏好

| 偏好项 | 默认值 | 作用 |
| --- | --- | --- |
| `language` | 引导完成前未设置 | `en` 或 `zh-CN`，控制启动器界面语言，不修改 ChatGPT 语言。 |
| `autoStart` | 常规启动器状态为 `true` | 通过启动器控制系统登录自启动；DEV 禁用该控制，需显式启动。 |
| `keepRunningOnClose` | `true` | 有托盘时，关闭窗口会隐藏窗口；没有托盘时按正常关闭行为处理。 |
| `showBrowserDuringTurns` | `true` | 自动任务开始时显示浏览器；手动回合独立于此偏好显示浏览器。 |
| `sidebarOpen` / `sidebarWidth` | `true` / `252` | 保存的侧栏布局；宽度限制为 `240`–`420`。 |

配置完成、模型目录验证、浏览器检查和重启指示均由启动器维护，不能通过手工修改这些状态字段将失败检查标记为通过。

<a id="models"></a>

## 模型目录与推理强度

Web2Harness 在经过身份验证的原生 Codex 目录中追加账户允许的 Web 条目。原生模型继续使用原生路由；Web 条目使用已登录的 ChatGPT 浏览器会话。

<a id="model-identifiers"></a>

### 模型标识与名称

| 概念 | 示例 | 含义 |
| --- | --- | --- |
| Codex 模型 ID | `chatgpt-web/gpt-6-pro` | Codex 及已保存任务使用的精确路由标识；命令要求模型 ID 时应使用此值。 |
| 显示名称 | `GPT-6 Pro (Web)` | 模型选择器中的可读名称，不是路由 ID。 |
| 浏览器模型家族 | `6` | 独立于推理强度，选择并验证需要的 ChatGPT 模型家族。 |
| 内部适配器模型 | `gpt-5.6-sol` | Sol／Pro 浏览器适配器与上下文策略共用的实现标识。路由的 `modelFamily` 选择实际浏览器家族；此内部名称不代表 GPT-6 请求会被发送给 GPT-5.6。 |
| 推理强度 | `max` | 所选路由支持的值；可用值随路由和账户能力变化。 |

没有 `chatgpt-web/` 前缀的原生 ID 保持原生路由。Web ID、浏览器标签与名称相近的原生／API 模型，不足以证明上下文容量、服务档位、响应行为或可用性相同。

自动 Web 条目公布文本与图片输入能力，手动条目仅公布文本输入能力。工具访问单独设置：原生工具将验证后的浏览器工具请求交给 Codex，MCP Bridge 通过隧道转发连接器调用，仅浏览器不提供本地工具。修改模型 ID 不会改变工具模式。

<a id="automatic-catalog"></a>

### 自动模式模型目录

启动器从已认证浏览器记录 `solAvailable`、`extraHighAvailable` 和 `proAvailable`，模型解析器据此构建目录。`solAvailable: false` 选择仅 Luna 的目录；`proAvailable: true` 选择 Pro 账户预算策略并启用 Pro 条目。Extra High 必须有独立的正向能力观察结果。

| 模型 ID | 显示名称 | 目录条件 | 强度与默认值 |
| --- | --- | --- | --- |
| `chatgpt-web/gpt-5.6-luna` | GPT-5.6 Luna · Ordinary / Think (Web) | `solAvailable: false` | `low` 为 Ordinary，`medium` 为 Think；默认 `low` |
| `chatgpt-web/gpt-5.6-sol-instant` | GPT-5.6 Sol · Instant (Web) | Sol 可用，且 Instant 不能与 Sol 条目共用上下文预算 | 固定 `low` |
| `chatgpt-web/gpt-5.6-sol` | GPT-5.6 Sol (Web) | Sol 可用 | `medium`、`high`；探测可用时提供 `xhigh`；预算相同时提供 `low`；默认 `high` |
| `chatgpt-web/gpt-5.6-pro` | GPT-5.6 Sol Pro (Web) | Sol 与 Pro 可用 | 固定 `max` |
| `chatgpt-web/gpt-6-pro` | GPT-6 Pro (Web) | Sol 与 Pro 可用 | 固定 `max` |

当前注册表没有 GPT-6 Instant、Medium、High 或 Extra High 路由。GPT-6 Pro 路由使用现有 Pro 兼容预算，其完整浏览器容量尚未独立标定。

模型目录判断记录的是通用 Sol／Extra High／Pro 能力，不是每个模型家族各自的可用性标记。在提交具有明确家族名称的自动路由前，适配器会选择并验证浏览器家族和推理强度。只有一个通用 Pro 标签不足以通过验证。无法验证目标家族时返回 `model_version_unavailable`，待发送消息不会提交，也不会静默换用其他家族。

<a id="instant-grouping"></a>

#### Instant 的分组规则

一个 Codex 模型目录条目只有一套上下文约定：窗口、有效窗口百分比及自动压缩阈值。只有三项完全一致，多个推理强度才能合并到同一条目。

| 账户策略 | Instant 行为 |
| --- | --- |
| 已观察到 Pro 能力 | Instant 与普通 Sol 思考档位均使用 `111193` 窗口和 `95000` 压缩阈值；`low` 显示在 `chatgpt-web/gpt-5.6-sol` 内。独立 Instant ID 仍可解析已保存任务，但在普通选择器中隐藏。 |
| Sol 可用但未观察到 Pro 能力 | Instant 使用 `41000` / `32000`，Medium 和 High 使用 `90000` / `80000`。目录单独显示 Instant，主 Sol 条目不提供 `low`。 |

预算不同时，若调用方在主 Sol 条目上请求 `low`，请求会被拒绝，并提示选择独立 Instant 条目。实现不会缩小思考档位的预算来合并这些选项。

<a id="effort-mapping"></a>

#### 推理强度映射

| Codex 强度 | 自动 Sol／Pro 浏览器选择 | 限制 |
| --- | --- | --- |
| `low` | Instant，滑块位置 `0` | 预算相同时可在 Sol 条目内选择，否则需选独立 Instant 条目。 |
| `medium` | Medium，位置 `1` | 标准 Sol 思考选项。 |
| `high` | High，位置 `2` | 主 Sol 条目的默认值。 |
| `xhigh` | Extra High，位置 `3` | 要求 `extraHighAvailable: true`。 |
| `max` | Pro，位置 `4` | 具有明确名称的 Pro 条目仅支持此强度。 |

Luna 使用上方目录表中的 Ordinary／Think 映射，不使用 Sol 的五档映射。新的 Pro 路由 ID 使用 `max`；`ultra` 只作为旧兼容路由的技术强度保留。强度名称描述浏览器控制项，不代表独立底层模型，也不是原生 Codex Fast 服务档位。

<a id="manual-catalog"></a>

### 手动模式模型目录

手动交互发布手动配置档位，替代自动模式的家族条目。启动器将其称为 **Zero Risk** 模式，要求 MCP Bridge 和启动器内嵌浏览器，详见[配置参考](#runtime-settings)。

| 模型 ID | 显示名称 | 可用性与用户操作 |
| --- | --- | --- |
| `chatgpt-web/zero-risk` | ChatGPT Web — Zero Risk | 默认手动条目；用户选择浏览器模型并提交每个增量提示。 |
| `chatgpt-web/zero-risk-pro` | ChatGPT Web — Zero Risk Pro | 仅在 `zeroRiskProEnabled: true` 时添加；用户必须每回合选择 ChatGPT Pro，以匹配配置的较大预算。 |

两个档位均使用技术强度 `low`，且只接受文本输入；该值不会选择 Instant 或其他 ChatGPT 模型。手动模式不检查浏览器中所选模型，也不刷新账户能力。使用 Pro 预算的条目来自用户显式设置，不代表已探测到使用权限。Context as File 与 skill 附件不可用。

<a id="saved-task-compatibility"></a>

### 已保存任务兼容

当前账户和交互方式允许时，兼容路由 ID 仍可解析。它们在普通选择器中隐藏，唯一例外是需要独立预算时的单独 Instant 条目。

| 兼容 ID | 保留的选择 |
| --- | --- |
| `chatgpt-web/light` | Sol 适配器 Instant |
| `chatgpt-web/medium` | Sol 适配器 Medium |
| `chatgpt-web/high` | Sol 适配器 High |
| `chatgpt-web/extra-high` | Sol 适配器 Extra High，受账户能力限制 |
| `chatgpt-web/pro` | Sol 适配器 Pro；技术 Codex 强度 `ultra` 映射为浏览器 `max` |
| `chatgpt-web/luna` | Luna Ordinary，仅限 Luna 账户 |
| `chatgpt-web/think` | Luna Think，仅限 Luna 账户 |
| `chatgpt-web/gpt-5.6-sol-instant` | 具有明确家族名称的 GPT-5.6 Sol Instant，分组合并导致隐藏时仍可使用 |

较旧的固定路由保留原适配器绑定，不会自动获得新命名路由的模型家族固定选择。需要明确选择家族时，应使用当前命名路由。命名路由收到不支持的推理强度时会拒绝请求，不会静默重新映射。

<a id="context-budgets"></a>

## 上下文与传输预算

三类限制具有不同用途：

1. **目录上下文窗口**：Web 模型条目向 Codex 公布的窗口，也是适配器发送前输入检查使用的窗口。
2. **自动压缩阈值**：任务历史达到该规模后，Codex 应在后续浏览器回合前执行压缩。
3. **浏览器消息限制**：单条已提交浏览器消息独立的 token 或字符边界。

权威实现位于[上下文策略](../src/models/chatgpt-web-context.ts)。这些数值是运行预算配置，文件上传成功、原生／API 模型规格或较小提示成功，都不能证明浏览器能够使用更大的上下文。

<a id="standard-context-budgets"></a>

### 标准目录预算

数值单位为 token。下表未启用 Context as File 的可选三倍预算。

| 路由／账户策略 | 上下文窗口 | 自动压缩阈值 | 有效窗口百分比 |
| --- | ---: | ---: | ---: |
| 未具备 Pro 能力的 Sol Instant | 41,000 | 32,000 | 78% |
| 未具备 Pro 能力的 Sol Medium／High 及可用的 Extra High | 90,000 | 80,000 | 89% |
| Pro 账户的 Sol Instant／Medium／High／可用 Extra High | 111,193 | 95,000 | 85% |
| GPT-5.6 Sol Pro 或 GPT-6 Pro | 112,193 | 95,000 | 85% |
| 默认手动档位 | 123,000 | 96,000 | 78% |
| 使用 Pro 预算的手动档位 | 336,579 | 285,000 | 85% |
| Luna Ordinary／Think | 1,050,000 | 公布值 1,050,000；见下方 Luna 行为 | 公布值 100% |

有效百分比计算为 `round(autoCompactTokenLimit / contextWindow × 100)`。Codex 的上下文指示器使用这些元数据，因此界面显示的工作预算不一定等于原始窗口值。

Pro 账户窗口包含 `8192` token 的平台预留，以及为适配器严格小于判断增加的一个 token：普通 Sol 为 `103000 + 8192 + 1`，Pro 为 `104000 + 8192 + 1`。单条消息边界包含上限本身；上下文发送前检查要求总估算输入严格小于上下文窗口。

手动档位使用每回合参考预算的三倍，因为可见会话承载连续增量回合。这不会启用 Context as File，也不保证任意手动选择的模型都能接受该规模的历史。

<a id="message-budgets"></a>

### 单条消息传输预算

| 自动路由／账户策略 | 明确的可见消息 token 上限 | 内联字符上限 |
| --- | ---: | ---: |
| 未具备 Pro 能力的 Sol Instant | 无独立上限；仍检查总上下文 | 211,256 |
| 未具备 Pro 能力的 Sol Medium／High／可用 Extra High | 无独立上限；仍检查总上下文 | 1,048,572 |
| Pro 账户的 Sol Instant | 103,000 | 545,000 |
| Pro 账户的 Sol Medium／High／可用 Extra High | 103,000 | 500,000 |
| GPT-5.6 Sol Pro 或 GPT-6 Pro | 104,000 | 1,635,000 |

输入必须同时满足所有适用限制。输入估算包含可见文本、上下文文件内容、所选 skill 附件、`8192` 平台预留以及图片预留。每张图片预留 `4096` token，`detail: "original"` 时预留 `8192`。字符与 token 限制相互独立：消息可能符合 token 预算，却超过字符上限。字符检查采用 JavaScript 字符串长度。

对 Sol／Pro，普通可见文本预算取以下两者较小值：明确的消息 token 上限，以及 `标准上下文窗口 − 平台预留 − 图片预留 − 1`。没有图片预留时，非 Pro Instant 为 `32807`，非 Pro 思考档位为 `81807`，Pro 账户普通 Sol 为 `103000`，Pro 为 `104000`。这些派生值用于传输规划，不是额外的压缩阈值。

<a id="context-files"></a>

### Context as File 与三倍预算

`experimentalContextFiles` 改变较大上下文的发送方式；`experimentalContextTripleBudget` 是单独的选择，仅在文件传输开启时生效。对自动 Sol／Pro 策略，它将窗口与压缩阈值乘以三，有效百分比保持不变。例如，Pro 账户普通 Sol 变为 `333579` / `285000`，Pro 路由变为 `336579` / `285000`。

三倍预算不会放大可见消息 token 上限、字符上限或账户使用额度；每张图片的 token 预留保持不变。它也不会改变 Luna 的检查点策略。手动模式拒绝文件传输并使用自己的固定预算。上传成功不证明浏览器模型使用了全部上传上下文。

<a id="luna-continuity"></a>

### Luna 连续性与浏览器边界

Luna 公布 `1050000` 窗口和相同的自动压缩阈值。实现注明 Codex 内部会将该阈值限制到窗口的 90%；Web2Harness 通过完成历史的私有滚动检查点控制普通浏览器回合规模。检查点最多为 `4000` token，不出现在可见助手文本中。

浏览器发送前检查对 Luna 的 Ordinary 和 Think 模式施加独立的 `28000` token 总估算请求预算，包含预留。因此，大目录窗口不代表单次 Luna 浏览器请求可以携带一百万 token。Luna 拒绝专门的 Codex 压缩请求；当前回合本身超过浏览器预算时，必须减少该回合输入，已完成历史被检查点替代后，`/compact` 无法继续缩小当前回合。

<a id="native-context-preservation"></a>

### 原生 Codex 上下文保留

Web2Harness 从原生模型目录模板创建 Web 条目，再写入 Web 路由自己的上下文元数据。Web 条目移除原生模板的 `comp_hash`，也不继承原生速度／服务档位。目录中的 `supported_in_api: true` 表示本地桥接实现了这些 ID，不代表 OpenAI 公共 API 提供这些模型。

原生条目保留自己的 `context_window`、压缩元数据与预算。集成不会将 Web 预算写入用户顶层的 `model_context_window` 或 `model_auto_compact_token_limit`。如果用户已设置正整数 `model_context_window`，目录扩展可以提高原生条目的 `max_context_window`，以保留该显式覆盖；不会降低原有更大的最大值，也不会修改原生条目的上下文／压缩字段。Codex 仍负责应用自身配置。

`compatibility-v1` 子代理设置会另外修改原生与 Web 条目的协作元数据；保留上下文并不代表原生目录中的每个字段逐字节不变。

<a id="data-locations"></a>

## 环境与数据位置

`~` 表示当前用户主目录。下表说明存放位置，不是清理操作指令。

| 数据 | 常规环境 | 隔离 DEV 环境 |
| --- | --- | --- |
| Web2Harness 主目录 | `~/.web2harness/` | `~/.web2harness-dev/` |
| 运行配置 | `<主目录>/config.json` | `<DEV 主目录>/config.json` |
| Codex 主目录 | `CODEX_HOME`，未设置时为 `~/.codex/` | `<DEV 主目录>/codex-home/` |
| Electron 用户数据 | Electron 对应系统应用数据目录下的 `Web2Harness/` | `<DEV 主目录>/launcher/` |
| 启动器偏好 | `<Electron 用户数据>/launcher-state.json` | `<DEV 主目录>/launcher/launcher-state.json` |
| 持久浏览器分区 | `persist:web2harness-chatgpt` | `persist:web2harness-dev-chatgpt` |
| 浏览器宿主描述文件 | `<主目录>/runtime/launcher-browser.json` | `<DEV 主目录>/runtime/launcher-browser.json` |
| 受管理 Chrome 会话文件 | 默认 `<主目录>/browser/storage-state.json` | 各环境独立保存，不从常规环境复制 |
| 受管理自动交互隧道密钥 | `<主目录>/secrets/tunnel-runtime-automatic.key` | DEV 主目录内的相同相对位置 |
| 受管理手动交互隧道密钥 | `<主目录>/secrets/tunnel-runtime-zero-risk.key` | DEV 主目录内的相同相对位置 |
| 命名 DEV 工作区 | 不适用 | `<DEV 主目录>/workspaces/<name>/` |
| DEV 聊天及传输状态 | 不适用 | `<DEV 主目录>/chats/` 和 `<DEV 主目录>/runtime/dev-chat/` |

浏览器会话、隧道密钥、配置中的控制令牌及描述文件均属于私有数据。原始诊断、浏览器状态和配置备份不能进入受版本管理的文档。边界说明见[安全架构](architecture.zh-CN.md#security-boundaries)，隔离测试见[开发指南](development.zh-CN.md)。

DEV 拒绝与生产数据目录重叠，使用独立浏览器登录及 Codex 主目录，并分配不同于常规默认值 `17841` 的回环端口。使用 `bun run dev:launcher` 启动；通过 `bun run src/cli.ts dev status --json` 检查当前环境和端点。不要让测试指向常规环境，也不要复制生产凭据。

<a id="environment-overrides"></a>

## 环境变量

覆盖值仅对接收它的进程生效。以下为支持的启动覆盖项，不包含全部内部测试变量。

| 变量 | 范围与作用 |
| --- | --- |
| `WEB2HARNESS_HOME` | 常规核心目录；CLI `--home PATH` 为当前调用选择相同范围，支持 `~` 展开。 |
| `WEB2HARNESS_DEV_HOME` | 独立 DEV 根目录，不能与生产目录重叠；DEV 拒绝 `--home`。 |
| `CODEX_HOME` | 常规 Codex 主目录；DEV 将其子进程环境设置为 `<DEV 主目录>/codex-home`。 |
| `WEB2HARNESS_LAUNCHER_DATA_DIR` | 常规 Electron 用户数据目录；DEV 改用 `<DEV 主目录>/launcher`。 |
| `WEB2HARNESS_CODEX_EXECUTABLE` | 为 DEV 可执行文件发现指定 Codex 可执行文件或 npm JavaScript 入口。 |
| `WEB2HARNESS_LAUNCHER_EXECUTABLE` | 为 DEV 指定打包启动器，该构建必须支持 DEV 环境；没有此覆盖项时，源码目录可使用自己的启动器开发脚本。 |
| `WEB2HARNESS_BUN` | 运行时发现使用的持久安装 Bun 可执行文件；安装运行命令时拒绝临时可执行文件。 |
| `WEB2HARNESS_REPOSITORY` | 显式 `OWNER/REPOSITORY` 发布源；打包元数据可提供启动器的缺省值。显式值无效时不会静默回退。安装脚本要求见[发布指南](release.zh-CN.md)。 |

不要修改全局环境变量将测试重定向到生产环境。DEV 命令自行构造隔离的子进程环境。

<a id="commands"></a>

## 命令接口

安装后的可执行命令为 `web2harness`；源码目录中可替换为 `bun run src/cli.ts`。Linux 桌面入口为 `web2harness-desktop`。

| 命令 | 用途与副作用 |
| --- | --- |
| `--help`、`--version` | 输出 CLI 帮助或版本。 |
| `doctor --json` / `status --json` | 执行诊断并返回结构化结果；报告不健康时返回非零退出码。 |
| `route status` | 检查受管理 Codex 路由是否已安装及启用。 |
| `route connect` / `route disconnect` | 启用或恢复受管理路由设置；发生修改后重启 Codex。 |
| `subagents status` | 检查已配置的协作协议和路由状态。 |
| `subagents compatibility-v1` / `subagents native` | 修改协议；需重启 Codex 和启动器。 |
| `browser check` | 检查配置的浏览器引擎或启动器浏览器；手动模式仅检查宿主存活，不检查 ChatGPT DOM。 |
| `setup [options]` | 验证并配置运行时、账户能力及 Codex 集成，会修改所选环境。 |
| `login` | 执行支持的浏览器登录流程；启动器拥有的登录仍由启动器控制。 |
| `serve` | 在前台启动所选运行时的 Responses 服务。 |
| `service status` / `tunnel status` | 检查所选环境的服务或隧道状态。 |
| `service install`、`start`、`restart`、`stop`、`cancel-turns` | 修改服务生命周期或取消活动回合；可用性取决于运行时平台和归属。 |
| `tunnel start`、`restart`、`stop`、`key-import` | 修改隧道生命周期或导入私有运行密钥。 |
| `open tunnels`、`open runtime-keys`、`open connectors` | macOS 打开对应设置网址，其他平台输出该网址。 |
| `uninstall --yes [--keep-data]` | 恢复受管理 Codex 集成并移除安装，可选保留私有数据。启动器拥有的集成必须从启动器「设置」中移除，以便先安全结束其运行时任务。 |
| `dev launcher`、`dev status --json`、`dev setup`、`dev codex -- …`、`dev chat NAME`、`dev list` | 使用隔离开发环境；实时测试前遵循[开发指南](development.zh-CN.md)。 |

<a id="setup-options"></a>

### Setup 选项分组

| 选项 | 对应设置与限制 |
| --- | --- |
| `--native-tools`、`--browser-only`、`--mcp-bridge` | 互斥运行模式，默认 `--native-tools`。 |
| `--automatic-browser-interaction`、`--zero-risk-browser-interaction` | 互斥交互方式；手动方式要求 MCP Bridge 和启动器描述文件。 |
| `--port NUMBER`、`--chrome PATH`、`--browser-host-descriptor PATH` | 端点与浏览器选择；描述文件选择启动器宿主，只有 Chrome 覆盖而没有描述文件时选择受管理 Chrome。 |
| `--subagent-protocol compatibility-v1\|native` | 选择协作协议。 |
| `--refresh-account-capabilities`、`--login` | 重新检查账户能力或刷新受管理浏览器登录；手动模式不可用，启动器会话登录由其界面控制。 |
| `--tunnel-id ID`、`--runtime-key-file PATH` | 为所选交互路径提供 MCP Bridge 连接凭据。 |
| `--saved-chats` / `--temporary-chats` | 设置 `useSavedChats`。 |
| `--fresh-conversation` / `--retained-conversation` | 设置自动交互的会话复用。 |
| `--context-files` / `--no-context-files` | 设置 Context as File 传输。 |
| `--context-triple-budget` / `--standard-context-budget` | 设置更大或标准预算；更大预算要求文件传输。 |
| `--skill-attachments` / `--inline-skills` | 设置所选 skill 的附件传输。 |
| `--zero-risk-pro` / `--zero-risk-default` | 添加或移除使用 Pro 预算的手动模型条目；仅能在手动模式中配置。 |
| `--auto-approve-tool-calls` | 启用浏览器 Allow once 自动点击。 |
| `--replace-codex-route` | 显式允许可逆替换现有 Responses 或 Voice 路由设置。 |
| `--restart-service` | 允许配置流程在需要时重启本项目守护进程。 |
| `--acknowledge-unofficial` | 提供配置流程要求的声明确认；未提供时必须进行交互式确认。 |

每对启用／关闭参数互斥。开发测试不能针对用户当前运行的安装执行常规 setup 或服务命令。

<a id="selection-and-failure-handling"></a>

## 模型选择与失败处理

应用配置或刷新账户能力后，按启动器提示刷新对应 Codex 模型目录。账户或浏览器界面发生变化时，已保存的能力观察可能过期。编辑 `proAvailable` 等字段不能解锁服务能力。

隔离命令行使用时，选择精确路由 ID，例如：

```bash
bun run dev:codex -m chatgpt-web/gpt-5.6-sol
bun run dev:codex -m chatgpt-web/gpt-6-pro
```

这些命令启动真实 DEV Codex 会话，要求先完成[开发配置与隔离流程](development.zh-CN.md)。本文列出命令不代表当前账户支持对应条目。

| 现象 | 含义及后续操作 |
| --- | --- |
| 没有独立 Instant 条目 | Pro 账户预算策略下，在 GPT-5.6 Sol 内选择 `low`。 |
| Sol 条目拒绝 `low` | 该账户的 Instant 使用独立预算，改选独立 Instant ID。 |
| 没有 Extra High | 未保存正向 Extra High 能力观察；在自动模式刷新账户能力。 |
| Pro 条目没有更低强度 | 具有明确名称的 Pro 路由按设计固定为 `max`。 |
| `model_version_unavailable` | 无法验证目标浏览器家族／强度；重试前检查浏览器选择及受支持的界面语言。 |
| `context_length_exceeded` | 超过适用的 token、字符或总输入限制；减少输入或对支持的路由执行压缩。文件传输不能消除全部限制。 |
| 主选择器有 Web 条目，但子代理覆盖不可用 | 客户端的子代理模型覆盖列表可能小于主模型目录；检查实际提供的覆盖值和所选子代理协议。 |

<a id="implementation-references"></a>

## 实现依据

以下模块定义本参考手册中的契约。目录职责与修改流程见[开发手册的仓库地图](development.zh-CN.md#repository-map)。

| 契约 | 实现 |
| --- | --- |
| 配置与命令 | [运行配置结构及默认值](../src/config.ts)、[配置应用规则](../src/setup.ts)、[CLI 解析器](../src/cli.ts)。 |
| 持久化结构迁移 | [共享迁移](../launcher/shared/config-migration.cjs)，供 Bun 与桌面共用的纯模块；校验和文件写入仍由调用方负责。 |
| 环境与桌面偏好 | [启动器环境](../launcher/electron/profile.cjs)、[启动器状态](../launcher/electron/state.cjs)、[DEV 环境](../src/dev/profile.ts)、[DEV 命令](../src/dev/cli.ts)。 |
| 运行控制 | [停滞检测](../src/stall-timeout.ts)、[隧道存储](../src/runtime/tunnel.ts)。 |
| 模型身份与可用性 | [路由注册表](../src/models/chatgpt-web-model-registry.ts)、[账户感知解析](../src/models/chatgpt-web-models.ts)、[模型类型](../src/models/chatgpt-web-model-types.ts)。 |
| 上下文与压缩预算 | [上下文与传输策略](../src/models/chatgpt-web-context.ts)、[输入估算与 Luna 边界](../src/adapters/chatgpt-web/prompt/input-tokens.ts)、[滚动检查点](../src/adapters/chatgpt-web/conversation/rolling-checkpoint.ts)。 |
| 目录与选择校验 | [模型目录扩展](../src/models/model-catalog.ts)、[原生上下文覆盖读取](../src/codex/integration-document.ts)、[浏览器家族验证](../src/adapters/chatgpt-web/browser/model-selection.ts)。 |

[返回项目文档](../README.zh-CN.md#documentation) · [使用手册](user-guide.zh-CN.md) · [故障排查](troubleshooting.zh-CN.md)
