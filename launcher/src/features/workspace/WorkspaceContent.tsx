import { useLimits } from "../limits/useLimits";
import { pageName, translate } from "./labels";
import { Connection } from "./pages/Connection";
import { About } from "./pages/About";
import { Diagnostics } from "./pages/Diagnostics";
import { Overview } from "./pages/Overview";
import { Preferences } from "./pages/Preferences";
import { RuntimeControls } from "./pages/RuntimeControls";
import type { WorkspaceProps } from "./types";
import "./workspace.css";

export function WorkspaceContent(props: WorkspaceProps) {
  const { page, snapshot, api } = props;
  const t = translate(snapshot.state.language ?? "en");
  const tracker = useLimits(
    api,
    snapshot.state.browserInteractionMode === "manual",
  );
  return (
    <div className={`workspace-ui ui-page page-${page}`}>
      <div
        role="region"
        aria-label={pageName(page, t)}
        tabIndex={0}
        className={`content content-scroll${page === "preferences" ? " is-narrow" : ""}`}
      >
        {props.statusError && (
          <div className="note warn" role="alert">
            {t("无法读取当前状态：", "Unable to read current status: ")}
            {props.statusError}
          </div>
        )}
        {page === "overview" && <Overview {...props} />}
        {page === "connection" && <Connection {...props} />}
        {page === "preferences" && <Preferences {...props} />}
        {page === "diagnostics" && <Diagnostics {...props} tracker={tracker} />}
        {page === "about" && <About {...props} />}
        {page === "runtime-controls" && <RuntimeControls {...props} />}
      </div>
    </div>
  );
}
