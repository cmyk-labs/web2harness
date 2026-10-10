import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorToast } from "./components/ErrorToast";
import { FatalMessage } from "./components/FatalMessage";
import { LauncherShell } from "./features/shell/LauncherShell";
import { Onboarding } from "./features/startup/Onboarding";
import { StartupScreen } from "./features/startup/StartupScreen";
import { copyFor } from "./i18n";
import { api as launcherApi } from "./ipc";
import { LicensePanel } from "./features/licensing/LicensePanel";
import type { LicenseStatus } from "../../src/licensing/schema";
import { messageOf } from "./lib/errors";
import type {
  BrowserState,
  Language,
  LauncherSnapshot,
  LauncherState,
  LogRecord,
  OperationState,
  StartupState,
} from "./types";

export function App() {
  const api = launcherApi;
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const licenseRevision = useRef(0);
  const acceptLicense = useCallback((status: LicenseStatus) => {
    licenseRevision.current++;
    setLicenseError(null);
    setLicense(status);
  }, []);
  const refreshLicense = useCallback(() => {
    if (!api) return;
    setLicenseError(null);
    const revision = ++licenseRevision.current;
    void api.licenseStatus().then(status => {
      if (revision === licenseRevision.current) setLicense(status);
    }, () => {
      if (revision === licenseRevision.current) { setLicense(null); setLicenseError("unavailable"); }
    });
  }, [api]);
  useEffect(() => {
    refreshLicense();
    const interval = setInterval(refreshLicense, 60_000);
    window.addEventListener("focus", refreshLicense);
    return () => { clearInterval(interval); window.removeEventListener("focus", refreshLicense); };
  }, [refreshLicense]);
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [snapshotFailure, setSnapshotFailure] = useState<string | null>(null);
  const retrySnapshot = useRef<() => Promise<void>>(async () => {});
  const systemLanguage: Language = navigator.language
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en";
  const documentLanguage = snapshot?.state.language ?? systemLanguage;

  useEffect(() => {
    document.documentElement.lang = documentLanguage;
  }, [documentLanguage]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let latestStartup: LauncherSnapshot["startup"] | undefined;
    let snapshotRequest = 0;
    const refreshSnapshot = () => {
      const request = ++snapshotRequest;
      setSnapshotFailure(null);
      return api
        .snapshot()
        .then((next) => {
          if (cancelled || request !== snapshotRequest) return;
          setSnapshot(
            latestStartup ? { ...next, startup: latestStartup } : next,
          );
          setBrowser(next.browser);
          setLogs(next.logs);
          setOperation(next.operation);
          if (
            next.operation?.status === "failed" &&
            next.operation.name !== "mcp-verification"
          ) {
            setError(next.operation.message);
          }
        })
        .catch((cause) => {
          if (!cancelled && request === snapshotRequest)
            setSnapshotFailure(messageOf(cause));
        });
    };
    retrySnapshot.current = refreshSnapshot;
    const unsubscribeStartup = api.onStartupState((startup) => {
      latestStartup = startup;
      // Enter the workspace only with its initialized snapshot, not a preparing snapshot
      // carrying a newer ready event. This also keeps first-run onboarding out of preparation.
      if (startup.status === "ready") void refreshSnapshot();
      else
        setSnapshot((current) => (current ? { ...current, startup } : current));
    });
    void refreshSnapshot();
    const unsubscribeState = api.onStateChanged((state) => {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              state,
              smokePassed:
                current.smokePassed ||
                (state.browserSmokePassed === true &&
                  state.browserSmokeVersion === current.version),
            }
          : current,
      );
    });
    const unsubscribeBrowser = api.onBrowserState(setBrowser);
    const unsubscribeOperation = api.onOperation((next) => {
      setOperation(next);
      if (next.status === "failed" && next.name !== "mcp-verification")
        setError(next.message);
    });
    const unsubscribeLog = api.onLog((record) =>
      setLogs((current) => [...current.slice(-299), record]),
    );
    const unsubscribeUpdate = api.onUpdateState((update) => {
      setSnapshot((current) => (current ? { ...current, update } : current));
    });
    return () => {
      cancelled = true;
      unsubscribeStartup();
      unsubscribeState();
      unsubscribeBrowser();
      unsubscribeOperation();
      unsubscribeLog();
      unsubscribeUpdate();
    };
  }, []);

  const updateState = useCallback((state: LauncherState) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            state,
            smokePassed:
              current.smokePassed ||
              (state.browserSmokePassed === true &&
                state.browserSmokeVersion === current.version),
          }
        : current,
    );
  }, []);

  if (!api) return <FatalMessage message="Launcher IPC is unavailable." />;
  const language = snapshot?.state.language ?? systemLanguage;
  const copy = copyFor(language);
  const startupState: StartupState = snapshotFailure
    ? {
        status: "failed",
        stage: "loading-shell",
        elapsedMs: 0,
        message: snapshotFailure,
      }
    : (snapshot?.startup ?? {
        status: "preparing",
        stage: "loading-shell",
        elapsedMs: 0,
      });

  if (license?.state !== "active") {
    return <div className="app-root license-gate entry-screen" data-theme="dark" data-language={language} data-platform={snapshot?.platform}>
      <LicensePanel api={api} language={language} status={license} onStatus={acceptLicense} activation version={snapshot?.version} devProfile={snapshot?.profile === "development"} loadError={licenseError} onRetry={refreshLicense} />
    </div>;
  }

  if (!snapshot || startupState.status !== "ready") {
    return (
      <div
        className="app-root"
        data-language={language}
        data-platform={snapshot?.platform}
        data-profile={snapshot?.profile}
        data-theme="dark"
      >
        <StartupScreen
          version={snapshot?.version}
          state={startupState}
          language={language}
          devProfile={snapshot?.profile === "development"}
          retry={
            snapshotFailure
              ? () => retrySnapshot.current()
              : () => api.retryStartup()
          }
          retryLabel={
            snapshotFailure
              ? language === "zh-CN"
                ? "重试"
                : "Retry"
              : undefined
          }
          exportLogs={() => api.exportLogs()}
        />
      </div>
    );
  }

  return (
    <div
      className="app-root"
      data-language={language}
      data-platform={snapshot.platform}
      data-profile={snapshot.profile}
      data-theme="dark"
    >
      <AnimatePresence mode="wait">
        {!snapshot.state.onboardingComplete ? (
          <Onboarding
            key="onboarding"
            language={language}
            setError={setError}
            snapshot={snapshot}
            updateState={updateState}
          />
        ) : (
          <LauncherShell
            browser={browser}
            copy={copy}
            key="launcher"
            language={language}
            logs={logs}
            operation={operation}
            setError={setError}
            snapshot={snapshot}
            updateState={updateState}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {error ? (
          <ErrorToast
            copy={copy}
            message={error}
            onDismiss={() => setError(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
