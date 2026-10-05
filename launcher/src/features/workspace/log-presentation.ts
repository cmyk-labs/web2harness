import type { Language, LogRecord } from "../../types";

const events: Record<string, readonly [string, string]> = {
  "runtime.started": ["运行服务已启动", "Runtime started"],
  "browser.connection_failed": ["浏览器连接失败", "Browser connection failed"],
  "launcher.window_created": ["应用窗口已创建", "Application window created"],
  "launcher.renderer_loaded": ["应用界面已加载", "Application interface loaded"],
  "launcher.runtime_prepared": ["运行环境已准备就绪", "Runtime prepared"],
  "launcher.runtime_stage_completed": ["运行环境准备步骤已完成", "Runtime preparation step completed"],
  "launcher.workspace_initialized": ["工作空间已就绪", "Workspace ready"],
  "launcher.update_available": ["发现可用更新", "Update available"],
  "launcher.update_check_failed": ["检查更新失败，可在关于页面重试", "Update check failed; retry from About"],
  "launcher.update_worker_started": ["安装更新已开始", "Update installation started"],
  "launcher.logs_exported": ["诊断日志已导出", "Diagnostic logs exported"],
  "browser.session_refresh_failed": ["登录状态刷新失败，请检查浏览器登录", "Session refresh failed; check browser sign-in"],
  "browser.tab_released": ["任务浏览器标签页已释放", "Task browser tab released"],
  "browser.idle_cleanup_failed": ["浏览器空闲清理失败", "Browser idle cleanup failed"],
  "codex.model_catalog_failed": ["模型列表检查失败，请运行健康检查", "Model catalog check failed; run health checks"],
  "codex.model_catalog_verified": ["模型列表检查通过", "Model catalog verified"],
  "runtime.operation_started": ["操作已开始", "Operation started"],
  "runtime.operation_completed": ["操作已完成", "Operation completed"],
  "runtime.operation_failed": ["操作失败，请查看详情", "Operation failed; inspect details"],
  "runtime.startup_failed": ["运行服务启动失败，请运行健康检查", "Runtime startup failed; run health checks"],
  "runtime.setup_required": ["运行环境需要配置", "Runtime setup required"],
  "runtime.external_owner_detected": ["检测到其他实例占用运行资源", "Runtime resource belongs to another instance"],
  "runtime.active_turns_cancelled": ["活动任务已取消", "Active turns cancelled"],
  "runtime.browser_turn_cancelled": ["网页请求已取消", "Browser turn cancelled"],
  "runtime.stdout": ["操作输出", "Operation output"],
  "runtime.stderr": ["操作诊断输出", "Operation diagnostic output"],
  "runtime.release_upgraded": ["运行环境已升级", "Runtime upgraded"],
  "dev_profile.ready": ["独立开发环境已就绪", "Isolated development environment ready"],
  "dev_profile.config_invalid": ["开发环境配置无效", "Development configuration invalid"],
  "dev_profile.runtime_start_failed": ["开发运行服务启动失败", "Development runtime failed to start"],
};

export function presentLog(record: LogRecord, language: Language) {
  const zh = language === "zh-CN";
  const labels = events[record.event];
  const title = labels?.[zh ? 0 : 1] ?? (zh ? "运行事件" : "Runtime event");
  // Log severity is not an operation result: informational records do not imply success.
  const status = record.level === "error" ? (zh ? "错误" : "Error")
    : record.level === "warning" ? (zh ? "警告" : "Warning")
    : record.level === "debug" ? (zh ? "调试" : "Debug") : (zh ? "信息" : "Info");
  const detail = Object.entries(record.detail ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
  return { title, status, detail, event: record.event };
}
