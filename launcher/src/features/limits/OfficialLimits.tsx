import { useState } from "react";
import policy from "../../../electron/limits/limits-policy.json";
import { translate } from "../workspace/labels";

export function OfficialLimits({ language }: { language: "en" | "zh-CN" }) {
  const t = translate(language);
  // Browsing policy never changes the identified account, route or ledger.
  const [tier, setTier] = useState("other");
  const [view, setView] = useState(policy.defaultView);
  const rules = policy.rules.filter(rule => rule.plan === tier && (rule.view === "all" || rule.view === view));
  const modelLabels: Record<string, string> = { "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-5.6-pro": "GPT-5.6 Sol Pro", "gpt-6-sol": "GPT-6", "gpt-6-pro": "GPT-6 Pro", "shared-pro": t("两种 Pro 模型共享", "Both Pro models combined") };
  const models = ["gpt-5.6-sol", "gpt-5.6-pro", "gpt-6-sol", "gpt-6-pro", ...(rules.some(rule => rule.model === "shared-pro") ? ["shared-pro"] : [])];
  return <div className="card official-limits">
    <h3>{t("模型限额参考", "Model allowance references")}</h3>
    <div className="official-filters">
      <label className="official-plan"><span>{t("套餐", "Plan reference")}</span>
        <select value={tier} onChange={event => setTier(event.target.value)}>
          <option value="other">{t("选择套餐", "Choose a plan")}</option>
          <option value="pro_100">Pro $100</option><option value="pro_200">Pro $200</option><option value="pro_500">Pro $500</option>
          <option value="business_standard">Business Standard</option><option value="business_premium">Business Premium</option>
        </select></label>
      {tier === "pro_200" && <label className="official-plan"><span>{t("参考时期", "Reference period")}</span>
        <select value={view} onChange={event => setView(event.target.value)}>
          <option value="future">{t("2026-10-30 起参考", "Reference from 2026-10-30")}</option>
          <option value="prior">{t("此前历史参考", "Earlier historical reference")}</option>
        </select></label>}
    </div>
    <div className="usage-table-scroll"><table className="usage-table">
      <thead><tr><th>{t("模型", "Model")}</th><th>{t("周期", "Period")}</th><th>{t("次数参考", "Reference count")}</th></tr></thead>
      <tbody>{models.map(model => { const rule = rules.find(item => item.model === model); return <tr key={model} className={model === "shared-pro" ? "usage-shared" : undefined}>
        <td>{modelLabels[model]}</td><td>{rule ? ({ day: t("每日", "Daily"), week: t("每周", "Weekly"), month: t("每月", "Monthly") } as Record<string, string>)[rule.period] : "-"}</td>
        <td>{rule ? rule.count : "-"}</td>
      </tr>; })}</tbody></table></div>
    <p className="usage-footnote">{t("核对日期", "Checked")} · {policy.checkedOn} · {t("仅供参考", "For reference only")}</p>
  </div>;
}
