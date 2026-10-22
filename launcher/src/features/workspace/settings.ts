import type { LauncherState } from "../../types";

// Pending values belong in settings forms, never in the active-runtime snapshot.
export function settingsForEditing(state: LauncherState): LauncherState {
  return { ...state, ...state.pendingSettings };
}
