# 原生能力兼容续项，2026-10-20

[English](README.md) | [简体中文](README.zh-CN.md) · [兼容对照](../../native-tools-compatibility.zh-CN.md)

本记录对应本地保存点 `a5ed839` 之后的未发布源码。没有推送远程、发布、安装或重配生产环境。认证网页任务使用 `chatgpt-web/gpt-6-sol/xhigh`；开发子 agent 使用原生 `gpt-6-astra/high`。

后续[恢复实现与认证证据](recovery.zh-CN.md)记录同轮读回、显式推理重置、图片任务续接通过及音频剩余失败。下文历史结果保留。

再后续的[音频自动流程复验](audio-automation.zh-CN.md)中，两份录音的普通自动问题及原生工具续答共四项通过，未修改产品代码；历史失败未复现，根因仍未定位。

[五项可落实的原生能力](five-native-capabilities.zh-CN.md)记录本地检查点`9ca034d`之后的Schema、远程图片、编码音频、图片编辑及活动任务追加指令验收。该轮更正了被真实Codex客户端拒绝的直接远程图片前提，并区分原生客户端、环境和桥本身的故障。

## 证据与归因

| 场景 | 观察 | 结果与范围 |
| --- | --- | --- |
| 明确上传额度错误 | 自有 HTTPS 服务向认证 DEV 上传返回429，浏览器响应与独立CDP观察都记录429。只有1次上传，无会话提交、工具执行和最终回答，保留原始额度错误。 | 通过：认证页面上的真实HTTP故障注入。不是账号自然耗尽额度的证据。 |
| 缺少重复输入确认事件 | 捕获流含本次请求精确绑定的用户消息、完整最终答案及两个终止标记，但没有单独`input_message`事件。桥误报`response_identity_incomplete`。 | Web2Harness缺陷已修复：匹配的用户快照也能证明接受输入。保留会话、角色、祖先及终态检查。 |
| 快照修复回放 | 原42事件公开投影按1／17／4096字节分块，均还原相同392字符答案。后续认证图片尝试已到达完整来源交付及工具解析。 | 正文绑定通过，不等于图片工具执行通过。 |
| 图片v2／v3尝试 | 均输出直接`image_gen.imagegen`调用，被拒为未声明的顶层工具；删掉额外参数仍失败。后续网页没有公开最终答案。 | 保留失败。真实CLI请求探针确认实际接口为`functions.exec`及嵌套`tools.image_gen__imagegen`。测试要求了错误调用层级，不能单独归因为参数错误。 |
| 透明上下文封装 | 显式空文本、签名和数组丢失；解码出的空压缩摘要被当作不可读密文。 | 已修复，79项上下文测试／416断言通过。证明可逆封装保真，不是原生密文解密。 |
| 原始音频传输 | 内联及任务授权的公开HTTPS Codex音频复用共享附件链路，保留原字节、MIME、位置及调用身份；不再把编码字节数当文本token。 | 格式、保真、引用解析和预算回归通过。真实音频理解尚未通过，部分传输证据记录如下。 |
| 音频模型目录 | 真实外层Code Mode调用到达MCP服务，服务返回原始WAV；但桥目录只声明文本／图片，Codex因此用不支持模态的提示替换音频。 | Web2Harness接入缺陷已修复：自动Web行声明audio，手动文本模式及原生模型行不变。目录／音频／Responses Lite组合55项／542断言通过。 |

目录探针通过真实DEV CLI、命令级loopback收集器取得请求并拒绝推理。它捕获Responses Lite输入中的`additional_tools`，再经实际解析器核对。这是调用契约证据，不是模型／工具执行验收；没有修改持久路由。

音频首轮仅执行了真实工具发现，最终模型描述中的`TypeError`没有对应原生调用或错误，不能证明Codex缺陷。第二轮实际调用MCP一次，定位到目录漏声明。官方[Codex模态枚举](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/protocol/src/openai_models.rs#L163)明确包含audio。支持传输不保证所有录音可解码，也不替代所选账号的实际支持检查。

## 人工验证前的认证媒体验收

目录修复后，真实DEV CLI模型列表中，所选自动Web模型已包含`text`、`image`和`audio`。修正后的类型检查及v4开发运行时构建通过。以下测试使用该运行时：

| 场景 | 已证实结果 | 未解决或未执行部分 |
| --- | --- | --- |
| 原生音频v3 | 一次外层Code Mode及一次MCP调用返回71,790字节WAV，MCP原字节与Codex `input_audio`字节的SHA-256相同。浏览器文件创建返回200，名称、MIME、大小符合预期。最终来源、实际交付和CLI答案完全一致，无命令执行和夹具变更。 | 模型报告无法可靠听辨，音频理解验收失败。本轮观察器未捕获浏览器所选文件hash或传输／处理确认，文件创建不等于完整上传／模型验收。 |
| 原生图片v4 | 页面显示状态文字后结束，没有公开最终答案；原生任务记录0外层工具调用、0命令、0图片文件。 | 以`response_final_message_ambiguous`失败。未观察到可供桥交付的有效公开答案，模型／网页具体原因未确定。更明确的外层Code Mode测试已准备，尚未执行。 |
| 直接音频组件 | 独立文件change观察器捕获浏览器选择的原197,792字节WAV，SHA-256一致；文件创建返回200。 | 准备及生成均被上游HTTP 403／`cloudflare_challenge`拒绝，没有已接受会话或回答事件，截图保留验证错误。这是共享Responses组件测试，不能证明音频理解或Codex端到端通过。 |

原生v3音频SHA-256为`b6da8ad3e7f7f2e259438f3d7cd61e350b9e7108dc4b6bce6341ffdfad994156`；最终答案SHA-256为`ea3e6cbd35a76b3040014f1434ecebc4033581a0843c96291ef1951833923bdc`。直接组件的输入和浏览器所选字节均为`38b3547e1a4b74640b5d94769fec742a5f306e83f90a611e2a24ba74734310d8`。两次提示均未提供预期转录内容。

此时维护者选择在DEV完成人工验证后继续，该选项本身不等于确认验证已经完成，因此暂停新的模型请求。验证属于上游访问门槛，不能据此认定正文校验或音频解析存在缺陷。没有绕过验证或复用生产认证。后续明确确认与结果见下节。

任务output下保留`native-audio-v3/audio-check.private.json`、`native-image-v4/proof.private.json`、`audio-v4-observer.private.json`及`audio-component-proof.private.json`。DEV诊断另保留组件`response-source-27`产物及`e9fe8c5d083a-b6504c57`轨迹的失败截图，以及图片v4的`1483f88ef5df-29b55947`轨迹截图；带版本的私有证据索引以摘要绑定这些产物。当时停止了观察器，DEV保持打开，供人工验证。

v4真实测试前后源码基线共938文件，无文件变化，HEAD及Git状态均不变；随后生产边界对照显示三项配置／认证哈希一致、服务无变化、保留进程身份无变化。本文档更新发生于该源码对照之后。这些检查不替代媒体验收。

## 明确完成人工验证后的结果

维护者随后明确回复“已完成验证”。重新核对DEV归属、登录和队列空闲后，才发送新请求。沿用同一v4运行时及GPT-6 Web／xhigh，测试期间没有更改产品代码或生产设置。

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| 音频组件v2 | 原197,792字节WAV与浏览器所选文件hash一致，实际上传PUT返回201、处理流返回200，请求正常完成，没有403。 | 传输继续推进，但模型表示无法可靠辨认语音，音频理解失败。HTTP处理状态本身不证明理解正确。 |
| 普通音频问题对照 | 共享浏览器实现只收到普通转录问题和同一音频，没有外层Codex上下文封装；沿用原单并发队列和同一模型／强度。 | 正常完成，但返回不相关引文而非测试口令。这是诊断对照，不是原生Codex端到端验收。移除上下文封装仍未得到正确音频理解。 |
| 录音真值核验 | 本机已有Microsoft Zira离线语音，以22,050 Hz／16位单声道重新合成明确测试口令；完整WAV与原197,792字节样本及SHA-256完全一致。 | 通过：错误转录不能解释为参考录音不一致。没有使用转录服务、网络、麦克风或修改系统配置。 |
| 原生图片v5 | 一次真实外层`functions.exec`调用`tools.image_gen__imagegen`，20.5秒返回981,129字节、1254×1254 PNG；原文件与原生`input_image`字节hash一致，目视确认蓝色三角形符合要求。 | 图片生成和原始结果传输通过；完整任务失败：后续两次网页尝试都没有公开final，复制命令和最终报告均未执行。CLI退出1，夹具不变，没有`acceptance.png`。 |

图片SHA-256为`bdc5943477e7cabc1a96b6a57fbf25cee722ed31c14c8eb241d35b4f4c0cd0e6`。首次工具调用正文418字符已完整交付。后续`b70afbf2083f`、`d837a3354a3e`轨迹分别保留30、46条公开投影证据记录，无丢弃；两次均接受输入并到达流终止，却没有公开final。首个失败末尾为非终态thoughts元数据，另有隐藏tool／commentary结构；没有读取或将这些正文提升为最终答案。DOM中的Markdown和工具面板不替代最终回复。首个失败截图5秒超时，保留其此前截图及结构化失败；第二次失败截图已保留。

原生Codex按自身策略重试sampling，后续缓存失败没有重复生成图片；整个任务只有一次原生图片调用。验收脚本没有追加重试、替换模型或伪造图片／最终答案。

这些结果未定位到新的Web2Harness音频理解或缺失final代码缺陷，也不能证明全部音频路径可用或图片完整任务通过。已修复的目录／绑定问题与这些未解决行为分别记录。

确认后的证据包括`audio-component-v2-proof.private.json`、`audio-v5-observer.private.json`、`audio-plain-control-proof.private.json`、`audio-ground-truth.private.json`、`native-image-v5/image-check.private.json`及`native-image-v5/proof.private.json`。DEV诊断`response-source-29`至`response-source-32`保留图片失败。`evidence-index-after-human-verification.private.json`将这些产物与前期证据一并记录摘要。

交接时DEV已登录且空闲，活动／等待请求均为0。新的938文件源码对照再次确认真实测试期间无变更。生产配置／认证哈希及服务未变，保留进程身份一致；宿主Codex／MCP／编辑器进程另有新增和退出，未控制这些进程。源码对照之后仅更新文档及忽略证据，没有新提交或推送。

## 429证据链

此前CDP合成响应在Electron中得到状态0，不是有效429证明。替代方案使用真实HTTPS响应，保留应用既有`onCompleted`观察器。仅重定向一个自有DEV上传目标，转到本地夹具前去掉认证／Cookie头和真实上下文正文，夹具只收到`{}`。证书例外仅适用于该目标及确切loopback来源，之后解除，没有修改系统信任或共享网络。

Codex之后重连／HTTP回退没有引起第二次网页上传。失败附件卡片保留、无Send、服务端仅收到一次请求及原始额度错误，共同证明立即报错分支。CLI非零退出符合预期拒绝，不是成功完成用户任务。

原始证据位于忽略目录`output/2026-10-20-capabilities-round2/`，不公开原始日志。稳定产物摘要：

| 产物 | SHA-256 |
| --- | --- |
| `upload-quota-https-fault.private.json` | `810fc49910aee27e1dc6627ec70c717b59af0abf5a0e1a9db480d2e58ea1b768` |
| `upload-quota-https/quota-check.private.json` | `7f86e44b850ff472cd574b96de699646dd72728a220a322226c54347a7914e02` |
| `native-image/source-failure.private.json` | `76a7412b67bc5979e5fde0105852e11e304bab8e7bf4007a9c2690784d11bbb7` |
| `native-image/source-replay-after.private.json` | `843905757b6f7883ec83753e4a0d3b4466e9b88c8b0afeb0a4987a50ee976337` |

回放答案SHA-256为`eb347c965b4d54f10cb4b9ffacfaa4e6d4014d9eaaae8362a11603fb84ce03f7`。私有产物可能包含公开回答正文，不纳入Git。

## 剩余边界

本次核查未找到原生不透明reasoning／compaction向Web导入的有效契约。需要来源完整明文，或受支持的来源导出／目标导入；可见摘要、空明文标记都不能解密既有负载。[上下文兼容边界](../../native-tools-compatibility.zh-CN.md#data-contracts)继续明确保留。

API托管`file_search`、`code_interpreter`、hosted MCP／computer及provider `file_id`依赖真实服务、状态、账号与权限契约。它们不同于Codex已注册的本地／MCP工具，后者保留原生执行器。本次没有引入额外API文件服务或凭据。原始视频、裸PCM及任意媒体容器仍不支持，转录／抽帧替代不能保留所要求的数据语义。

自动化夹具、真实CLI契约探针、认证页面故障注入、认证工具执行是不同证据层级。本任务没有进行安装器及跨平台真实验收。
