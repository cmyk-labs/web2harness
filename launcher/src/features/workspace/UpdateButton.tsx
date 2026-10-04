import { useState } from "react";
import { Icon } from "../../components/icons";
import { messageOf } from "../../lib/errors";
import { translate } from "./labels";
import { workspaceBusy } from "./status";
import type { WorkspaceProps } from "./types";

export function UpdateButton({
  api, snapshot, browser, operation, setError, sidebar = false,
}: Pick<WorkspaceProps, "api" | "snapshot" | "browser" | "operation" | "setError"> & { sidebar?: boolean }) {
  const [pending, setPending] = useState(false);
  const t = translate(snapshot.state.language ?? "en");
  const update = snapshot.update;
  if (update.status !== "available" && update.status !== "downloading" && update.status !== "installing") return null;
  const busy = workspaceBusy(browser, operation);
  const label = update.status === "downloading"
    ? t("正在下载更新…", "Downloading update…")
    : update.status === "installing" || pending
      ? t("正在安装更新…", "Installing update…")
      : `${t("更新至", "Update to")} v${update.version}`;
  const install = async () => {
    setPending(true);
    setError(null);
    try { await api.installUpdate(); }
    catch (error) { setError(messageOf(error)); }
    finally { setPending(false); }
  };
  return (
    <button
      type="button"
      className={sidebar ? "sidebar-update" : "btn"}
      disabled={pending || busy || snapshot.startup.status !== "ready" || update.status !== "available"}
      title={busy ? t("当前任务结束后即可更新", "Update when the current task finishes") : label}
      onClick={() => void install()}
    >
      {sidebar && <Icon name="update" />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
