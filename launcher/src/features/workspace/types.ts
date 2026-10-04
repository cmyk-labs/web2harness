import type {
  BrowserState,
  LauncherApi,
  LauncherSnapshot,
  LauncherState,
  LogRecord,
  OperationState,
  WorkspaceStatus,
} from "../../types";

export type WorkspacePage =
  | "overview"
  | "browser"
  | "runtime-controls"
  | "connection"
  | "diagnostics"
  | "about"
  | "preferences";

export type Translate = (zh: string, en: string) => string;

export interface WorkspaceProps {
  api: LauncherApi;
  page: Exclude<WorkspacePage, "browser">;
  navigate: (page: WorkspacePage) => void;
  snapshot: LauncherSnapshot;
  browser: BrowserState | null;
  operation: OperationState | null;
  logs: LogRecord[];
  status: WorkspaceStatus | null;
  statusError: string | null;
  refresh: () => Promise<void>;
  updateState: (state: LauncherState) => void;
  setError: (error: string | null) => void;
  activateBrowser: (show?: boolean) => Promise<void>;
}
