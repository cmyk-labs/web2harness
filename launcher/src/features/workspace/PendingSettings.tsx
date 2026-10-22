import { useState } from "react";
import { Button } from "../../components/Buttons";
import { useLicense } from "../licensing/LicenseContext";
import { translate } from "./labels";
import { workspaceBusy } from "./status";
import type { WorkspaceProps } from "./types";

export function PendingSettings({ p, disabled = false }: { p: WorkspaceProps; disabled?: boolean }) {
  const { active } = useLicense();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const t = translate(p.snapshot.state.language ?? "en");
  if (!Object.keys(p.snapshot.state.pendingSettings ?? {}).length) return null;
  const ready = active && p.snapshot.startup.status === "ready" && p.snapshot.state.coreSetupComplete;
  return <div className="note" role="status">
    <p>{!active ? t("设置已保存。激活授权并完成连接配置后，可应用到任务。", "Settings saved. Activate your license and configure the connection to apply them to tasks.")
      : !ready ? t("设置已保存。完成连接配置后可应用。", "Settings saved. Configure the connection to apply them.")
      : t("有已保存的设置尚未应用，请在任务空闲时应用。", "Saved settings are waiting to be applied. Apply them when tasks are idle.")}</p>
    <Button disabled={!ready || disabled || working || workspaceBusy(p.browser, p.operation)} onClick={() => {
      setWorking(true); setError("");
      void p.api.applyPendingSettings().then(state => { p.updateState(state); return p.refresh(); })
        .catch(reason => { setError(String(reason)); void p.refresh(); }).finally(() => setWorking(false));
    }}>{working ? t("应用中…", "Applying…") : t("应用已保存设置", "Apply saved settings")}</Button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
