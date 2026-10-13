import { useLimits } from "../limits/useLimits";
import { pageName, translate } from "./labels";
import { Connection } from "./pages/Connection";
import { About } from "./pages/About";
import { License } from "./pages/License";
import { Diagnostics } from "./pages/Diagnostics";
import { Overview } from "./pages/Overview";
import { Preferences } from "./pages/Preferences";
import { RuntimeControls } from "./pages/RuntimeControls";
import type { WorkspaceProps } from "./types";
import "./workspace.css";
import { useLicense } from "../licensing/LicenseContext";

export function WorkspaceContent(props: WorkspaceProps) {
  const { page, snapshot, api } = props;
  const { active: licensed } = useLicense();
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
        {!licensed && page !== "license" && page !== "overview" && <div className="note" role="status">
          {t("当前仅供查看，填写有效授权码后可使用功能。", "View only. Activate a valid license to use these features.")}
        </div>}
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
        {page === "license" && <License {...props} />}
        {page === "runtime-controls" && <RuntimeControls {...props} />}
      </div>
    </div>
  );
}
