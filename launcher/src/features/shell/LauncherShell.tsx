import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Copy } from "../../i18n";
import { api } from "../../ipc";
import { messageOf } from "../../lib/errors";
import type {
  BrowserState,
  Language,
  LauncherSnapshot,
  LauncherState,
  LogRecord,
  OperationState,
  WorkspaceStatus,
} from "../../types";
import { BrowserSurface } from "../browser/BrowserSurface";
import { SessionRefreshReminder } from "../browser/SessionRefreshReminder";
import type { WorkspacePage } from "../workspace/types";
import { WorkspaceContent } from "../workspace/WorkspaceContent";
import { WorkspaceSidebar } from "../workspace/WorkspaceSidebar";
import { TitleBar } from "./TitleBar";

const COMPACT_SIDEBAR_QUERY = "(max-width: 820px)";

export function LauncherShell({
  browser,
  copy,
  language,
  logs,
  operation,
  setError,
  snapshot,
  updateState,
}: {
  browser: BrowserState | null;
  copy: Copy;
  language: Language;
  logs: LogRecord[];
  operation: OperationState | null;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
}) {
  const [surface, setSurface] = useState<WorkspacePage>("overview");
  useEffect(() => () => { void api!.setBrowserSurfaceActive(false).catch(() => {}); }, []);
  const reducedMotion = useReducedMotion();
  const devProfile = snapshot.profile === "development";
  const [changingLanguage, setChangingLanguage] = useState(false);
  const languageChangePending = useRef(false);
  const changeLanguage = async (next: Language) => {
    if (languageChangePending.current || next === language) return;
    languageChangePending.current = true;
    setChangingLanguage(true);
    setError(null);
    try {
      updateState(await api!.setLanguage(next));
    } catch (error) {
      setError(messageOf(error));
    } finally {
      languageChangePending.current = false;
      setChangingLanguage(false);
    }
  };
  const compactAtMount = useRef(
    window.matchMedia(COMPACT_SIDEBAR_QUERY).matches,
  ).current;
  const [sidebarOpen, setSidebarOpen] = useState(!compactAtMount),
    [compactSidebar, setCompactSidebar] = useState(compactAtMount);
  const [browserSlot, setBrowserSlot] = useState<HTMLDivElement | null>(null);
  const browserSlotRef = useCallback(
    (node: HTMLDivElement | null) => setBrowserSlot(node),
    [],
  );
  const browserSurfaceActive =
    surface === "browser" && !(compactSidebar && sidebarOpen);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null),
    [statusError, setStatusError] = useState<string | null>(null);
  const [sessionReminderBusy, setSessionReminderBusy] = useState(false),
    [sessionReminderDue, setSessionReminderDue] = useState(false);
  const mounted = useRef(true),
    statusSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++statusSequence.current;
    try {
      const next = await api!.workspaceStatus();
      if (mounted.current && sequence === statusSequence.current) {
        setStatus(next);
        setStatusError(null);
      }
    } catch (error) {
      if (mounted.current && sequence === statusSequence.current) {
        setStatus(null);
        setStatusError(messageOf(error));
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    void refresh();
  }, [snapshot.state, snapshot.startup.status, operation?.status, refresh]);
  const selectedManualTab = browser?.tabs.find(
    (tab) => tab.active && tab.interactionMode === "manual",
  );
  useEffect(() => {
    if (!selectedManualTab) return;
    setSurface("browser");
    setSidebarOpen(false);
    void api!
      .setBrowserSurfaceActive(true)
      .catch((error) => setError(messageOf(error)));
  }, [selectedManualTab?.id, selectedManualTab?.manualState, setError]);
  const automaticTurn = browser?.tabs.find(
    (tab) =>
      tab.active &&
      tab.interactionMode !== "manual" &&
      tab.status === "running",
  );
  useEffect(() => {
    if (!automaticTurn || !snapshot.state.showBrowserDuringTurns) return;
    setSurface("browser");
    if (compactSidebar) setSidebarOpen(false);
  }, [
    automaticTurn?.id,
    automaticTurn?.traceId,
    snapshot.state.showBrowserDuringTurns,
    compactSidebar,
  ]);
  // Browser ownership, measurement and native surface behavior are retained unchanged.
  useLayoutEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let observer: ResizeObserver | null = null;

    const measure = () => {
      if (!browserSlot) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const rect = browserSlot.getBoundingClientRect();
        void api!
          .setBrowserBounds({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          })
          .catch((cause) => setError(messageOf(cause)));
      });
    };

    void api!
      .setBrowserSurfaceActive(browserSurfaceActive)
      .then(() => {
        if (cancelled || !browserSurfaceActive || !browserSlot) return;
        measure();
        observer = new ResizeObserver(measure);
        observer.observe(browserSlot);
        window.addEventListener("resize", measure);
      })
      .catch((cause) => setError(messageOf(cause)));

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [browserSlot, browserSurfaceActive, snapshot.startup.status, setError]);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    const apply = () => {
      setCompactSidebar(media.matches);
      setSidebarOpen(!media.matches);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const reminderAt = snapshot.state.sessionRefreshReminderAt;
    const reminderTime =
      reminderAt === null ? Number.NaN : Date.parse(reminderAt);
    if (browser?.authenticated !== true || !Number.isFinite(reminderTime)) {
      setSessionReminderDue(false);
      return;
    }
    const delay = reminderTime - Date.now();
    if (delay <= 0) {
      setSessionReminderDue(true);
      return;
    }
    setSessionReminderDue(false);
    const timer = window.setTimeout(() => setSessionReminderDue(true), delay);
    return () => window.clearTimeout(timer);
  }, [browser?.authenticated, snapshot.state.sessionRefreshReminderAt]);

  const activateBrowser = useCallback(
    async (show = false) => {
      setSurface("browser");
      if (compactSidebar) setSidebarOpen(false);
      await api!.setBrowserSurfaceActive(true);
      if (show) await api!.showBrowser();
    },
    [compactSidebar],
  );
  const toggleSidebar = () => {
    const next = !sidebarOpen;
    if (compactSidebar && next && surface === "browser") {
      void api!
        .setBrowserSurfaceActive(false)
        .then(() => setSidebarOpen(true))
        .catch((error) => setError(messageOf(error)));
      return;
    }
    setSidebarOpen(next);
  };
  const navigateSurface = (next: WorkspacePage) => {
    setSurface(next);
    if (compactSidebar) setSidebarOpen(false);
  };
  const dismissSessionReminder = async () => {
    setSessionReminderBusy(true);
    try {
      updateState(await api!.dismissSessionReminder());
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setSessionReminderBusy(false);
    }
  };
  const logoutChatGpt = async () => {
    setSessionReminderBusy(true);
    try {
      const result = await api!.logoutChatGpt();
      updateState(result.state);
      await activateBrowser();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setSessionReminderBusy(false);
    }
  };
  return (
    <motion.main
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      className={`app-shell workspace-shell${compactSidebar ? " is-compact" : ""}${sidebarOpen ? " is-sidebar-open" : ""}`}
    >
      <TitleBar
        copy={copy}
        devProfile={devProfile}
        draggable={surface !== "browser"}
        sidebarOpen={sidebarOpen}
        toggleSidebar={toggleSidebar}
      />
      {compactSidebar && sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={copy.hideSidebar}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <motion.aside
        id="workspace-sidebar"
        inert={!sidebarOpen}
        animate={{ width: sidebarOpen ? "var(--sidebar-width)" : 0 }}
        className="app-sidebar workspace-ui"
        initial={false}
        transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0, 0, 1] }}
      >
        <div className="sidebar-clip">
          <WorkspaceSidebar
            api={api!}
            setError={setError}
            onLanguageChange={(value) => void changeLanguage(value)}
            changingLanguage={changingLanguage}
            page={surface}
            navigate={navigateSurface}
            snapshot={snapshot}
            status={status}
            browser={browser}
            operation={operation}
          />
        </div>
      </motion.aside>
      <section className="workspace">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={surface}
            className="surface-transition"
            transition={{ duration: reducedMotion ? 0 : 0.12 }}
          >
            {surface === "browser" ? (
              snapshot.startup.status !== "ready" ? (
                <div className="workspace-ui ui-page" />
              ) : (
                <BrowserSurface
                  browser={browser}
                  browserSlotRef={browserSlotRef}
                  copy={copy}
                  interactionMode={snapshot.state.browserInteractionMode}
                  operation={operation}
                  platform={snapshot.platform}
                  setError={setError}
                />
              )
            ) : (
              <WorkspaceContent
                api={api!}
                page={surface}
                navigate={navigateSurface}
                snapshot={snapshot}
                browser={browser}
                operation={operation}
                logs={logs}
                status={status}
                statusError={statusError}
                refresh={refresh}
                updateState={updateState}
                setError={setError}
                activateBrowser={activateBrowser}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </section>
      <AnimatePresence>
        {sessionReminderDue && (
          <SessionRefreshReminder
            busy={sessionReminderBusy}
            copy={copy}
            onDismiss={() => void dismissSessionReminder()}
            onLogout={() => void logoutChatGpt()}
          />
        )}
      </AnimatePresence>
    </motion.main>
  );
}
