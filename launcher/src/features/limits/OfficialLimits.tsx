import { useState } from "react";
import policy from "../../../electron/limits/limits-policy.json";
import { Button } from "../../components/Buttons";
import { translate } from "../workspace/labels";
import type { LimitsApi, LimitsSnapshot } from "./limits-types";

export function OfficialLimits({ language, api, plan }: {
  language: "en" | "zh-CN"; api: LimitsApi; plan: LimitsSnapshot["plan"];
}) {
  const t = translate(language);
  const [selection, setSelection] = useState<string | null>(null);
  const tier = selection ?? (plan === "pro_100" || plan === "pro_200" ? plan : "other");
  const hasProReference = tier === "pro_100" || tier === "pro_200";
  const unspecified = t("未公开固定次数", "No fixed count published");
  const shared = t("两种 Pro 模型共享", "Both Pro models combined");
  const rows: [string, string, string][] = tier === "pro_200" ? [
    ["GPT-6 Pro", t("每周", "Weekly"), `${policy.pro_200.gpt6Weekly} ${t("（通知转录）", "(notice transcript)")}`],
    ["GPT-5.6 Sol Pro", t("每日", "Daily"), `${policy.pro_200.solDaily} ${t("（沿用参考）", "(prior reference)")}`],
    [shared, t("每日", "Daily"), `${policy.pro_200.combinedDaily} ${t("（沿用参考）", "(prior reference)")}`],
    ["GPT-5.6 Sol", "—", unspecified],
  ] : tier === "pro_100" ? [
    [shared, t("每周", "Weekly"), String(policy.pro_100.combinedWeekly)],
    ["GPT-5.6 Sol", "—", unspecified],
  ] : tier === "business_standard" || tier === "business_premium" ? [
    [shared, tier === "business_standard" ? t("每月", "Monthly") : t("每周", "Weekly"),
      String(tier === "business_standard" ? policy.business.standardMonthly : policy.business.premiumWeekly)],
    ["GPT-5.6 Sol · Thinking", "—", unspecified],
  ] : [
    ["GPT-6 Pro", "—", unspecified],
    ["GPT-5.6 Sol Pro", "—", unspecified],
    ["GPT-5.6 Sol / Luna", "—", unspecified],
  ];
  const source = tier.startsWith("business") ? policy.sources.business
    : hasProReference ? policy.sources.publishedModels : policy.sources.models;
  return <div className="card official-limits">
    <h3>{t("官方公开对话上限", "Official published conversation limits")}</h3>
    <div className="note">
      <strong>{t("官方周期未确认", "Official usage period unconfirmed")}</strong>
      <p>{t("尚未取得此账户的模型周期起止时间，以下仅为公开上限参考。", "This account’s model-period boundaries are unavailable. The table below lists published policy references only.")}</p>
    </div>
    <label className="official-plan">
      <span>{t("套餐参考", "Plan reference")}</span>
      <select value={tier} onChange={event => setSelection(event.target.value)}>
        <option value="other">{t("其他／未识别套餐", "Other / unidentified plan")}</option>
        <option value="pro_100">Pro $100</option>
        <option value="pro_200">Pro $200</option>
        <option value="pro_500">Pro $500</option>
        <option value="business_standard">Business Standard</option>
        <option value="business_premium">Business Premium</option>
      </select>
    </label>
    {tier === "pro_200" && <p><strong>{t(`${policy.pro_200.effectiveFrom} 起参考`, `Reference from ${policy.pro_200.effectiveFrom}`)}</strong></p>}
    <div className="usage-table-scroll">
      <table className="usage-table">
        <thead><tr><th>{t("模型", "Model")}</th><th>{t("周期", "Period")}</th><th>{t("公开上限（参考）", "Published limit (reference)")}</th></tr></thead>
        <tbody>{rows.map(([model, period, count]) => <tr key={model}><td>{model}</td><td>{period}</td><td>{count}</td></tr>)}</tbody>
      </table>
    </div>
    <p>{tier === "pro_200"
      ? t(`100 次/周来自订阅者公开转录的 OpenAI 通知，尚未独立核验原始邮件。每日两项沿用最近明确公开值，${policy.pro_200.effectiveFrom} 后是否继续适用待确认。实际以 ChatGPT 提示为准。`, `100/week comes from subscribers’ public transcripts of an OpenAI notice; the original email has not been independently verified. Both daily values retain the latest explicit published references; applicability after ${policy.pro_200.effectiveFrom} is unconfirmed. Check ChatGPT for your actual limits.`)
      : tier === "pro_100"
        ? t("两种 Pro 模型共享此公开上限，切换模型不会增加额度。当前账户适用上限以 ChatGPT 提示为准。", "Both Pro models share this published allowance; switching models does not increase it. Check ChatGPT for your account’s applicable limits.")
      : tier === "pro_500"
        ? t("Pro $500 的固定次数尚未查到官方明确说明。", "No explicit official message count was found for Pro $500.")
      : tier.startsWith("business")
        ? t("Pro 上限由 GPT-6 Pro 与 GPT-5.6 Sol Pro 共享。", "GPT-6 Pro and GPT-5.6 Sol Pro share the Pro allowance.")
        : t("模型是否可用取决于套餐。Free / Go 日常文本对话不限次，思考与工具另有上限。", "Model availability depends on your plan. Free / Go everyday text chats are unlimited; thinking and tools have separate limits.")}</p>
    <div className="note">{t("本地统计使用滚动窗口，不能据此计算官方剩余次数或重置时间。", "Local rolling counts cannot determine official remaining usage or reset times.")}</div>
    <p className="muted">{t("核对日期", "Checked on")} · {policy.checkedOn}</p>
    <div className="actions">
      {tier === "pro_200" && <Button onClick={() => void api.openExternal(policy.sources.pro200Notice)}>{t("订阅通知（转录）", "Subscriber notice (transcript)")}</Button>}
      <Button onClick={() => void api.openExternal(source)}>{hasProReference ? t("数字出处", "Published counts") : t("官方说明", "Official source")}</Button>
      {tier.startsWith("pro_") && <Button onClick={() => void api.openExternal(policy.sources.pro)}>{t("Pro 套餐说明", "Pro plan details")}</Button>}
    </div>
  </div>;
}
