# 公开响应回放与原生文件职责 — 2026-10-19

[English](README.md) | [简体中文](README.zh-CN.md) · [上一轮补测](../2026-10-19-answer-delivery-followup/README.zh-CN.md) · [初始调查](../2026-10-19-answer-delivery/README.zh-CN.md)

用户批准继续补齐观察，并要求核实CSV/PNG下载是否属于保持Codex能力的必要功能。本轮收紧范围，完成一次本机Chrome公开正文观测及离线回放，不修改产品/测试源码，不启动DEV或原生Codex任务，不提交发布。

## 文件职责澄清

| 能力 | 责任与本次范围 |
| --- | --- |
| Codex在任务环境生成、读取、保存CSV/PNG等文件 | 应保留原生工具、命令、技能、插件及其文件结果。格式本身不要求专用下载工具，具体生成依赖相应可用工具和依赖。 |
| Codex通过已有浏览器、网络或其他工具下载文件 | 应保持工具本身的权限、调用及结果；不能因本轮不新增网页下载器而禁用它们。 |
| Web2Harness自动搬运ChatGPT网页Python沙箱的文件 | 属于不同执行环境之间的工件桥接，不是保留Codex原生文件操作能力的必然条件。前轮把落盘列为核心补测项，范围放大；现改列网页工件扩展，未验证事实保留，不新增功能。 |
| 回答中出现网页图片或文件引用 | 仍须识别并保留其语义或明确交付限制，不能静默删去后宣称完整；网页sandbox路径也不能冒充Codex任务环境中的文件。 |

官方[Codex CLI说明](https://learn.chatgpt.com/docs/codex/cli)确认本地文件、命令和工具执行。[Code Interpreter说明](https://developers.openai.com/api/docs/guides/tools-code-interpreter)规定的是托管容器及文件引用/下载，不能直接证明ChatGPT网页私有端点或Codex默认工具具有相同契约。

项目[native-tool-call-block.ts](../../../src/adapters/chatgpt-web/tools/native-tool-call-block.ts)明确原生模式由Web产生调用决策、Codex在自身沙箱与审批约束下执行。直接网页Python测试用于观察工具/富内容生命周期，不代表原生任务应该改由网页Python执行。已有原生图像、输入附件和托管工具的不同兼容边界仍见[原生工具对照](../../native-tools-compatibility.zh-CN.md)。

## 本轮现场与回放

一次新生成使用 `gpt-6-thinking` / `max`，请求明确不调用工具、访问文件或生成下载工件。输出包含中文、`🙂𠮷é`、两行数据表、Python代码和Mermaid。约60.852秒后正常完成；最终fallback为438个UTF-16代码单元、436个Unicode码点、973个UTF-8字节。

- 生成前开启Network观察，取得起始 `delta_encoding` 到 `[DONE]` 的26个事件，缓冲未截断；观察到的拼接流30778字节，仅在采集会话内存中，未原样落盘。
- 实时出现“回答已完成”，且 final 的成功状态、end_turn、is_complete、finish_details=stop及message_stream_complete、DONE均在。随后网络为ERR_ABORTED；完成后getResponseBody不可用。实时流采集仍保留已收到内容，不能仅凭后者判定回答失败。
- [public-events.json](public-events.json)保留全部26个事件位置、公开正文及其更新、引用和终态，删除用户/系统/非公开正文、续接令牌、渲染程序、常量和非必要元数据；身份改为保持相等关系的别名。
- 保存前浏览器公开投影的JSON为10254字节，FNV-1a为90e57e59；本地转录核对一致，再生成公开别名版。FNV仅作转录检查，不是密码学证明。工件SHA-256见[provenance.json](provenance.json)。
- 当前解析器按1、7、17、4096字节分块回放均解析到26个事件、无残留SSE帧，并一致拒绝为 `response_references_unsupported`，见[replay-result.json](replay-result.json)。这是现有源解析缺口的离线证据，不是整个Web2Harness误交付/失败复现；DOM回退未在本轮执行。

这份材料是**完整事件顺序的公开内容投影**，不是完整私有原始响应、原始网络分块或所有协议语义的无损回放。删除的14个渲染程序/常量更新没有被伪造补回。它足以重复本样本的正文、Unicode引用与当前拒绝结果，不关闭旧事故原始流缺失或全部上下文/合并协议的覆盖缺口。

## 新确认的解析边界

| 编号 | 实测结果 | 设计含义 |
| --- | --- | --- |
| R01 | Python引用为[330,375)，对应JS字符串起点332；Mermaid引用为[377,424)，对应JS起点379。按Unicode码点切片两者均精确匹配，UTF-16或UTF-8字节切片均不匹配。 | 该版本样本的偏移单位是码点。两个非BMP字符导致JS索引多2。先匹配正文表示/版本，再按正确单位解释偏移；不能直接使用String.slice，也不能预先做Unicode归一化。 |
| R02 | 第18、19事件整体替换fallback；表格从部分占位变完整，Mermaid从空代码变完整。新fallback不以旧fallback为前缀，但最终内容完整。 | 未交付草稿发生合法非前缀改写，最终快照应负责完整性。它不是已经观察到任意DOM段落拆合或根重挂载。 |
| R03 | 引用先整体加入，随后以嵌套patch更新Mermaid的data.content、matched_text和end_idx（392→424）。 | 不能仅保存引用第一次出现的值；正文与引用必须来自同一最终版本。 |
| R04 | 按4种分块回放得到相同的引用不支持结果，观察到的完成边界仍为真。 | 完成事实与内容表示能否解码需分别记录，不能把不支持的引用包装成网络中断。 |

上一轮无非BMP字符的引用样本中，JS切片与码点切片恰好相同；该结论仅说明引用属于fallback，不能外推为JS索引契约。原记录保留，本报告补上这一限定。

## 复核方法与状态

在匹配[源码摘要](provenance.json)的检出中，可以读取public-events.json，将每条value序列化为SSE data（DONE保持裸字符串），保留event名称，送入[ChatGptResponseSource](../../../src/adapters/chatgpt-web/browser/response-source.ts)及[ServerSentEventDecoder](../../../src/adapters/chatgpt-web/browser/sse-decoder.ts)。binding随工件提供。全部事件都应参与回放，不删除导致拒绝的事件以求通过。离线辅助脚本留在本地output，未加入产品或测试实现。

已补齐：一个可重复的完整公开正文样本、Unicode偏移单位、引用增量更新及非前缀fallback修订。网页CSV/PNG落盘继续标为未验证扩展，不再阻塞本轮核心正文设计。

尚未证明：完整原始字节回放、任意上下文回切/合并形态、任意段落拆合/根重挂载、音视频、Web2Harness实际集成、旧故障根治。当前证据已足以进入设计实现讨论，无需为了复制ChatGPT所有网页功能扩大本轮范围。实施和集成验收仍未执行。
