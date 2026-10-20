# 五项可落实的原生能力

[English](five-native-capabilities.md) | [简体中文](five-native-capabilities.zh-CN.md)

日期：2026-10-20。本报告针对未发布源码检查点`9ca034d`，不是生产发布；检查点只在本地提交，未推送。复用现有实现，仅针对实际证据证明的Web2Harness缺陷修改。历史／偶发故障、原生密文迁移及没有真实服务契约的托管能力不在本轮范围内。

本轮已完成下表可行范围的真实验收并更正兼容说明；检查点之后没有修改产品运行时代码。

## 方法与状态

标准DEV launcher使用独立配置、凭据和浏览器分区。每个真实Codex任务通过`bun run dev:codex`启动，拥有独立工作区并保留正常原生沙箱。父模型明确为`chatgpt-web/gpt-6-sol`／`xhigh`，实际网页请求必须核实为`gpt-6-thinking`／`max`。不启用MCP Bridge，不控制生产会话；本地fixture MCP只绑定本任务。

| 顺序 | 能力 | 结果与证据 |
| --- | --- | --- |
| F01 | 原生JSON Schema最终输出 | **通过。** 真实CLI传入`--output-schema`，一次成功原生命令读取fixture。结果无需修补即通过原schema校验，数值正确且与原生final一致；两个fixture未改变，9项检查通过。 |
| F02 | 远程图片输入 | **原生下载→查看→续答通过，11项检查通过。** 直接app-server HTTPS图片输入仍被Codex自身拒绝，单独记录边界。 |
| F03 | 编码音频原生工具结果 | **MP3、M4A、WebM、OGG通过，各13项检查。** 复用既有WAV证据；FLAC在到桥之前被原生Codex省略，从本轮可行范围排除。 |
| F04 | 双参考图原生图片编辑 | **通过。** 11项原生/字节/文件/最终结果核验及直接目视检查通过。 |
| F05 | 活动原生任务追加指令 | **通过。** 12项检查：工具待返回时接收追加要求，单轮次/收据/输入，实际文件写入/读回和正确最终结果。 |

F01线程：`01a15924-2f61-7d02-b6d2-b36009d20864`。初始提示不含fixture答案；原schema进入上传上下文，两个实际网页请求均使用指定模型／强度。原生`standalone_web_search`实验特性提示保留，没有禁用功能以清除提示。

## 更正远程图片前提

当前官方Codex `0.162.0-alpha.17.2` app-server在`turn/start`阶段拒绝HTTPS图片URL，返回`-32600`，明确要求内联data URL。这发生在模型生成及Web2Harness分派之前，因此不是桥内下载器故障。

原计划“真实原生客户端直接提交HTTPS图片URL”的前提不适用于此客户端。可行流程是原生工具下载公开原图，再原生查看图片；不能将该流程冒充桥内直接HTTPS图片解析器的认证验收。既有下载器fixture及公开PDF组件证据保留各自范围。

线程`01a1592d-1dba-77f3-8bd6-80bbdc429566`首先因测试子进程默认原生沙箱禁止联网而下载失败，没有产生图片。随后仅在该任务的原生workspace-write策略中明确授权联网，不改全局或生产设置。真实命令收到HTTP 200并下载2070074字节PNG；下载文件、原生`view_image`结果及网页所选图片的SHA-256一致（`5cbfe09c463f400d25723cef6048e17c1fc2c543012f12ce5cf2b4180a26f35d`）。最终答案准确读出四个卡片标题及三个系统名称，原生/CLI最终文本一致；原fixture未变，仅新增remote.png。本次两轮续验11项检查全部通过。

## 编码音频与FLAC边界

使用已有本机FFmpeg，把同一已验证录音分别独立编码；FFprobe核实容器/codec及时间，解码信号大小确认非静音。每种格式使用独立原生线程，只调用一次音频fixture。提示和工具元数据不含答案，也没有通过转录服务或本地命令提供答案。

| 格式 | 实际编码 | 原生线程 | 结果 |
| --- | --- | --- | --- |
| MP3 | MP3，`audio/mpeg`，40482字节 | `01a1593a-baf5-7932-b3c4-17e056fad332` | 通过 |
| M4A | MP4中的AAC，`audio/mp4`，29597字节 | `01a1593c-4410-7ed0-87da-bfd7b10ed650` | 通过 |
| WebM | Opus，`audio/webm`，19143字节 | `01a1593d-cd4b-74f1-bdc6-820ac720bfc8` | 通过 |
| OGG | Vorbis，`audio/ogg`，17036字节 | `01a1593f-30a0-73c3-a39a-70efc4ebbbbd` | 通过 |
| FLAC | FLAC，`audio/flac`，59935字节 | `01a15940-b95d-7630-8172-88c0b1a956bd` | 失败；原生客户端边界 |

四项通过均核对原生音频原字节/MIME、网页文件选择、处理完成、提交附件/调用关联、实际模型/强度、正确转录、答案未泄漏、native/CLI最终文本一致及fixture未变。不据此声明全部录音条件或长音频准确率。

FLAC的真实MCP结果有正确原字节，但Codex Code Mode输出音频省略占位，而非`input_audio`；网页观察器没有收到FLAC附件。固定官方源码的[音频准备实现](https://github.com/openai/codex/blob/e1b9c9457ceca75a99b034a5df39ac48c3998d15/codex-rs/utils/audio/src/lib.rs)在MIME清单中排除FLAC，无法估算时长时按data URL大小计算；[输出截断实现](https://github.com/openai/codex/blob/e1b9c9457ceca75a99b034a5df39ac48c3998d15/codex-rs/utils/output-truncation/src/lib.rs)可省略超出原生工具预算的音频。实测省略与该原生链路一致，单纯提高预算也不能消除另外的MIME限制。

未开发Codex分支、伪装MIME、用转录替代音频，也没有尝试在桥内恢复到达前已丢失的数据。桥内FLAC解析仍保留离线支持，但不是原生端到端通过；此发现不能解释此前WAV偶发识别失败。

FLAC后续在没有音频的情况下重试/重同步。精确核验后停止其归属原生进程，再仅取消该线程的DEV活动请求。记录为exit255、没有final，不是自然完成；失败audit和取消归属证据均保留。

## 原生图片编辑

线程`01a1594c-1e5b-7771-86e8-be77da0e1799`仅调用一次真实原生`image_gen__imagegen`执行器，传入两个本地参考路径，16.3秒返回新的1254×1254 PNG。原生成文件、原生图片结果及实际原生命令保存的edited.png均为1397947字节，SHA-256一致：`40e29a55b11fa37f5c74c3b0f9a9f7efb72424cae03bad25e1273f6fbd6ef37e`。

直接查看确认第二张参考的白色环形图案和中央H置于第一张参考的蓝色三角形内部，背景为白色。两份参考图及文字fixture未变，父模型保持GPT-6 Web/xhigh，原生/CLI最终文本一致。此结果证明原生编辑/多参考及续答路径，不等价于通用hosted `image_generation`事件支持，也不保证任意图像质量。

## 活动原生任务追加指令

真实Codex app-server启动线程`01a15950-434f-7382-8bf0-b225eeb54151`、轮次`01a15950-4465-7eb0-b862-8c448bc1249a`。任务专属stdio工具创建一次唯一收据并暂缓返回，客户端在其待返回时调用`turn/steer`，明确携带该活动轮次ID。Codex在`12:37:25.143Z`确认同一轮次接收成功，随后客户端才放行原工具结果。

追加要求将颜色从blue改为green并增加标记。实际原生命令创建并读回result.json，其中保留原收据token，包含`color: green`及`steering: STEER_APPLIED_7261`。收据只产生一次，原生历史中的追加输入只有一次，仅启动一个原生轮次；fixture和收据未变，实际模型/强度保持不变，原生final与客户端报告一致，12项检查通过。

这是使用受控任务fixture，在工具待返回边界完成的真实原生`turn/steer`验收。不据此声明能够打断正在生成的网页Token流、支持更早Responses steering边界，或兼容任意托管工具审批。

## 证据与保留失败

私有证据根目录：`output/2026-10-20-five-native-capabilities/`。

- `f01-schema/acceptance.private.json`：9项明确检查、原生rollout摘要、命令／文件／最终输出证据。
- `f01-observer.private.json`：实际网页模型／强度及携带schema的上下文。
- `f02-image-url/`：真实app-server请求、拒绝及归属线程身份。
- `f02-native-download/`：保留禁网测试失败，CLI正常退出不等于能力验收通过。
- `f02-native-network/acceptance.private.json`及`f02-observer.private.json`：原生允许联网的续验、图片摘要、实际模型/强度及命令/文件/答案证据。
- `remote-image-fixture.private.json`：公开图片状态、MIME、原字节摘要及已查看参考图。
- `audio-fixtures.private.json`：原始WAV与独立编码样本、codec、时长及解码信号大小。准备样本不等于真实验收。
- `f03-audio-{mp3,m4a,webm,ogg}/acceptance.private.json`、`f03-observer.private.json`及`audio-*-calls.private.jsonl`：四项认证通过、原生输入/最终记录及字节/调用关联。
- `f03-audio-flac/`：保留失败audit、真实MCP结果、原生省略、取消归属及队列收尾。
- `official-audio-source/manifest.private.json`：固定官方源码版本及三个文件摘要。
- `f04-image-edit/{acceptance.private.json,image-artifacts.private.json,visual-review.private.json}`及`f04-observer.private.json`：一次真实原生编辑、两张参考、原产物摘要、文件命令、目视和最终结果一致性。
- `f05-steer/{requests.private.jsonl,app-events.private.jsonl,acceptance.private.json,native-rollout.private.jsonl}`、gate收据及`f05-observer.private.json`：真实原生steering确认、工具待返回时序、单次执行、文件读回和最终结果一致性。

首次DEV smoke因浏览器面板未获得布局边界失败，打开面板后标准smoke通过；首次未发送模型任务。独立的PowerShell公开图片下载曾因TLS认证失败，Bun保留正常TLS验证下载同一URL成功。这两项均不构成修改产品的理由。

后续原生远程图片任务发生一次既有“缺少公开最终正文”错误，Codex自行重试。保留该错误；本轮不展开偶发正文问题定位，也不宣称已根治。

## 收尾

生产配置/认证的3份摘要、相关服务及原有26个相关进程身份全部不变。新增16个相关进程均核实归属DEV启动进程链；已取消FLAC任务记录的6个后代进程均已退出。DEV保持独立登录和空闲，排队、活动浏览器及活动WebSocket轮次均为零。

此前243份诊断文件与收尾时现存210份文件分别复制并核对摘要。各任务原生rollout、网页观察、原始失败及产物保留在私有证据目录；归档数量不表示全部历史流都完整覆盖。

8份相关文档的122个本地链接及空白检查通过，`git diff --check`通过。因运行时代码没有改变，复用既有实现回归结果，不宣称新增全量测试/构建通过。`closeout.private.json`记录可行范围验收、保留失败、边界对照和空闲状态。

检查点仅保存在本地，后续文档尚未另行提交，独立宣传图保持原样。未执行安装器验证、发布或生产部署。
