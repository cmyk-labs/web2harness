import { IconButton } from "../../components/Buttons";
import { createPortal } from "react-dom";
import type { Copy } from "../../i18n";

export function TitleBar({
  copy,
  platform,
  devProfile,
  sidebarOpen,
  toggleSidebar,
}: {
  copy: Copy;
  platform: string;
  devProfile: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}) {
  // Window controls and the shared drag region stay anchored to the viewport.
  return createPortal(
    <header data-platform={platform} className="app-titlebar draggable">
      <div className="titlebar-left no-drag">
        <IconButton
          icon="sidebar"
          expanded={sidebarOpen}
          controls="workspace-sidebar"
          label={sidebarOpen ? copy.hideSidebar : copy.showSidebar}
          onClick={toggleSidebar}
        />
        {devProfile && !sidebarOpen ? (
          <span className="titlebar-dev-profile">{copy.devBadge}</span>
        ) : null}
      </div>
    </header>, document.getElementById("root")!,
  );
}
