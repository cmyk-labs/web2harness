import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LicenseStatus } from "../../../../src/licensing/schema";
import type { LauncherApi } from "../../types";

interface LicenseContextValue {
  status: LicenseStatus | null;
  active: boolean;
  error: string | null;
  refresh: () => void;
  accept: (status: LicenseStatus) => void;
}
const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ api, children }: { api: LauncherApi; children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const accept = useCallback((next: LicenseStatus) => {
    revision.current++;
    setError(null);
    setStatus(next);
  }, []);
  const refresh = useCallback(() => {
    const request = ++revision.current;
    void api.licenseStatus().then(next => {
      if (request === revision.current) { setStatus(next); setError(null); }
    }, () => {
      if (request === revision.current) { setStatus(null); setError("unavailable"); }
    });
  }, [api]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { revision.current++; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refresh]);
  useEffect(() => {
    if (status?.state !== "active" || status.expiresAt === null || !status.expiresAt) return;
    const delay = Date.parse(status.expiresAt) - Date.now();
    const timer = setTimeout(() => {
      if (delay <= 2_147_483_647) {
        revision.current++;
        setStatus(current => current === status ? { ...current, state: "expired" } : current);
      }
      refresh();
    }, Math.max(0, Math.min(delay, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [status, refresh]);
  const active = status?.state === "active"
    && (status.expiresAt === null || (typeof status.expiresAt === "string" && Date.parse(status.expiresAt) > Date.now()));
  return <LicenseContext.Provider value={{ status, active, error, refresh, accept }}>{children}</LicenseContext.Provider>;
}

export function useLicense() {
  const value = useContext(LicenseContext);
  if (!value) throw new Error("LicenseProvider is required");
  return value;
}
