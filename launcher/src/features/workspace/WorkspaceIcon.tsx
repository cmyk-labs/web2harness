import { Icon, type IconName } from "../../components/icons";

const workspaceIcons: Record<string, IconName> = {
  overview: "activity",
  browser: "browser",
  "runtime-controls": "controls",
  connection: "setup",
  diagnostics: "logs",
  preferences: "settings",
  about: "info",
  arrow: "chevron",
  terminal: "activity",
};

export function WorkspaceIcon({ name }: { name: string }) {
  return <Icon name={workspaceIcons[name] ?? "info"} />;
}
