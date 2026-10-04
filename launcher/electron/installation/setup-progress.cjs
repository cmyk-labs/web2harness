const fs = require("node:fs");
const path = require("node:path");
const { assertPlainPath, recordPaths } = require("./installation-record.cjs");

const labels = {
  "stopping-runtime": ["正在停止应用后台服务", "Stopping application services"],
  "saving-registration": ["正在保存安装设置", "Saving installation settings"],
  "saving-application": ["正在备份当前应用", "Saving the current application"],
  "saving-runtime": ["正在备份当前运行组件", "Saving the current runtime"],
  "updating-shortcuts": ["正在更新快捷方式图标", "Updating shortcut icons"],
  "replacing-application": ["正在替换应用文件", "Replacing application files"],
  "deploying-runtime": ["正在部署运行组件", "Preparing runtime components"],
  "checking-installation": ["正在检查现有运行组件", "Checking installed components"],
  "waiting-source": ["正在等待安装文件就绪", "Waiting for installation files"],
  "verifying-source": ["正在校验安装文件", "Verifying installation files"],
  "verifying-installed": ["正在校验现有运行组件", "Verifying installed components"],
  "copying-runtime": ["正在复制运行组件", "Copying runtime components"],
  "verifying-copy": ["正在校验复制结果", "Verifying copied components"],
  "committing-runtime": ["正在启用新运行组件", "Activating runtime components"],
  "registering-installation": ["正在登记安装信息", "Registering the installation"],
  "finishing-installation": ["正在完成安装", "Finishing installation"],
  "recovering-installation": ["正在恢复原有安装", "Restoring the previous installation"],
};

function createSetupReporter(options, write = line => process.stdout.write(line)) {
  const zh = options.language === "zh-CN";
  const log = path.join(recordPaths(options.appData, options.installRoot).directory, "setup-timings.jsonl");
  let current, lastAt = 0;
  return progress => {
    const label = labels[progress.stage];
    if (!label) return;
    const first = current !== progress.stage;
    const ended = progress.status !== "running";
    const now = Date.now();
    if (first || ended) {
      // Diagnostic output must not interrupt recovery; no paths, credentials or helper arguments.
      try {
        assertPlainPath(log);
        fs.mkdirSync(path.dirname(log), { recursive: true, mode: 0o700 });
        fs.appendFileSync(log, JSON.stringify({ at: new Date(now).toISOString(), version: options.version,
          stage: progress.stage, status: progress.status, elapsedMs: progress.elapsedMs }) + "\n", { mode: 0o600 });
      } catch { write(zh ? "无法写入安装耗时日志\n" : "Could not write installation timing log\n"); }
    }
    if (!first && !ended && now - lastAt < 1000) return;
    current = progress.stage;
    lastAt = now;
    const count = Number.isInteger(progress.completedFiles) && Number.isInteger(progress.totalFiles)
      ? ` (${progress.completedFiles}/${progress.totalFiles})` : "";
    const status = ended ? (progress.status === "completed" ? (zh ? "完成" : "Done") : (zh ? "失败" : "Failed")) : "";
    write(`${label[zh ? 0 : 1]}${count}${ended ? ` — ${status} ${(progress.elapsedMs / 1000).toFixed(1)}s` : "…"}\n`);
  };
}

module.exports = { createSetupReporter };
