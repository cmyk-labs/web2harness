import { IconButton } from "../../components/Buttons";
import type { Copy } from "../../i18n";

export function TitleBar({
  copy,
  devProfile,
  draggable,
  sidebarOpen,
  toggleSidebar,
}: {
  copy: Copy;
  devProfile: boolean;
  draggable: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}) {
  return (
    <header className={`app-titlebar${draggable ? " draggable" : ""}`}>
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
    </header>
  );
}
