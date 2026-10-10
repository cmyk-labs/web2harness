import { useEffect, useState } from "react";
import type { LicenseStatus } from "../../../../../src/licensing/schema";
import { LicensePanel } from "../../licensing/LicensePanel";
import type { WorkspaceProps } from "../types";

export function License({ api, snapshot }: WorkspaceProps) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void api.licenseStatus().then(setStatus, () => setError("unavailable")); };
  useEffect(refresh, [api]);
  return <LicensePanel api={api} status={status} onStatus={setStatus} language={snapshot.state.language || "en"} loadError={error} onRetry={refresh} />;
}
