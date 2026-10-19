# 正文交付证据索引 — 2026-10-19

[English](evidence.md) | [简体中文](evidence.zh-CN.md) · [归档结论](README.zh-CN.md)

阅读顺序：结论编号C → 本页证据E → 已归档摘要/源码S → 原记录R/V及SHA-256。以下保存必要事实，不要求读者访问被Git忽略的工作日志才能理解结论。原记录仍保留在本地；路径与摘要哈希见[来源清单](evidence/provenance.json)。该清单不是发布验收manifest，也不代表保存了原始网络回放。

| 材料 | 内容与证据层级 |
| --- | --- |
| [observations.json](evidence/observations.json) | 根据既有记录整理的浏览器观测摘要；不是原始SSE/DOM |
| [validation-summary.json](evidence/validation-summary.json) | 既有同任务/并行验证输出的白名单字段、取消判据结果、观察前后源码基线摘要；本次未重跑模型或判据 |
| [source-snapshot.json](evidence/source-snapshot.json) | 当前未提交源码的文件SHA-256、行号、原样关键片段S01–S07；HEAD不能单独代表这份工作树 |
| [provenance.json](evidence/provenance.json) | 归档材料哈希、原记录相对路径/哈希及可用性说明；不含认证、私有原始日志或浏览器状态 |

<a id="e01"></a>

## E01 — 两次正式版故障

来源：R01（10月17日生产事件）、R02（两指定会话覆盖核查）。这是原始rollout、队列和安装manifest的既有调查摘要，本次没有重新读取或运行生产任务。

| 场景 | 已记录事实 | 不能据此推出 |
| --- | --- | --- |
| 10月17日多agent | 22:31:21、22:33:41两个正文校验失败；22:37:05发送未知使全局暂停；22:52:12/19两个请求各15分钟队列超时，未获派发 | 不是已证明并发名额不足；未获发送确认的底层事件原因仍缺证据 |
| 10月18日只读任务 | 前五请求成功；11:31:23第六请求missing_pending_content；buffered、emittedChars=0、observedSegments=36；无暂停；遥测180帧、DONE=true | 计数不等于完整响应回放；不能确定精确DOM变化，也不能套用另一个任务的队列故障 |
| 版本核对 | 两次日志sourceId与当时最新正式版2.4.0安装manifest一致；未含新响应源实现标志 | 不是用户未更新，也不是后来未发布源码的回归证明 |

R01另记录四个离线因果探针和68项回归。合成的pending表格单元格从`Al`增长为`Alpha`可被真实缓冲器误拒；调高并发不能解除全局暂停。这些证明实现分支，不证明生产恰好发生了同一表格变化。原始流与相邻DOM缺失，精确根因边界保留。

<a id="e02"></a>

## E02 — 同任务真实DEV复测通过

来源：R03及V01。真实Codex `0.162.0-alpha.17.2`，`chatgpt-web/gpt-6-sol/xhigh`，只读沙箱、approval=never。947.844秒，35命令（34成功、1个正则转义错误后纠正），9个Web请求全部成功；最终turn.completed、4564字符。最终文件、native final_answer、task_complete和CLI事件一致；摘要保留对应布尔值与结果哈希。

初始结果核对器只找phase=final，漏掉final_answer，曾产生错误核对结果；后续只修忽略目录核对器，未重跑或修改模型回答。888项目文件、HEAD/Git状态不变；原记录报告生产边界检查通过。此结果限于该次新源码DEV运行，不证明历史原始流被重放或所有偶发问题消失。

<a id="e03"></a>

## E03 — 三子agent任务整体失败

来源：R04及V02。三个真实子agent均为指定模型/极高、只读沙箱，父子关系与并行生命周期已核对；实际峰值Web并发4。曾观察到父agent原生wait时没有活动Web请求，而三个子请求仍在执行。

- 三份子报告分别为7648、8620、3214字符，全部到达主任务。代码审核仅抽样，不能宣称覆盖82个改动文件。
- 4286.756秒后主任务以turn.failed/exit1结束，最终报告交付两次失败，parentReportExists=false。
- 139请求：128成功、10失败、1主动取消。10失败包括5次源校验、4次正文对齐、1次模型控件故障；验证输出最后一类的传输reason记作upstream_server_error，不能只从该字段推断服务器根因。
- 保留44次native sampling重试、自动HTTP回退及工具调用块转发异常。总266命令中10个非零，包含9个PowerShell受限语言命令；不能把本机沙箱命令错误统一归为正文桥接错误。
- 最初两个详细源工件被普通十目录轮转清理；后续保留六份，有些显式replayable=false。不能称为完整原始回放。

整体FAILED不因子报告到达而改为通过。协调者result.md是独立整理，不能伪装成主agent成功输出。V02摘要保留passed=false、taskCompleted=false和失败计数；R04保留原先错误的核对器假定主报告存在而报ENOENT的过程。

<a id="e04"></a>

## E04 — 已做修复与最新验证边界

来源：R05（正文阶段修复）、R06（续验）、R07（独立超时）。状态均来自既有实施记录，本次不新增产品通过数。

- 已做：响应源终态/消息边界、晚到内容与诊断保留、表格水合/包装兼容、模型选择竞争、原生回执重放等针对性修复。可回放的历史源工件3/5曾通过；其他工件不可回放或已丢失，不能整体关闭。
- 真实表格包装误拒曾保留pending/committed/final DOM；针对性修正后私有回放得到7680字符，与最终快照一致。完整未交付草稿前缀约束仍存在，见S05。
- 后续boundary-final真实任务46.836秒失败、零命令：附件基线与配置相减产生1ms等待，是已确认的Web2Harness回归。后续重连又有queue_identity_conflict，其归因仍未闭合。
- 用户批准取消跨步骤总额度；各操作独立计时，保留取消、所有权和正常权限。外层/子步骤不共享消耗，原生wait和模型用量无关。
- 最后核心合并证据1755通过/80跳过，启动器688通过/4跳过；类型、构建、审计、迁移包冒烟通过。**这是全量失败后受影响复测的合并统计，并非最后一次全量命令零失败。**中间失败保留。
- 用户要求先汇报，最新候选认证DEV短任务和完整三子任务验收未执行。环境/夹具失败（受限令牌、假时钟、旧阈值断言、fixture超时等）与项目缺陷分别记录，未修改生产或系统设置来通过。

现行阈值以[配置参考](../../reference.zh-CN.md)为准；此处解释已做变更及证据范围，不建立另一份活动参数表。

<a id="e05"></a>

## E05 — 第一次直接Chrome源码调研

来源：R08、R09。GPT-6/Extra High，实际`gpt-6-thinking/max`；新对话单次发送公开Codex源码调研问题，要求功能表、代码、Mermaid、公式、引用和列表。196条DOM变化状态；临时WeakMap标记节点，通过CDP观察网络。不是Web2Harness执行。

| 检查 | 结果 |
| --- | --- |
| 生命周期 | 总496.871秒；正文最长242.303秒不变，当时898字符、Stop仍在 |
| 中间与最终状态 | 中间合并消息finished_successfully但end_turn=false；最终end_turn=true、message_stream_complete及DONE |
| 续接 | 初始ERR_CONNECTION_CLOSED；自动resume先RESET/NETWORK_CHANGED，后200 SSE完成；无人工重发；完成后ERR_ABORTED |
| 最终表示 | innerText7044、textContent14174、HTML189382、公开fallback Markdown8928字符，表示不同不能按长度互证 |
| 复制 | 整段18988字符，混入Mermaid CSS，缺图源码和三个代码语言标签；图表单独复制418字符/16行，与公开源码一致 |
| 引用与媒体 | fallback Markdown18引用标记、120私用区字符；18张图均32×32来源图标，并非正文图片；需引用解析 |

外层turn及正文根在此样本保持稳定；未复现重挂载。一个逻辑回答有片段、合并与上下文`c`更新，`c`不是final/commentary频道。初次临时投影忽略上下文导致重复，纠正观察方法后取得公开合并内容；该工具错误不是产品正文损坏证据。

没有完整原始SSE/DOM文件；归档的是既有工具输出/内存观察写成的记录和派生摘要。网页复制改过剪贴板；观察器/计时器/网络监听已停止。不能把回顾摘要包装为原始现场回放。

<a id="e06"></a>

## E06 — 六场景网页补测

来源：R10、R11、V04。所有请求保持`gpt-6-thinking/max`。以下时长为POST开始至该请求网络结束；取消正文603字符是公开源Markdown，631字符是DOM表示，两者不能直接比较完整性。

| 场景 | 秒 | 公开Markdown字符 | 结果 |
| --- | ---: | ---: | --- |
| 两次Python与富内容报告 | 148.262 | 3733 | 正常完成；总数274/211、差63独立复核；真实图片、CSV预览、图表、公式、代码、Mermaid |
| 长追问 | 62.175 | 3506 | 正常完成；12节、24行表格、120赋值及代码/正文末尾标记 |
| 重新生成 | 59.961 | 3450 | 正常完成；同用户turn，新assistant版本与正文根 |
| 编辑分支、工具错误后恢复 | 20.534 | 255 | 正常完成；Python除零后再次执行返回16，用户turn与回答均更新 |
| 主动停止长列表 | 38.744 | 603 | 按计划停止；只到第20项，末尾标记缺失；in_progress/end_turn=null，无DONE/流完成 |
| 停止后新追问 | 4.364 | 22 | 正常完成；精确两行RECOVERY-OK与7+9=16（原文含空格）；旧部分答案留在上一轮 |

五次正常完成均有成功final、end_turn=true、流完成和DONE。六次网络结束均ERR_ABORTED；工具除零回执消息自身仍为finished_successfully，说明消息状态不等于工具业务无错。

**完整读取反例：** 第一报告代码完整源1125字符，顶部DOM808、导航末尾901且缺开头；第二报告源1707字符，初次DOM含120赋值，打开菜单后仅前57行/732字符，正文末尾仍在。都是完成后非编辑操作；这是CodeMirror视口虚拟化，不是模型继续生成。

**内容类型：** CodeMirror为`.cm-content`和`.cm-line`，不是普通`code`；图表引用内容是对象，代码/Mermaid引用是字符串；CSV入口是无href的`span[role=link]`，先预览再选导出格式。三次下载事件等待超时：前两次等待早于实际导出，第三次未验证落盘；不据此宣称项目下载损坏。

第二阶段186条变化状态；同一回答根在观测内稳定，重新生成换根。前期范围曾误扩为原生整体验收，已按用户纠正收敛；DEV准备实例已关闭，没有发送原生任务。保留的生产检查显示3文件和服务不变，10个跟踪进程中1个bun子进程消失、父仍在，未控制该子进程且原因未知，不能概括所有生产进程不变。

<a id="e07"></a>

## E07 — 主动停止的判据缺口

来源：E06现场、V03现有纯函数结果、S01/S02/S03/S06源码。

```json
{
  "responsePresent": true,
  "running": false,
  "currentText": "STOPCASE-BEGIN partial answer",
  "completionActionVisible": true,
  "handoffCompletionVisible": false
}
```

上述为代表现场状态的**缩减输入**，不是631字符原文快照。已有调用结果：`chatGptTurnIsComplete(input) === true`；`responseSourceBlocksFallback({state:"rejected",reason:"response_transport_incomplete"}) === false`。

这条链证明DOM完成判据与不完整传输回退组合有漏洞；不能断言完整worker必然交付，因为后续缓冲、身份、工具栅栏仍可能拒绝。Codex主动取消另有abortSignal→AbortError分支，见S06；此处讨论网页停止/未知中断，不能混淆。建议补正向完成依据，不是把所有abort都禁用DOM回退。

<a id="e08"></a>

## E08 — 源码身份与静态对应

以[source-snapshot.json](evidence/source-snapshot.json)所存工作树文件哈希、行号和原文片段为准。HEAD=`71eefe428cc99f8c84fd5ca7540f1bd4301637ea`，当时工作树含未提交修复；仅链接该提交不能代表分析对象。相对源码链接便于导航，后续改动后应使用已保存片段复核历史结论。

| 源码ID | 文件 | 对应依据 |
| --- | --- | --- |
| S01 | [turn-observation.ts](../../../src/adapters/chatgpt-web/browser/turn-observation.ts) | 完成判据与稳定/工具活动检查；不是单纯静止检测 |
| S02 | [response-source.ts](../../../src/adapters/chatgpt-web/browser/response-source.ts) | 阻止回退列表；单current及p/o上下文；缺少本次观察到的合并/引用完整适配 |
| S03 | [response-stream.ts](../../../src/adapters/chatgpt-web/browser/response-stream.ts) | 初始生成路由匹配；完成后传输关闭容忍；resume未关联为同一生成链 |
| S04 | [response-dom.ts](../../../src/adapters/chatgpt-web/browser/response-dom.ts) | 图片/SVG/预览清理，代码规范化依赖pre/code；不能完整读取本次CodeMirror |
| S05 | [markdown.ts](../../../src/adapters/chatgpt-web/markdown.ts) | 图片/SVG删除；buffered重建仍要求candidate以known开头 |
| S06 | [browser-worker.ts](../../../src/adapters/chatgpt-web/browser/browser-worker.ts) | 原响应使用条件、已完成整段交付、取消、DOM回退及覆盖收尾 |
| S07 | [chatgpt-answer-dom.cjs](../../../launcher/shared/chatgpt-answer-dom.cjs) | 现有选择器与归属分类；文件哈希记录，不能改为任意消息ID全选 |

## 核验与限制

来源清单的R01–R11是既有开发记录；V01–V05是既有验证/派生摘要。原记录路径保持仓库相对形式，不暴露用户目录或认证。被忽略的原始材料不随克隆分发；上文及JSON保留可公开的必要事实，缺失原始回放明确标注。

核验顺序：用SHA-256校验归档文件 → 如本地原记录仍在，核对其哈希 → 通过S编号检查保存的源码片段和文件哈希 → 按E级别判断结论。当前源码哈希以后变化只表示版本不同，不自动推翻历史记录；哈希一致也不等于所有推断已获得运行证明。

本次归档检查文件/链接/锚点、来源与片段哈希、双语结论编号、既有README相关回归，以及改动范围。没有新做网页/产品验收。完整回放、CSV落盘、其他媒体和最新真实多agent最终交付继续标为未验证。
