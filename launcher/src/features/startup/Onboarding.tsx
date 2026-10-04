import { useRef, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { Icon } from "../../components/icons";
import { copyFor } from "../../i18n";
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
    [working, setWorking] = useState<"repository" | "continue" | null>(null);
  const pending = useRef(false);
  const busy = working !== null;
  const t = translate(selected);
  const copy = copyFor(selected);
  async function run(action: "repository" | "continue") {
    if (pending.current) return;
    pending.current = true;
    setWorking(action);
    setError(null);
    try {
      const state = action === "repository"
        ? await api!.openRepository()
        : await api!.completeOnboarding(selected, "automatic");
      updateState(state);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      pending.current = false;
      setWorking(null);
    }
  }
  return (
    <main className="workspace-ui ui-page" lang={selected}>
      <header className="startup-titlebar draggable">
        {snapshot.profile === "development" && <span>Web2Harness DEV</span>}
      </header>
      <div className="onboarding">
        <div className="onboarding-brand"><BrandMark /><strong>Web2Harness</strong></div>
        <h1>{t("欢迎使用 Web2Harness", "Welcome to Web2Harness")}</h1>
        <p>
          {t(
            "将 ChatGPT 网页版模型接入你的 Codex 工作流。选择语言后，即可开始配置。",
            "Bring ChatGPT web models into your Codex workflow. Choose a language to begin setup.",
          )}
        </p>
        <Segment
          label={t("选择语言", "Choose language")}
          value={selected}
          onChange={setSelected}
          disabled={busy}
          options={[{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }]}
        />
        <section className="onboarding-support" aria-labelledby="support-title">
          <h2 id="support-title">{copy.supportTitle}</h2>
          <p>{copy.supportBody}</p>
          <button
            type="button"
            className="btn"
            disabled={busy || !snapshot.urls.github}
            onClick={() => void run("repository")}
          >
            <Icon name="github" />
            {working === "repository" ? t("正在打开…", "Opening…") : copy.star}
            <Icon name="external" />
          </button>
          {snapshot.state.githubOpened && (
            <p className="onboarding-repository-opened" role="status">
              {t(
                "仓库已打开。你可以在 GitHub 点亮 Star，再返回这里继续配置。",
                "Repository opened. You can leave a Star on GitHub, then return here to continue setup.",
              )}
            </p>
          )}
        </section>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run("continue")}
          >
            {working === "continue" ? t("请稍候", "Please wait")
              : snapshot.state.githubOpened ? t("继续配置", "Continue setup")
                : t("跳过，开始配置", "Skip and start setup")}
          </button>
        </div>
      </div>
    </main>
  );
}
