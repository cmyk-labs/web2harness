# 音频自动流程复验，2026-10-20

[English](audio-automation.md) | [简体中文](audio-automation.zh-CN.md) · [前期结果](recovery.zh-CN.md) · [兼容说明](../../native-tools-compatibility.zh-CN.md)

## 结论

两份不同录音分别通过普通 BrowserWorker 提问及真实 Codex 原生工具结果续答，共四项认证 DEV 验收通过。全部沿用本轮开始时的产品代码；没有增加等待、重传、转录服务或模型替换。因此本轮证明这些具体输入与路径当前可用，**没有证明此前失败的根因已定位或修复**。原失败保留，不由新通过记录覆盖。

用户在本机 Chrome 和 DEV 内置浏览器手动成功的结果，使排查重点收敛为标准自动流程。前期普通 DEV UI 使用相同英文转录提示也曾成功，不能将失败泛化为内置浏览器不支持音频、临时聊天不支持音频或某个提示词必然致错。

## 实际验收

请求选择 `chatgpt-web/gpt-6-sol`／`xhigh`；每次网页提交实际为 `gpt-6-thinking`／`max`。普通问题使用共享 BrowserWorker，原生任务使用标准 `dev:codex`、独立工作区、`read-only` 沙箱与正常原生审批策略。没有启用 MCP Bridge；音频由任务独立的 stdio MCP 服务返回。

| 用例 | 输入与执行证据 | 结果 |
| --- | --- | --- |
| B，普通自动问题 | 原144870字节WAV，同英文转录提示，临时聊天，一次发送 | 正确识别“The red bicycle is beside the green door.” |
| B，原生音频续答 | 一次真实外层Code Mode/MCP调用；原生 `input_audio`、网页所选文件及参考文件hash一致；两次Web生成分别请求工具和续答 | 正确转录并返回验收标记；0命令，fixture未变 |
| C，普通自动问题 | 新162946字节WAV，相同提示/模式，一次发送 | 正确识别“Three silver keys are inside the yellow box.” |
| C，原生音频续答 | 独立线程，一次真实外层Code Mode/MCP调用；原字节与调用/附件绑定核验通过 | 正确转录并返回验收标记；0命令，fixture未变 |

参考文字只用于离线合成和结果断言，不写入模型提示、工具描述或工具文本结果。没有ASR替代。两份音频均为22050Hz、单声道、16位PCM WAV：

- B：SHA256 `7ccfeec59db12f930fbb7e6b495eb93b38de34092a63abd4d8876b35c2cddd6c`，约3.28秒。
- C：SHA256 `65f68d44dd7de9a0acec21fb54a6875d2b38276e7fbc41a8fd485cca6e380a67`，约3.69秒。

两项原生审计各核验12项：调用次数、原字节、网页选中文件、处理完成、实际提交中的 `call_id`／`attachment_ref` 及附件身份、实际模型/强度、正确内容、答案未泄漏、原生最终消息与CLI一致、正常终态、0命令、fixture未变。它们是实际工具及文件证据，不以CLI退出码单独判断成功。

## 发送时机假设

| 用例 | 处理响应结束至实际发送的间隔 |
| --- | --- |
| B普通自动问题 | 4.181秒 |
| C普通自动问题 | 3.846秒 |
| B原生音频续答 | 14.361秒 |
| C原生音频续答 | 15.710秒 |

这些间隔是自然发生的观测值，不是新增等待配置。所有用例在点击发送前处理响应已经结束。因此，本轮不支持“只收到 `file.processing.completed` 就过早发送”的解释，也不据此修改超时或等待条件。

原计划的人工释放发送暂停只在复现失败后用于区分变量；本轮基线直接通过，因此没有额外执行该实验、增加相同请求或重发已接受任务。需要归因的历史间歇性失败仍缺少同条件失败样本。

## 环境限制与证据

C样本离线合成首次因受限进程无法访问已安装语音而失败；仅该任务命令在获自动批准的环境中使用现有Zira成功，未安装组件、修改系统或网络。原生Apps MCP启动出现连接失败并继续使用既有工具缓存；任务独立的音频MCP实际执行成功。这些环境事件分别保留，没有当作Web2Harness缺陷修复。

原始证据位于忽略目录 `output/2026-10-20-audio-automation/`：

| 范围 | 证据 |
| --- | --- |
| 普通问题的最终内容、实际请求与处理时间 | `baseline/proof.private.json`、`sample-c/proof.private.json` |
| 原生B线程、工具、文件及最终消息 | `native-audio-recheck-b/`，线程 `01a158c7-8429-7713-8feb-01e9645cf009` |
| 原生C线程、工具、文件及最终消息 | `native-audio-recheck-c/`，线程 `01a158ce-cd43-7e43-a96f-67a7c16409fe` |
| 原生上传和请求观察 | `audio-v1-observer.private.json`、`audio-v2-observer.private.json` |
| 样本有效波形 | `waveform-check.private.json` |
| 原证据保全 | `prior-dev-traces/`：测试前复制208文件并逐一核验hash |
| 收尾证据保全 | `final-dev-traces/`及`final-dev-traces-manifest.private.json`：复制243文件并逐一核验hash；两项原生线程另存`native-rollout.private.jsonl` |
| 生产边界与DEV收尾 | `boundary-before.private.json`、`boundary-after.private.json`、`boundary-ownership.private.json`、`dev-final-status.log` |
| 汇总与文件摘要 | `evidence-index.private.json` |

前后3份生产配置/认证hash及相关服务不变，原58进程身份均保留且未改变；新增3进程的父链均归属已核验DEV。DEV收尾保持认证、运行与等待任务均为0。没有操作生产路由、复制认证或关闭用户成功会话。本轮复制保全不代表此前披露的历史截图缺失已恢复。

未执行：其他音频格式、长录音、噪声/多人录音、不同账号或模型、安装器、全量回归及自然旧失败的修复验证。本轮只更新证据和能力说明，没有产品代码改动、发布或推送。密文迁移、外部托管工具和其他媒体格式的既有边界不由这四项音频通过消除。
