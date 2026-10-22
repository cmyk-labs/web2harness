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
import { useLicense } from "../licensing/LicenseContext";
import { PageNavigationContext, UnsavedChangesDialog, type NavigationGuardRef } from "./PageNavigationGuard";


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
  const { active: licensed } = useLicense();
  const [surface, setSurface] = useState<WorkspacePage>(licensed ? "overview" : "license");
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
  const [sidebarOpen, setSidebarOpen] = useState(snapshot.state.sidebarOpen);
  useEffect(() => setSidebarOpen(snapshot.state.sidebarOpen), [snapshot.state.sidebarOpen]);
  const [, refreshGuard] = useState(0);
  const navigationGuard = useRef<NavigationGuardRef>({ current: null }).current;
  navigationGuard.notify = () => refreshGuard(value => value + 1);
  const [pendingNavigation, setPendingNavigation] = useState<WorkspacePage | null>(null);
  const navigationTransaction = useRef<{ next: WorkspacePage; resolve: (allow: boolean) => void } | null>(null);
  const navigationSaving = useRef(false);
  const [savingNavigation, setSavingNavigation] = useState(false);
  const [browserPending, setBrowserPending] = useState(false);
  const commitNavigation = useCallback((next: WorkspacePage) => {
    setSurface(next);
    if (next === "browser") setBrowserPending(false);
  }, []);
  const requestNavigation = useCallback((next: WorkspacePage): Promise<boolean> => {
    if (navigationTransaction.current) return Promise.resolve(false);
    if (next === surface) { commitNavigation(next); return Promise.resolve(true); }
    const guard = navigationGuard.current;
    if (!guard?.dirty && !guard?.busy) { commitNavigation(next); return Promise.resolve(true); }
    return new Promise(resolve => {
      navigationTransaction.current = { next, resolve };
      setPendingNavigation(next);
    });
  }, [surface, navigationGuard, commitNavigation]);
  const resolveNavigation = async (action: "save" | "discard" | "continue") => {
    const transaction = navigationTransaction.current;
    const guard = navigationGuard.current;
    if (!transaction || navigationSaving.current || guard?.busy) return;
    let allowed = action === "discard";
    if (action === "save") {
      if (!guard?.canSave) return;
      navigationSaving.current = true; setSavingNavigation(true);
      try { allowed = await guard.save(); }
      catch (error) { setError(messageOf(error)); }
      finally { navigationSaving.current = false; setSavingNavigation(false); }
    } else if (action === "discard") guard?.discard();
    navigationTransaction.current = null;
    setPendingNavigation(null);
    if (allowed) commitNavigation(transaction.next);
    transaction.resolve(allowed);
  };
  const revealBrowserAutomatically = useCallback(() => {
    if (navigationGuard.current?.dirty || navigationGuard.current?.busy || navigationTransaction.current) {
      setBrowserPending(true);
      return;
    }
    commitNavigation("browser");
  }, [navigationGuard, commitNavigation]);
  const [browserSlot, setBrowserSlot] = useState<HTMLDivElement | null>(null);
  const browserSlotRef = useCallback(
    (node: HTMLDivElement | null) => setBrowserSlot(node),
    [],
  );
  const browserSurfaceActive =
    licensed && surface === "browser";
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
    if (!licensed || !selectedManualTab) return;
    revealBrowserAutomatically();
  }, [licensed, selectedManualTab?.id, selectedManualTab?.manualState, revealBrowserAutomatically]);
  const automaticTurn = browser?.tabs.find(
    (tab) =>
      tab.active &&
      tab.interactionMode !== "manual" &&
      tab.status === "running",
  );
  useEffect(() => {
    if (!selectedManualTab && !automaticTurn) setBrowserPending(false);
  }, [selectedManualTab?.id, automaticTurn?.id]);
  useEffect(() => {
    if (!licensed || !automaticTurn || !snapshot.state.showBrowserDuringTurns) return;
    revealBrowserAutomatically();
  }, [
    automaticTurn?.id,
    automaticTurn?.traceId,
    snapshot.state.showBrowserDuringTurns,
    licensed,
    revealBrowserAutomatically,
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
      if (!await requestNavigation("browser")) return;
      await api!.setBrowserSurfaceActive(true);
      if (show) await api!.showBrowser();
    },
    [requestNavigation],
  );
  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    void api!.setSidebarState({ open: next, width: snapshot.state.sidebarWidth }).then(updateState)
      .catch(error => { setSidebarOpen(snapshot.state.sidebarOpen); setError(messageOf(error)); });
  };
  const navigateSurface = (next: WorkspacePage) => {
    void requestNavigation(next);
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
    <PageNavigationContext.Provider value={navigationGuard}>
    <motion.main
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      className={`app-shell workspace-shell${sidebarOpen ? " is-sidebar-open" : ""}`}
    >
      <TitleBar
        copy={copy}
        platform={snapshot.platform}
        devProfile={devProfile}
        sidebarOpen={sidebarOpen}
        toggleSidebar={toggleSidebar}
      />
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
        {browserPending && surface !== "browser" && <div className="note" role="status">
          {language === "zh-CN" ? "浏览器中有任务，当前修改已保留。" : "A browser task is available. Your edits are preserved."}
          <button className="text-button" onClick={() => navigateSurface("browser")} type="button">{language === "zh-CN" ? "查看任务" : "View task"}</button>
        </div>}
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
              licensed && snapshot.startup.status !== "ready" ? (
                <div className="workspace-ui ui-page" />
              ) : (
                <fieldset className="browser-preview" disabled={!licensed}>
                <BrowserSurface
                  browser={licensed ? browser : null}
                  browserSlotRef={browserSlotRef}
                  copy={copy}
                  interactionMode={snapshot.state.browserInteractionMode}
                  operation={operation}
                  platform={snapshot.platform}
                  setError={setError}
                  previewNotice={!licensed ? (language === "zh-CN" ? "填写有效授权码后，即可登录 ChatGPT 并使用浏览器功能。" : "Activate a valid license to sign in to ChatGPT and use the browser.") : undefined}
                />
                </fieldset>
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
        {licensed && sessionReminderDue && (
          <SessionRefreshReminder
            busy={sessionReminderBusy}
            copy={copy}
            onDismiss={() => void dismissSessionReminder()}
            onLogout={() => void logoutChatGpt()}
          />
        )}
      </AnimatePresence>
      {pendingNavigation && <UnsavedChangesDialog language={language}
        busy={savingNavigation || navigationGuard.current?.busy === true}
        canSave={navigationGuard.current?.canSave === true}
        onSave={() => { void resolveNavigation("save"); }}
        onDiscard={() => { void resolveNavigation("discard"); }}
        onContinue={() => { void resolveNavigation("continue"); }} />}
    </motion.main>
    </PageNavigationContext.Provider>
  );
}
