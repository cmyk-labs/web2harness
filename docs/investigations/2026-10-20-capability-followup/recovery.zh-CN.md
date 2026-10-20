# 同轮结果复核与能力恢复，2026-10-20

[English](recovery.md) | [简体中文](recovery.zh-CN.md) · [前期证据](README.zh-CN.md) · [兼容说明](../../native-tools-compatibility.zh-CN.md)

本轮在检查点 `a5ed839` 之后的未发布工作区实现已批准恢复方案。工具、执行、沙箱及审批仍由原生Codex负责；认证媒体任务使用 `chatgpt-web/gpt-6-sol`／`xhigh`，无需开发子agent。本轮未提交、推送、发布或部署生产。

## 已实现行为

| 范围 | 结果 |
| --- | --- |
| 流结束但无公开final | 将 `awaiting_final` 与多个final冲突分开。网页／工具活动停止后独立给予120秒只读复核；到期返回不可重试的 `chatgpt_public_answer_missing`，桥不重新生成或重复工具。 |
| 保存会话恢复 | 空闲保存会话最多自动刷新一次，被动观察同页面正常GET。兼容旧 `mapping` 和当前分页 `messages`，绑定精确提交用户及活动末端final。临时会话不因此开启保存／读历史。 |
| 跨表示校验 | 保存页面会省略／重排隐藏节点。其有序活动分支通过精确user/current-node ID及一致的 `turn_exchange_id`／`working_turn_id` 绑定本轮，不强求流里的隐藏父ID保持不变。旧图结构在该快照内部证明祖先关系。 |
| 显式推理重置 | `X-Web2Harness-Reasoning-Migration: visible-history` 只重置顶层原生加密reasoning。保留可见字段、工具／结果、显式模型／强度及原始续接输入；模型收到说明，成功HTTP响应返回重置计数。默认／`strict` 仍拒绝不透明上下文。 |

推理重置会失去原加密推理连续性，不是解密原生密文、恢复隐藏压缩／agent／工具状态，也不允许重复工具副作用。其他密文和损坏桥封装仍失败。

## 保存页面观察与修正

新建归属明确的保存测试，只提交一次问题，实际 `gpt-6-thinking`／`max`，公开回答为 `SAVED_READBACK_20261020_OK`。刷新请求 `/backend-api/conversations/{id}`，带 `num_turns`、`include_has_versions`；HTTP200返回 `messages`、`current_node` 和分页信息，而非旧 `mapping`。三个可见消息拥有相同的两个本轮标识。recap的隐藏父节点与原流不同，但user ID、final ID及正文相同。

这揭示初版的两处不足：只观察单数接口；把隐藏父节点关系当作跨表示不变量。现已修正。无关／缺失用户、缺少活动叶节点、本轮标识不符、final冲突和明确中断仍不能恢复。

**回放通过：** 从真实公开投影中去除4个final相关帧，保留19条记录，先确认 `awaiting_final`，再从真实保存页面投影恢复完全相同的原final。回放不生成新回复或执行工具。认证观察加这项回放，**不能证明**自然缺失final事故已由完整worker自动恢复。调查为确认结构手动刷新数次，不是worker“一次刷新”限制的真实执行证据；该限制有夹具覆盖。

辅助失败保留：只认中文的断言误拒绝英文 `6 Extra High`；保存请求省略 `history_and_training_disabled` 而非明确发送false；完整URL匹配最初漏掉查询参数。修正测试假设时未改产品模型选择或重发问题。

## 原生图片及音频结果

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| 已有图片作为用户输入 | 真实Codex `--image`、原981129字节PNG、65字符正确描述、无命令 | 视觉诊断通过 |
| 同图作为原生工具结果 | 一次真实外层Code Mode／MCP调用；原生 `input_image` 与原图hash一致；82字符正确最终回答 | 原结果续答通过 |
| 新图片首次任务 | 一次真实 `image_gen` 返回995093字节、1254×1254 PNG，原生字节一致。之后命令在创建进程前失败 `CreateRestrictedToken: 87` | 保留原生Windows环境失败；反复失败后仅取消归属明确的DEV请求 |
| 同一图片线程续接 | 正常外层启动环境；子Codex保持 `workspace-write`、Windows `unelevated`、审批 `never` 及指定Web模型／强度。一条命令exit0，复制原PNG，无第二次生成 | 工具／文件／汇报链路通过 |
| 独立普通网页音频 | 原A录音未能准确听辨；另一B录音准确转录，预期文字未写入提示 | B仅在这项普通网页对照通过 |
| 原生音频B | 一次真实MCP回传；原字节、原生 `input_audio`、浏览器选中字节一致。PUT201、处理HTTP200。无命令或fixture变化；最终称无法可靠转录 | 传输证据通过，音频理解失败 |
| 共享BrowserWorker普通问题 | 同一B录音，不含Codex上下文包装 | 理解仍失败，不能只归因包装 |
| 不提交生成的上传入口对照 | 直接选择和真实文件选择器使用同一input，`ace_upload`、`chat_composer`、MIME／大小等价，均处理完成 | 无证据支持改用猜测的音频接口或字段 |

独立目视确认白底蓝色三角形。工具字节、生成文件和复制后的 `acceptance.png` 均为SHA256 `cc09cac3c26e456258a3ddd0ed32c18180b993df13c2ac09e8d0ce86e3a2ce74`。原51字节fixture不变，只新增图片；529字符汇报与实际原生 `phase: final_answer` 及CLI输出一致。首次命令失败不是桥缺陷或PowerShell语法错误的证据；未改系统沙箱或生产设置。

首次图片审计总项仍保留 **false**：八项执行／文件检查通过，但此前DEV重启后未保留可对应的可选成功交付私有快照。补充审计核实原生最终消息及运行时来源交付事件，不冒称原始source／DOM／CLI三方字节一致。另一个辅助审计最初误用 `channel: final`，实际CLI为 `phase: final_answer`；原false也保留。

B录音144870字节，SHA256 `7ccfeec59db12f930fbb7e6b495eb93b38de34092a63abd4d8876b35c2cddd6c`。**原生音频理解仍失败。** 没有引入ASR／转录替代、模型替换或推测性上传器重写。

以上是本报告对应轮次的失败结果。[后续两样本复验](audio-automation.zh-CN.md)的普通BrowserWorker和真实原生音频续答均通过，沿用原产品实现；这不覆盖原失败，也未证明其根因已修复。

## 验证与边界

| 检查 | 结果 |
| --- | --- |
| 最后保存结构修正前的browser／Responses组合 | 814通过、88跳过、0失败，5343断言 |
| 最新source／读回／stream／worker定向回归 | 75通过、0失败，520断言 |
| 最后补齐新旧接口及正文结构组合 | 20通过、0失败，123断言 |
| 完整worker保存读回成功／到期夹具 | 2通过、0失败，20断言；其他22例被过滤 |
| 核心类型检查及开发运行时构建 | 通过：`typecheck-v7`、`runtime-v3` |
| 重启后隔离DEV | 归属、原生工具运行时就绪及浏览器已登录均核验 |

各组互有重叠，不能累计。此前类型错误、unsupported-presentation生命周期回归、不完整读回假设及辅助失败均保留。未重跑全量、跳过项、真实安装器或跨平台登录检查。

媒体验收期间原944文件基线保持原hash；并行工作另增16项海报／提示词，故Git status和整个工作区并非不变。之后保存结构修正有意修改两个源码文件及测试，再同步文档；其他资产保留。

最终生产比较：3项配置／认证hash不变、服务不变、35个保留进程身份不变。DEV重启及其他宿主进程新增／退出单独记录，不声称全部进程集合固定。

原生不透明压缩／agent／工具迁移仍需受支持的完整来源导出／目标导入。provider `file_id`、API托管 `file_search`、持久化 `code_interpreter` 等仍需真实服务／账户／状态契约；裸PCM、单独AAC流和原始视频仍不支持。复用此前有效的429认证HTTP注入证据，不等于自然额度耗尽。正确拒绝和推理重置不等于解决这些缺口。

## 证据链

私有证据保留于被忽略的 `output/2026-10-20-capability-recovery/`；本文不包含认证或隐藏祖先正文。

| 结论 | 证据 |
| --- | --- |
| 原保存回答与真实新结构 | `saved-readback-ui-v2-proof.private.json`、`saved-live-shape-v3.private.json`、`saved-readback-resume-v2-result.png` |
| 旧假设失败及完整恢复 | `saved-readback-resume-proof.private.json`、`saved-readback-resume-v2-proof.private.json`、`saved-live-replay.private.json`、`saved-live-replay-v3.private.json` |
| 图片调用、原失败、续接及文件 | `native-image-full/`、`native-image-resume/`、`native-result-audit-v2.private.json` |
| 音频对照、字节及理解失败 | `audio-ui-b3-proof.private.json`、`native-audio-b/audio-check.private.json`、`audio-plain-control-b2-proof.private.json`、`upload-entry-comparison-v3.private.json` |
| 检查与隔离 | `affected-tests-v5.log`、`readback-v8.log`、`readback-stream-v9.log`、`saved-worker-v10.log`、`typecheck-v7.log`、`build-v3.log`、`boundary-comparison.private.json`、`project-live-v1-summary.json` |

`evidence-index-final.private.json` 记录本轮141项证据，并复核前期58项索引。该审计的**四张旧截图保全失败**：前期403、image-v4的失败图，以及image-v5的正文可见／失败图，已不在共享轮换诊断目录。其余54项仍hash匹配；搜索任务output内5004张PNG未找到原样副本。共享目录只保留十个trace；验收流程未在后续测试前把这些已索引截图复制到轮换范围之外。

已将仍在的54项复制并核验hash，存入 `prior-evidence-archive/`，由 `prior-evidence-preservation.private.json` 记录原路径、归档路径及四项缺失hash。历史结构化／公开事件失败仍可核查，但缺失截图不能独立复验；原失败索引保留。`evidence-completion.private.json` 绑定索引、保全记录及最终文档，不把此次证据保全失败改写成通过。
