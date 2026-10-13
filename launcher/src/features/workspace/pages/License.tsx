import { LicensePanel } from "../../licensing/LicensePanel";
import { useLicense } from "../../licensing/LicenseContext";
import type { WorkspaceProps } from "../types";

export function License({ api, snapshot }: WorkspaceProps) {
  const { status, accept, error, refresh } = useLicense();
  return <LicensePanel api={api} status={status} onStatus={accept} language={snapshot.state.language || "en"} loadError={error} onRetry={refresh} />;
}
