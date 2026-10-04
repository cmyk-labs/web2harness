import { Section } from "../controls";
import type { Translate } from "../types";

export function OperatingDiagram({ t }: { t: Translate }) {
  return (
    <section className="operating-principle" aria-labelledby="operating-title">
      <Section title={t("工作原理", "How it works")} id="operating-title" />
      <figure className="operating-diagram">
        <figcaption>
          {t("一次 Web 模型任务的往返", "A round trip with a web model")}
        </figcaption>
        <div className="operating-route">
          <div className="operating-node">
            <strong>Codex</strong>
            <span>{t("发起任务 · 执行工具", "Start tasks · Run tools")}</span>
          </div>
          <div className="operating-connector">
            <span>{t("任务上下文", "Task context")} <i aria-hidden="true">→</i></span>
            <span><i aria-hidden="true">←</i> {t("工具请求 / 回答", "Tool requests / answers")}</span>
          </div>
          <div className="operating-node">
            <strong>Web2Harness</strong>
            <span>{t("组织上下文 · 转接请求", "Prepare context · Relay requests")}</span>
          </div>
          <div className="operating-connector">
            <span>{t("发送到网页", "Send to web")} <i aria-hidden="true">→</i></span>
            <span><i aria-hidden="true">←</i> {t("模型响应", "Model response")}</span>
          </div>
          <div className="operating-node">
            <strong>ChatGPT Web</strong>
            <span>{t("使用所选模型推理", "Reason with the selected model")}</span>
          </div>
        </div>
        <p className="operating-loop">
          {t(
            "需要工具时，Codex 执行后将结果送回模型，继续推理，直到完成任务。工具权限始终由 Codex 的沙箱与审批规则控制。",
            "When tools are needed, Codex executes them and returns their results to the model. This repeats until the task is complete. Codex sandbox and approval rules govern tool access.",
          )}
        </p>
      </figure>
      <dl className="operating-modes">
        {[
          [t("原生工具", "Native Tools"), t("解析网页中的结构化工具请求，交给 Codex 执行。", "Parse structured tool requests from the web response for Codex to execute.")],
          ["MCP Bridge", t("经连接器和隧道转交工具请求，仍由 Codex 执行。", "Relay tool requests through a connector and tunnel for Codex to execute.")],
          [t("仅浏览器", "Browser only"), t("只返回模型回答，不提供本地工具调用。", "Return model answers without local tool calls.")],
        ].map(([mode, description]) => (
          <div key={mode}><dt>{mode}</dt><dd>{description}</dd></div>
        ))}
      </dl>
    </section>
  );
}
