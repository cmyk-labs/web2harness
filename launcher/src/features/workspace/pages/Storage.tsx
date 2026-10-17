import { useEffect, useState } from "react";
import type { Language, LauncherApi, StorageUsage } from "../../../types";
import { translate } from "../labels";
import { Row, Section } from "../controls";
import { Button } from "../../../components/Buttons";

function size(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}
export function Storage({ api, language, busy }: { api: LauncherApi; language: Language; busy: boolean }) {
  const t = translate(language);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [working, setWorking] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let disposed = false;
    setWorking(true);
    api.storageUsage().then(value => { if (!disposed) setUsage(value); }, error => { if (!disposed) setError(String(error)); })
      .finally(() => { if (!disposed) setWorking(false); });
    return () => { disposed = true; };
  }, [api]);
  async function run(clear = false) {
    if (working || (clear && busy)) return;
    setWorking(true); setError(""); setNotice("");
    try {
      setUsage(await (clear ? api.clearCaches() : api.storageUsage()));
      if (clear) setNotice(t("网页资源和代码缓存已清理，登录状态与站点数据已保留。", "Web resources and code caches cleared. Sign-in and site data were preserved."));
    } catch (error) { setError(String(error)); }
    finally { setWorking(false); }
  }
  return <div aria-busy={working}>
    <Section title={t("本地存储", "Local storage")} meta={<Button disabled={working} onClick={() => void run()}>{t("刷新占用", "Refresh usage")}</Button>} />
    <p>{t("占用为估算值，缓存可能在浏览网页后重新生成。", "Sizes are estimates. Browsing can recreate caches.")}</p>
    {error && <div className="note warn" role="alert">{error}</div>}
    {usage && <>
      {([
        [t("已安装运行时", "Installed runtimes"), usage.runtimeBytes, t("自动保留当前版和一个回退版；使用中或恢复所需的版本额外保留。", "Keeps the current and one rollback version, plus versions still in use or needed for recovery.")],
        [t("网页资源缓存", "Web resource cache"), usage.httpCacheBytes],
        [t("代码缓存", "Code cache"), usage.codeCacheBytes],
        [t("保留的站点及浏览器数据", "Retained site and browser data"), usage.siteDataBytes, t("包含登录状态与站点数据，本次清理不会删除。", "Includes sign-in and site data; preserved during cleanup.")],
        [t("日志", "Logs"), usage.logBytes, t("自动轮转；每个日志目录最多保留 7 天、100 MiB 的已归档日志。", "Rotated automatically; archives are retained for up to 7 days and 100 MiB per log directory.")],
      ] as [string, number, string?][]).map(([title, bytes, description]) => <Row key={title} title={title} description={description}><span>{size(bytes)}</span></Row>)}
      <p>{t("最近测量：", "Last measured: ")}{new Date(usage.measuredAt).toLocaleString(language)}</p>
    </>}
    {working && <p role="status">{t("正在处理…", "Working…")}</p>}
    <div className="flex wrap" style={{ marginTop: 20 }}>
      <Button disabled={working || busy || !usage} onClick={() => void run(true)}>{t("清理缓存", "Clear caches")}</Button>
      <p>{t("任务空闲时可清理，不会退出登录。", "Clear caches when tasks are idle. You will stay signed in.")}</p>
    </div>
    {notice && <p role="status">{notice}</p>}
  </div>;
}
