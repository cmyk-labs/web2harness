# 打包依赖补丁

[English](README.md) | [简体中文](README.zh-CN.md)

## Electron 产物下载

`app-builder-lib@26.15.3.patch` 与启动器中将 `@electron/get` 固定为 `5.1.0` 的覆盖规则配套使用。该正式发布的下载器使用 Fetch，移除了受 [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) 影响的 `got` → `cacheable-request` → `http-cache-semantics` 依赖链。打包工具继续固定在稳定版本。依赖审计保持原有规则，没有忽略漏洞公告。

代理初始化和中止信号超时改动改编自采用 MIT 许可证的 [electron-builder 实现 ec9135d](https://github.com/electron-userland/electron-builder/blob/ec9135d0626879479ffa4235006f06b14375cc43/packages/app-builder-lib/src/util/electronGet.ts)。补丁同时让重试逻辑识别 Fetch HTTP 状态及嵌套网络错误，并将原有、明确指定的旧选项 `strictSSL: false` 转换为 Undici dispatcher；正常下载仍验证 TLS 证书。Web2Harness 不启用该选项。

启动器直接声明 Undici，确保代理支持不依赖可选依赖是否安装。下载器及 CommonJS 加载 ESM 需要 Node.js 22.12.0 或更新版本；CI 使用 Node 24。这些要求适用于构建主机，不增加安装版桌面应用的用户环境要求。

## 维护流程

1. 精确的打包工具版本、覆盖规则、补丁文件、`patchedDependencies` 和锁文件必须一起维护。使用项目固定的 Bun 版本和 `--frozen-lockfile` 安装依赖。
2. 升级 electron-builder 时，检查正式版本的下载器集成。只有其支持的依赖链不再包含受影响缓存组件，且 Fetch 集成兼容时，才同时移除补丁和覆盖规则。
3. 从仓库根目录运行 `node --test launcher/tests/installation/build-download.test.cjs`、两套依赖审计及 `bun run verify`。通过全新冻结安装验证受版本控制的补丁能够应用，不依赖本地模块修改。
4. 发布前完成[发布流程](../../docs/release.zh-CN.md)要求的原生打包和隔离安装器检查。本地下载 fixture 不能证明真实安装器已通过验收。

保留依赖的原有许可。被修改文件仍属于采用 MIT 许可证的 app-builder-lib；本仓库保留[原始许可证](../../LICENSES/electron-builder-MIT.txt)。该补丁只处理下载兼容性，不修改 ChatGPT 会话、Codex 路由、应用配置或已安装的桌面应用。
