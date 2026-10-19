import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { expandUserPath } from "../config";
import { processRunning } from "../runtime/process";
import { diagnosticError, diagnosticEvent } from "../diagnostics";
import { validateRuntimeParameters, type RuntimeParameters } from "../../launcher/shared/runtime-parameters.cjs";
import { OPERATION_STAGE_TIMEOUTS, type OperationStage } from "../../launcher/shared/operation-stages.cjs";

export const LAUNCHER_BROWSER_HOST_KIND = "web2harness-launcher";
export const LAUNCHER_BROWSER_IDLE_URL = "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ECodex%20Web%20GPT%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E#web2harness-browser-host";
export type LauncherBrowserHostProfile = "production" | "development";

export class LauncherBrowserTurnCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherBrowserTurnCancelledError";
  }
}

export class LauncherRetainedConversationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherRetainedConversationUnavailableError";
  }
}

export class LauncherManualTurnTimedOutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherManualTurnTimedOutError";
  }
}

export class LauncherManualTurnFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherManualTurnFailedError";
  }
}

export interface LauncherBrowserHostDescriptor {
  version: 3;
  kind: typeof LAUNCHER_BROWSER_HOST_KIND;
  profile: LauncherBrowserHostProfile;
  pid: number;
  endpoint: string;
  control: {
    endpoint: string;
    token: string;
  };
  helper: {
    executable: string;
    script: string;
  };
  partition: string;
  idleUrl: string;
  surfaceId: string;
  surfaceTargets: Record<string, string>;
  createdAt: string;
  runtimeParameters?: RuntimeParameters;
  language?: "en" | "zh-CN";
}

export interface LauncherBrowserConnection {
  descriptor: LauncherBrowserHostDescriptor;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

function assertLoopbackEndpoint(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing`);
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error(`${label} is not a valid URL`); }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error(`${label} must use http://127.0.0.1`);
  }
  if (!parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must contain only a loopback host and explicit port`);
  }
  return parsed.origin;
}

function assertDescriptorShape(value: unknown): LauncherBrowserHostDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Launcher browser descriptor is not an object");
  }
  const descriptor = value as Partial<LauncherBrowserHostDescriptor>;
  if (descriptor.version !== 3 || descriptor.kind !== LAUNCHER_BROWSER_HOST_KIND) {
    throw new Error("Launcher browser descriptor has an unsupported identity or version; restart the updated launcher");
  }
  if (descriptor.profile !== "production" && descriptor.profile !== "development") {
    throw new Error("Launcher browser descriptor has an invalid profile");
  }
  if (!Number.isInteger(descriptor.pid) || descriptor.pid! < 1) {
    throw new Error("Launcher browser descriptor has an invalid pid");
  }
  const endpoint = assertLoopbackEndpoint(descriptor.endpoint, "Launcher CDP endpoint");
  if (!descriptor.control || typeof descriptor.control !== "object") {
    throw new Error("Launcher browser descriptor is missing its control channel");
  }
  const controlEndpoint = assertLoopbackEndpoint(descriptor.control.endpoint, "Launcher control endpoint");
  if (typeof descriptor.control.token !== "string" || !/^[A-Za-z0-9_-]{40,}$/.test(descriptor.control.token)) {
    throw new Error("Launcher browser descriptor has an invalid control token");
  }
  if (!descriptor.helper || typeof descriptor.helper !== "object") {
    throw new Error("Launcher browser descriptor is missing its Node helper command");
  }
  const helperExecutable = typeof descriptor.helper.executable === "string" ? resolve(descriptor.helper.executable) : "";
  const helperScript = typeof descriptor.helper.script === "string" ? resolve(descriptor.helper.script) : "";
  if (!helperExecutable || !existsSync(helperExecutable)) {
    throw new Error("Launcher browser descriptor helper executable does not exist");
  }
  if (!helperScript || !existsSync(helperScript)) {
    throw new Error("Launcher browser descriptor helper script does not exist");
  }
  const expectedPartition = descriptor.profile === "development"
    ? "persist:web2harness-dev-chatgpt"
    : "persist:web2harness-chatgpt";
  if (descriptor.partition !== expectedPartition) {
    throw new Error("Launcher browser descriptor identifies an unexpected browser partition");
  }
  if (descriptor.idleUrl !== LAUNCHER_BROWSER_IDLE_URL) {
    throw new Error("Launcher browser descriptor identifies an unexpected idle surface");
  }
  if (typeof descriptor.surfaceId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(descriptor.surfaceId)) {
    throw new Error("Launcher browser descriptor has an invalid owned surface id");
  }
  const targets = descriptor.surfaceTargets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)
    || Object.entries(targets).some(([surface, target]) => !/^[A-Za-z0-9_-]{32}$/.test(surface)
      || typeof target !== "string" || !target.trim())
    || new Set(Object.values(targets)).size !== Object.keys(targets).length) {
    throw new Error("Launcher browser descriptor has invalid or duplicated surface targets");
  }
  if (typeof descriptor.createdAt !== "string" || Number.isNaN(Date.parse(descriptor.createdAt))) {
    throw new Error("Launcher browser descriptor has an invalid creation time");
  }
  return {
    version: 3,
    kind: LAUNCHER_BROWSER_HOST_KIND,
    profile: descriptor.profile,
    pid: descriptor.pid!,
    endpoint,
    control: { endpoint: controlEndpoint, token: descriptor.control.token },
    helper: { executable: helperExecutable, script: helperScript },
    partition: descriptor.partition,
    idleUrl: descriptor.idleUrl,
    surfaceId: descriptor.surfaceId,
    surfaceTargets: targets,
    createdAt: descriptor.createdAt,
    ...(descriptor.language === "zh-CN" || descriptor.language === "en" ? { language: descriptor.language } : {}),
    ...(descriptor.runtimeParameters === undefined ? {} : { runtimeParameters: validateRuntimeParameters(descriptor.runtimeParameters) }),
  };
}

export function readLauncherBrowserHostDescriptor(configuredPath: string): LauncherBrowserHostDescriptor {
  const path = resolve(expandUserPath(configuredPath));
  if (!existsSync(path)) throw new Error(`Launcher browser host is unavailable: descriptor is missing at ${path}`);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Launcher browser descriptor is not a regular file: ${path}`);
  if (process.platform !== "win32") {
    if ((stat.mode & 0o077) !== 0) throw new Error(`Launcher browser descriptor has unsafe permissions: ${path}`);
    const getuid = process.getuid;
    if (typeof getuid === "function" && stat.uid !== getuid()) {
      throw new Error(`Launcher browser descriptor is not owned by the current user: ${path}`);
    }
  }
  let decoded: unknown;
  try { decoded = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    throw new Error(`Launcher browser descriptor is invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const descriptor = assertDescriptorShape(decoded);
  if (!processRunning(descriptor.pid)) {
    throw new Error(`Launcher browser host process is not running (pid ${descriptor.pid})`);
  }
  return descriptor;
}

async function assertCdpReady(descriptor: LauncherBrowserHostDescriptor, timeoutMs: number, abortSignal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  abortSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${descriptor.endpoint}/json/version`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.webSocketDebuggerUrl !== "string" || !body.webSocketDebuggerUrl.startsWith("ws://127.0.0.1:")) {
      throw new Error("CDP metadata did not expose a loopback WebSocket endpoint");
    }
  } catch (error) {
    if (abortSignal?.aborted) throw new DOMException("Launcher browser connection aborted", "AbortError");
    throw new Error(`Launcher browser CDP endpoint is not ready: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", onAbort);
  }
}

async function launcherNativeStage<T>(
  label: string, action: () => Promise<T>, timeoutMs: number,
  abortSignal?: AbortSignal, retireLate?: (value: T) => Promise<unknown>,
): Promise<T> {
  if (abortSignal?.aborted) throw new DOMException("Launcher browser connection aborted", "AbortError");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let abandoned = false;
  const pending = action();
  void pending.then(value => {
    if (abandoned) void retireLate?.(value).catch(() => {});
  }, () => {});
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      onAbort = () => { abandoned = true; reject(new DOMException("Launcher browser connection aborted", "AbortError")); };
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        abandoned = true;
        reject(new Error(`Launcher browser ${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (abortSignal?.aborted) onAbort();
    })]);
  } finally {
    clearTimeout(timer);
    if (onAbort) abortSignal?.removeEventListener("abort", onAbort);
  }
}

export async function inspectLauncherBrowserHostLiveness(
  descriptorPath: string,
  options: {
    expectedProfile?: LauncherBrowserHostProfile;
    timeoutMs?: number;
  } = {},
): Promise<LauncherBrowserHostDescriptor> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  if (options.expectedProfile && descriptor.profile !== options.expectedProfile) {
    throw new Error(
      `Launcher browser belongs to ${descriptor.profile}, but ${options.expectedProfile} was required`,
    );
  }
  await assertCdpReady(descriptor, options.timeoutMs ?? 5_000);
  return descriptor;
}

export async function selectLauncherPage(
  browser: Browser,
  descriptor: LauncherBrowserHostDescriptor,
  timeoutMs: number,
  surfaceId = descriptor.surfaceId,
  abortSignal?: AbortSignal,
): Promise<{ context: BrowserContext; page: Page }> {
  if (abortSignal?.aborted) {
    throw new DOMException("Launcher browser connection aborted", "AbortError");
  }
  const targetId = descriptor.surfaceTargets[surfaceId];
  if (!targetId) throw new Error("Launcher browser surface is no longer registered with its native target");
  const deadline = Date.now() + timeoutMs;
  do {
    if (abortSignal?.aborted) {
      throw new DOMException("Launcher browser connection aborted", "AbortError");
    }
    const candidates = browser.contexts().flatMap(context => context.pages().map(page => ({ context, page })));
    // Target metadata belongs to the browser process. Evaluating every page here makes an
    // unrelated busy/paused renderer block acquisition of an already-responsive owned page.
    const inspected = await Promise.all(candidates.map(async candidate => {
      const session = await launcherNativeStage("CDP session creation", () => candidate.context.newCDPSession(candidate.page),
        OPERATION_STAGE_TIMEOUTS.inspection, abortSignal,
        late => launcherNativeStage("late CDP detach", () => late.detach(), OPERATION_STAGE_TIMEOUTS.inspection)).catch(() => undefined);
      if (!session) return { ...candidate, targetId: undefined };
      try {
        const { targetInfo } = await launcherNativeStage("target inspection", () => session.send("Target.getTargetInfo"),
          OPERATION_STAGE_TIMEOUTS.inspection, abortSignal);
        return { ...candidate, targetId: targetInfo.targetId };
      } catch {
        return { ...candidate, targetId: undefined };
      } finally {
        await launcherNativeStage("CDP detach", () => session.detach(), OPERATION_STAGE_TIMEOUTS.inspection).catch(() => {});
      }
    }));
    if (abortSignal?.aborted) throw new DOMException("Launcher browser connection aborted", "AbortError");
    const owned = inspected.filter(candidate => candidate.targetId === targetId);
    if (owned.length === 1) {
      return { context: owned[0].context, page: owned[0].page };
    }
    if (owned.length > 1) {
      throw new Error(`Launcher browser host exposed ${owned.length} surfaces with the same ownership id`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error("Launcher browser host did not expose its owned browser surface");
}

export async function connectLauncherBrowserHost(
  descriptorPath: string,
  timeoutMs = OPERATION_STAGE_TIMEOUTS.connection,
  surfaceId?: string,
  abortSignal?: AbortSignal,
): Promise<LauncherBrowserConnection> {
  if (abortSignal?.aborted) {
    throw new DOMException("Launcher browser connection aborted", "AbortError");
  }
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  await assertCdpReady(descriptor, timeoutMs, abortSignal);
  let browser: Browser;
  try {
    browser = await launcherNativeStage("CDP connection", () => chromium.connectOverCDP(descriptor.endpoint, { timeout: timeoutMs }),
      timeoutMs, abortSignal, late => launcherNativeStage("late browser cleanup", () => late.close(), OPERATION_STAGE_TIMEOUTS.cleanup));
  } catch (error) {
    if (abortSignal?.aborted) throw new DOMException("Launcher browser connection aborted", "AbortError");
    throw new Error(`Could not connect Playwright to the launcher browser: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const closeOnAbort = () => { void launcherNativeStage("browser cleanup", () => browser.close(), OPERATION_STAGE_TIMEOUTS.cleanup).catch(() => {}); };
  abortSignal?.addEventListener("abort", closeOnAbort, { once: true });
  try {
    if (abortSignal?.aborted) {
      throw new DOMException("Launcher browser connection aborted", "AbortError");
    }
    const { context, page } = await selectLauncherPage(
      browser,
      descriptor,
      timeoutMs,
      surfaceId,
      abortSignal,
    );
    return { descriptor, browser, context, page };
  } catch (error) {
    await launcherNativeStage("browser cleanup", () => browser.close(), OPERATION_STAGE_TIMEOUTS.cleanup).catch(() => {});
    throw error;
  } finally {
    abortSignal?.removeEventListener("abort", closeOnAbort);
  }
}

export async function inspectLauncherBrowserHost(
  descriptorPath: string,
  options: {
    detectCapabilities?: boolean;
    expectedProfile?: LauncherBrowserHostProfile;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
    onStage?: (stage: OperationStage) => void;
  } = {},
): Promise<{ solAvailable?: boolean; extraHighAvailable?: boolean; proAvailable?: boolean; url: string }> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  if (options.expectedProfile && descriptor.profile !== options.expectedProfile) {
    throw new Error(
      `Launcher browser belongs to ${descriptor.profile}, but ${options.expectedProfile} was required`,
    );
  }
  if (options.abortSignal?.aborted) throw new DOMException("Session inspection aborted", "AbortError");
  const controller = new AbortController();
  let timedOut = false;
  let lostOwner = false;
  let stage: OperationStage = "connection";
  let timeoutMs = options.timeoutMs ?? OPERATION_STAGE_TIMEOUTS.connection;
  let timer: ReturnType<typeof setTimeout>;
  const armStage = (nextStage: OperationStage) => {
    clearTimeout(timer);
    stage = nextStage;
    if (stage !== "running") {
      timeoutMs = options.timeoutMs ?? OPERATION_STAGE_TIMEOUTS[stage];
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    }
    options.onStage?.(stage);
  };
  const onAbort = () => controller.abort();
  options.abortSignal?.addEventListener("abort", onAbort, { once: true });
  const ownerProbe = setInterval(() => {
    if (!processRunning(descriptor.pid)) { lostOwner = true; controller.abort(); }
  }, 1_000);
  try {
    armStage("connection");
    const response = await fetch(`${descriptor.control.endpoint}/v1/session/inspect`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.control.token}`,
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify({ detectCapabilities: options.detectCapabilities === true }),
      signal: controller.signal,
    });
    let body: Record<string, unknown> = {};
    if (response.ok && response.headers.get("content-type")?.includes("application/x-ndjson")) {
      armStage("running");
      if (!response.body) throw new Error("Launcher inspection stream is missing");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let sequence = 0;
      let finished = false;
      try {
        while (!finished) {
          const { done, value } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          let newline;
          while ((newline = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            const message = JSON.parse(line) as Record<string, unknown>;
            if (message.type === "stage") {
              if (message.sequence !== ++sequence || typeof message.stage !== "string"
                || !["running", "startup", "connection", "controls", "inspection", "cleanup", "page-load"].includes(message.stage)) {
                throw new Error("Launcher inspection stage ownership is invalid");
              }
              // The host and worker enforce their own primitive deadlines. These
              // records describe progress, not a second enclosing client timer.
            } else if (message.type === "result" && message.value && typeof message.value === "object") {
              body = message.value as Record<string, unknown>;
              finished = true;
              break;
            } else if (message.type === "error" && typeof message.message === "string") {
              throw new Error(message.message);
            } else throw new Error("Launcher inspection stream is invalid");
          }
          if (pending.length > 64 * 1024) throw new Error("Launcher inspection message is too large");
          if (done && !finished) throw new Error("Launcher inspection ended without a result");
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } else {
      armStage("inspection");
      body = await response.json().catch(() => ({})) as Record<string, unknown>;
    }
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
    if (body.authenticated !== true || body.temporary !== true || typeof body.url !== "string") {
      throw new Error("Launcher returned invalid ChatGPT session evidence");
    }
    if (options.detectCapabilities
      && (typeof body.solAvailable !== "boolean" || typeof body.extraHighAvailable !== "boolean" || typeof body.proAvailable !== "boolean")) {
      throw new Error("Launcher did not return complete ChatGPT account capability evidence");
    }
    if (options.detectCapabilities && (body.proAvailable === true || body.extraHighAvailable === true) && body.solAvailable !== true) {
      throw new Error("Launcher returned contradictory ChatGPT account capability evidence");
    }
    return {
      url: body.url,
      ...(options.detectCapabilities ? {
        solAvailable: body.solAvailable as boolean,
        extraHighAvailable: body.extraHighAvailable as boolean,
        proAvailable: body.proAvailable as boolean,
      } : {}),
    };
  } catch (error) {
    if (options.abortSignal?.aborted) throw new DOMException("Session inspection aborted", "AbortError");
    const detail = timedOut
      ? `session inspection timed out after ${timeoutMs}ms (${stage} stage)`
      : lostOwner ? "launcher browser host process exited during inspection"
        : error instanceof Error ? error.message : String(error);
    throw new Error(`Launcher ChatGPT session could not be verified: ${detail}`, { cause: error });
  } finally {
    clearTimeout(timer!);
    clearInterval(ownerProbe);
    options.abortSignal?.removeEventListener("abort", onAbort);
  }
}

// A single inspection budget, not a cap on a multi-stage session/capability flow.
export const LAUNCHER_SESSION_INSPECTION_TIMEOUT_MS = OPERATION_STAGE_TIMEOUTS.inspection;
export const LAUNCHER_CAPABILITY_INSPECTION_TIMEOUT_MS = OPERATION_STAGE_TIMEOUTS.inspection;

export type LauncherTurnActivity =
  | {
      phase: "conversation";
      traceId: string;
      helperPid: number;
      conversationId: string;
      named?: boolean;
    }
  | {
      phase: "usage";
      traceId: string;
      helperPid: number;
      receipt?: import("../../launcher/shared/usage-receipts.cjs").UsageReceipt;
      trackingError?: "account-unavailable";
    }
  | {
      phase: "start";
      traceId: string;
      helperPid: number;
      conversationKey?: string;
      connectorIdentity?: string;
      requireRetainedConversation?: boolean;
      savedChat?: import("../../launcher/shared/saved-chat.cjs").SavedChatTask;
    }
  | {
      phase: "heartbeat";
      traceId: string;
      helperPid: number;
      /** Re-establish the launcher's hidden viewport after the caller closes its CDP session. */
      refreshViewport?: boolean;
    }
  | {
      phase: "end";
      traceId: string;
      helperPid: number;
      status: "completed" | "failed" | "aborted";
      message?: string;
      retain?: boolean;
      connectorBound?: boolean;
      awaitingToolResults?: boolean;
      failureCode?: "browser_stream_inconsistent";
    };

// Startup must outlast the launcher's ten-second idle bootstrap. This is not a model-turn budget.
export const LAUNCHER_TURN_START_TIMEOUT_MS = 30_000;
export const LAUNCHER_TURN_HEARTBEAT_INTERVAL_MS = 10_000;
export const LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS = 5_000;
export const LAUNCHER_TURN_END_TIMEOUT_MS = 15_000;

export interface LauncherManualTurnOwner {
  traceId: string;
  helperPid: number;
}

export interface LauncherManualTurnStart extends LauncherManualTurnOwner {
  prompt: string;
  /** Used only when the exact retained ChatGPT conversation already owns the accumulated history. */
  resumePrompt?: string;
  conversationKey?: string;
  /** Gives a manual context handoff enough time without widening ordinary Zero Risk turns. */
  compaction?: true;
}

export interface LauncherManualTurnLease {
  tabId: string;
  reused: boolean;
  deadlineAt: string | null;
  state: "awaiting-user" | "sent" | "running" | "completed";
}

export interface LauncherManualTurnEnd extends LauncherManualTurnOwner {
  status: "completed" | "failed" | "aborted";
  retain?: boolean;
  awaitingToolResults?: boolean;
}

export interface LauncherManualTurnTerminal {
  status: "cancelled" | "failed";
}

export const LAUNCHER_MANUAL_TURN_START_TIMEOUT_MS = 10_000;
export const LAUNCHER_MANUAL_SENT_REQUEST_TIMEOUT_MS = 40_000;
export const LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS = 15_000;

async function launcherManualRequest(
  descriptor: LauncherBrowserHostDescriptor,
  action: "start" | "wait-sent" | "wait-terminal" | "started" | "end" | "cancel" | "request-finish",
  body: LauncherManualTurnStart | LauncherManualTurnOwner | LauncherManualTurnEnd,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  abortSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(`${descriptor.control.endpoint}/v1/manual/${action}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.control.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const decoded = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body: decoded };
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", abort);
  }
}

async function reconcileLauncherManualMutation(
  descriptor: LauncherBrowserHostDescriptor,
  action: "start" | "started" | "end",
  body: LauncherManualTurnStart | LauncherManualTurnOwner | LauncherManualTurnEnd,
  timeoutMs: number,
  validAcknowledgement: (body: Record<string, unknown>) => boolean,
  invalidAcknowledgementMessage: string,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  let ambiguousError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await launcherManualRequest(descriptor, action, body, timeoutMs);
      if (!result.response.ok || validAcknowledgement(result.body)) return result;
      ambiguousError = new LauncherManualTurnFailedError(invalidAcknowledgementMessage);
    } catch (error) {
      ambiguousError = error;
    }
  }
  // These mutations are keyed by the exact turn owner and are idempotent in the launcher.
  // The second identical request reconciles one missing or incomplete local acknowledgement.
  throw ambiguousError;
}

function isLauncherManualTurnLease(body: Record<string, unknown>): boolean {
  return body.ok === true
    && typeof body.tabId === "string"
    && body.tabId.length > 0
    && typeof body.reused === "boolean"
    && (body.deadlineAt === null
      || (typeof body.deadlineAt === "string" && !Number.isNaN(Date.parse(body.deadlineAt))))
    && ["awaiting-user", "sent", "running", "completed"].includes(String(body.state));
}

function throwManualControlError(response: Response, body: Record<string, unknown>): never {
  const message = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
  if (body.code === "turn_cancelled") throw new LauncherBrowserTurnCancelledError(message);
  if (body.code === "manual_turn_timed_out") throw new LauncherManualTurnTimedOutError(message);
  throw new LauncherManualTurnFailedError(message);
}

export async function startLauncherManualTurn(
  descriptorPath: string,
  activity: LauncherManualTurnStart,
  timeoutMs = LAUNCHER_MANUAL_TURN_START_TIMEOUT_MS,
): Promise<LauncherManualTurnLease> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await reconcileLauncherManualMutation(
    descriptor,
    "start",
    activity,
    timeoutMs,
    isLauncherManualTurnLease,
    "Launcher returned an invalid manual turn lease",
  );
  if (!response.ok) throwManualControlError(response, body);
  return {
    tabId: body.tabId as string,
    reused: body.reused as boolean,
    deadlineAt: body.deadlineAt as string | null,
    state: body.state as LauncherManualTurnLease["state"],
  };
}

export async function waitForLauncherManualSent(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  options: { abortSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ sentAt: string | null }> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const timeoutMs = options.timeoutMs ?? LAUNCHER_MANUAL_SENT_REQUEST_TIMEOUT_MS;
  for (;;) {
    if (options.abortSignal?.aborted) throw new DOMException("Manual Sent wait aborted", "AbortError");
    const { response, body } = await launcherManualRequest(
      descriptor,
      "wait-sent",
      owner,
      timeoutMs,
      options.abortSignal,
    );
    if (response.status === 202 && body.status === "pending") continue;
    if (!response.ok) throwManualControlError(response, body);
    if (body.status !== "sent"
      || (body.sentAt !== null && (typeof body.sentAt !== "string" || Number.isNaN(Date.parse(body.sentAt))))) {
      throw new LauncherManualTurnFailedError("Launcher returned invalid manual Sent confirmation");
    }
    return { sentAt: body.sentAt as string | null };
  }
}

export async function markLauncherManualTurnStarted(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  timeoutMs = LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS,
): Promise<void> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await reconcileLauncherManualMutation(
    descriptor,
    "started",
    owner,
    timeoutMs,
    body => body.ok === true,
    "Launcher returned an invalid manual started acknowledgement",
  );
  if (!response.ok) throwManualControlError(response, body);
}

export async function waitForLauncherManualTerminal(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  options: { abortSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<LauncherManualTurnTerminal> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const timeoutMs = options.timeoutMs ?? LAUNCHER_MANUAL_SENT_REQUEST_TIMEOUT_MS;
  for (;;) {
    if (options.abortSignal?.aborted) throw new DOMException("Manual terminal wait aborted", "AbortError");
    const { response, body } = await launcherManualRequest(
      descriptor,
      "wait-terminal",
      owner,
      timeoutMs,
      options.abortSignal,
    );
    if (response.status === 202 && body.status === "pending") continue;
    if (!response.ok) throwManualControlError(response, body);
    if (body.status !== "cancelled" && body.status !== "failed") {
      throw new LauncherManualTurnFailedError("Launcher returned an invalid manual terminal signal");
    }
    return { status: body.status };
  }
}

export async function endLauncherManualTurn(
  descriptorPath: string,
  activity: LauncherManualTurnEnd,
  timeoutMs = LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS,
): Promise<{ cancelledByUser: boolean }> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await reconcileLauncherManualMutation(
    descriptor,
    "end",
    activity,
    timeoutMs,
    body => body.ok === true && typeof body.cancelledByUser === "boolean",
    "Launcher returned an invalid manual turn release result",
  );
  if (!response.ok) throwManualControlError(response, body);
  return { cancelledByUser: body.cancelledByUser as boolean };
}

export async function cancelLauncherManualTurn(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  timeoutMs = LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS,
): Promise<void> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await launcherManualRequest(descriptor, "cancel", owner, timeoutMs);
  if (!response.ok) throwManualControlError(response, body);
}

export async function notifyLauncherTurn(
  descriptorPath: string,
  activity: LauncherTurnActivity,
  timeoutMs = activity.phase === "end"
    ? LAUNCHER_TURN_END_TIMEOUT_MS
    : activity.phase === "heartbeat"
      ? LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS
      : LAUNCHER_TURN_START_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<{
  surfaceId?: string;
  reused?: boolean;
  connectorBound?: boolean;
  cancelledByUser?: boolean;
  authenticationRequired?: boolean;
  trackUsage?: boolean;
  expectedConversationId?: string;
  conversationTitle?: string;
  usageStatus?: "recorded" | "duplicate" | "gap-recorded";
}> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${descriptor.control.endpoint}/v1/turn/${activity.phase}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.control.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(activity),
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.status === 409 && body.code === "turn_cancelled") {
        throw new LauncherBrowserTurnCancelledError(
          typeof body.error === "string" ? body.error : `Browser turn ${activity.traceId} was cancelled by the user`,
        );
      }
      if (response.status === 409 && body.code === "retained_conversation_unavailable") {
        throw new LauncherRetainedConversationUnavailableError(
          typeof body.error === "string" ? body.error : "The retained ChatGPT conversation is no longer available",
        );
      }
      const detail = typeof body.error === "string" ? body.error : "";
      throw Object.assign(new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`), { status: response.status });
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (activity.phase === "usage") {
      if (!["recorded", "duplicate", "gap-recorded"].includes(String(body.status))) throw new Error("Usage receipt was not acknowledged: " + String(body.reason ?? body.status));
      return { usageStatus: body.status as "recorded" | "duplicate" | "gap-recorded" };
    }
    if (activity.phase === "start") {
      if (typeof body.surfaceId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(body.surfaceId)) {
        throw new Error("Launcher browser control channel returned an invalid turn surface id");
      }
      if (typeof body.reused !== "boolean") {
        throw new Error("Launcher browser control channel returned an invalid reuse state");
      }
      if (typeof body.connectorBound !== "boolean") {
        throw new Error("Launcher browser control channel returned an invalid connector state");
      }
      if (body.expectedConversationId !== undefined
        && (typeof body.expectedConversationId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(body.expectedConversationId))) {
        throw new Error("Launcher returned an invalid saved conversation identity");
      }
      return {
        surfaceId: body.surfaceId,
        reused: body.reused,
        connectorBound: body.connectorBound,
        trackUsage: body.trackUsage === true,
        ...(typeof body.expectedConversationId === "string" ? { expectedConversationId: body.expectedConversationId } : {}),
      };
    }
    if (activity.phase === "end") {
      if (typeof body.cancelledByUser !== "boolean") {
        throw new Error("Launcher browser control channel returned an invalid turn release result");
      }
      if (body.authenticationRequired !== undefined && typeof body.authenticationRequired !== "boolean") {
        throw new Error("Launcher browser control channel returned an invalid authentication state");
      }
      return {
        cancelledByUser: body.cancelledByUser,
        ...(body.authenticationRequired === true ? { authenticationRequired: true } : {}),
      };
    }
    if (activity.phase === "conversation") {
      if (body.conversationTitle !== undefined
        && (typeof body.conversationTitle !== "string" || body.conversationTitle.length > 220
          || /[\u0000-\u001f\u007f]/.test(body.conversationTitle))) {
        throw new Error("Launcher returned an invalid conversation title");
      }
      return typeof body.conversationTitle === "string" ? { conversationTitle: body.conversationTitle } : {};
    }
    return {};
  } catch (error) {
    const failure = signal?.aborted
      ? Object.assign(new DOMException("Launcher browser acquisition cancelled", "AbortError"), { cause: error })
      : controller.signal.aborted
        ? new Error(`Launcher browser control ${activity.phase} timed out after ${timeoutMs}ms`, { cause: error })
        : error instanceof LauncherBrowserTurnCancelledError || error instanceof LauncherRetainedConversationUnavailableError
          ? error
          : new Error(`Launcher browser control channel failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    diagnosticEvent(signal?.aborted || error instanceof LauncherBrowserTurnCancelledError ? "info" : "error", "browser.control_failed", {
      traceId: activity.traceId, phase: activity.phase, ...diagnosticError(failure),
    });
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

export async function releaseLauncherRetainedConversation(
  descriptorPath: string,
  conversationKey: string,
  timeoutMs = LAUNCHER_TURN_END_TIMEOUT_MS,
  traceId?: string,
): Promise<number> {
  if (!/^[a-f0-9]{64}$/.test(conversationKey)) {
    throw new Error("Launcher retained conversation key is invalid");
  }
  if (traceId !== undefined && !/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) {
    throw new Error("Launcher retained turn trace is invalid");
  }
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${descriptor.control.endpoint}/v1/turn/release`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.control.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversationKey, ...(traceId ? { traceId } : {}) }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || !Number.isSafeInteger(body.released) || Number(body.released) < 0) {
      const detail = typeof body.error === "string" ? `: ${body.error}` : "";
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    return Number(body.released);
  } catch (error) {
    const failure = new Error(`Launcher retained conversation release failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    diagnosticEvent("error", "browser.control_failed", { phase: "release", ...diagnosticError(failure) });
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForLauncherManualFinished(descriptorPath: string, owner: LauncherManualTurnOwner, signal?: AbortSignal): Promise<void> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  for (;;) {
    signal?.throwIfAborted();
    const result = await launcherManualRequest(descriptor, "request-finish", owner, 10_000, signal);
    if (!result.response.ok) throw new Error(String(result.body.error ?? "Manual finish confirmation failed"));
    if (result.body.status === "finished") return;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
}
