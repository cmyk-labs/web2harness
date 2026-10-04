import { copyFor, localizeRuntimeMessage } from "../../i18n";
import type { DoctorReport, Language } from "../../types";
import { translate } from "./labels";

export function Report({
  report,
  language,
}: {
  report: DoctorReport;
  language: Language;
}) {
  const copy = copyFor(language);
  const t = translate(language);
  const titles: Record<string, string> = {
    "dev-profile": t("开发环境配置", "Development configuration"),
    config: t("应用配置", "Application configuration"),
    "dev-tunnel-credentials": t("MCP 隧道凭据", "MCP tunnel credentials"),
    "dev-tunnel-runtime": t("MCP 隧道连接", "MCP tunnel connection"),
    "responses-listener": t("本地连接服务", "Local connection service"),
    proxy: t("本地连接服务", "Local connection service"),
    runtime: t("运行环境", "Runtime environment"),
    "local-runtime": t("本地运行环境", "Local runtime"),
    "browser-host": t("内嵌浏览器连接", "Embedded browser connection"),
    chrome: t("浏览器程序", "Browser application"),
    login: t("ChatGPT 登录状态", "ChatGPT sign-in"),
    codex: t("Codex 模型连接", "Codex model connection"),
    route: t("Codex 模型路由", "Codex model route"),
    service: t("后台服务", "Background service"),
    "tunnel-binary": t("MCP 隧道组件", "MCP tunnel component"),
    "tunnel-key": t("MCP 隧道凭据", "MCP tunnel credentials"),
    "tunnel-service": t("MCP 隧道服务", "MCP tunnel service"),
    "tunnel-runtime": t("MCP 隧道连接", "MCP tunnel connection"),
    connector: t("ChatGPT 连接器", "ChatGPT connector"),
    tools: t("工具执行模式", "Tool execution mode"),
  };
  return (
    <div className="panel" style={{ marginTop: 16 }} role="status">
      {report.checks.map((check, i) => {
        const notRequired = check.status === "ok"
          && check.id === "dev-tunnel-credentials"
          && check.message === "This mode does not require an MCP tunnel";
        const status = check.status === "error" ? t("未通过", "Failed")
          : check.status === "warning" ? t("需注意", "Needs attention")
          : notRequired ? t("无需使用", "Not required") : t("通过", "Passed");
        const tone = check.status === "error" ? "error"
          : check.status === "warning" || notRequired ? "neutral" : "success";
        return (
          <div className="row doctor-check" key={`${check.id}-${i}`}>
            <div className="doctor-check-content">
              <h3>{Object.hasOwn(titles, check.id) ? titles[check.id] : t("其他检查", "Additional check")}</h3>
              <p>
                {check.status === "ok"
                  ? localizeRuntimeMessage(
                      copy,
                      check.message,
                      check.id,
                      language,
                    )
                  : check.message}
              </p>
              <details className="doctor-check-details">
                <summary>{t("技术详情", "Technical details")}</summary>
                <code>{check.id}</code>
                <code>{check.message}</code>
                {check.detail && <code>{check.detail}</code>}
              </details>
            </div>
            <span className={`doctor-check-status status-${tone}`}>
              {status}
            </span>
          </div>
        );
      })}
    </div>
  );
}
