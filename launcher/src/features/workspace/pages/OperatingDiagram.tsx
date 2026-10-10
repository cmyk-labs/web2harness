import type { Translate } from "../types";

export function OperatingDiagram({ t }: { t: Translate }) {
  return (
    <section className="operating-principle" aria-label={t("工作原理", "How it works")}>
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
            "需要工具时，Codex 执行后将结果送回模型，继续推理，直到完成任务。",
            "When tools are needed, Codex executes them and returns their results to the model. This repeats until the task is complete.",
          )}
        </p>
      </figure>
      <div className="operating-modes-scroll" role="region" aria-label={t("模式能力对比", "Tool mode comparison")} tabIndex={0}>
        <table className="operating-modes" aria-label={t("模式能力对比", "Tool mode comparison")}>
          <colgroup><col className="mode-name-column" /><col className="mode-capability-column" /><col className="mode-difference-column" /><col className="mode-advice-column" /></colgroup>
          <thead>
            <tr>
              <th scope="col">{t("模式", "Mode")}</th>
              <th scope="col">{t("执行能力", "Execution capabilities")}</th>
              <th scope="col">{t("与原生 Codex 的差异", "Differences from native Codex")}</th>
              <th scope="col">{t("使用建议", "When to use")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t("原生工具", "Native Tools")}<span className="mode-recommended">{t("推荐", "Recommended")}</span></th>
              <td>{t("使用当前 Codex 任务开放的工具，包括命令执行、文件读写、代码修改及 MCP／应用工具。", "Use the tools available in the current Codex task: commands, file access, code edits, and MCP or app tools.")}</td>
              <td>{t("保留原生工具和 Code Mode 代码编排设置，具体能力取决于当前任务。", "Preserves native tools and Code Mode settings. Available capabilities depend on the current task.")}</td>
              <td>{t("日常编程首选，无需连接器和隧道。", "Recommended for everyday coding. No connector or tunnel required.")}</td>
            </tr>
            <tr>
              <th scope="row">MCP Bridge</th>
              <td>{t("同样由 Codex 执行工具，提供常用工具快捷入口和通用调用入口。", "Codex still executes the tools, with shortcuts for common tools and a general tool-call interface.")}</td>
              <td>{t("增加工具封装；默认不继承原生 Code Mode 设置。自动模式可调用任务实际提供的 exec；手动模式不开放自由 JavaScript 编排入口。", "Adds tool wrappers without inheriting native Code Mode settings by default. Automatic mode can call exec when the task exposes it; manual mode does not expose arbitrary JavaScript orchestration.")}</td>
              <td>{t("需要连接器工作流或手动交互时选择。", "Use for connector workflows or manual interaction.")}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="operating-notes">
        <p><strong>{t("权限：", "Permissions: ")}</strong>{t("原生工具与 MCP Bridge 均沿用 Codex 当前任务的文件访问权限、沙箱及审批规则。", "Native Tools and MCP Bridge both follow the current Codex task’s file permissions, sandbox and approval rules.")}</p>
        <p><strong>{t("代码编排：", "Code orchestration: ")}</strong>{t("指用 JavaScript 组合多个工具并处理结果，与普通终端命令执行不同。", "Combining tools and processing their results with JavaScript, distinct from running ordinary terminal commands.")}</p>
      </div>
    </section>
  );
}
