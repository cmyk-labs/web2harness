# 原生工具模式兼容对照与边界

[English](native-tools-compatibility.md) | [简体中文](native-tools-compatibility.zh-CN.md) · [文档导航](../README.zh-CN.md#documentation)

本对照基于 **2026-10-18** 核查的源码与证据。**本次核查中的最新已发布版本是 2.4.0；下述兼容改动仍属于未发布源码。** 工作区已有实现、fixture 通过或包版本号未变，都不意味着已安装的 2.4.0 包含这些改动。本文不表示已经发布或部署到生产。

目标是让 Web 模型承接 Codex 的模型交互，同时保留 Codex 工具、执行、任务上下文、权限、审批，以及显式模型和推理强度选择。移除一项额外限制，不等于已经兼容 Codex 全部能力。明确拒绝不支持的请求属于正确的失败处理，不代表缺失能力已经实现。

**目录**

- [能力对照](#comparison)
- [原生搜索](#search)
- [Hosted 工具与真实独立执行器](#hosted-tools)
- [附件、输出与上下文](#data-contracts)
- [传输、续接与原生等待](#transport)
- [可靠性改进与保留失败](#reliability)
- [证据与待验收项](#evidence)

<a id="comparison"></a>

## 能力对照

下文“已实现”指核查时源码中存在实现。“证据”限定实际已经证明的范围，不是全面兼容证明。

| 能力 | 未发布源码／保留行为 | 边界与证据 |
| --- | --- | --- |
| 原生 function/custom/namespace 工具与延迟发现 `tool_search` | 保留任务工具目录、身份、参数及调用与结果对应关系，由 Codex 在自己的沙箱和审批约束下执行。 | 有既有定向 fixture 和此前认证 DEV 的读取 → 补丁 → 命令流程；不代表逐个认证了所有工具、插件或 MCP 服务。 |
| 原生搜索 | 在原生 `/alpha/search` 路径周围新增可恢复的 `standalone_web_search` 配置及搜索模型别名处理，保留 Codex 的 `web.run` 执行器和搜索设置。 | 配置／传输 fixture、合成上游 CLI fixture，以及 GPT-6 Sol／`xhigh`、限制 `learn.chatgpt.com` 域名的实时搜索认证 DEV 均已通过；有原生读取／修改／回读证据。 |
| 原始 hosted `web_search`／`web_search_preview` 声明 | Web Responses 解析器仍明确拒绝，并提示使用 Codex standalone 搜索路径。 | 不静默删除声明，也不翻译为虚构的本地工具；禁用搜索不是等价修复。 |
| DOCX/XLSX/PPTX 输入 | 在既有 PDF／文本路径上增加 Office 原始字节上传、规范 MIME 和有界包结构校验。 | fixture 及共享 Responses 组件的认证 DEV 均通过，正确读出三个 Office 附件中的不同标识；属于组件验收，不是 Codex Office 工具端到端通过。 |
| 远程图片／`input_file.file_url` | 新增绑定任务／provider／账号的精确 URL 授权，预检后有界解析公开 HTTPS。预填保留原引用，不下载。 | 七项共享边界测试及解析器／网络 fixture 通过。真实公开 PDF URL 组件验收**通过**，不代表远程图片 live 或 Codex 文件工具端到端验收。 |
| provider `file_id` 与原始音频／视频 | 此 Web 附件路径明确不支持，包括预填阶段。 | 尚无已验证的 Codex／ChatGPT 文件 ID 下载端点或原始媒体处理契约；转录文本／抽帧不等于原输入。 |
| `text.format: json_object` | 解析格式要求，并将完整最终答案校验为 JSON 对象。 | 校验器／适配器 fixture 及共享 Responses 组件认证 DEV 已通过；不保证 Web 后端采用受约束解码。 |
| 严格 JSON Schema | 保留既有 schema 校验，不强制转换、修补、注入默认值或删除额外属性。 | 属于提示加最终输出校验，不表示 Web 模型使用 API 的解码机制。 |
| Web 无法落实的有效生成控制 | 在构造适配器前返回 HTTP 400 `unsupported_web_request_control`。 | 以显式边界替代静默接受；没有实现采样、Token 上限、后台任务或 API 服务档位。 |
| 不透明加密上下文与跨后端 agent 消息 | 对展开后的原始输入进行有界预检，在浏览器工作前对不兼容输入返回 HTTP 400 `incompatible_web_context`。 | 有分类器及协作 fixture，服务器预检已接入；原生密文的跨后端可移植性仍未解决。 |
| Responses WebSocket | 共享调度支持具名／默认通道内 FIFO、有界跨通道并发及自然完成边界 steering。 | 共享 11 场景／274 断言通过。真实 CLI resume／interrupt／恢复及独立 prefill／steering 组件验收**通过**，CLI 流程 HTTP 回退为零。保留原失败证据，已发布 2.4.0 不变。 |
| Web `generate:false` 请求状态预填 | 校验并在内存中保留展开输入后返回空 completed 响应，不下载 URL 引用。 | fixture 及真实独立通道预填**通过**：首个模型终态前完成，`output: []`。不执行模型／浏览器／工具，不宣称 KV 预热；provider 文件 ID 及原生透传预填仍不支持。 |
| `previous_response_id` | 有界本地缓存按传入授权／账号／组织／项目摘要分区；WebSocket／预填历史及后代保持纯内存。 | 缓存作用域不是身份认证。丢失、过期、淘汰或重启须提交完整原历史，不重放工具；不保证持久性或上游缓存等价。 |
| 原生阻塞 `wait` | Web 轮次及物理资源收尾后，主任务的原生等待不占 Web 执行名额。 | **既有行为**，不是本批新能力；此前认证多 agent 观察支持这一边界。 |

Hosted 类型与真实 Codex 工具适用不同契约。原生图像生成／编辑已有转发路径，但路由存在本身不证明认证验收通过。将不支持的声明认定为缺少本地工具前，请先核对[逐工具条件性阻碍](#hosted-tools)。

源码归属：[工具解析器](../src/responses/parser.ts)、[Responses 服务](../src/server.ts)、[原生透传](../src/codex/native-passthrough.ts)、[原生工具调用契约](../src/adapters/chatgpt-web/tools/native-tool-call-block.ts)。

<a id="search"></a>

## 原生搜索

采用的集成方向是 Codex 的 **standalone 搜索执行器**：

1. 原生工具模式的配置接入可恢复地管理 `[features].standalone_web_search = true`。Codex 暴露原生 `web.run` 工具，Web 模型请求该已声明工具，由 Codex 执行。
2. Codex 向桥接的 `POST /v1/alpha/search` 发送独立搜索请求，桥接携带传入的 Codex Bearer 授权转发到原生 `/alpha/search` 服务。
3. 桥接只将自己的 Web 模型别名解析为对应搜索身份。未知或未经确认的别名明确失败；不会以原生模型生成替换选定的 Web 模型。
4. Codex 的 `web_search` 策略，包括 `cached`、`live`、`disabled`，仍由用户控制。搜索命令、`external_web_access`、域名过滤器和结果保留原生传输语义。桥接不会把缓存搜索改成实时浏览、移除过滤器，或开启用户禁用的搜索策略。

standalone 功能开关启用的是执行器，本身不改变 cached/live 策略，也不授予认证或账号权限。缺少传入授权的请求返回 401，上游拒绝／配额错误仍作为失败保留。不能从 Web 模型可用推断原生搜索服务一定可用。

2026-10-18 主线提供的认证 DEV 结果已通过：原生工具模式、GPT-6 Sol Web 模型及 `xhigh`、`live` 搜索，并限制 `learn.chatgpt.com` 域名。外层 Codex `webSearch` 事件成功，原生命令读取退出码为 0、`fileChange` 完成、命令回读退出码为 0；检查结果精确匹配 `CHECK=NATIVE-SEARCH-3187 COUNT13`，最终回答引用官方[网页搜索文档](https://learn.chatgpt.com/docs/web-search)。这以实际工具和文件证据验证了该 live／域名过滤路径，不把 cached／disabled 策略或其他过滤组合的 fixture 覆盖改记为认证验收。

新接入日志记录管理归属和原值。断开／卸载或离开原生工具模式时恢复该基线；用户后来显式修改则报冲突，不覆盖新值。旧接入日志不会仅因重连就取得该功能的管理权：需要带有明确原生工具模式配置的 setup／重新应用，以及 Codex 配置重载。可恢复编辑器支持普通 `[features]` 中的布尔标量；其他不支持的 TOML 表示方式明确失败，不擅自重写。

profile 评审已按当前安装的 Codex **0.155.1** 修正：根级 `profile` 选择器不受支持，内联 `[profiles.<name>]` 表也不是当前 CLI 的 profile 选择机制。接入 guard 明确拒绝已出现的旧式根级选择器，不改变用户选择、模型、provider 或权限；不合并旧式表、不猜测未指定的 `--profile` 调用，也不读取／修改外部选定的 profile 文件，未使用的内联数据保持原样。旧 guard 接受过旧式配置，不代表当前 CLI 实际采用了该 profile。Compatibility V1 的分隔空行恢复也已针对新记录的操作修复，不猜测旧日志中的空行归属。配置回归 **117 项通过**。

这条路径**没有**让原始 hosted `web_search` 声明变得可解析。不得删除声明、禁用搜索或替换执行器后宣称完全等价。`tool_search` 是延迟工具发现，属于另一项能力。

实现与 fixture：[搜索映射](../src/codex/native-search.ts)、[配置接入](../src/codex/integration.ts)、[配置恢复测试](../tests/codex/standalone-search-integration.test.ts)、[原生搜索传输测试](../tests/codex/native-search.test.ts)、[实际 CLI fixture](../scripts/smoke-codex-web-search.ts)。

<a id="hosted-tools"></a>

## Hosted 工具与真实独立执行器

官方 Codex CLI **0.155.1** 发布源码（`be2951ea34f0d295ed0becf97079f92fa5f6950e`）与本次参考源码（`8c076942cb70fba8e5c4732c23f1faabc4aed484`）区分真实注册工具与 hosted Responses 类型。两者的 [ToolSpec 枚举](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/tools/src/tool_spec.rs)包含 function、namespace、custom、tool search 和 web search。能解析历史项不代表存在执行器；无法验证等价服务契约时，本阶段没有新增通用 hosted 桥。

| 工具类型 | 现有路径及条件性阻碍 |
| --- | --- |
| `web_search` | 真实 `web.run` 扩展使用 `/alpha/search`；功能、provider 及用户搜索策略均须允许执行。Web 路由仍不支持原始 hosted 声明。 |
| `image_generation` | 真实 `image_gen.imagegen` 扩展负责输入读取、图像 API 请求、产物和工具结果事件。`/images/generations`、`/images/edits` 保留传入认证、确切图像模型／正文、响应字节、错误及取消。CLI 0.155.1 还检查图像功能、provider 图像／namespace 能力、图像输入及支持的认证，并排除已知 Free 计划。路由存在不会自动启用工具。不能从 Images 响应制造通用 hosted 调用 ID、部分图像事件、改写提示词及编辑续接。[Hosted 图像契约](https://developers.openai.com/api/docs/guides/tools-image-generation)。 |
| `computer`／`computer_use_preview` | 需要真实绑定任务的浏览器／桌面驱动、截图及安全／审批处理。已注册 Codex 工具可保留原执行器，但 Responses 声明不会授予网关环境控制能力；没有通用 hosted 驱动桥。[Computer 契约](https://developers.openai.com/api/docs/guides/tools-computer-use)。 |
| `file_search` | 独立向量库检索 API 存在，但完整等价还需原库／文件身份、项目授权、查询规划／排序／过滤行为、调用生命周期及引用。本地文件读取或另一 MCP 搜索不具备该契约。[File Search](https://developers.openai.com/api/docs/guides/tools-file-search)、[Retrieval](https://developers.openai.com/api/docs/guides/retrieval)。 |
| `code_interpreter` | Hosted 执行依赖持久容器、其中的文件和引用身份。已查公开 Containers 契约提供生命周期／文件操作，未提供独立续接 hosted 解释器调用的端点。本地 shell 或另一沙箱会改变状态及权限。[Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter)。 |
| Hosted `mcp` | Codex 已注册 MCP 函数保留预备好的服务绑定及原生执行。Hosted MCP 另有连接器／服务凭据、发现及审批请求／响应状态；名称相同不能证明授权或执行等价。[MCP 契约](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)。 |

已查[图像执行器](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/ext/image-generation/src/tool.rs)通过 Codex 原生函数结果及 begin／end 事件交付图像。后端 `generation_id`、原生工具调用 ID 与 hosted 图像调用 ID 是不同身份。[发布版工具规划](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/tools/spec_plan.rs)包含上述 namespace 门槛；已查较新版本去掉了该项图像门槛。应遵循实际客户端声明及门槛，不能仅凭路由存在启用不可用工具。

现有原生转发器可复用于已验证的独立搜索／图像请求，调用、结果、权限和产物仍须由客户端执行器拥有。工具服务的模型选择不授权把主 Web 模型或 effort 替换成原生 Responses 生成。其余 hosted 缺口须有已证明的任务绑定服务契约，不能靠禁用工具、虚构函数或占位成功结果补齐。

<a id="data-contracts"></a>

## 附件、输出与上下文

### Office 直接输入

DOCX/XLSX/PPTX 按调用方原始字节传输，不抽取文本替代、不修复文档、不剥离宏。包校验覆盖 ZIP 目录与本地头一致性、范围、名称、校验和、必需主部件、内容类型和内部根关系。它是有界的容器／身份检查，不是完整 OOXML schema 校验器或恶意软件扫描。

主线认证 DEV 组件验证通过共享 Responses 实现在 **81 秒**内完成，准确读出一个 DOCX、一个 XLSX、一个 PPTX 中的不同标识，并满足 `json_object` 输出校验。标识仅存在于附件中，没有放入提示词。这证明该共享组件路径的真实 Office 上传／读取和 JSON 输出通过，**不是** Codex Office 工具端到端执行结果，也不代表认证了所有 Office 结构或渲染细节。

既有上传上限保持为单文件 20,000,000 字节、每条消息 10 个混合附件、合计 50,000,000 字节。Office 校验另外限制为最多 4,096 个条目、每条目解压后 50,000,000 字节、总解压量 100,000,000 字节、每份清单 1,000,000 字节。要求标准主部件路径及 UTF-8 清单。旧版 DOC/XLS/PPT、含宏格式、加密／分卷包、ZIP64 和不支持的结构会明确失败。二进制 Token 计数基于原始字节长度估算，不保证等同于提取后的 Token 数或模型容量。

### 任务授权的附件引用

Web 请求路径先校验展开历史、所选模型／推理强度、工具与控制，再解析远程图片或 `input_file.file_url`。共享服务器仅授权已校验任务输入中的精确引用，并绑定任务、所选 provider 路由及传入账号作用域。任意工具参数／元数据不会成为下载指令。预填只校验结构并保留原引用，不执行 DNS／HTTP；生成时先解析，再走普通附件校验。原生请求绕过此 Web 解析器。

仅允许公开 HTTPS 的 443 端口。所有 DNS 结果须通过公网地址检查，实际连接固定到已检查地址，同时保留主机名／TLS 验证。不使用浏览器／provider 授权、Cookie、环境代理或凭据查找。每个重定向目标都须有独立的精确 URL 授权，重定向本身不授予权限。展开请求中的内联与远程图片／文件附件合计最多 10 个、总计 50,000,000 字节；总量同时计入内联内容字节和下载字节。单附件最多 20,000,000 字节，下载整体限时 30 秒、最多三次重定向，并受共享请求分配预算和取消约束。保留支持的明确 MIME 与原字节；含糊 MIME、不支持的字符集／HTTP 压缩及原始音视频明确失败。

provider `file_id` 在预填和生成阶段仍不支持。公开 API Files 端点不能证明存在兼容 Codex OAuth／ChatGPT 后端的服务。补齐需要已验证服务来源、绑定账号的传入授权、重定向策略和相同资源上限。原始媒体也须有选定 Web 路由的上传／处理契约，转录或抽帧不能补齐此缺口。直接上传边界不限制 Codex 本地工具／技能操作文件。

见[引用解析](../src/responses/input-references.ts)、[固定地址 HTTPS 传输](../src/responses/input-reference-network.ts)及[共享边界 fixture](../tests/responses/server-input-references.test.ts)。

见[输入校验](../src/responses/file-input.ts)、[文件兼容 fixture](../tests/responses/file-input-compatibility.test.ts)、[附件传输 fixture](../tests/adapters/chatgpt-web/browser/attachment-compatibility.test.ts)。

### 输出校验与不支持的控制

`json_object` 校验解析**完整最终答案**并要求其为对象。数组、标量、残缺 JSON、Markdown 围栏及前后附加文字均失败，不修补输出、不截取片段。失败为不可重试的 `structured_output_validation_failed`，错误分类状态为 502；已打开的流报告失败，不交付成功终态。只有工具调用的轮次和中间工具传输不作为最终 JSON 答案。既有严格 JSON Schema 校验继续保留。两者都是交付检查，不是原生受约束解码证明。

普通 Web Responses 请求中，下列不支持的有效顶层控制在浏览器／队列工作前被拒绝：

| 拒绝的覆盖值 | 本检查视为不覆盖的值 |
| --- | --- |
| `max_output_tokens`；显式 `temperature` 或 `top_p`，包括 API 数值默认值 | 未提供或 null |
| 停止字符串或非空停止列表 | 未提供、null 或空列表 |
| 非零 `presence_penalty`／`frequency_penalty` | 未提供、null 或零 |
| 除 `auto` 外的显式 API 服务档位 | 未提供、null 或 `auto` |
| 后台生成、自动截断历史 | 未提供／null、`background:false`、`truncation:"disabled"` |

常规 schema 校验仍然适用。该检查只作用于 Web，不限制原生透传、独立搜索，也不限制 `exec_command.max_output_tokens` 等命令工具参数。专用压缩操作有独立契约。接受“不覆盖”值不代表 Web 的采样配置与 API 相同；用量仍为估算，不是原生 Token 计量。

见[输出校验器](../src/adapters/chatgpt-web/output-validation.ts)、[请求控制](../src/adapters/chatgpt-web/request-controls.ts)、[服务器边界 fixture](../tests/responses/server-web-capabilities.test.ts)。

### 不透明上下文

预检检查展开后的原始历史，包括 agent 消息、推理、各类压缩项、工具输出及显式加密参数元数据，返回有界且不含正文的问题位置和恢复指引。混合明文、相邻摘要或其他项上的空明文标记，均不能让密文变得可读。

桥接不得解密未知原生状态、丢弃密文、以摘要替代、强制 MultiAgent V1、切换模型、关闭加密，或重放工具副作用来制造续接。既有明文 V2 交付，以及合法的桥接自有透明 `ocx1`／`ocxr1` 封装仍可使用；这些封装是可逆编码，不是对原生密文解密。原生透传保留独立的原始数据路径。

已验证的明文契约比迁移更窄：CLI 0.155.1 的[路由器](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/tools/router.rs)仅对携带原始明文的直接 `collaboration.spawn_agent`、`send_message`、`followup_task` 调用识别 `encrypted_function_args: []`。接收方保留作者／收件方／正文边界；该标记不能解密既有负载，明密混合内容仍失败。

原生[推理](https://developers.openai.com/api/docs/guides/reasoning)与[压缩](https://developers.openai.com/api/docs/guides/compaction)契约提供受支持后端上的不透明状态续传，未提供经验证的完整明文导出供 Web 模型使用。Hosted [Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent) 动作由服务端执行，不应重放成本地函数。其独立的 `/responses/compact` 限制也意味着不能把该端点假定为通用迁移／导出服务。继续原后端须保留用户明确选择的路由；自动回退不是迁移。

补齐仍需原始生产方提供受支持的完整导出或原始明文交付。预检改善诊断，没有证明跨后端无损续接。见[上下文兼容检查](../src/responses/context-compatibility.ts)及[对应 fixture](../tests/responses/context-compatibility.test.ts)。

<a id="transport"></a>

## 传输、续接与原生等待

新的 [WebSocket 适配器](../src/responses/websocket.ts)共用 HTTP Responses 处理器、正文预算及取消生命周期。每个具名 `stream_id` 和隐式默认通道内部按 FIFO 顺序执行且不重叠，不同通道可并发。每连接默认最多 16 个活动响应、32 个具名通道加默认通道，待处理队列限制为 128 个请求／64 MiB；事件、背压及 steering 也有独立上限。这些传输上限不会增加全局 Web 执行名额。`stream_id` 决定顺序及事件归属，`previous_response_id` 决定历史来源，包括父响应仍可用时的分支。

续接缓存按传入授权、账号、组织及项目请求头的摘要隔离。这是缓存分区，不是身份认证或工具授权。WebSocket 历史、预填上下文及其后代均为 `memoryOnly`，后续改走 HTTP 也保持纯内存；其他请求触发快照时同样排除。保留上限为一小时、1,000 项及 64 MiB UTF-8 历史项数据。重启、过期、淘汰或作用域变化均可能返回 `previous_response_not_found`；应去掉该 ID，提交包含已有工具结果的完整原始历史，不重做工具。这是进程内共享缓存，不等同于上游服务的连接级缓存，也不是 ZDR 认证。

Web `generate:false` 先校验并保留完整展开输入，再返回带可用 ID 的空 completed 响应。不执行模型、浏览器或工具；input／output／total 用量均为零，不单列缓存 Token。URL 引用在预填时保留原样，不做 DNS 或下载；损坏引用及不支持的 provider 文件引用明确失败。文本和 URL 预填现均使用已配置的 provider 参数，不读取活动 Launcher／浏览器描述符，也不构造模型适配器；原生任务修订／取消检查保留。正常生成仍解析活动描述符。预填 ID 仅证明请求状态已保留，不证明资源可达、模型可读或 KV 缓存预热。原生透传预填仍返回 `unsupported_native_prewarm`，不会删掉该标志而意外启动生成。

`response.steer` 已在**自然完成边界**实现，限于受支持的普通自动交互 GPT-6 Native Tools 请求。校验不生成、不下载、不提交缓存状态；预填／原生透传请求、不支持的路由、hosted conversation、hosted agents 和自动压缩均不适用。`response.steer.accepted` 仅表示输入已排队，后继响应的 `response.created` 才是提交点。不需要外部输入的成功完成可按原模型、推理强度、工具及其他设置启动后继响应。当前不会在更早的输出项边界打断正在运行的浏览器轮次，也不伪造 `incomplete: steered`。

若仍需客户端工具结果或审批，已接受的 steering 保持待处理并发出 `response.steer.pending`。调用方须在同一连接／通道上，通过匹配的显式 `response.create` 提交所需结果／决定；系统仅将已接受的 steering 前置一次，该显式续接保留其自身设置。不要重复发送已接受的 steer、重做工具或制造审批。后继启动前失败通过 `response.steer.failed` 报告。识别 hosted 待审批结构，不表示已实现该 hosted 工具。

当前官方 [Responses WebSocket](https://developers.openai.com/api/docs/guides/websocket-mode) 与 [steering](https://developers.openai.com/api/docs/guides/steering) 契约记录 create／steer，没有已核实的 Realtime 式 `response.cancel` 客户端事件。此前将缺少取消帧列为兼容缺口的说法现予更正：不应以虚构事件作为等价要求。断开归属连接会取消该连接的工作；原生精确轮次 interrupt 是独立的身份／授权路径，后台 HTTP 取消也属另一契约。Web 后台／非流式生成、原生预填及更早边界 steering 仍不支持。

共享服务器 fixture 覆盖作用域历史、通道及等待工具结果的 steering。真实 CLI resume、interrupt 和恢复通过，HTTP 回退为零；共享组件验收通过公开 PDF 读取、独立通道预填及一次自然边界 steering 后继。见[验证范围](#evidence)。原失败运行继续保留，不据此宣称更早边界 steering、上游缓存／协议等价或原生逐 Token 模型流。

前一 Web 轮次及物理资源收尾后，原生阻塞 `wait` **本来就不再占用**主任务的 Web 名额。后续再次调用模型时重新申请名额；子 agent 的 Web 请求独立计数。本地队列状态轮询与反复调用模型不同。“wait 不占 Web 名额”不等于所有轮询／模型轮次都免于队列准入。

此前新增的两条“先做独立工作再等待”“减少短模型轮询”建议已按用户要求移除，本批不强加这些编排策略。必要的工具结果对应及轮次收尾规则仍保留。移除建议没有改变原生执行器、wait 参数、审批或沙箱。

<a id="reliability"></a>

## 可靠性改进与保留失败

此前的正文来源、发送确认和队列错误改动也尚未发布。已调查的两次异常发生于**最新已发布 2.4.0**，不是用户安装版本过旧，也不是这份新实现的运行结果。

| 改进 | 剩余边界 |
| --- | --- |
| 严格公开正文重建，终态元数据缺失时允许独立 DOM 校验回退；保留同请求有界正文回退和私有重放证据 | 富引用／未知结构尚未全覆盖。捕获内容是经隐私投影的诊断证据，不是原始网络字节或交付授权；历史失败原流仍缺失。 |
| 单次触发 Send，加有界只读迟到回执核对 | 初次观察／发送阶段失败后最多五秒，仅有唯一匹配请求、HTTP 200、绑定输入的接受回执且来源身份完整时，才能确认原提交。不再次点击、重载、重绑定或重发；历史发送未知根因仍未证明。 |
| 立即报告 `queue_blocked_<reason>` 并保留已知暂停来源 | 发送未知时的全局保护仍存在，不等于实现自动任务隔离或后台恢复。 |

失败时在观察器 detach 前保存私有证据，默认上限 2 MiB／2,048 个事件；普通诊断仅保留引用和计数。捕获／重放仅接纳实测 `delta_encoding`、`message`、`delta` 事件名及支持的负载结构。隐藏的 `model_editable_context` 只保留结构字段；未知事件、error 负载和不支持的结构仍为 withheld。已知私有正文经投影移除，缺口／截断明确标注；后续隐藏频道变化会撤销此前含正文的记录。离线重放不发起网络、模型或工具操作，也不授予交付权限。成功／取消轮次不创建此产物；私有产物仍可能包含公开回答正文，须受控访问。

`response_message_incomplete` 的原历史根因仍未证明。对 37 个已有脱敏样本的重放保留了结果（36 个完成、一个收集中），不等于精确复现缺失的历史失败原流。迟到回执 fixture 证明的是特定时序／竞态修复，不是历史根因。身份歧义、观察丢失或远程结果未知时，仍保留全局 `send_outcome_unknown` 保护；关闭页面不能证明远程已终止。

本阶段首轮认证 WebSocket 已完成原生读取 → 补丁 → 回读。同会话第二轮原生补丁达到 `COUNT14`、验证命令退出码为 0，但最终响应报 `response_message_incomplete`；Codex 随后尝试 HTTP 回退，被 WebSocket 验收运行器拒绝。该次原失败证据继续保留；后续 resume／interrupt／恢复验收已通过，未重放已完成的补丁。

失败运行的观察器报告 `finished`、`endTurn`、`done` 为 true，而完成字段（`is_complete`）及 finish 元数据缺失。当时私有捕获未保留非默认 SSE 事件，无法恢复遗漏负载。后续认证 smoke 捕获 12,885 字节，实测 `delta_encoding`、`message`、`delta` 现已支持。诊断重放保留 **23 个事件、18 个投影、0 withheld、0 丢弃**；三种分块方式均与直接解析的 facts／result 一致，四个已核查私有值未出现在产物中。这验证该样本的捕获／隐私／重放，**不是 missing-metadata 失败复现**，也没有找回历史原流。

缺少 `is_complete` 或 finish 元数据时，现仅在输入／会话身份、唯一已结束 final、其他公开消息状态及父链检查通过后返回 `response_terminal_metadata_unavailable`。这不授权交付来源正文，只允许既有独立 DOM 完成及 Markdown 覆盖校验决定能否回退。明确 false 的完成值、非 stop 或格式错误的 finish、未结束状态、身份冲突及迟到修改仍阻断回退；明确终态失败保留 `response_message_incomplete`。

<a id="evidence"></a>

## 证据与待验收项

### 2026-10-18 只读任务验收

两次真实认证测试使用同一未发布源码检查点、独立 DEV、Codex CLI `0.162.0-alpha.17.2`、Native Tools 及 `chatgpt-web/gpt-6-sol`／`xhigh`。项目仅作为只读分析对象，未控制历史生产线程。

| 任务 | 结果 | 证据与限制 |
| --- | --- | --- |
| 重做此前的改动／故障分析 | **通过**，947.844 秒 | 九次 Web 请求成功；35 条原生命令，其中一次正则错误随后纠正。4,564 字符报告与 CLI 事件、落盘正文及原生终态记录一致。单次通过不能证明间歇故障已修复。 |
| 三个子 agent 并行审核代码规范、技术方案及相关技术，由主 agent 汇总 | **失败**，4,286.756 秒 | 三份子报告均收到，但主任务最终正文两次失败：`turn.failed`、退出码 1，没有有效主任务最终报告。139 个 Web 请求中 128 成功、十次失败、一次主动取消。 |

并行测试复现五次 `response_message_incomplete`、三次 `missing_pending_content`、一次 `unanchored_snapshot` 及一次模型控件不可用。final 已完成、此前 commentary 未完成，底层协议语义仍需调查。四次 Markdown 冲突均发生在正文发送前。44 次原生采样重试不等于 44 个不同 Web 请求；私有日志另保留工具调用块转交失败及自动 HTTP 回退。

并行任务实际执行 266 条原生命令（256 次退出 0、十次非零），并有 27 次原生 Web 操作。实际 Web 并发峰值为四，观察到主任务原生等待不占 Web 名额、三个子任务同时活动。三份子报告与主任务收到的消息一致；外层协调器的汇总不算模型成功交付的主回答。

两次测试均确认 888 个项目文件、HEAD、Git 状态不变，生产配置／认证哈希及相关进程／服务身份不变，自有 DEV 已关闭。并行测试将并发从四恢复为一。私有证据留在本地 `output/2026-10-18-thread-01a14d08-retest/` 与 `output/2026-10-18-parallel-review/`。后六份来源导出已保存，前两份已被轮转清理，部分导出明确不可完整重放。单任务通过不能关闭并行验收失败；两次测试均不代表安装器验收、发布或 Codex 全能力等价。

### 此前限定范围验收

下列结果仅适用于各自已记录的源码检查点。**真实 CLI resume／取消恢复、公开 PDF URL／独立 prefill／steering 组件、最终运行包及隔离收尾检查均通过。** 保留原失败证据及历史根因限制。认证由独立 DEV 登录恢复，不是 readiness 修复。已发布 2.4.0 不变；这些限定范围的通过不代表 Codex 全能力兼容或生产发布。

| 检查 | 结果 | 范围／限制 |
| --- | --- | --- |
| 终态／readiness 修复后核心全量 | **1,689 通过／77 跳过／0 失败；11,824 断言；137 文件；214.81 秒** | 早于 SSE 事件白名单修复，后者由下列定向检查单独验证。 |
| 预填修复后共享回归 | **7 项引用用例**、**11 个 WebSocket 场景／274 个内部断言**通过；组合运行 **8 项外层测试／48 个外层断言通过** | 覆盖无需活动描述符的文本／URL 预填、引用边界、作用域历史、通道和 steering。外层与子进程数量重叠，不代表认证模型验收。 |
| 最终全项目类型检查 | **通过** | 包含最终诊断事件改动，不代表认证验收。 |
| 最终 source／stream／evidence 回归 | **57 通过／269 断言**；捕获定向套件 **29 通过／148 断言** | 范围重叠，不累加。覆盖终态分类、实测 SSE 事件名及隐私／重放，不宣称完整 CLI 续接通过。 |
| Desktop 全量及隔离复核 | 全量 **673 通过／4 跳过／2 项环境失败**；已授权的两文件复核 **94 通过／1 跳过／0 失败** | 复核解决 Vite 上级目录访问及归属明确子进程终止两项失败。保留原全量结果，不宣称后来完成了全绿 Desktop 全量。 |
| 最终已验证运行包 | `runtime-bundle-verified` 构建及搬迁烟测**通过**，标记为 `RELOCATABLE_RUNTIME_SMOKE_OK` | 验证重建运行包，不是已安装升级或完整认证工具／模型验收。 |
| 真实认证 Codex CLI | **PASS** | 续接原失败线程，验证既有 `COUNT14`，未重放补丁。状态为 completed／interrupted／completed；三个命令退出码 0、一次文件修改完成，最终 `COUNT15` 且 nonce 保留。三次 WS 升级、两次 prefill、四次续接、零 HTTP 回退。Interrupt 后 HTTP／browser／WS 活动轮次归零，同线程随后无需重启即可修改并回读。 |
| 认证共享组件 | **PASS** | 准确读出公开 W3C PDF 正文 `Dummy PDF file`，提示未提供答案。独立通道 `generate:false` 在首个模型终态前完成，`output: []`。一次 accepted steer 生成自然边界后继，随机 proof 正确，原响应及后继均通过 JSON 校验。这是组件验收，不代表远程图片 live、原始媒体或 Codex 文件工具端到端验收。 |
| 隔离收尾 | **PASS** | 三个生产配置／认证文件哈希、九个已安装 app／runtime 进程加一个用户 Codex 进程身份及相关服务均未变化；自有 DEV 已正常关闭并确认退出。 |
| 安装器／生产部署 | 未执行 | 不表示已发布、安装升级或生产验收。 |

定向 fixture 另覆盖可恢复配置、附件／网络上限、私有证据及离线重放、迟到回执、独立转发和不透明上下文检查。这些范围与全量／共享套件重叠，不得相加扩大总数。跳过项仍未执行；fixture 通过不能补足缺失的历史失败原流，也不能消除 hosted／密文兼容阻碍。

此前实际 CLI fixture 在合成上游下验证了搜索执行、顺序 WebSocket 预填及工具续接，不代表认证 Web 生成或后续通道／steering 验收。此前认证 DEV 已验证读取 → 补丁 → 命令、压缩、取消／复用及原生等待；独立搜索流程验证了 GPT-6 Sol／`xhigh`、实时搜索及域名过滤，共享 Office／`json_object` 组件流程也已通过。结果仅保留其原范围：早期离线任务流程关闭了搜索，Office 组件验收不等于 Codex Office 工具端到端验收。

根据[能力验收](acceptance-tests.zh-CN.md)选择适用用例，遵循[标准隔离开发流程](development.zh-CN.md#standard-isolated-test-procedure)，按[发布手册](release.zh-CN.md)评估发布。fixture、认证 DEV 和安装器证据分别记录，不据此表宣称 Codex 全能力等价。
