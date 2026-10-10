import { useRef, useState } from "react";
import { EntryBrand } from "./EntryBrand";
import { api } from "../../ipc";
import { messageOf } from "../../lib/errors";
import type { Language, LauncherSnapshot, LauncherState } from "../../types";
import { Segment } from "../workspace/controls";
import { translate } from "../workspace/labels";
import "./onboarding.css";

export function Onboarding({
  language,
  setError,
  snapshot,
  updateState,
}: {
  language: Language;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
}) {
  const [selected, setSelected] = useState<Language>(language),
    [working, setWorking] = useState(false);
  const pending = useRef(false);
  const busy = working;
  const t = translate(selected);
  async function run() {
    if (pending.current) return;
    pending.current = true;
    setWorking(true);
    setError(null);
    try {
      const state = await api!.completeOnboarding(selected, "automatic");
      updateState(state);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }
  return (
    <main className="workspace-ui ui-page entry-screen welcome-screen" lang={selected}>
      <header className="startup-titlebar draggable">
        {snapshot.profile === "development" && <span>Web2Harness DEV</span>}
      </header>
      <div className="onboarding entry-content">
        <EntryBrand version={snapshot.version} />
        <h1>
          <span>{t("用 Web 模型推理。", "Reason with web models.")}</span>{" "}
          <span>{t("让 Codex 把事做完。", "Get it done in Codex.")}</span>
        </h1>
        <p>
          {t(
            "你的 ChatGPT 订阅。你的 Codex 工作流。让可用的 Web 模型参与更多实际任务。",
            "Your ChatGPT plan. Your Codex workflow. Put your available web models to work.",
          )}
        </p>
        <Segment
          label={t("选择语言", "Choose language")}
          value={selected}
          onChange={setSelected}
          disabled={busy}
          options={[{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }]}
        />
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run()}
          >
            {working ? t("请稍候", "Please wait") : t("继续配置", "Continue setup")}
          </button>
        </div>
      </div>
    </main>
  );
}
