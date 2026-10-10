# 离线设备授权

[English](licensing.md) | [简体中文](licensing.zh-CN.md)

2.0.0 需要激活后使用，从 1.x 升级也需要本机授权码。应用先显示激活页，验证通过后才进入语言选择和配置；启动及每次新建 Web/MCP 工作时检查授权，不联系发行方服务器。ChatGPT 和连接器本身仍需要联网。

## 用户流程

激活后的「产品授权」页默认显示授权状态、有效期和设备码。点击「更新授权」展开输入框；取消会清空本次输入，有效授权保持不变。

1. 打开 Web2Harness，在激活页复制设备码。也可运行 `web2harness license device`；单独构建的 `Web2Harness-DeviceCode` 程序不需要安装 Bun。
2. 将设备码发给发行方，取得授权码文本或 `.w2h` 文件。
3. 粘贴授权内容，点击「激活并继续」，再选择语言、配置 ChatGPT。应用内「产品授权」可查看期限和更新授权。

获取设备码的命令必须在**客户自己的电脑**执行。已安装并可使用 `web2harness` 命令时：

```powershell
web2harness license device
```

未安装客户端时，将单独的设备码工具发给客户，让其在工具所在文件夹打开 PowerShell 运行（无需安装 Bun）：

```powershell
.\Web2Harness-DeviceCode.exe
```

客户将输出的完整 `W2D1-…` 设备码发给发行方即可。

命令行从标准输入导入，避免授权码出现在进程参数中：

```powershell
Get-Content -Raw .\license.w2h | web2harness license import --stdin
web2harness license status --json
```

无效授权不会覆盖已有授权。正常升级、断开 Codex 集成均保留授权；明确删除全部应用数据时才删除。

## 有效期与设备变更

授权可以为永久或指定期限，到期时间在激活页和「产品授权」中显示。到期后，更新有效授权即可继续使用。更换电脑或重装系统导致设备码变化时，请联系发行方处理。

授权码仅用于对应设备，请勿公开粘贴或加入故障报告。正常升级保留现有授权；显式清除全部应用数据会移除授权。

## 源码开发与构建

DEV 使用独立测试授权。运行 `bun run scripts/prepare-license-dev.ts`，设置输出的 `WEB2HARNESS_DEV_HOME` 和 `WEB2HARNESS_LICENSE_KEYS_FILE`，再运行 `bun run dev:launcher`。测试及 `bun run verify` 自行准备临时测试资源。

正式构建通过 `WEB2HARNESS_LICENSE_KEYS_FILE` 读取发行方提供的正式公钥清单；GitHub 发布工作流从仓库变量 `WEB2HARNESS_LICENSE_PUBLIC_KEYS_JSON` 读取同一份公开配置。缺少配置或使用开发配置时，正式打包会失败。该配置不包含私钥，测试包不得作为正式版本分发。发布流程见[发布手册](release.zh-CN.md)。

客户设备码工具可通过 `bun run license:device:build` 单独构建，产物位于 `output/device-code/`。签发工具独立维护，不属于公开仓库或客户安装包。
