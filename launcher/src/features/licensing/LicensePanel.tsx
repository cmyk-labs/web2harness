import { useEffect, useId, useRef, useState } from "react";
import type { LicenseState, LicenseStatus } from "../../../../src/licensing/schema";
import type { Language, LauncherApi } from "../../types";
import { EntryBrand } from "../startup/EntryBrand";
import "./license.css";

export function licenseLabel(state: LicenseState, zh: boolean): string {
  const names: Record<LicenseState, [string, string]> = {
    active: ["已激活", "Activated"], missing: ["请输入授权码", "Enter your license"],
    expired: ["授权已到期，请导入新授权", "License expired. Import a renewed license"],
    invalid: ["授权码无效", "Invalid license"], "wrong-device": ["授权码与此设备不匹配", "License belongs to another device"],
    "clock-error": ["系统时间异常，请校准后重试", "Check your system clock and retry"],
    "device-unavailable": ["无法读取设备码", "Device identity unavailable"],
    unconfigured: ["授权公钥未配置，请联系发行方", "Signing public key missing. Contact the publisher"],
    "storage-error": ["无法读取或保存授权", "Unable to read or save the license"],
  };
  return names[state][zh ? 0 : 1];
}

export function LicensePanel({ api, language, status, onStatus, activation = false, version, devProfile = false, loadError, onRetry }: {
  api: LauncherApi; language: Language; status: LicenseStatus | null;
  onStatus: (status: LicenseStatus) => void; activation?: boolean; version?: string; devProfile?: boolean; loadError?: string | null; onRetry?: () => void;
}) {
  const zh = language === "zh-CN";
  const t = (cn: string, en: string) => zh ? cn : en;
  const id = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<"saved" | "copied" | "copy-manually" | null>(null);
  const [failure, setFailure] = useState<LicenseState | "request" | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const renewButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const pending = useRef(false);
  const active = status?.state === "active";
  const showEditor = activation || !active || editing;
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (restoreFocus.current) { renewButton.current?.focus(); restoreFocus.current = false; }
  }, [editing]);
  const finishEditing = () => {
    setCode(""); setFailure(null); restoreFocus.current = true; setEditing(false);
  };
  const importCode = async () => {
    if (pending.current || !code.trim()) return;
    pending.current = true;
    setBusy(true); setFeedback(null); setFailure(null);
    try {
      const next = await api.importLicense(code.trim());
      if (next.state === "active") { onStatus(next); finishEditing(); setFeedback("saved"); }
      else setFailure(next.state);
    } catch { setFailure("request"); }
    finally { pending.current = false; setBusy(false); }
  };
  const errorMessage = failure === "request" ? t("无法验证授权，请重试", "Unable to verify the license. Please retry")
    : failure ? licenseLabel(failure, zh) : loadError ? t("无法读取授权状态，请重试。", "Unable to read the license status. Please retry.") : "";
  return <section className={`license-panel${activation ? " license-activation entry-content" : ""}`} aria-label={t("产品授权", "Product license")}>
    {activation && <EntryBrand version={version} devProfile={devProfile} />}
    <h1>{activation ? t("激活 Web2Harness", "Activate Web2Harness") : t("产品授权", "Product license")}</h1>
    {(activation || !active) && <p className="license-muted">{t("将设备码提供给发行方，然后填入收到的授权码。", "Send your device code to the publisher, then enter the license you receive.")}</p>}
    <div className="license-summary" role="status">
      <strong className={active ? "license-active" : undefined}>{status ? licenseLabel(status.state, zh) : loadError ? t("读取授权失败", "Unable to load license") : t("正在检查授权…", "Checking license…")}</strong>
      {active && <span>{t("有效期：", "Valid until: ")}{status.expiresAt === null ? t("永久", "Perpetual") : new Date(status.expiresAt!).toLocaleString(zh ? "zh-CN" : "en-US")}</span>}
    </div>
    <div className="license-field">
      <div className="license-field-heading">
        <label htmlFor={`${id}-device`}>{t("设备码", "Device code")}</label>
        <div className="license-actions">
          <button className="btn" disabled={!status?.deviceCode} onClick={() => {
            void navigator.clipboard.writeText(status!.deviceCode!).then(() => setFeedback("copied"), () => setFeedback("copy-manually"));
          }}>{t("复制设备码", "Copy device code")}</button>
          {onRetry && <button className="btn" onClick={onRetry} disabled={busy}>{t("重新检查", "Check again")}</button>}
        </div>
      </div>
      <textarea id={`${id}-device`} rows={2} readOnly value={status?.deviceCode || ""} spellCheck={false} />
    </div>
    {active && !activation && !editing && <button ref={renewButton} className="btn" onClick={() => { setFeedback(null); setEditing(true); }}>{t("更新授权", "Update license")}</button>}
    {showEditor && <form id={`${id}-editor`} onSubmit={event => { event.preventDefault(); void importCode(); }}>
      <div className="license-field"><label htmlFor={`${id}-code`}>{t("授权码", "License")}</label><textarea id={`${id}-code`} ref={input} rows={4} value={code} maxLength={8192} onChange={event => setCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="W2H1.…" /></div>
      <div className="license-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>{busy ? t("验证中…", "Verifying…") : activation ? t("激活并继续", "Activate and continue") : t("更新授权", "Update license")}</button>
        {active && !activation && <button type="button" className="btn" disabled={busy} onClick={finishEditing}>{t("取消", "Cancel")}</button>}
      </div>
    </form>}
    {errorMessage && <p role="alert" className="license-feedback is-error">{errorMessage}</p>}
    {feedback && <p role="status" className="license-feedback">{feedback === "saved" ? t("授权已保存", "License saved") : feedback === "copied" ? t("设备码已复制", "Device code copied") : t("请手动复制设备码", "Copy the device code manually")}</p>}
  </section>;
}
