import { diagnosticContext, diagnosticEvent, diagnosticError } from "../../../diagnostics";
import { acquireOwnedBrowserResource } from "./owned-browser-resource";
import { operationStage } from "../../../runtime/operation-stage";
import { chatGptMarkdownFailure } from "../adapter-error";
import { chatGptWebQueueModel } from "../../../models/chatgpt-web-queue-model";
import { CompletionFenceWait, type CompletionFenceState, type CompletionFenceCommit } from "../tools/completion-fence";
import { observeMcpCompletion } from "./mcp-call-observation";
import { createHash, randomUUID } from "node:crypto";
import { withQueuedRequest, waitForSendPermit, queueRequest, type RequestQueueTarget } from "../../../browser/request-queue-client";
import { getStandaloneRequestQueue, cancelStandaloneRequests, closeStandaloneRequestQueues } from "../../../browser/standalone-request-queue";
import { requireLicense } from "../../../licensing/service";
import { createUsageDelivery } from "./usage-delivery";
import { armCompletionAnnouncement, readCompletionAnnouncement, disposeCompletionAnnouncement } from "./completion-announcement";
import { savedChatId } from "../../../../launcher/shared/saved-chat.cjs";
import { assertSavedChatIdentity, renameSavedChat } from "./saved-chat";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectChatGptLimitsPlan, readChatGptUsageAccount, readChatGptUsageModel, chatGptUsagePlan, type ChatGptUsageModel } from "../limits";
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request, type Response } from "playwright-core";
import {
  atomicWriteFile,
  CHATGPT_CONNECTOR_NAME,
  defaultChromeExecutable,
  DEV_CHATGPT_CONNECTOR_NAME,
  expandUserPath,
  getConfigDir,
  isLegacyChatGptConnectorName,
  legacyChatGptConnectorMigrationMessage,
  LEGACY_CHATGPT_CONNECTOR_NAMES,
} from "../../../config";
import type { CodexProviderConfig, CodexTool } from "../../../types";
import { parseNativeToolCallReply } from "../tools/native-tool-call-block";
import {
  ChatGptMarkdownBuffer,
  ChatGptMarkdownConsistencyError,
} from "../markdown";
import {
  CHATGPT_WEB_LUNA_MODEL_ID,
  CHATGPT_WEB_MODEL_ID,
  resolveChatGptWebModelMode,
  type ChatGptWebCapabilities,
  type ChatGptWebModelMode,
} from "../model";
import {
  compiledChatGptWebMaxMessageChars,
  estimateChatGptWebImageTokens,
  estimateCompiledChatGptWebMessageTokens,
} from "../prompt/input-tokens";
import type { CompiledChatGptWebPrompt } from "../prompt/compile";
import { readChatGptUserMessage } from "./user-message";
import { attachChatGptFilesWithRetry } from "./attachment-retry";
import { ChatGptResponseStream } from "./response-stream";
import { chatGptResponseDeliveryEvidence } from "./response-delivery-evidence";
import { ChatGptPendingObservation } from "./pending-observation";
import { responseSourceBlocksFallback } from "./response-source";
import { observeSendInput, reconcileSendAcceptance } from "./send-input-probe";
import { estimateCompiledChatGptWebInputTokens } from "../prompt/input-tokens";
import {
  assertAuthenticatedChatGptPage,
  assertNewChatPage,
  chatGptNewChatUrl,
  chatGptAssistantTurnSelector,
  CHATGPT_ASSISTANT_TURN_SELECTOR,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  CHATGPT_MODEL_CONTROL_SETTLE_MS,
  CHATGPT_STOP_BUTTON_SELECTOR,
  CHATGPT_SEND_BUTTON_SELECTOR,
  CHATGPT_USER_TURN_SELECTOR,
  activateChatGptEffortMenu,
  closeChatGptEffortMenu,
  detectChatGptAccountCapabilities,
  readChatGptEffortSnapshot,
} from "../../../browser/session";
import { loginVerificationMarkerPath } from "../../../browser/login";
import {
  connectLauncherBrowserHost,
  LauncherBrowserTurnCancelledError,
  LauncherRetainedConversationUnavailableError,
  LAUNCHER_TURN_HEARTBEAT_INTERVAL_MS,
  LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS,
  notifyLauncherTurn,
} from "../../../browser/launcher-client";
import {
  resolveChatGptWebContextLimits,
  resolveChatGptWebTransportLimits,
} from "../../../models/chatgpt-web-models";
import { LauncherBrowserHelperClient } from "./launcher-helper-client";
import { ChatGptTurnEvidence } from "./turn-evidence";
import { ChatGptStreamEvidence } from "./stream-evidence";
import { CHATGPT_UNSUBMITTED_PREPARATION,
  ChatGptPreparationRecovery, noToolActivity, preparationError, proveUnsubmittedPreparation,
  readChatGptReadiness, waitForChatGptReadiness, type ChatGptReadinessSnapshot } from "./page-readiness";
import { assertChatGptModelFamily, selectChatGptModelFamily } from "./model-selection";
import { MAX_CHATGPT_BROWSER_TABS } from "./concurrency";
import {
  ChatGptCompactionHandoffAccepted,
  ChatGptWebAdapterError,
  chatGptBrowserTabClosedError,
  chatGptRetainedConversationUnavailableError,
  chatGptStoppedThinkingError,
  chatGptResponseFailure,
} from "../adapter-error";
import {
  ChatGptLunaCheckpointStream,
  type CapturedChatGptLunaCheckpoint,
} from "../conversation/rolling-checkpoint";
import {
  chatGptExternalProgressIsLive,
  chatGptExternalToolCallsAreInFlight,
} from "../tools/turn-progress";
import type { ChatGptTurnProgressReader } from "../tools/turn-progress";

import {
  CHATGPT_RESPONSE_DOM_GRACE_MS,
  CHATGPT_RESPONSE_EXTRACTION_TIMEOUT_MS,
  CHATGPT_EMPTY_RESPONSE_GRACE_MS,
  CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS,
  MAX_CHATGPT_BROWSER_PAGE_REBINDS,
  MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS,
  ChatGptBrowserObservationTimeoutError,
  ChatGptCompletionTracker,
  type ChatGptSuspensionClock,
  ChatGptTurnDomHealthTracker,
  chatGptSuspensionClock,
  chatGptSubmissionEvidence,
  chatGptNewTurnIdentity,
  chatGptReboundTurnIdentity,
  chatGptExternalProgressSuppressesDomHealth,
  remainingStageBudgetMs,
  withChatGptBrowserObservationTimeout,
  type ChatGptSubmissionEvidence,
} from "./turn-observation";
import {
  CHATGPT_DOM_REVISION_ATTRIBUTES,
  ChatGptVisibleTraceTracker,
  readChatGptResponseDom,
  disposeChatGptResponseDom,
  type ChatGptResponseDomCache,
  type ChatGptResponseDomSnapshot,
} from "./response-dom";
import { ChatGptBrowserDiagnostics, describeStalledChatGptTurn, redactChatGptUiDiagnostic, persistChatGptResponseEvidence, ChatGptResponseEvidenceStorageError } from "./browser-diagnostics";
import {
  CHATGPT_COMPOSER_DOCUMENT_END_KEY,
  CHATGPT_COMPOSER_SELECT_ALL_KEY,
  ChatGptPromptAttachmentIntegrityError,
  assertChatGptPromptAttachments,
  chatGptPromptFilePayloads,
  chatGptPromptTextEquivalent,
  chatGptPromptEquivalentPrefixLength,
  insertPlainTextIntoComposer,
  prepareComposerForInput,
} from "./composer";

// Keep the worker entry's existing helper API available while implementations have one owner.
export {
  CHATGPT_RESPONSE_DOM_GRACE_MS,
  CHATGPT_EMPTY_RESPONSE_GRACE_MS,
  ChatGptSuspensionClock,
  chatGptSuspensionClock,
  remainingStageBudgetMs,
  CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS,
  MAX_CHATGPT_BROWSER_PAGE_REBINDS,
  ChatGptBrowserObservationTimeoutError,
  withChatGptBrowserObservationTimeout,
  chatGptTurnIsComplete,
  type ChatGptSubmissionEvidence,
  chatGptSubmissionEvidence,
  chatGptNewTurnIdentity,
  chatGptReboundTurnIdentity,
  ChatGptCompletionTracker,
  ChatGptTurnDomHealthTracker,
  MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS,
  CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS,
  CHATGPT_EXTERNAL_PROGRESS_CLOCK_SKEW_MS,
  chatGptExternalProgressSuppressesDomHealth,
} from "./turn-observation";
export {
  ChatGptVisibleTraceTracker,
  isChatGptTraceControl,
  stripChatGptTraceControlSuffix,
  type ChatGptVisibleTraceBlock,
  type ChatGptVisibleTraceEvent,
} from "./response-dom";
export { browserDiagnosticCheckpoint, redactChatGptUiDiagnostic, sanitizeChatGptBrowserDiagnosticState } from "./browser-diagnostics";
export {
  CHATGPT_COMPOSER_DOCUMENT_END_KEY,
  CHATGPT_COMPOSER_SELECT_ALL_KEY,
  ChatGptPromptAttachmentIntegrityError,
  chatGptImageFilePayloads,
  chatGptPromptFilePayloads,
  insertPlainTextIntoComposer,
} from "./composer";

export { MAX_CHATGPT_BROWSER_TABS } from "./concurrency";

const workers = new Map<string, ChatGptBrowserWorker>();

export async function closeChatGptBrowserWorkers(): Promise<void> {
  const active = [...workers.values()];
  workers.clear();
  const failures: unknown[] = [];
  try { await cancelStandaloneRequests(); } catch (error) { failures.push(error); }
  const results = await Promise.allSettled(active.map(worker => worker.close()));
  failures.push(...results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => result.reason));
  try { await closeStandaloneRequestQueues(); } catch (error) { failures.push(error); }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} ChatGPT browser worker(s) failed to close`);
  }
}
export const CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS = 60_000;
export const MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS = 3;
const CHATGPT_CONNECTOR_MENTION_QUERY = "@codex";
const CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS = 60_000;
const CHATGPT_SMOKE_TEXT = "Reply with exactly: WEB2HARNESS READY";
const CHATGPT_SMOKE_EXPECTED = "WEB2HARNESS READY";
/**
 * ChatGPT applies composer state asynchronously, and a fast host can reach the next step before the
 * editor has taken the previous one. This is headroom for that, not a readiness check.
 */
export const CHATGPT_UI_SETTLE_MS = 250;
export const CHATGPT_SEND_ENABLE_GRACE_MS = 120_000;

const settleChatGptUi = (): Promise<void> => (
  new Promise(resolveSettle => setTimeout(resolveSettle, CHATGPT_UI_SETTLE_MS))
);

class ChatGptConnectorCatalogStaleError extends Error {
  constructor(
    readonly appName: string,
    readonly triggerAttempts: number,
  ) {
    super(`ChatGPT connector catalog is missing ${JSON.stringify(appName)}`);
    this.name = "ChatGptConnectorCatalogStaleError";
  }
}

interface ChatGptConnectorAttemptBudget {
  triggerAttempts: number;
}

function chatGptConnectorUnavailableError(message: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 424,
    errorType: "connector_error",
    code: "connector_not_found",
    retryable: false,
  });
}

const CHATGPT_MODEL_CONTROL_UNAVAILABLE_MESSAGE = "ChatGPT model controls are unavailable. Reload ChatGPT and retry the task.";

function chatGptModelControlUnavailableError(diagnostic: string): Error {
  return new Error(CHATGPT_MODEL_CONTROL_UNAVAILABLE_MESSAGE, { cause: new Error(diagnostic) });
}

function chatGptModelControlUnavailableAdapterError(diagnostic: string, detail?: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    detail ? `${CHATGPT_MODEL_CONTROL_UNAVAILABLE_MESSAGE} ChatGPT: ${detail}` : CHATGPT_MODEL_CONTROL_UNAVAILABLE_MESSAGE,
    {
      status: 502,
      errorType: "server_error",
      code: "upstream_server_error",
      retryable: false,
      cause: new Error(diagnostic),
    },
  );
}

export async function chatGptUnavailableProDetail(menu: Locator): Promise<string | undefined> {
  // Pro is the product label in the picker. Its linked tooltip supplies the site's own
  // localized explanation/date; do not search the conversation or infer a reset time.
  const rows = menu.getByRole("menuitemradio", { name: "Pro", exact: true }).filter({ visible: true });
  try {
    if (await rows.count() !== 1 || await rows.getAttribute("aria-disabled") !== "true") return undefined;
    await rows.hover({ timeout: 1_500 });
    return await rows.evaluate(async element => {
      const deadline = Date.now() + 1_000;
      do {
        const ids = element.getAttribute("aria-describedby")?.trim().split(/\s+/).filter(Boolean) ?? [];
        const tooltips = ids.map(id => document.getElementById(id))
          .filter((node): node is HTMLElement => node instanceof HTMLElement && node.getAttribute("role") === "tooltip");
        const visible = tooltips.filter(node => {
          for (let current: HTMLElement | null = node; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (!current.isConnected || current.hidden || current.getAttribute("aria-hidden") === "true"
              || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          }
          return true;
        });
        if (visible.length === 1) {
          const text = visible[0]!.textContent?.replace(/\s+/g, " ").trim();
          if (text && text.length <= 512) return text;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      return undefined;
    }, undefined, { timeout: 1_500 });
  } catch {
    // Optional UI detail must not replace the existing model-unavailable error.
    return undefined;
  }
}

export type ChatGptPersonalizationPreflight = "already-personalized" | "enabled";

const CHATGPT_PERSONALIZATION_CONTROL_SELECTOR = [
  '[data-testid="thread-header-right-actions"] [aria-haspopup="menu"]',
  '#conversation-header-actions [aria-haspopup="menu"]',
  '[data-content-sheet-root] > button[aria-expanded][aria-controls]',
].join(", ");
const CHATGPT_PERSONALIZATION_CHOICE_SELECTOR = '[role="menuitemradio"], [role="radio"]';
const CHATGPT_PERSONALIZATION_PREFLIGHT_TIMEOUT_MS = 60_000;
const CHATGPT_PERSONALIZATION_CLEANUP_TIMEOUT_MS = 30_000;
const CHATGPT_COMPOSER_PREPARATION_TIMEOUT_MS = 60_000;

class ChatGptPersonalizationDeadlineError extends Error {
  constructor() {
    super("ChatGPT personalization preflight exceeded its readiness timeout");
    this.name = "ChatGptPersonalizationDeadlineError";
  }
}

class ChatGptPersistentBrowserStateError extends AggregateError {
  constructor(errors: Iterable<unknown>, message: string) {
    super(errors, message);
    this.name = "ChatGptPersistentBrowserStateError";
  }
}

function chatGptPersonalizationStepTimeout(timeoutMs: number, signal?: AbortSignal): number {
  if (signal?.aborted) throw new DOMException("ChatGPT personalization preflight aborted", "AbortError");
  return timeoutMs;
}

async function runChatGptPersonalizationStep<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  chatGptPersonalizationStepTimeout(timeoutMs, signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await withBrowserTurnAbort(Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ChatGptPersonalizationDeadlineError()), timeoutMs);
      }),
    ]), signal);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Mutating personalization work owns its AbortSignal and must settle its cleanup before the caller
 * can observe cancellation. Unlike observation races, returning early here could release the page
 * while a rollback or composer clear was still running against the persistent browser profile.
 */
async function runChatGptPersonalizationOwnedStep<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  chatGptPersonalizationStepTimeout(timeoutMs, signal);
  const result = await operation();
  chatGptPersonalizationStepTimeout(timeoutMs, signal);
  return result;
}

async function waitForChatGptPersonalizationPoll(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
    return;
  }
  if (signal.aborted) throw new DOMException("ChatGPT personalization preflight aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("ChatGPT personalization preflight aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function runChatGptPersonalizationCleanup<T>(
  operation: (timeoutMs: number, signal: AbortSignal) => Promise<T>,
  timeoutMs = CHATGPT_PERSONALIZATION_CLEANUP_TIMEOUT_MS,
): Promise<T> {
  // Cleanup owns fresh limits for its individual operations, independent of turn cancellation.
  return operation(timeoutMs, new AbortController().signal);
}

async function pressChatGptPersonalizationEscape(
  page: Page,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  await page.locator("body").press("Escape", {
    timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
    signal,
  });
}

async function dismissChatGptPersonalizationMenu(page: Page): Promise<void> {
  await runChatGptPersonalizationCleanup((timeoutMs, signal) => (
    pressChatGptPersonalizationEscape(page, timeoutMs, signal)
  ));
}

async function waitForChatGptOwnedPersonalizationMenu(
  page: Page,
  control: Locator,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Locator> {
  let menuId: string | null = null;
  const ownerDeadline = Date.now() + timeoutMs;
  while (!menuId) {
    chatGptPersonalizationStepTimeout(timeoutMs, signal);
    const remaining = ownerDeadline - Date.now();
    if (remaining <= 0) throw new ChatGptPersonalizationDeadlineError();
    menuId = await control.getAttribute("aria-controls", { timeout: remaining, signal });
    if (!menuId) await waitForChatGptPersonalizationPoll(Math.min(50, remaining), signal);
  }
  const menu = page.locator(`[id=${JSON.stringify(menuId)}]`);
  try {
    await menu.waitFor({
      state: "visible",
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    throw chatGptConnectorUnavailableError(
      "ChatGPT personalization control did not expose its owned menu before the readiness timeout",
    );
  }
  return menu;
}

type ChatGptPersonalizationChoiceIndex = 0 | 1;

interface ChatGptPersonalizationState {
  menu: Locator;
  choices: Locator;
  checkedIndex: ChatGptPersonalizationChoiceIndex;
}

interface ChatGptPersonalizationToggleReceipt {
  originalIndex: ChatGptPersonalizationChoiceIndex;
}

async function readChatGptPersonalizationCheckedIndex(
  choices: Locator,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ChatGptPersonalizationChoiceIndex> {
  timeoutMs = 30_000;
  const checked: boolean[] = [];
  for (let index = 0; index < 2; index += 1) {
    const choice = choices.nth(index);
    const ariaChecked = await choice.getAttribute("aria-checked", {
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
    const dataState = await choice.getAttribute("data-state", {
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
    checked.push(ariaChecked === "true" || dataState === "checked");
  }
  if (checked.filter(Boolean).length !== 1) {
    throw chatGptConnectorUnavailableError(
      "ChatGPT personalization menu did not expose one checked state",
    );
  }
  return checked[0] ? 0 : 1;
}

async function openChatGptStructuralPersonalizationState(
  page: Page,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ChatGptPersonalizationState> {
  const controls = page.locator(CHATGPT_PERSONALIZATION_CONTROL_SELECTOR).filter({ visible: true });
  const control = controls.first();
  try {
    await control.waitFor({
      state: "visible",
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    throw chatGptConnectorUnavailableError(
      "ChatGPT Temporary Chat did not expose a structural personalization control before the readiness timeout",
    );
  }
  const controlCount = await runChatGptPersonalizationStep(() => controls.count(), timeoutMs, signal);
  if (controlCount !== 1) {
    throw chatGptConnectorUnavailableError(
      `ChatGPT Temporary Chat exposed ${controlCount} structural personalization controls; expected exactly one`,
    );
  }
  await control.click({
    timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
    signal,
  });
  const menu = await waitForChatGptOwnedPersonalizationMenu(page, control, timeoutMs, signal);
  const choices = menu.locator(CHATGPT_PERSONALIZATION_CHOICE_SELECTOR).filter({ visible: true });
  if (await runChatGptPersonalizationStep(() => choices.count(), timeoutMs, signal) !== 2) {
    throw chatGptConnectorUnavailableError(
      "ChatGPT personalization menu did not expose exactly two checkable states",
    );
  }
  return {
    menu,
    choices,
    checkedIndex: await readChatGptPersonalizationCheckedIndex(choices, timeoutMs, signal),
  };
}

async function restoreChatGptPersonalizationChoice(
  page: Page,
  receipt: ChatGptPersonalizationToggleReceipt,
): Promise<void> {
  await runChatGptPersonalizationCleanup(async (timeoutMs, signal) => {
    await pressChatGptPersonalizationEscape(page, timeoutMs, signal);
    let state = await openChatGptStructuralPersonalizationState(page, timeoutMs, signal);
    if (state.checkedIndex === receipt.originalIndex) {
      await pressChatGptPersonalizationEscape(page, timeoutMs, signal);
      return;
    }
    await state.choices.nth(receipt.originalIndex).click({
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
    await state.menu.waitFor({
      state: "hidden",
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
    await waitForChatGptPersonalizationPoll(CHATGPT_UI_SETTLE_MS, signal);

    state = await openChatGptStructuralPersonalizationState(page, timeoutMs, signal);
    if (state.checkedIndex !== receipt.originalIndex) {
      throw new Error("ChatGPT personalization rollback did not restore the original checked state");
    }
    await pressChatGptPersonalizationEscape(page, timeoutMs, signal);
  });
}

async function toggleChatGptPersonalizationChoice(
  page: Page,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ChatGptPersonalizationToggleReceipt> {
  let receipt: ChatGptPersonalizationToggleReceipt | undefined;
  try {
    const state = await openChatGptStructuralPersonalizationState(page, timeoutMs, signal);
    receipt = { originalIndex: state.checkedIndex };
    const nextIndex: ChatGptPersonalizationChoiceIndex = state.checkedIndex === 0 ? 1 : 0;
    await state.choices.nth(nextIndex).click({
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
    await state.menu.waitFor({
      state: "hidden",
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, signal),
      signal,
    });
    await runChatGptPersonalizationStep(settleChatGptUi, timeoutMs, signal);
    return receipt;
  } catch (error) {
    try {
      if (receipt) await restoreChatGptPersonalizationChoice(page, receipt);
      else await dismissChatGptPersonalizationMenu(page);
    } catch (cleanupError) {
      throw new ChatGptPersistentBrowserStateError(
        [error, cleanupError],
        "ChatGPT personalization change failed and its original state could not be restored",
      );
    }
    throw error;
  }
}

async function ensureChatGptPersonalizedConnectorAccessSteps(
  page: Page,
  timeoutMs: number,
  abortSignal: AbortSignal,
  captureDiagnostic?: (checkpoint: string) => Promise<void>,
  proveConfiguredConnectorAccess?: (signal?: AbortSignal) => Promise<boolean>,
): Promise<ChatGptPersonalizationPreflight> {
  const capture = async (checkpoint: string): Promise<void> => {
    if (!captureDiagnostic) return;
    await runChatGptPersonalizationStep(() => captureDiagnostic(checkpoint), timeoutMs, abortSignal);
  };
  const proveConnectorAccess = async (): Promise<boolean> => {
    if (!proveConfiguredConnectorAccess) return false;
    return runChatGptPersonalizationOwnedStep(
      () => proveConfiguredConnectorAccess(abortSignal),
      timeoutMs,
      abortSignal,
    );
  };
  // The visible sheet can be aria-hidden during hydration. Include those controls in the role
  // query but still require visibility; never select a hidden duplicate or switch locator rules.
  const personalized = page
    .getByRole("button", { name: /^(?:Personalized|个性化)$/, exact: true, includeHidden: true })
    .filter({ visible: true });
  const unpersonalized = page
    .getByRole("button", { name: /^(?:Unpersonalized|非个性化)$/, exact: true, includeHidden: true })
    .filter({ visible: true });
  let personalizedCount = await runChatGptPersonalizationStep(() => personalized.count(), timeoutMs, abortSignal);
  let unpersonalizedCount = await runChatGptPersonalizationStep(() => unpersonalized.count(), timeoutMs, abortSignal);
  if (personalizedCount === 0 && unpersonalizedCount === 0) {
    await runChatGptPersonalizationStep(settleChatGptUi, timeoutMs, abortSignal);
    personalizedCount = await runChatGptPersonalizationStep(() => personalized.count(), timeoutMs, abortSignal);
    unpersonalizedCount = await runChatGptPersonalizationStep(() => unpersonalized.count(), timeoutMs, abortSignal);
    if (personalizedCount === 0 && unpersonalizedCount === 0) {
      if (!proveConfiguredConnectorAccess) {
        await capture("personalization-control-missing");
        throw chatGptConnectorUnavailableError(
          "ChatGPT Temporary Chat did not expose a verifiable personalization control",
        );
      }
      if (await proveConnectorAccess()) {
        await capture("personalization-already-enabled");
        return "already-personalized";
      }
      await capture("personalization-unpersonalized");
      const toggleReceipt = await toggleChatGptPersonalizationChoice(page, timeoutMs, abortSignal);
      try {
        if (await proveConnectorAccess()) {
          await capture("personalization-enabled");
          return "enabled";
        }
      } catch (error) {
        try {
          await restoreChatGptPersonalizationChoice(page, toggleReceipt);
        } catch (restoreError) {
          throw new ChatGptPersistentBrowserStateError(
            [error, restoreError],
            "ChatGPT personalization proof failed and the original state could not be restored",
          );
        }
        throw error;
      }
      try {
        await restoreChatGptPersonalizationChoice(page, toggleReceipt);
      } catch (restoreError) {
        throw new ChatGptPersistentBrowserStateError(
          [restoreError],
          "ChatGPT personalization changed but connector access was not proven and the original state could not be restored",
        );
      }
      throw chatGptConnectorUnavailableError(
        "The configured ChatGPT connector remained unavailable after the structural personalization state changed",
      );
    }
  }
  if (personalizedCount === 1 && unpersonalizedCount === 0) {
    await capture("personalization-already-enabled");
    return "already-personalized";
  }
  if (personalizedCount !== 0 || unpersonalizedCount !== 1) {
    throw chatGptConnectorUnavailableError(
      `ChatGPT exposed an invalid Temporary Chat personalization state`
      + ` (personalized=${personalizedCount}, unpersonalized=${unpersonalizedCount})`,
    );
  }

  await capture("personalization-unpersonalized");
  await unpersonalized.click({
    timeout: chatGptPersonalizationStepTimeout(timeoutMs, abortSignal),
    signal: abortSignal,
  });
  try {
    const menu = await waitForChatGptOwnedPersonalizationMenu(
      page,
      unpersonalized,
      timeoutMs,
      abortSignal,
    );
    const choice = menu
      .locator(CHATGPT_PERSONALIZATION_CHOICE_SELECTOR)
      .filter({ hasText: /^(?:Personalized|个性化)/ });
    if (await runChatGptPersonalizationStep(() => choice.count(), timeoutMs, abortSignal) !== 1) {
      throw chatGptConnectorUnavailableError(
        "ChatGPT personalization menu did not expose one exact Personalized choice",
      );
    }
    await choice.click({
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, abortSignal),
      signal: abortSignal,
    });
    await personalized.waitFor({
      state: "visible",
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, abortSignal),
      signal: abortSignal,
    });
    await unpersonalized.waitFor({
      state: "hidden",
      timeout: chatGptPersonalizationStepTimeout(timeoutMs, abortSignal),
      signal: abortSignal,
    });
  } catch (error) {
    try {
      await dismissChatGptPersonalizationMenu(page);
    } catch (cleanupError) {
      throw new ChatGptPersistentBrowserStateError(
        [error, cleanupError],
        "ChatGPT labeled personalization change failed and its opened menu could not be closed",
      );
    }
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    throw chatGptConnectorUnavailableError(
      "ChatGPT did not confirm Personalized connector access for this Temporary Chat",
    );
  }
  await capture("personalization-enabled");
  return "enabled";
}

/** New Temporary Chats may suppress connectors until this exact browser conversation is Personalized. */
export async function ensureChatGptPersonalizedConnectorAccess(
  page: Page,
  captureDiagnostic?: (checkpoint: string) => Promise<void>,
  proveConfiguredConnectorAccess?: (signal?: AbortSignal) => Promise<boolean>,
  abortSignal?: AbortSignal,
): Promise<ChatGptPersonalizationPreflight> {
  try {
    return await ensureChatGptPersonalizedConnectorAccessSteps(
      page, CHATGPT_PERSONALIZATION_PREFLIGHT_TIMEOUT_MS,
      abortSignal ?? new AbortController().signal,
      captureDiagnostic, proveConfiguredConnectorAccess,
    );
  } catch (error) {
    if (error instanceof ChatGptPersonalizationDeadlineError) {
      throw chatGptConnectorUnavailableError("ChatGPT personalization operation exceeded its readiness timeout");
    }
    throw error;
  }
}

const chatGptRateLimitDialog = (page: Page): Locator => page.locator('[role="dialog"]')
  .filter({ hasText: /Too many requests|太多要求|太多请求|リクエストが多すぎます|요청이 너무 많습니다|요청을 너무 빠르게|너무 많은 요청/i })
  .filter({ hasText: /making requests too quickly|過於頻繁|过于频繁|リクエストの頻度が高すぎます|요청을 너무 빠르게|요청이 너무 많습니다|너무 많은 요청/i })
  .last();

export async function throwIfChatGptRateLimitDialog(page: Page): Promise<void> {
  const dialog = chatGptRateLimitDialog(page);
  if (!await dialog.isVisible().catch(() => false)) return;

  const acknowledge = dialog.getByRole("button", { name: /^(Got it|知道了|了解|알겠습니다|확인)$/ }).last();
  if (await acknowledge.isVisible().catch(() => false)) {
    try {
      await acknowledge.press("Enter");
    } catch (error) {
      throw new ChatGptWebAdapterError(
        `ChatGPT rate limit: too many requests, and the dialog could not be dismissed (${error instanceof Error ? error.message : String(error)}). Try again in a few minutes.`,
        { status: 429, errorType: "rate_limit_error", code: "rate_limit_exceeded", retryable: false },
      );
    }
  }
  // Dismissing the modal does not prove the account cooldown has cleared. Keep this failure
  // replayable in the adapter so native reconnects cannot start more browser submissions.
  throw new ChatGptWebAdapterError(
    "ChatGPT rate limit: too many requests. Try again in a few minutes.",
    { status: 429, errorType: "rate_limit_error", code: "rate_limit_exceeded", retryable: false },
  );
}

const chatGptTemporaryChatOnboardingDialog = (page: Page): Locator => page
  .locator('[role="dialog"]')
  .filter({ hasText: "Not in history" })
  .filter({ hasText: "No model training" })
  .filter({ hasText: "Memory off" })
  .last();

export async function dismissChatGptTemporaryChatOnboarding(page: Page, timeoutMs = 60_000, signal?: AbortSignal): Promise<boolean> {
  const dialog = chatGptTemporaryChatOnboardingDialog(page);
  if (!await dialog.isVisible().catch(() => false)) return false;
  const continueButton = dialog.getByRole("button", { name: "Continue", exact: true }).last();
  if (!await continueButton.isVisible().catch(() => false)) {
    throw new Error("ChatGPT Temporary Chat onboarding is visible without its Continue action");
  }
  signal?.throwIfAborted();
  await continueButton.click({ force: true, timeout: timeoutMs, signal });
  await dialog.waitFor({ state: "hidden", timeout: timeoutMs, signal });
  return true;
}

type ChatGptTextScope = Pick<Locator, "getByText" | "getByTestId">;

const chatGptSubscriptionFailureAlert = (page: Page): Locator => page
  .locator('[role="alert"]')
  .filter({ hasText: /Failed to load subscription/i })
  .last();

const chatGptExpiredSessionAlert = (page: Page): Locator => page
  .locator('[role="alert"], [role="dialog"]')
  .filter({ hasText: /Your session has expired|你的工作階段已過期|您的工作階段已過期|你的会话已过期|您的会话已过期/i })
  .last();

export async function throwIfChatGptSessionFailureAlert(page: Page): Promise<void> {
  if (await chatGptExpiredSessionAlert(page).isVisible().catch(() => false)) {
    throw new ChatGptWebAdapterError(
      "The ChatGPT session has expired. Sign in again in Web2Harness.",
      { status: 401, errorType: "authentication_error", code: "chatgpt_session_expired", retryable: false },
    );
  }
  if (!await chatGptSubscriptionFailureAlert(page).isVisible().catch(() => false)) return;
  throw new ChatGptWebAdapterError(
    "ChatGPT could not load the account subscription. Reload ChatGPT inside the launcher and retry; sign out only if the error persists.",
    { status: 503, errorType: "server_error", code: "chatgpt_subscription_unavailable", retryable: true },
  );
}

const chatGptTerminalErrorAlert = (scope: ChatGptTextScope): Locator => scope
  .getByText(/Something went wrong[\s\S]*help\.openai\.com/i)
  .last();

// The current UI renders message_length_exceeds_limit as an ordinary response error.
// Observe only browser-issued submissions from this owned page after Send is activated;
// an old response, another tab, or a background endpoint cannot classify this turn.
export class ChatGptSubmissionRejectionObserver {
  private page?: Page;
  private readonly requests = new Set<Request>();
  private checks: Array<Promise<ChatGptWebAdapterError | undefined>> = [];

  private readonly onRequest = (request: Request): void => {
    if (!this.page || request.method() !== "POST"
      || request.url() !== "https://chatgpt.com/backend-api/f/conversation"
      || request.frame() !== this.page.mainFrame()) return;
    this.requests.add(request);
  };

  private readonly onResponse = (response: Response): void => {
    if (!this.requests.delete(response.request()) || response.status() !== 413
      || !response.headers()["content-type"]?.includes("application/json")) return;
    this.checks.push(withChatGptBrowserObservationTimeout(response.json(), 3_000)
      .then(body => body?.detail?.code === "message_length_exceeds_limit"
        ? new ChatGptWebAdapterError(
          "ChatGPT rejected this message because it exceeds the selected mode's input-size limit. Compact the task before retrying.",
          { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
        ) : undefined)
      // Unreadable or unfamiliar responses do not establish a size rejection. The normal
      // bound-response DOM error remains authoritative in that case.
      .catch(() => undefined));
  };

  begin(page: Page): void {
    this.dispose();
    this.checks = [];
    this.page = page;
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
  }

  async failure(): Promise<ChatGptWebAdapterError | undefined> {
    return (await Promise.all(this.checks)).find(error => error !== undefined);
  }

  dispose(): void {
    this.page?.off("request", this.onRequest);
    this.page?.off("response", this.onResponse);
    this.page = undefined;
    this.requests.clear();
  }
}

type SelectedChatGptWebModelMode = ChatGptWebModelMode & {
  modelFamily?: "5.6" | "6";
  selection?: { url: string; label: string };
  usageModel?: ChatGptUsageModel;
};

export async function throwIfChatGptTerminalErrorAlert(scope: ChatGptTextScope): Promise<void> {
  if (await scope.getByTestId("regenerate-thread-error-button").last().isVisible().catch(() => false)) {
    throw new ChatGptWebAdapterError(
      "ChatGPT displayed an error for this response. Check the ChatGPT tab for the exact error, then retry the turn.",
      { status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true },
    );
  }
  if (!await chatGptTerminalErrorAlert(scope).isVisible().catch(() => false)) return;
  throw new ChatGptWebAdapterError(
    "ChatGPT ended the turn with 'Something went wrong'. Retry the turn.",
    { status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true },
  );
}

export async function resolveChatGptToolConfirmation(
  page: Page,
  appName: string,
  autoApprove: boolean,
  signal?: AbortSignal,
  timeoutMs = CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS,
  onVisible?: () => Promise<void>,
): Promise<boolean> {
  const dialog = page.locator('[role="dialog"], [data-testid="tool-approval-card"]')
    .filter({ hasText: `Allow ChatGPT to use ${appName}?` })
    .last();
  if (!await dialog.isVisible().catch(() => false)) return false;
  await onVisible?.();

  if (autoApprove) {
    // ChatGPT exposes either "Allow once" or the shorter "Allow" for the
    // current one-shot approval. Keep the matcher anchored so persistent
    // actions such as "Always allow" cannot match.
    const allowCurrentAction = dialog
      .getByRole("button", { name: /^Allow(?: once)?$/ })
      .last();
    await allowCurrentAction.waitFor({ state: "visible", timeout: 10_000 });
    await allowCurrentAction.press("Enter");
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if (!await dialog.isVisible().catch(() => false)) return true;
    await new Promise(resolveSleep => setTimeout(resolveSleep, Math.min(100, Math.max(1, deadline - Date.now()))));
  }

  if (!await dialog.isVisible().catch(() => false)) return true;
  const deny = dialog.getByRole("button", { name: "Deny", exact: true }).last();
  await deny.waitFor({ state: "visible", timeout: 5_000 });
  await deny.press("Enter");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  return true;
}

export function assertChatGptWebInputWithinLimits(
  estimatedInputTokens: number,
  estimatedMessageTokens: number,
  modelId: string,
  effort: ChatGptWebModelMode["effort"],
  capabilities: ChatGptWebCapabilities,
  promptChars?: number,
): void {
  if (modelId !== CHATGPT_WEB_MODEL_ID && modelId !== CHATGPT_WEB_LUNA_MODEL_ID) {
    throw new Error(`ChatGPT web context limit is not defined for model: ${modelId}`);
  }
  const { contextWindow } = resolveChatGptWebContextLimits(modelId, effort, capabilities);
  const { browserMessageTokenLimit, browserComposerCharLimit } = resolveChatGptWebTransportLimits(
    modelId,
    effort,
    capabilities,
  );
  if (
    browserComposerCharLimit !== undefined
    && promptChars !== undefined
    && promptChars > browserComposerCharLimit
  ) {
    throw new ChatGptWebAdapterError(
      `This prompt contains ${promptChars.toLocaleString("en-US")} inline characters, which exceeds the measured ${browserComposerCharLimit.toLocaleString("en-US")}-character ChatGPT composer boundary for this account and effort. Run /compact, then retry this Web model.`,
      { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
    );
  }
  if (browserMessageTokenLimit !== undefined && estimatedMessageTokens > browserMessageTokenLimit) {
    throw new ChatGptWebAdapterError(
      `This prompt requires ${estimatedMessageTokens.toLocaleString("en-US")} visible message tokens, which exceeds the measured ${browserMessageTokenLimit.toLocaleString("en-US")}-token ChatGPT browser message boundary for this account and effort. The model context window is ${contextWindow.toLocaleString("en-US")} tokens; run /compact to reduce the next browser message without changing that model window.`,
      { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
    );
  }
  if (estimatedInputTokens < contextWindow) return;
  throw new ChatGptWebAdapterError(
    `This task is estimated at ${estimatedInputTokens.toLocaleString("en-US")} input tokens, which exceeds the ${contextWindow.toLocaleString("en-US")}-token context window for this ChatGPT Web model. Run /compact to reduce the context, then retry.`,
    { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
  );
}

export const browserStageTimeouts = {
  browserPage: 120_000,
  navigation: 120_000,
  composerReady: 120_000,
  fileAttachment: 300_000,
  send: 60_000,
  sendEnable: CHATGPT_SEND_ENABLE_GRACE_MS,
  submissionAcknowledgement: 120_000,
} as const;

export async function connectAfterClosingBrowserConnection<T>(
  previousConnection: Pick<Browser, "close"> | undefined,
  connect: () => Promise<T>,
): Promise<T> {
  if (previousConnection) await previousConnection.close();
  return connect();
}

export const CHATGPT_MIN_OPERATIONAL_VIEWPORT = Object.freeze({ width: 320, height: 240 });

async function waitForOperationalChatGptViewport(page: Page, signal?: AbortSignal): Promise<void> {
  try {
    await withBrowserTurnAbort(page.waitForFunction(
      ({ width, height }) => innerWidth >= width && innerHeight >= height,
      CHATGPT_MIN_OPERATIONAL_VIEWPORT,
      { polling: 50, timeout: 30_000 },
    ), signal);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("ChatGPT browser page acquisition aborted", "AbortError");
    throw new Error(
      `ChatGPT browser surface did not expose an operational viewport: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function throwIfPromptAttachmentAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("ChatGPT prompt attachment aborted", "AbortError");
}

function withBrowserTurnAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("ChatGPT web turn aborted", "AbortError"));
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(new DOMException("ChatGPT web turn aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolvePromise, rejectPromise).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export interface BrowserTurn {
  /** Buffered native replies are private until the complete answer is validated. */
  textDelivery?: "append" | "buffered";
  uiLanguage?: "en" | "zh-CN";
  attachmentTimeoutMs?: number;
  scheduling?: import("../../../../launcher/shared/request-scheduler.cjs").QueueInput;
  queueTicket?: import("../../../browser/request-queue-client").QueueTicket;
  /** Daemon-only authority: atomically retire a binding with no past or current tool activity. */
  authorizeMcpRecovery?: () => Promise<boolean>;
  mcpRemoteVerified?: () => Promise<boolean>;
  traceId: string;
  modelId: string;
  /** Stable native-round identity, independent of stream reconnects and generic retries. */
  preparationKey?: string;
  allowPreparationRecovery?: boolean;
  reasoning?: string;
  usagePurpose?: "task" | "tool-result" | "compaction";
  modelFamily?: "5.6" | "6";
  capabilities: ChatGptWebCapabilities;
  prepare: () => Promise<CompiledChatGptWebPrompt & { release: () => void }>;
  prepareResume?: () => Promise<CompiledChatGptWebPrompt & { release: () => void }>;
  /** Select the Codex Native connector without advertising the ordinary turn tool environment. */
  nativeConnector?: boolean;
  retainConversation?: boolean;
  requireRetainedConversation?: boolean;
  conversationKey?: string;
  savedChat?: import("../../../../launcher/shared/saved-chat.cjs").SavedChatTask;
  onPreparedSelected?: (reused: boolean) => void | Promise<void>;
  abortSignal?: AbortSignal;
  onHeartbeat?: () => void;
  /** Owner callback after queue admission; execution timers must not run while queued. */
  onQueueDispatched?: () => void;
  /** Send activation is the ambiguity boundary after which a fresh surface must not replay this prompt. */
  onSendActivated?: () => void | Promise<void>;
  /** Semantic submission evidence proved that ChatGPT accepted the prompt. */
  onSubmitted?: () => void | Promise<void>;
  /** Semantic generation completion; settlement/extraction may still be in progress. */
  onResponseCompleted?: () => void | Promise<void>;
  /** Visible ChatGPT reasoning-summary step titles only; never hidden chain-of-thought. */
  onReasoningSummary?: (text: string, continuation?: boolean) => void;
  /** Stable visible ChatGPT prose between status/tool rows. */
  onCommentary?: (text: string, continuation?: boolean) => void;
  /** Append-only, structurally stable Markdown chunks. */
  onTextDelta: (delta: string) => void;
  /** Proven current-turn MCP activity; never response content or completion. */
  externalProgress?: ChatGptTurnProgressReader;
  /** Atomically fences browser completion against concurrent MCP claims in the turn broker. */
  completionFence?: {
    begin(): Promise<CompletionFenceState>;
    commit(revision: number, browserReply?: string): Promise<CompletionFenceCommit>;
  };
  /** Native declarations are needed to classify retained replies before releasing the page. */
  nativeToolDefinitions?: CodexTool[];
  /** Allow one clean pre-submit composer retry for isolated history compaction only. */
  compaction?: boolean;
  /** Require and remove the private Luna checkpoint tail from the visible Markdown stream. */
  captureLunaCheckpoint?: boolean;
  onLunaCheckpoint?: (captured: CapturedChatGptLunaCheckpoint) => void;
}

interface ChatGptSubmissionBaseline {
  userTurns: Locator;
  responseTurns: Locator;
  initialTurnIdentities: readonly string[];
  domCache: ChatGptSubmissionDomCache;
  submittedText?: string;
  acceptedUserIdentity?: string;
}

interface ChatGptSubmissionObservationRecovery {
  page: Page;
  baseline: ChatGptSubmissionBaseline;
}

type ChatGptObservationRecovery = (
  attempt: number,
  cause: ChatGptBrowserObservationTimeoutError,
  baseline: ChatGptSubmissionBaseline,
  abortSignal?: AbortSignal,
) => Promise<ChatGptSubmissionObservationRecovery>;

interface ChatGptAssistantTurnBinding {
  identity: string;
  locator: Locator;
  acceptedTurnIdentities: readonly string[];
}

interface ChatGptSubmissionDomState {
  userTurnCount: number;
  assistantTurnCount: number;
  visibleStopButtonCount: number;
  turnIdentities: string[];
  userIdentities: string[];
  responseIdentities: string[];
}

interface ChatGptSubmissionDomCache {
  key?: string;
  snapshot?: ChatGptSubmissionDomState;
  fullScans?: number;
  cacheHits?: number;
}

export interface ResolvedBrowserConfig {
  appName: string;
  browserHost: "managed-chrome" | "launcher";
  browserHostDescriptorPath?: string;
  browserHelperScriptPath?: string;
  browserDiagnosticsPath?: string;
  storageStatePath: string;
  chromeExecutablePath: string;
  turnTimeoutMs?: number;
  headed: boolean;
  autoApproveToolCalls: boolean;
  useSavedChats: boolean;
}

export type ChatGptConnectorAttachmentMode = "none" | "mention";

/** Conversation ownership is reusable; the connector mention belongs to each physical message. */
export function chatGptConnectorAttachmentMode(
  localTools: boolean,
  _reuseConversation: boolean,
): ChatGptConnectorAttachmentMode {
  if (!localTools) return "none";
  return "mention";
}

export async function setChatGptThinkMode(
  composerForm: Locator,
  enabled: boolean,
  captureDiagnostic?: (checkpoint: string) => Promise<void>,
  abortSignal?: AbortSignal,
): Promise<void> {
  throwIfPromptAttachmentAborted(abortSignal);
  const controls = composerForm
    .getByRole("button", { name: "Think", exact: true })
    .filter({ visible: true });
  const count = await controls.count();
  if (count === 0 && !enabled) {
    await captureDiagnostic?.("luna-default-confirmed");
    return;
  }
  if (count > 1) throw new Error(`ChatGPT exposed ${count} visible Think controls`);
  const control = controls.first();
  const actionOptions = { signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS };
  let pressed = count === 1 ? await control.getAttribute("aria-pressed", actionOptions) : null;
  if (count === 1 && pressed !== "true" && pressed !== "false") {
    throw new Error("ChatGPT Think control has no semantic pressed state");
  }
  const target = enabled ? "true" : "false";
  if (pressed !== target) {
    const composer = composerForm.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true }).first();
    const composerState = () => composer.evaluate(element => {
      const copy = element.cloneNode(true) as HTMLElement;
      const pills = [...copy.querySelectorAll('[data-id^="plugin:"][data-keyword]')];
      const connectors = pills.map(pill => pill.getAttribute("data-keyword")).sort();
      for (const pill of pills) pill.remove();
      const text = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? element.value : copy.textContent ?? "";
      return { text: text.trim(), connectors };
    }, undefined, actionOptions);
    const before = await composerState();
    if (before.text) throw new Error("ChatGPT Think selection requires an empty prompt draft");
    await composer.focus(actionOptions);
    await composer.press(CHATGPT_COMPOSER_DOCUMENT_END_KEY, actionOptions);
    await composer.pressSequentially("/think", { ...actionOptions, delay: 25 });
    await captureDiagnostic?.("think-slash-triggered");
    // The command popup shares menu-item classes with sidebar history. Count only this popup.
    const popup = composerForm.page().locator('.popover[aria-busy="false"]').filter({ visible: true });
    const rows = popup.locator('.__menu-item[tabindex="0"]').filter({ visible: true });
    await rows.first().waitFor({ state: "visible", timeout: 30_000, signal: abortSignal });
    if (await popup.count() !== 1 || await rows.count() !== 1) {
      throw new Error("ChatGPT Think slash menu must expose exactly one command option");
    }
    const row = rows.first();
    if (await row.getAttribute("data-highlighted", actionOptions) === null) {
      await composer.press("ArrowDown", actionOptions);
    }
    if (await row.getAttribute("data-highlighted", actionOptions) === null) {
      throw new Error("ChatGPT Think slash option is not highlighted");
    }
    await captureDiagnostic?.("think-slash-menu-ready");
    throwIfPromptAttachmentAborted(abortSignal);
    await composer.press("Enter", actionOptions);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      throwIfPromptAttachmentAborted(abortSignal);
      const currentCount = await controls.count();
      if (currentCount > 1) throw new Error(`ChatGPT exposed ${currentCount} visible Think controls`);
      pressed = currentCount === 1 ? await control.getAttribute("aria-pressed", actionOptions) : null;
      if (pressed === target) break;
      if (currentCount === 1 && pressed !== "true" && pressed !== "false") {
        throw new Error("ChatGPT Think control lost its semantic pressed state");
      }
      await withBrowserTurnAbort(new Promise(resolveSleep => setTimeout(resolveSleep, 100)), abortSignal);
    }
    if (pressed !== target) {
      throw new Error(`ChatGPT did not ${enabled ? "enable" : "disable"} Think mode`);
    }
    const after = await composerState();
    if (after.text || JSON.stringify(after.connectors) !== JSON.stringify(before.connectors)) {
      throw new Error("ChatGPT Think slash selection did not preserve the empty draft and selected connectors");
    }
  }
  await captureDiagnostic?.(enabled ? "think-enabled" : "think-disabled");
}

export function resolveBrowserConfig(provider: CodexProviderConfig): ResolvedBrowserConfig {
  const configured = provider.chatgptWeb ?? {};
  const appName = configured.appName?.trim() || CHATGPT_CONNECTOR_NAME;
  const browserHost = configured.browserHost ?? "managed-chrome";
  const browserHostDescriptorPath = configured.browserHostDescriptorPath?.trim();
  const browserHelperScriptPath = configured.browserHelperScriptPath?.trim();
  const browserDiagnosticsPath = resolve(expandUserPath(
    configured.browserDiagnosticsPath?.trim() || join(getConfigDir(), "diagnostics", "browser-turns"),
  ));
  const turnTimeoutMs = configured.turnTimeoutMs;
  if (browserHost === "launcher" && !browserHostDescriptorPath) {
    throw new Error("Launcher browser host requires chatgptWeb.browserHostDescriptorPath");
  }
  if (browserHelperScriptPath && browserHost !== "launcher") {
    throw new Error("Explicit browser helper script requires a launcher host");
  }
  const resolvedBrowserHelperScriptPath = browserHelperScriptPath
    ? resolve(expandUserPath(browserHelperScriptPath))
    : undefined;
  if (resolvedBrowserHelperScriptPath && !existsSync(resolvedBrowserHelperScriptPath)) {
    throw new Error(`Explicit browser helper script does not exist: ${resolvedBrowserHelperScriptPath}`);
  }
  if (turnTimeoutMs !== undefined
    && (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs <= 0)) {
    throw new Error("ChatGPT Web turnTimeoutMs must be a positive finite number");
  }
  if (isLegacyChatGptConnectorName(appName)) {
    throw new Error(legacyChatGptConnectorMigrationMessage(appName));
  }
  return {
    appName,
    browserHost,
    ...(browserHostDescriptorPath ? { browserHostDescriptorPath: resolve(expandUserPath(browserHostDescriptorPath)) } : {}),
    ...(resolvedBrowserHelperScriptPath ? { browserHelperScriptPath: resolvedBrowserHelperScriptPath } : {}),
    browserDiagnosticsPath,
    storageStatePath: resolve(expandUserPath(configured.storageStatePath?.trim() || join(getConfigDir(), "browser", "storage-state.json"))),
    chromeExecutablePath: resolve(expandUserPath(configured.chromeExecutablePath?.trim() || defaultChromeExecutable())),
    ...(turnTimeoutMs !== undefined ? { turnTimeoutMs } : {}),
    headed: configured.headed !== false,
    autoApproveToolCalls: configured.autoApproveToolCalls === true,
    useSavedChats: configured.useSavedChats === true,
  };
}

export class ChatGptBrowserWorker {
  static forProvider(provider: CodexProviderConfig): ChatGptBrowserWorker {
    const config = resolveBrowserConfig(provider);
    const key = JSON.stringify(config);
    let worker = workers.get(key);
    if (!worker) {
      worker = new ChatGptBrowserWorker(config);
      workers.set(key, worker);
    }
    return worker;
  }

  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private managedBrowserReady?: Promise<{ browser: Browser; context: BrowserContext }>;
  private readonly managedPageReleases = new Map<Page, () => void>();
  private readonly pendingManagedReleases = new Set<() => void>();
  private launcherHelper?: LauncherBrowserHelperClient;
  private maintenanceTail: Promise<void> = Promise.resolve();
  private readonly activeRuns = new Map<string, Promise<string>>();
  private readonly preparationBudgets = new Map<string, ChatGptPreparationRecovery>();

  private constructor(private readonly config: ResolvedBrowserConfig) {}

  run(turn: BrowserTurn): Promise<string> {
    if (this.activeRuns.has(turn.traceId)) {
      return Promise.reject(new Error(`Duplicate ChatGPT web browser turn: ${turn.traceId}`));
    }
    if (this.config.browserHost === "launcher" && !turn.scheduling && this.activeRuns.size >= MAX_CHATGPT_BROWSER_TABS) {
      return Promise.reject(new Error(
        `ChatGPT Web supports at most ${MAX_CHATGPT_BROWSER_TABS} simultaneous browser turns; close or finish a browser tab before starting another`,
      ));
    }
    const useHelper = this.config.browserHost === "launcher" && process.env.WEB2HARNESS_BROWSER_HELPER_PROCESS !== "1";
    if (useHelper) {
      this.launcherHelper ??= new LauncherBrowserHelperClient(this.config);
    }
    const execute = async (current: BrowserTurn) => {
      current.abortSignal?.throwIfAborted();
      if (this.config.browserHost === "managed-chrome") await requireLicense();
      current.abortSignal?.throwIfAborted();
      current.onQueueDispatched?.();
      return useHelper ? this.launcherHelper!.run(current) : this.runExclusive(current);
    };
    const run = Promise.resolve().then(async () => {
      const scheduling = turn.scheduling ?? (this.config.browserHost === "managed-chrome" ? {
        id: createHash("sha256").update(turn.traceId).digest("hex"), groupId: turn.conversationKey ?? turn.traceId,
        model: chatGptWebQueueModel(turn.modelId, turn.modelFamily, turn.reasoning), effort: turn.reasoning, mode: turn.capabilities.localToolsEnabled ? "mcp-bridge"
          : turn.capabilities.nativeToolsEnabled ? "native-tools" : "browser-only", bytes: 0,
      } : undefined);
      if (!scheduling || turn.queueTicket) return execute(turn);
      const key = turn.preparationKey ?? scheduling.id;
      const now = Date.now();
      for (const [oldKey, old] of this.preparationBudgets) {
        if (old.closedAt !== undefined && now - old.closedAt > 30 * 60_000) this.preparationBudgets.delete(oldKey);
      }
      // An explicitly authorized model/error retry still gets its ordinary first preparation.
      // It cannot receive an initialization recovery or overwrite that native round's consumed
      // recovery budget. Model generation time must not expire a later authorized retry's setup.
      const separateAttempt = turn.allowPreparationRecovery === false;
      const budget = separateAttempt ? new ChatGptPreparationRecovery()
        : this.preparationBudgets.get(key) ?? new ChatGptPreparationRecovery();
      if (!separateAttempt) this.preparationBudgets.set(key, budget);
      let submissionStarted = false;
      const queuedTurn: BrowserTurn = { ...turn, onSendActivated: async () => {
        submissionStarted = true;
        await turn.onSendActivated?.();
      }, onSubmitted: async () => { submissionStarted = true; await turn.onSubmitted?.(); } };
      try {
        for (;;) {
          turn.abortSignal?.throwIfAborted();
          try {
            const job = budget.recoveries === 0 ? scheduling : { ...scheduling,
              id: createHash("sha256").update(`${scheduling.id}:preparation:${budget.recoveries}`).digest("hex") };
            return await withQueuedRequest({ descriptorPath: await this.requestQueueTarget(), job,
              traceId: turn.traceId, signal: turn.abortSignal,
              remoteVerified: turn.mcpRemoteVerified,
              execute: async (queueTicket, signal) => {
                try { return await execute({ ...queuedTurn, queueTicket, abortSignal: signal }); }
                catch (error) {
                  // execute has physically settled the old browser. Only the broker can authorize
                  // recovery; the remote error itself confers no tool or replay permissions.
                  if (error instanceof ChatGptWebAdapterError && error.mcpRemote
                    && ["rate_limit", "unavailable"].includes(error.mcpRemote.kind)
                    && (error.mcpRemote.retryAfterMs ?? 0) <= 120_000 && !signal.aborted && !turn.compaction
                    && await turn.authorizeMcpRecovery?.() && !signal.aborted) {
                    throw new ChatGptWebAdapterError(error.message, { status: error.status, errorType: error.errorType,
                      code: error.code, retryable: true, mcpRemote: error.mcpRemote, cause: error });
                  }
                  throw error;
                }
              },
            });
          } catch (error) {
            if (!(error instanceof ChatGptWebAdapterError) || error.code !== CHATGPT_UNSUBMITTED_PREPARATION) throw error;
            turn.abortSignal?.throwIfAborted();
            // This error is issued only by the initial-page readiness boundary after a DOM/network
            // proof. Repeat the daemon's authoritative tool/send checks after physical cleanup.
            if (turn.allowPreparationRecovery === false || turn.compaction || submissionStarted
              || !noToolActivity(turn.externalProgress?.snapshot()) || !budget.recover()) {
              throw preparationError("chatgpt_composer_unavailable");
            }
            diagnosticEvent("info", "browser.preparation_requeued", { traceId: turn.traceId,
              attempt: budget.recoveries });
            // withQueuedRequest settled the failed lease. A fresh admission observes normal fairness
            // and send spacing; no browser action or backoff holds the previous execution slot.
          }
        }
      } finally { budget.closedAt = Date.now(); }
    });
    this.activeRuns.set(turn.traceId, run);
    void run.finally(() => {
      if (this.activeRuns.get(turn.traceId) === run) this.activeRuns.delete(turn.traceId);
    }).catch(() => {});
    return run;
  }

  private async requestQueueTarget(): Promise<RequestQueueTarget> {
    return this.config.browserHost === "launcher" ? this.config.browserHostDescriptorPath!
      : getStandaloneRequestQueue(this.config.storageStatePath);
  }

  verifyConnector(traceId = `verify_${randomUUID().replaceAll("-", "")}`, abortSignal?: AbortSignal): Promise<string> {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) {
      return Promise.reject(new Error("ChatGPT connector verification trace id is invalid"));
    }
    return this.enqueueMaintenance("connector verification", () => this.verifyConnectorExclusive(traceId, abortSignal));
  }

  inspectSession(detectCapabilities: boolean, abortSignal?: AbortSignal): Promise<{
    authenticated: true;
    temporary: true;
    url: string;
    solAvailable?: boolean;
    extraHighAvailable?: boolean;
    proAvailable?: boolean;
  }> {
    return this.enqueueMaintenance("session inspection", () => this.inspectSessionExclusive(detectCapabilities, abortSignal));
  }

  smokeTest(abortSignal?: AbortSignal, traceId?: string): Promise<{ effort: string; response: string }> {
    return this.enqueueMaintenance("smoke test", () => this.smokeTestExclusive(abortSignal, traceId));
  }

  inspectLimitsPlan(abortSignal?: AbortSignal) {
    return this.enqueueMaintenance("Limits setup", async () => {
      abortSignal?.throwIfAborted();
      const page = await this.ensurePage();
      await this.prepareChatSurface(page, undefined, false, { signal: abortSignal });
      const plan = await detectChatGptLimitsPlan(page);
      abortSignal?.throwIfAborted();
      return plan;
    });
  }

  private enqueueMaintenance<T>(name: string, action: () => Promise<T>): Promise<T> {
    const operation = this.maintenanceTail.then(() => {
      if (this.activeRuns.size > 0) {
        throw new Error(`ChatGPT ${name} requires all browser turns to finish`);
      }
      return action();
    });
    this.maintenanceTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async close(): Promise<void> {
    if (this.launcherHelper) {
      const helper = this.launcherHelper;
      this.launcherHelper = undefined;
      await helper.close();
    }
    await Promise.allSettled([...this.activeRuns.values()]);
    await this.maintenanceTail;
    const browser = this.browser;
    // For connectOverCDP, Playwright implements Browser.close as a transport disconnect; it does
    // not close the launcher-owned Electron process. Always release that connection and its
    // artifact directory instead of leaking one per timeout/helper lifecycle.
    if (browser) await operationStage("cleanup", () => withChatGptBrowserObservationTimeout(browser.close(), 120_000));
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.managedBrowserReady = undefined;
    for (const release of this.pendingManagedReleases) release();
    this.pendingManagedReleases.clear(); this.managedPageReleases.clear();
  }

  private async runStage<T>(
    traceId: string,
    stage: string,
    timeoutMs: number | undefined,
    action: (abortSignal: AbortSignal) => Promise<T>,
    suspensionClock: Pick<ChatGptSuspensionClock, "suspendedMs"> = chatGptSuspensionClock,
    awaitAbortedActionSettlement = false,
    retirement?: { graceMs: number; closeOwnedPage(): Promise<void> },
  ): Promise<T> {
    chatGptSuspensionClock.start();
    const startedAt = performance.now();
    const suspendedAtStart = suspensionClock.suspendedMs();
    const operationId = randomUUID();
    const stageContext = { ...diagnosticContext.getStore(), traceId, operationId, parentOperationId: diagnosticContext.getStore()?.operationId, stage, timeoutMs };
    diagnosticEvent("info", "browser.stage_started", { ...stageContext, outcome: "started" });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stageTimedOut = false;
    let actionPromise: Promise<T> | undefined;
    try {
      const timeout = new Promise<never>((_, rejectTimeout) => {
        if (timeoutMs === undefined) return; // orchestration only; its operations own their timers
        const fireOrRearm = () => {
          // A stage that spans a system sleep has not consumed its budget: the browser was as
          // frozen as this process, so slept time is refunded before the timer is re-armed.
          const suspendedMs = suspensionClock.suspendedMs() - suspendedAtStart;
          const remaining = remainingStageBudgetMs(timeoutMs, performance.now() - startedAt, suspendedMs);
          if (remaining > 0) {
            timer = setTimeout(fireOrRearm, remaining);
            return;
          }
          stageTimedOut = true;
          controller.abort();
          rejectTimeout(new Error(`ChatGPT browser stage timed out: ${stage}`));
        };
        timer = setTimeout(fireOrRearm, timeoutMs);
      });
      actionPromise = diagnosticContext.run(stageContext, () => action(controller.signal));
      const value = await Promise.race([actionPromise, timeout]);
      diagnosticEvent("info", "browser.stage_completed", { ...stageContext, outcome: "completed", durationMs: Math.round(performance.now() - startedAt) });
      return value;
    } catch (error) {
      let surfacedError = error;
      if (stageTimedOut && awaitAbortedActionSettlement && actionPromise) {
        const settled = actionPromise.then(
          () => ({ settled: true as const, error: undefined }),
          error => ({ settled: true as const, error }),
        );
        let settlementTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = retirement ? await Promise.race([
            settled,
            new Promise<{ settled: false }>(resolve => {
              settlementTimer = setTimeout(() => resolve({ settled: false }), retirement.graceMs);
            }),
          ]) : await settled;
          if (outcome.settled) {
            if (outcome.error instanceof ChatGptPersistentBrowserStateError) surfacedError = outcome.error;
          } else if (retirement) {
            diagnosticEvent("warning", "browser.stage_cleanup_stalled", {
              ...stageContext, outcome: "timeout", cleanupGraceMs: retirement.graceMs,
            });
            if (settlementTimer) clearTimeout(settlementTimer);
            // A timed-out DOM mutation can still be running inside Chromium. Retire only this
            // task's exclusive page before returning; a rejected promise alone is not settlement.
            await Promise.race([
              retirement.closeOwnedPage(),
              new Promise<never>((_resolve, reject) => {
                settlementTimer = setTimeout(() => reject(new Error("Owned task page close was not acknowledged")), retirement.graceMs);
              }),
            ]);
            surfacedError = new ChatGptWebAdapterError(
              `ChatGPT task page stopped responding during ${stage}; its page was closed. Retry the task.`,
              { status: 502, errorType: "server_error", code: "chatgpt_browser_unresponsive", retryable: false, cause: error },
            );
          }
        } catch (settlementError) {
          surfacedError = new ChatGptPersistentBrowserStateError(
            [error, settlementError], "ChatGPT stage timed out and its task page could not be closed",
          );
        } finally {
          if (settlementTimer) clearTimeout(settlementTimer);
        }
      }
      const failure = diagnosticError(surfacedError);
      diagnosticEvent(failure.category === "cancelled" ? "info" : "error", "browser.stage_failed", {
        ...stageContext, outcome: stageTimedOut ? "timeout" : failure.category === "cancelled" ? "cancelled" : "failed",
        durationMs: Math.round(performance.now() - startedAt), error: failure,
      });
      throw surfacedError;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.config.browserHost === "launcher") {
      const connection = await connectLauncherBrowserHost(this.config.browserHostDescriptorPath!);
      this.browser = connection.browser;
      this.context = connection.context;
      this.page = connection.page;
      return this.page;
    }
    if (!existsSync(this.config.storageStatePath) || !existsSync(loginVerificationMarkerPath(this.config.storageStatePath))) {
      throw new Error(`ChatGPT web login state is missing: ${this.config.storageStatePath}`);
    }
    if (!existsSync(this.config.chromeExecutablePath)) {
      throw new Error(`Configured Chrome executable does not exist: ${this.config.chromeExecutablePath}`);
    }
    const { context } = await this.ensureManagedBrowser();
    this.context = context;
    this.page = await acquireOwnedBrowserResource(() => this.context!.newPage(), page => page.close());
    return this.page;
  }

  private async ensureManagedBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
    await getStandaloneRequestQueue(this.config.storageStatePath);
    if (this.managedBrowserReady) return this.managedBrowserReady;
    const opening = (async () => {
      if (!existsSync(this.config.storageStatePath) || !existsSync(loginVerificationMarkerPath(this.config.storageStatePath))) {
        throw new Error(`ChatGPT web login state is missing: ${this.config.storageStatePath}`);
      }
      if (!existsSync(this.config.chromeExecutablePath)) {
        throw new Error(`Configured Chrome executable does not exist: ${this.config.chromeExecutablePath}`);
      }
      const browser = await chromium.launch({
        executablePath: this.config.chromeExecutablePath,
        headless: !this.config.headed,
        timeout: 120_000,
      });
      this.browser = browser;
      let context: BrowserContext;
      try { context = await acquireOwnedBrowserResource(
        () => browser.newContext({ storageState: this.config.storageStatePath }), context => context.close(),
      ); }
      catch (error) {
        try { await operationStage("cleanup", () => withChatGptBrowserObservationTimeout(browser.close(), 120_000)); }
        catch (cleanupError) {
          throw new ChatGptPersistentBrowserStateError([error, cleanupError], "Browser context creation failed and its browser did not close");
        }
        this.browser = undefined;
        throw error;
      }
      this.context = context;
      return { browser, context };
    })();
    this.managedBrowserReady = opening;
    try {
      return await opening;
    } catch (error) {
      if (this.managedBrowserReady === opening) this.managedBrowserReady = undefined;
      throw error;
    }
  }

  /**
   * A Codex turn owns one isolated browser conversation. Reusing the same
   * ChatGPT SPA page can retain the previous transcript and autocomplete DOM,
   * so an @app lookup may select stale UI from the preceding turn.
   */
  private async pageForNewTurn(turn: BrowserTurn): Promise<Page> {
    if (this.config.browserHost === "launcher") {
      throw new Error("Launcher turns require an explicitly leased browser surface");
    }
    if (!turn.queueTicket) throw new Error("Managed browser turns require queue admission");
    const queue = await getStandaloneRequestQueue(this.config.storageStatePath);
    let released = false;
    const release = () => { released = true; this.pendingManagedReleases.delete(release); };
    try { await queue.holdResource(turn.queueTicket, () => released); }
    catch (error) { release(); throw error; }
    this.pendingManagedReleases.add(release);
    let context: BrowserContext;
    try { ({ context } = await this.ensureManagedBrowser()); }
    catch (error) { if (!this.browser) release(); throw error; }
    const page = await acquireOwnedBrowserResource(() => context.newPage(), async page => {
      await page.close();
      if (page.isClosed()) release();
    }, turn.abortSignal);
    this.managedPageReleases.set(page, release);
    return page;
  }

  private async selectModelAndEffort(
    page: Page, modelId: string, reasoning: string | undefined, capabilities: ChatGptWebCapabilities,
    captureDiagnostic?: (checkpoint: string) => Promise<void>, trackUsage = false, modelFamily?: "5.6" | "6",
  ): Promise<SelectedChatGptWebModelMode> {
    const execute = async (): Promise<SelectedChatGptWebModelMode> => {
      const mode = resolveChatGptWebModelMode(modelId, reasoning, capabilities);
      const composer = await this.activeComposer(page);
      const composerForm = composer.locator("xpath=ancestor::form[1]");
      const uiEffortIndex = mode.uiEffortIndex;
      if (uiEffortIndex === null) {
        await settleChatGptUi();
        await throwIfChatGptRateLimitDialog(page);
        const visibleControls = composerForm.locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
        if (await visibleControls.count() > 0) {
          throw chatGptModelControlUnavailableError(
            "ChatGPT Luna was selected from a Luna-only capability probe, but the account now exposes a model selector; rerun setup",
          );
        }
        // Enable Think during prompt attachment, after fresh connector selection. Ordinary Luna
        // still clears a previous Think selection here; retained Think is checked on every attach.
        if (!mode.thinkEnabled) await setChatGptThinkMode(composerForm, false, captureDiagnostic);
        return trackUsage ? { ...mode, usageModel: "gpt-5.6-luna" } : mode;
      }
      const currentEffort = composerForm.locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
      const effortWaitAbort = new AbortController();
      try {
        const ready = await Promise.race([
          currentEffort.waitFor({ state: "visible", timeout: 120_000, signal: effortWaitAbort.signal }).then(() => "effort" as const),
          chatGptRateLimitDialog(page).waitFor({ state: "visible", timeout: 0, signal: effortWaitAbort.signal }).then(() => "rate-limit" as const),
          chatGptExpiredSessionAlert(page).waitFor({ state: "visible", timeout: 0, signal: effortWaitAbort.signal }).then(() => "session-expired" as const),
        ]);
        if (ready === "rate-limit") await throwIfChatGptRateLimitDialog(page);
        if (ready === "session-expired") await throwIfChatGptSessionFailureAlert(page);
      } catch (error) {
        if (error instanceof ChatGptWebAdapterError) throw error;
        await throwIfChatGptRateLimitDialog(page);
        await throwIfChatGptSessionFailureAlert(page);
        throw chatGptModelControlUnavailableError(
          "ChatGPT rendered the composer but its model/effort control did not become ready",
        );
      } finally {
        effortWaitAbort.abort();
      }
      await settleChatGptUi();
      await throwIfChatGptRateLimitDialog(page);
      diagnosticEvent("info", "browser.model_control_ready", { phase: "control", outcome: "visible" });
      await captureDiagnostic?.("effort-control-ready");
      await throwIfChatGptRateLimitDialog(page);
      let activation = await activateChatGptEffortMenu(page, currentEffort);
      diagnosticEvent("info", "browser.model_menu_opened", { method: activation.method, outcome: "opened" });
      if (modelFamily) activation = await selectChatGptModelFamily(
        activation, modelFamily, () => activateChatGptEffortMenu(page, currentEffort),
      );
      if (activation.method === "pointerdown") {
        await captureDiagnostic?.("effort-menu-pointerdown-fallback");
      }
      await captureDiagnostic?.("effort-menu-open-requested");
      const effortSlider = activation.slider;
      const sliderContainer = activation.sliderContainer;
      const waitAbort = new AbortController();
      try {
        const ready = await Promise.race([
          sliderContainer.waitFor({ state: "visible", timeout: 120_000, signal: waitAbort.signal })
            .then(() => effortSlider.waitFor({ state: "attached", timeout: 120_000, signal: waitAbort.signal }))
            .then(() => "slider" as const),
          // These watchers only interrupt on a real alert. The two sequential hydration
          // operations above own their individual deadlines; finally cancels the watchers.
          chatGptRateLimitDialog(page).waitFor({ state: "visible", timeout: 0, signal: waitAbort.signal }).then(() => "rate-limit" as const),
          chatGptExpiredSessionAlert(page).waitFor({ state: "visible", timeout: 0, signal: waitAbort.signal }).then(() => "session-expired" as const),
        ]);
        if (ready === "rate-limit") await throwIfChatGptRateLimitDialog(page);
        if (ready === "session-expired") await throwIfChatGptSessionFailureAlert(page);
        await captureDiagnostic?.("effort-slider-visible");
      } catch (error) {
        if (error instanceof ChatGptWebAdapterError) throw error;
        await throwIfChatGptRateLimitDialog(page);
        await throwIfChatGptSessionFailureAlert(page);
        throw chatGptModelControlUnavailableAdapterError(
          `ChatGPT effort slider did not become ready for item index ${uiEffortIndex}`,
        );
      } finally {
        waitAbort.abort();
      }
      const selectionUrl = page.url();
      const readAvailableEffort = async (container: Locator, menu: Locator) => {
        const state = await readChatGptEffortSnapshot(container)
          .catch(error => { throw chatGptModelControlUnavailableAdapterError(String(error)); });
        if (uiEffortIndex > state.max - state.min) {
          const detail = uiEffortIndex === 4 ? await chatGptUnavailableProDetail(menu) : undefined;
          throw chatGptModelControlUnavailableAdapterError(
            `ChatGPT effort slider does not expose item index ${uiEffortIndex} (min=${state.min}; max=${state.max})`
            + (uiEffortIndex === 4 ? " ChatGPT may have temporarily hidden Pro because you reached its usage limit." : ""),
            detail,
          );
        }
        if (!state.available[uiEffortIndex]) {
          throw new ChatGptWebAdapterError(
            `ChatGPT locks the browser option requested for ${mode.displayLabel} behind an upgrade. `
            + "The message was not sent. Choose an available effort and run Repair Codex setup to refresh the model list.",
            { status: 400, errorType: "invalid_request_error", code: "chatgpt_effort_locked", retryable: false },
          );
        }
        return state;
      };
      let sliderState = await readAvailableEffort(sliderContainer, activation.menu);
      const initialMin = sliderState.min;
      const targetValue = initialMin + uiEffortIndex;
      diagnosticEvent("info", "browser.effort_selection", { previousValue: sliderState.value, targetValue, min: sliderState.min, max: sliderState.max });
      const sliderControl = effortSlider.locator("xpath=ancestor::*[@role='menuitem'][1]");
      while (sliderState.value !== targetValue) {
        await throwIfChatGptRateLimitDialog(page);
        const direction = targetValue > sliderState.value ? 1 : -1;
        const key = direction > 0 ? "ArrowRight" : "ArrowLeft";
        const previousValue = sliderState.value;
        await sliderControl.press(key, { timeout: 60_000 });
        diagnosticEvent("debug", "browser.effort_action", { previousValue, targetValue, direction, outcome: "action-returned" });
        const changeDeadline = Date.now() + 30_000;
        do {
          sliderState = await readAvailableEffort(sliderContainer, activation.menu);
          if (sliderState.min !== initialMin) {
            throw chatGptModelControlUnavailableError("ChatGPT changed its effort range origin during selection");
          }
          if (sliderState.value !== previousValue) break;
          await new Promise(resolveSleep => setTimeout(resolveSleep, 50));
        } while (Date.now() < changeDeadline);
        if (sliderState.value !== previousValue + direction) {
          throw chatGptModelControlUnavailableError(
            `ChatGPT effort slider did not move exactly one step with ${key}`
            + ` (before=${previousValue}; after=${sliderState.value})`,
          );
        }
      }
      await settleChatGptUi();
      const selectedState = await readAvailableEffort(sliderContainer, activation.menu);
      if (selectedState.min !== initialMin || selectedState.value !== targetValue) {
        throw chatGptModelControlUnavailableAdapterError("ChatGPT changed its effort range or selection before the menu closed");
      }
      await captureDiagnostic?.("effort-selected");
      if (modelFamily) await assertChatGptModelFamily(activation, modelFamily, mode.effort, uiEffortIndex, CHATGPT_MODEL_CONTROL_SETTLE_MS);
      const usageModel = trackUsage ? await readChatGptUsageModel(activation.slider, mode.effort === "max")
        .catch(() => mode.effort === "max" ? "pro-unknown" as const : "other" as const) : undefined;
      await closeChatGptEffortMenu(page, currentEffort);
      await settleChatGptUi();
      // Verify the open selection, then close once and retain its committed trigger label.
      // Final send preflight checks persistence; an immediate close/reopen races menu cleanup.
      const selectedMode: SelectedChatGptWebModelMode = {
        ...mode,
        ...(modelFamily ? { modelFamily } : {}),
        ...(usageModel ? { usageModel } : {}),
        selection: { url: selectionUrl, label: (await currentEffort.innerText()).trim() },
      };
      await this.assertSelectedEffort(page, selectedMode, false);
      await captureDiagnostic?.("effort-selection-confirmed");
      return selectedMode;
    };
    const started = performance.now();
    const context = { ...diagnosticContext.getStore(), operationId: randomUUID(), parentOperationId: diagnosticContext.getStore()?.operationId,
      requestedModel: modelId, requestedEffort: reasoning ?? "default", modelFamily };
    return diagnosticContext.run(context, async () => {
      diagnosticEvent("info", "browser.model_selection_started", { outcome: "started" });
      try {
        const mode = await execute();
        diagnosticEvent("info", "browser.model_selection_verified", { outcome: "verified", verifiedModel: modelId,
          verifiedEffort: mode.effort, verification: "composer-controls", durationMs: Math.round(performance.now() - started) });
        return mode;
      } catch (error) {
        const failure = diagnosticError(error);
        diagnosticEvent(failure.category === "cancelled" ? "info" : "error", "browser.model_selection_failed", {
          outcome: failure.category === "cancelled" ? "cancelled" : "failed", submission: "not-sent", verifiedModel: "unknown",
          durationMs: Math.round(performance.now() - started), error: failure });
        throw error;
      }
    });
  }

  private async assertSelectedEffort(page: Page, mode: SelectedChatGptWebModelMode, verifyFamily = true): Promise<void> {
    if (!mode.selection) return;
    const composer = await this.activeComposer(page);
    const controls = composer.locator("xpath=ancestor::form[1]")
      .locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
    if (page.url() !== mode.selection.url || !mode.selection.label || await controls.count() !== 1) {
      throw chatGptModelControlUnavailableAdapterError("ChatGPT changed the selected model's browser surface before submission");
    }
    const control = controls.first();
    if ((await control.innerText()).trim() !== mode.selection.label
      || await control.getAttribute("aria-expanded") !== "false"
      || !await composer.isEditable()) {
      throw chatGptModelControlUnavailableAdapterError(
        "ChatGPT did not retain the selected effort in its ready composer; the message was not submitted",
      );
    }
    if (verifyFamily && mode.uiEffortIndex !== null) {
      diagnosticEvent("info", "browser.model_preflight", { stage: "menu_open", outcome: "started" });
      const menu = await activateChatGptEffortMenu(page, control);
      try {
        diagnosticEvent("info", "browser.model_preflight", { stage: "selection_read", outcome: "started" });
        const state = await readChatGptEffortSnapshot(menu.sliderContainer);
        if (!state.available[mode.uiEffortIndex] || state.value !== state.min + mode.uiEffortIndex) {
          throw chatGptModelControlUnavailableAdapterError("ChatGPT did not retain the requested available effort before submission");
        }
        if (mode.modelFamily) await assertChatGptModelFamily(menu, mode.modelFamily, mode.effort, mode.uiEffortIndex, CHATGPT_MODEL_CONTROL_SETTLE_MS);
      } finally {
        diagnosticEvent("info", "browser.model_preflight", { stage: "menu_close", outcome: "started" });
        await closeChatGptEffortMenu(page, control);
      }
      diagnosticEvent("info", "browser.model_preflight", { stage: "closed_control_read", outcome: "started" });
      if (page.url() !== mode.selection.url || (await control.innerText()).trim() !== mode.selection.label
        || await control.getAttribute("aria-expanded") !== "false" || !await composer.isEditable()) {
        throw chatGptModelControlUnavailableAdapterError("ChatGPT changed the model while checking its family before submission");
      }
    }
  }

  private async activeComposer(
    page: Page,
    timeoutMs = 60_000,
    abortSignal?: AbortSignal,
  ): Promise<Locator> {
    const composers = page.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true });
    const deadline = Date.now() + timeoutMs;
    let count = 0;
    while (Date.now() < deadline) {
      throwIfPromptAttachmentAborted(abortSignal);
      count = await withBrowserTurnAbort(
        withChatGptBrowserObservationTimeout(
          composers.count(),
          Math.max(1, Math.min(CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS, deadline - Date.now())),
        ),
        abortSignal,
      );
      if (count === 1) return composers.first();
      await withBrowserTurnAbort(
        new Promise(resolveSleep => setTimeout(resolveSleep, 50)),
        abortSignal,
      );
    }
    throw preparationError(count > 1 ? "chatgpt_page_structure_unsupported" : "chatgpt_composer_unavailable");
  }

  /** Prepare a new conversation; account inspection still uses an empty Temporary Chat. */
  private async prepareChatSurface(
    page: Page,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    useSavedChats = false,
    readiness?: { timeoutMs?: number; signal?: AbortSignal; onSnapshot?: (snapshot: ChatGptReadinessSnapshot) => void },
  ): Promise<Locator> {
    // Launcher verification refreshes its owned page before attaching Playwright so a newly added
    // connector is present in the catalog. Navigating again here destroys that freshly hydrated
    // document and made the first verification race a second SPA bootstrap. A leased turn starts on
    // about:blank and therefore still performs exactly one navigation through this same method.
    const targetUrl = chatGptNewChatUrl(useSavedChats);
    readiness?.signal?.throwIfAborted();
    if (page.url() !== targetUrl) {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: browserStageTimeouts.navigation,
        signal: readiness?.signal,
      });
      await captureDiagnostic?.(useSavedChats ? "saved-chat-navigation-complete" : "temporary-chat-navigation-complete");
    }
    // A failed page read is not evidence of an expired login. Preserve the actual
    // observation error; the authenticated-session check below owns login failures.
    const composer = await waitForChatGptReadiness(page, { deadline: Date.now() + (readiness?.timeoutMs ?? browserStageTimeouts.composerReady),
      signal: readiness?.signal, onSnapshot: readiness?.onSnapshot });
    if (!useSavedChats && await dismissChatGptTemporaryChatOnboarding(page, 60_000, readiness?.signal)) {
      await captureDiagnostic?.("temporary-chat-onboarding-dismissed");
    }
    await captureDiagnostic?.("composer-ready");
    await throwIfChatGptSessionFailureAlert(page);
    await assertAuthenticatedChatGptPage(page);
    await assertNewChatPage(page, useSavedChats);
    await captureDiagnostic?.("session-verified");
    return composer;
  }

  private async waitForTurnDomMutation(page: Page, timeoutMs = 50): Promise<void> {
    await page.evaluate(({ timeout, attributeFilter }) => new Promise<void>(resolveMutation => {
      let settled = false;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeoutTimer);
        if (settleTimer) clearTimeout(settleTimer);
        resolveMutation();
      };
      const observer = new MutationObserver(() => {
        if (settleTimer) return;
        // Let one React mutation batch finish before the next compact state read.
        settleTimer = setTimeout(finish, 16);
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter,
      });
      const timeoutTimer = setTimeout(finish, timeout);
    }), { timeout: timeoutMs, attributeFilter: [...CHATGPT_DOM_REVISION_ATTRIBUTES] });
  }

  private async waitForTurnDomOrExternalProgress(
    page: Page,
    afterProgressRevision: number,
    externalProgress?: ChatGptTurnProgressReader,
    signal?: AbortSignal,
  ): Promise<void> {
    const domMutation = this.waitForTurnDomMutation(page);
    if (!externalProgress) {
      await withBrowserTurnAbort(domMutation, signal);
      return;
    }
    const progressWaitAbort = new AbortController();
    const progressSignal = signal
      ? AbortSignal.any([progressWaitAbort.signal, signal])
      : progressWaitAbort.signal;
    try {
      await withBrowserTurnAbort(Promise.race([
        domMutation,
        externalProgress.waitForChange(afterProgressRevision, progressSignal).then(() => undefined),
      ]), signal);
    } finally {
      progressWaitAbort.abort();
    }
  }

  private async waitForSubmissionAccepted(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    signal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    initialToolBatchRevision = externalProgress?.snapshot().lastToolBatchRevision ?? 0,
    completionTracker?: ChatGptCompletionTracker,
    responseAccepted?: () => boolean,
  ): Promise<ChatGptSubmissionEvidence> {
    if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    for (;;) {
      if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      if (responseAccepted?.()) return "response_stream";
      const progress = externalProgress?.snapshot();
      if (progress
        && externalProgress
        && completionTracker?.needsToolBatchObservation(progress.lastToolBatchRevision)) {
        await this.currentSubmissionAnswerText(page, baseline, signal);
        const completion = await readCompletionAnnouncement(page, completionTracker.announcementKey);
        completionTracker.observeToolBatch(progress.lastToolBatchRevision, completion.revision);
        await externalProgress.acknowledgeToolBatch(progress.lastToolBatchRevision);
      }
      if (progress && progress.lastToolBatchRevision > initialToolBatchRevision) return "mcp_tool_call";
      await throwIfChatGptSessionFailureAlert(page);
      await throwIfChatGptRateLimitDialog(page);
      // Until the new response is bound, last() can still be a historical failed answer.
      // Response errors are checked against the bound current turn in the observation loops.
      let evidence: ChatGptSubmissionEvidence | undefined;
      if (externalProgress) {
        const progressWaitAbort = new AbortController();
        const progressSignal = signal
          ? AbortSignal.any([progressWaitAbort.signal, signal])
          : progressWaitAbort.signal;
        try {
          const observed = await withBrowserTurnAbort(Promise.race([
            this.currentSubmissionEvidence(page, baseline, signal).then(value => ({ kind: "dom" as const, value })),
            externalProgress.waitForChange(progress?.revision ?? 0, progressSignal)
              .then(() => ({ kind: "external" as const })),
          ]), signal);
          if (observed.kind === "external") continue;
          evidence = observed.value;
        } finally {
          progressWaitAbort.abort();
        }
      } else {
        evidence = await this.currentSubmissionEvidence(page, baseline, signal);
      }
      if (evidence) return evidence;
      if (responseAccepted?.()) return "response_stream";
      await this.waitForTurnDomOrExternalProgress(
        page,
        progress?.revision ?? 0,
        externalProgress,
        signal,
      );
    }
  }

  private async submissionDomState(
    page: Page,
    cache?: ChatGptSubmissionDomCache,
    signal?: AbortSignal,
  ): Promise<ChatGptSubmissionDomState> {
    throwIfPromptAttachmentAborted(signal);
    const observed = await withChatGptBrowserObservationTimeout(withBrowserTurnAbort(page.evaluate(options => {
      type ObserverState = { id: string; revision: number; observer: MutationObserver };
      const scope = globalThis as typeof globalThis & {
        __WEB2HARNESS_TURN_OBSERVER__?: ObserverState;
      };
      const observerState = scope.__WEB2HARNESS_TURN_OBSERVER__ ??= (() => {
        const state: ObserverState = {
          id: `${performance.timeOrigin}:${Math.random().toString(36).slice(2)}`,
          revision: 0,
          observer: undefined as unknown as MutationObserver,
        };
        state.observer = new MutationObserver(() => {
          state.revision += 1;
        });
        state.observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: options.attributeFilter,
        });
        return state;
      })();
      const observerKey = `${observerState.id}:${observerState.revision}`;
      if (options.knownKey === observerKey) return { key: observerKey };
      const identities = (elements: Element[], attribute: string): string[] => {
        const values = elements.map(element => element.getAttribute(attribute));
        if (values.some(value => typeof value !== "string" || value.trim().length === 0)) {
          throw new Error(`ChatGPT conversation turn has no stable ${attribute} identity`);
        }
        const typed = values as string[];
        if (new Set(typed).size !== typed.length) {
          throw new Error("ChatGPT exposed duplicate conversation turn identities");
        }
        return typed;
      };
      const visible = (element: Element): boolean => {
        const candidate = element as HTMLElement;
        const style = getComputedStyle(candidate);
        const bounds = candidate.getBoundingClientRect();
        return candidate.isConnected
          && style.visibility !== "hidden"
          && (bounds.width > 0 || bounds.height > 0);
      };
      // data-testid contains a display index: ChatGPT can renumber it while the same turn lives.
      // Virtualization removes a turn's section, but retains its outer identity container.
      const containers = [...document.querySelectorAll("[data-turn-id-container]")].filter(element =>
        !element.closest("[data-turn-key]")
        && element.parentElement?.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container")
          !== element.getAttribute("data-turn-id-container"));
      const turnIdentities = identities(containers, "data-turn-id-container");
      const legacyTurns = (selector: string) => [...document.querySelectorAll(selector)]
        .filter(element => element.getAttribute("data-turn-key") == null);
      const userIdentities = identities(legacyTurns(options.userTurnSelector), "data-turn-id");
      const responseIdentities = identities(legacyTurns(options.assistantTurnSelector), "data-turn-id");
      const knownTurns = new Set(turnIdentities);
      if ([...userIdentities, ...responseIdentities].some(identity => !knownTurns.has(identity))) {
        throw new Error("ChatGPT conversation turn has no matching identity container");
      }
      const groups = [...document.querySelectorAll("[data-turn-key]")];
      const groupKeys = identities(groups, "data-turn-key");
      groups.forEach((group, index) => {
        const user = `group:user:${groupKeys[index]}`;
        const assistant = `group:assistant:${groupKeys[index]}`;
        // Keep both logical roles in the baseline even when virtualization unmounts their
        // contents. Remounting an old answer must never acknowledge a new submission.
        turnIdentities.push(user, assistant);
        if (group.querySelector("[data-user-message-bubble]")) userIdentities.push(user);
        if (group.querySelector('[data-conversation-role="assistant"], [data-chatgpt-agent-turn-start]')) responseIdentities.push(assistant);
      });
      return {
        key: observerKey,
        snapshot: {
          userTurnCount: userIdentities.length,
          assistantTurnCount: responseIdentities.length,
          visibleStopButtonCount: [...document.querySelectorAll(options.stopButtonSelector)].filter(visible).length,
          turnIdentities,
          userIdentities,
          responseIdentities,
        },
      };
    }, {
      userTurnSelector: CHATGPT_USER_TURN_SELECTOR,
      assistantTurnSelector: CHATGPT_ASSISTANT_TURN_SELECTOR,
      stopButtonSelector: CHATGPT_STOP_BUTTON_SELECTOR,
      knownKey: cache?.key,
      attributeFilter: [...CHATGPT_DOM_REVISION_ATTRIBUTES],
    }), signal));
    const snapshot = observed.snapshot ?? cache?.snapshot;
    if (!snapshot) throw new Error("ChatGPT turn DOM revision cache has no baseline snapshot");
    if (observed.snapshot && cache) {
      cache.key = observed.key;
      cache.snapshot = observed.snapshot;
      cache.fullScans = (cache.fullScans ?? 0) + 1;
    } else if (!observed.snapshot && cache?.snapshot) {
      cache.cacheHits = (cache.cacheHits ?? 0) + 1;
    }
    return snapshot;
  }

  private async currentSubmissionEvidence(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    signal?: AbortSignal,
  ): Promise<ChatGptSubmissionEvidence | undefined> {
    const state = await this.submissionDomState(page, baseline.domCache, signal);
    const evidence = chatGptSubmissionEvidence({
      initialTurnIdentities: baseline.initialTurnIdentities,
      userIdentities: state.userIdentities,
      responseIdentities: state.responseIdentities,
      generationRunning: state.visibleStopButtonCount > 0,
    });
    if (evidence === "user_turn") {
      // Activity can temporarily replace this group before the assistant is mounted.
      // Preserve the identity that acknowledged Send, independently of rendered text.
      const identity = chatGptNewTurnIdentity(baseline.initialTurnIdentities, state.userIdentities)!;
      if (baseline.acceptedUserIdentity && baseline.acceptedUserIdentity !== identity) {
        throw new Error("ChatGPT changed the user turn that acknowledged the submission");
      }
      baseline.acceptedUserIdentity = identity;
    }
    return evidence;
  }

  private async currentSubmissionAnswerText(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    signal?: AbortSignal,
  ): Promise<string> {
    const state = await this.submissionDomState(page, baseline.domCache, signal);
    const identity = chatGptNewTurnIdentity(
      baseline.initialTurnIdentities,
      state.responseIdentities,
    );
    if (!identity) return "";
    this.assertAssistantTurnOwnership(baseline, state, identity);
    const locator = page.locator(chatGptAssistantTurnSelector(identity));
    return (await this.responseDomSnapshot(locator)).visibleText;
  }

  private assertAssistantTurnOwnership(
    baseline: ChatGptSubmissionBaseline,
    state: ChatGptSubmissionDomState,
    identity: string,
  ): void {
    const user = baseline.acceptedUserIdentity;
    if (!user?.startsWith("group:user:") || !identity.startsWith("group:assistant:")) return;
    const responseUser = `group:user:${identity.slice("group:assistant:".length)}`;
    if (responseUser === user) return;
    // Activity can temporarily replace the accepted exchange with an assistant-only
    // group. Preserve that supported transition, but never adopt a different complete
    // exchange or a competing answer while the accepted user's group is still present.
    // A historical whole group remounted after the baseline is otherwise falsely "new".
    if (state.turnIdentities.includes(user) || state.userIdentities.includes(responseUser)) {
      throw new Error("ChatGPT assistant turn does not belong to the user turn that acknowledged the submission");
    }
  }

  private async captureSubmissionBaseline(page: Page, submittedText?: string): Promise<ChatGptSubmissionBaseline> {
    const userTurns = page.locator(CHATGPT_USER_TURN_SELECTOR);
    const responseTurns = page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR);
    const domCache: ChatGptSubmissionDomCache = {};
    const state = await this.submissionDomState(page, domCache);
    return {
      userTurns,
      responseTurns,
      initialTurnIdentities: state.turnIdentities,
      domCache,
      submittedText,
    };
  }

  private reboundSubmissionBaseline(page: Page, baseline: ChatGptSubmissionBaseline): ChatGptSubmissionBaseline {
    // Reconnecting the owned page is not another Send. An answer may have finished while
    // observation was stalled, so taking a new identity baseline would hide that answer.
    // Only transport-bound locators and the old document's revision cache are disposable.
    return {
      ...baseline,
      userTurns: page.locator(CHATGPT_USER_TURN_SELECTOR),
      responseTurns: page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR),
      domCache: {},
    };
  }

  private async waitForNewAssistantTurn(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    deadline: number | undefined,
    signal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    graceMs: number = CHATGPT_RESPONSE_DOM_GRACE_MS,
    completionTracker?: ChatGptCompletionTracker,
    recoverObservation?: ChatGptObservationRecovery,
    responseComplete?: () => boolean,
    sourceProgress?: () => boolean,
  ): Promise<ChatGptAssistantTurnBinding | undefined> {
    let observationPage = page;
    let observationBaseline = baseline;
    let recoveryAttempts = 0;
    let responseDeadline = Math.min(
      deadline ?? Number.POSITIVE_INFINITY,
      Date.now() + graceMs,
    );
    for (;;) {
      if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      if (observationPage.isClosed()) throw chatGptBrowserTabClosedError();
      if (responseComplete?.()) return undefined;
      if (sourceProgress?.()) responseDeadline = Date.now() + graceMs;
      let progress = externalProgress?.snapshot();
      if (progress?.lastProgressAt !== undefined) {
        responseDeadline = Math.min(
          deadline ?? Number.POSITIVE_INFINITY,
          Math.max(responseDeadline, progress.lastProgressAt + graceMs),
        );
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw chatGptResponseFailure("chatgpt_response_timeout");
      }
      await throwIfChatGptSessionFailureAlert(observationPage);
      await throwIfChatGptRateLimitDialog(observationPage);
      let state: ChatGptSubmissionDomState;
      try {
        state = await this.submissionDomState(
          observationPage,
          observationBaseline.domCache,
          signal,
        );
      } catch (error) {
        if (responseComplete?.() && !signal?.aborted) return undefined;
        const latestProgress = externalProgress?.snapshot();
        if (error instanceof ChatGptBrowserObservationTimeoutError && recoverObservation) {
          recoveryAttempts += 1;
          if (recoveryAttempts > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
            throw chatGptResponseFailure("chatgpt_dom_unresponsive", error);
          }
          const recovered = await recoverObservation(
            recoveryAttempts,
            error,
            observationBaseline,
            signal,
          );
          observationPage = recovered.page;
          observationBaseline = recovered.baseline;
          continue;
        }
        if (!chatGptExternalProgressIsLive(latestProgress, Date.now(), graceMs)) throw error;
        await this.waitForTurnDomOrExternalProgress(
          observationPage,
          latestProgress?.revision ?? 0,
          externalProgress,
          signal,
        );
        continue;
      }
      recoveryAttempts = 0;
      // A tool batch can arrive while the DOM probe is in flight. Read progress again before
      // acknowledging its boundary; the pre-probe snapshot can otherwise leave the broker waiting
      // despite this exact iteration having successfully observed the page.
      progress = externalProgress?.snapshot();
      const identity = chatGptNewTurnIdentity(
        observationBaseline.initialTurnIdentities,
        state.responseIdentities,
      );
      if (identity) this.assertAssistantTurnOwnership(observationBaseline, state, identity);
      if (progress
        && externalProgress
        && completionTracker?.needsToolBatchObservation(progress.lastToolBatchRevision)) {
        if (identity) await this.responseDomSnapshot(
            observationPage.locator(chatGptAssistantTurnSelector(identity)),
          );
        const completion = await readCompletionAnnouncement(observationPage, completionTracker.announcementKey);
        completionTracker.observeToolBatch(progress.lastToolBatchRevision, completion.revision);
        await externalProgress.acknowledgeToolBatch(progress.lastToolBatchRevision);
      }
      if (identity) return {
        identity,
        locator: observationPage.locator(chatGptAssistantTurnSelector(identity)),
        acceptedTurnIdentities: state.turnIdentities,
      };
      // The power UI can expose Stop for a long reasoning phase before mounting any assistant
      // node. Fresh generation evidence extends only DOM grace, never the caller's deadline.
      if (state.visibleStopButtonCount > 0) {
        responseDeadline = Math.min(deadline ?? Number.POSITIVE_INFINITY, Date.now() + graceMs);
      }
      // A delayed renderer wake can cross the grace while the assistant appears. Only a fresh
      // observation can prove it is still missing; the explicit turn deadline remains above.
      if (Date.now() >= responseDeadline
        && !chatGptExternalProgressSuppressesDomHealth(progress, Date.now())) {
        throw chatGptResponseFailure("chatgpt_assistant_turn_missing");
      }
      await this.waitForTurnDomOrExternalProgress(
        observationPage,
        progress?.revision ?? 0,
        externalProgress,
        signal,
      );
    }
  }

  private async reconcileAssistantTurnBinding(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    binding: ChatGptAssistantTurnBinding,
    signal?: AbortSignal,
  ): Promise<ChatGptAssistantTurnBinding> {
    const boundCount = await withChatGptBrowserObservationTimeout(
      withBrowserTurnAbort(binding.locator.count(), signal),
    );
    if (boundCount === 1) {
      if (baseline.acceptedUserIdentity?.startsWith("group:user:")
        && binding.identity.startsWith("group:assistant:")
        && binding.identity !== `group:assistant:${baseline.acceptedUserIdentity.slice("group:user:".length)}`) {
        this.assertAssistantTurnOwnership(baseline, await this.submissionDomState(page, baseline.domCache, signal), binding.identity);
      }
      return binding;
    }
    if (boundCount > 1) {
      throw new Error(`ChatGPT exposed ${boundCount} DOM nodes for the bound assistant turn`);
    }
    const state = await this.submissionDomState(page, baseline.domCache, signal);
    const acceptedTurns = new Set(binding.acceptedTurnIdentities);
    const identity = chatGptReboundTurnIdentity(
      baseline.initialTurnIdentities,
      binding.identity,
      state.responseIdentities,
    );
    const newUsers = state.userIdentities.filter(identity => !acceptedTurns.has(identity));
    if (newUsers.length > 0) {
      // Activity can unmount the accepted user group while it renders a temporary
      // assistant group. Its return must match the ID that acknowledged Send. If no
      // user ID was observed then, require the entire submitted text instead. A
      // surviving old group or any competing new turn remains foreign.
      const user = newUsers[0]!;
      const replacement = identity && newUsers.length === 1
        && binding.identity.startsWith("group:assistant:")
        && user.startsWith("group:user:")
        && identity === `group:assistant:${user.slice("group:user:".length)}`
        && !state.turnIdentities.includes(binding.identity)
        && state.turnIdentities.every(turn => acceptedTurns.has(turn) || turn === user || turn === identity);
      let matches = false;
      if (replacement) {
        const locator = page.locator(chatGptAssistantTurnSelector(identity!));
        matches = baseline.acceptedUserIdentity
          ? user === baseline.acceptedUserIdentity
          : Boolean(baseline.submittedText) && await withChatGptBrowserObservationTimeout(withBrowserTurnAbort(
            this.userMessageMatchesSubmission(locator, baseline.submittedText!, signal), signal,
          ));
        // The accepted user identity (or exact submitted text) establishes ownership.
        // Activity can replace its temporary group while still generating; requiring
        // a completed answer here mistakes that same unfinished turn for a foreign one.
      }
      if (!matches) throw new Error("ChatGPT opened another user turn while the bound assistant response was detached");
      // Expanding a collapsed message yields to DOM updates. Recheck ownership
      // afterwards so a competing or remounted old group cannot race verification.
      const current = await this.submissionDomState(page, baseline.domCache, signal);
      if (!current.userIdentities.includes(user) || !current.responseIdentities.includes(identity!)
        || current.turnIdentities.includes(binding.identity)
        || current.turnIdentities.some(turn => !acceptedTurns.has(turn) && turn !== user && turn !== identity)) {
        throw new Error("ChatGPT changed conversation turns while verifying the submitted message");
      }
    }
    if (!identity || identity === binding.identity) return binding;
    return {
      identity,
      locator: page.locator(chatGptAssistantTurnSelector(identity)),
      acceptedTurnIdentities: state.turnIdentities,
    };
  }

  private async userMessageMatchesSubmission(group: Locator, submitted: string, signal?: AbortSignal): Promise<boolean> {
    const bubble = group.locator("[data-user-message-bubble]");
    if (await bubble.count() !== 1) return false;
    const content = bubble.locator("[data-search-result-target]:not([data-search-result-target] [data-search-result-target])");
    if (await content.count() !== 1) return false;
    // Long messages are removed from the DOM when collapsed, not merely clipped.
    // Use the observed semantic control across locales; never compare a prefix.
    const expand = bubble.locator('button[type="button"][aria-expanded][data-thread-find-skip="true"][data-markdown-copy="exclude"]');
    const count = await expand.count();
    if (count > 1) return false;
    if (count === 1 && await expand.getAttribute("aria-expanded") === "false") {
      await expand.press("Enter", { signal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
      await expand.locator('xpath=self::*[@aria-expanded="true"]').waitFor({
        state: "attached", signal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      });
    }
    const observed = await withChatGptBrowserObservationTimeout(withBrowserTurnAbort(
      content.evaluate(readChatGptUserMessage, this.config?.appName), signal,
    ));
    return observed !== undefined
      && submitted.replace(/\r\n?/g, "\n") === observed.text.replace(/\r\n?/g, "\n");
  }

  private async attachedPromptText(page: Page, abortSignal?: AbortSignal): Promise<string> {
    const composer = await this.activeComposer(page, 60_000, abortSignal);
    return composer.evaluate(element => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(
        '[data-id^="plugin:"][data-keyword], [data-inline-selection-pill-cursor-target], [app-mention-path^="app://"][app-mention-display-name][contenteditable="false"]',
      )
        .forEach(part => part.remove());
      return [...clone.childNodes]
        .map(child => child.textContent ?? "")
        .join("\n")
        .trimStart();
    }, undefined, { timeout: 60_000, signal: abortSignal });
  }

  private async assertPromptAttached(
    page: Page,
    prompt: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + 30_000;
    let observed = "";
    while (Date.now() < deadline) {
      throwIfPromptAttachmentAborted(abortSignal);
      observed = await this.attachedPromptText(page, abortSignal);
      throwIfPromptAttachmentAborted(abortSignal);
      if (chatGptPromptTextEquivalent(prompt, observed)) return;
      await withBrowserTurnAbort(
        new Promise(resolveSleep => setTimeout(resolveSleep, 50)),
        abortSignal,
      );
    }
    throwIfPromptAttachmentAborted(abortSignal);
    const commonPrefix = chatGptPromptEquivalentPrefixLength(prompt, observed);
    throw new ChatGptPromptAttachmentIntegrityError(
      `ChatGPT composer did not preserve the complete prompt (expectedChars=${prompt.length}, actualChars=${observed.length}, commonPrefixChars=${commonPrefix})`,
    );
  }

  private selectedConnectorControl(composer: Locator): Locator {
    return composer
      .locator([
        `[data-id^="plugin:"][data-keyword=${JSON.stringify(this.config.appName)}]`,
        `[app-mention-path^="app://"][app-mention-display-name=${JSON.stringify(this.config.appName)}][contenteditable="false"]`,
      ].join(", "))
      .filter({ visible: true });
  }

  private async connectorIsSelected(composer: Locator, abortSignal?: AbortSignal): Promise<boolean> {
    const selected = this.selectedConnectorControl(composer);
    const keywords = await withBrowserTurnAbort(
      withChatGptBrowserObservationTimeout(selected.evaluateAll(elements => (
        elements.map(element => element.getAttribute("data-keyword") ?? element.getAttribute("app-mention-display-name"))
      ))),
      abortSignal,
    );
    const exactMatches = keywords.filter(keyword => keyword === this.config.appName).length;
    if (exactMatches > 1) {
      throw new Error(`ChatGPT composer exposed duplicate ${JSON.stringify(this.config.appName)} connector selections`);
    }
    return exactMatches === 1;
  }

  private async connectorMentionRowTitles(
    menuRows: Locator,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    let texts: string[];
    try {
      texts = await withBrowserTurnAbort(
        withChatGptBrowserObservationTimeout(menuRows.filter({ visible: true }).allInnerTexts()),
        abortSignal,
      );
    } catch (error) {
      if (abortSignal?.aborted) throw error;
      texts = [];
    }
    return texts
      .map(text => (text.split("\n")[0] ?? "").replace(/\s+/g, " ").trim())
      .filter(title => title.length > 0);
  }

  private async connectorMentionFailure(
    menuRows: Locator,
    triggerAttempts: number,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const titles = await this.connectorMentionRowTitles(menuRows, abortSignal);
    if (titles.length === 0) {
      return `ChatGPT connector menu did not open after ${triggerAttempts} complete mention trigger attempt(s)`;
    }
    if (this.config.appName === CHATGPT_CONNECTOR_NAME && titles.includes(DEV_CHATGPT_CONNECTOR_NAME)) {
      return `ChatGPT exposes the isolated DEV connector ${JSON.stringify(DEV_CHATGPT_CONNECTOR_NAME)},`
        + ` but production requires a separate connector named ${JSON.stringify(CHATGPT_CONNECTOR_NAME)};`
        + ` create ${JSON.stringify(CHATGPT_CONNECTOR_NAME)} against the production tunnel and leave the DEV connector unchanged`;
    }
    if (this.config.appName === CHATGPT_CONNECTOR_NAME && !titles.includes(CHATGPT_CONNECTOR_NAME)) {
      const legacyName = LEGACY_CHATGPT_CONNECTOR_NAMES.find(name => titles.includes(name));
      if (legacyName) return legacyChatGptConnectorMigrationMessage(legacyName);
    }
    return `ChatGPT connector menu opened but exposed no row named ${JSON.stringify(this.config.appName)}`
      + ` after ${triggerAttempts} complete mention trigger attempt(s)`
      + `; create a connector with that exact name before retrying`;
  }

  private async clearChatGptComposerState(
    page: Page, abortSignal?: AbortSignal, purpose: "preparation" | "rollback" = "rollback",
  ): Promise<void> {
    await runChatGptPersonalizationCleanup(async (_timeoutMs, cleanupSignal) => {
      // Preparation respects the turn cancellation. Rollback callers omit abortSignal so
      // an already-cancelled turn still gets a bounded, independently verified cleanup.
      const signal = abortSignal ? AbortSignal.any([abortSignal, cleanupSignal]) : cleanupSignal;
      throwIfPromptAttachmentAborted(signal);
      await pressChatGptPersonalizationEscape(page, 30_000, signal);
      const timeoutMs = 60_000;
      const composer = await this.activeComposer(page, timeoutMs, signal);
      await composer.focus({
        signal,
        timeout: 30_000,
      });
      await composer.press(CHATGPT_COMPOSER_SELECT_ALL_KEY, {
        signal,
        timeout: 30_000,
      });
      await composer.press("Backspace", {
        signal,
        timeout: 30_000,
      });
      await waitForChatGptPersonalizationPoll(CHATGPT_UI_SETTLE_MS, signal);
      const settledComposer = await this.activeComposer(page, 60_000, signal);
      const remainingMs = 60_000;
      const remainingText = await settledComposer.evaluate(
        element => element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
          ? element.value : element.textContent ?? "",
        undefined,
        { timeout: remainingMs, signal },
      );
      const connectorSelected = await this.connectorIsSelected(settledComposer, signal);
      if (remainingText.length > 0 || connectorSelected) {
        throw new ChatGptPromptAttachmentIntegrityError(
          `ChatGPT connector cleanup did not produce an empty composer`
          + ` (visibleCharacters=${remainingText.length}, connectorSelected=${connectorSelected})`,
        );
      }
    }, purpose === "preparation" ? CHATGPT_COMPOSER_PREPARATION_TIMEOUT_MS : CHATGPT_PERSONALIZATION_CLEANUP_TIMEOUT_MS);
  }

  private async selectConnector(
    page: Page,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    catalogRefreshAvailable = false,
    attemptBudget: ChatGptConnectorAttemptBudget = { triggerAttempts: 0 },
    abortSignal?: AbortSignal,
  ): Promise<Locator> {
    const capture = async (checkpoint: string): Promise<void> => {
      throwIfPromptAttachmentAborted(abortSignal);
      await withBrowserTurnAbort(captureDiagnostic?.(checkpoint) ?? Promise.resolve(), abortSignal);
      throwIfPromptAttachmentAborted(abortSignal);
    };
    let composer: Locator;
    const menuRows = page.locator('.__menu-item[tabindex="0"], [data-mention-list-scroll-area] button[data-list-navigation-item="true"]');
    const appResult = menuRows.filter({
      has: page.getByText(this.config.appName, { exact: true }),
    });
    const typeMention = async (signal?: AbortSignal): Promise<void> => {
      throwIfPromptAttachmentAborted(signal);
      const ready = await composer.evaluate(prepareComposerForInput, undefined, {
        signal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      });
      throwIfPromptAttachmentAborted(signal);
      if (!ready) {
        throw new ChatGptPromptAttachmentIntegrityError("ChatGPT composer could not prepare an editable connector mention caret");
      }
      await composer.pressSequentially(CHATGPT_CONNECTOR_MENTION_QUERY, {
        delay: 25, signal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      });
      throwIfPromptAttachmentAborted(signal);
    };
    const assertMention = async (signal?: AbortSignal): Promise<void> => {
      throwIfPromptAttachmentAborted(signal);
      const mention = await composer.evaluate(element => ({
        text: element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
          ? element.value : element.textContent ?? "",
        focused: element === document.activeElement,
      }), undefined, { timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS, signal });
      throwIfPromptAttachmentAborted(signal);
      if (mention.text !== CHATGPT_CONNECTOR_MENTION_QUERY) {
        throw new ChatGptPromptAttachmentIntegrityError(
          `ChatGPT did not preserve the connector mention (expectedChars=${CHATGPT_CONNECTOR_MENTION_QUERY.length}, actualChars=${mention.text.length}, focused=${mention.focused})`,
        );
      }
    };
    if (new URL(page.url()).searchParams.get("temporary-chat") === "true") await ensureChatGptPersonalizedConnectorAccess(
      page,
      capture,
      async (personalizationSignal) => {
        let proofResult: boolean | undefined;
        let proofError: unknown;
        try {
          await this.clearChatGptComposerState(page, personalizationSignal, "preparation");
          composer = await this.activeComposer(page, 60_000, personalizationSignal);
          await composer.focus({
            signal: personalizationSignal,
            timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
          });
          await withBrowserTurnAbort(settleChatGptUi(), personalizationSignal);
          await typeMention(personalizationSignal);
          await capture("personalization-proof-mention-triggered");
          await assertMention(personalizationSignal);
          try {
            await appResult.waitFor({ state: "visible", timeout: 30_000, signal: personalizationSignal });
            proofResult = true;
            await capture("personalization-proof-menu-visible");
          } catch (error) {
            if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
            proofResult = false;
            await capture("personalization-proof-menu-missing");
            await assertMention(personalizationSignal);
          }
        } catch (error) {
          proofError = error;
        }
        try {
          await this.clearChatGptComposerState(page);
        } catch (cleanupError) {
          throw new ChatGptPersistentBrowserStateError(
            proofError !== undefined ? [proofError, cleanupError] : [cleanupError],
            "ChatGPT connector proof did not leave a verified empty composer",
          );
        }
        if (proofError !== undefined) throw proofError;
        return proofResult === true;
      },
      abortSignal,
    );
    try {
      composer = await this.activeComposer(page, 60_000, abortSignal);
      if (await this.connectorIsSelected(composer, abortSignal)) {
        if ((await this.attachedPromptText(page, abortSignal)).length === 0) {
          await capture("connector-already-selected");
          return composer;
        }
        // A restored draft can include both the connector and an earlier request. Selecting
        // that pill proves the connector, not an empty composer. Reset the owned draft before
        // attaching this request so it cannot be appended to the previous one.
      }
      let firstMenuCaptured = false;
      while (attemptBudget.triggerAttempts < MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS) {
        attemptBudget.triggerAttempts += 1;
        await this.clearChatGptComposerState(page, abortSignal, "preparation");
        composer = await this.activeComposer(page, 60_000, abortSignal);
        await composer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
        await withBrowserTurnAbort(settleChatGptUi(), abortSignal);
        await typeMention(abortSignal);
        if (!firstMenuCaptured) {
          firstMenuCaptured = true;
          await capture("connector-mention-triggered");
        }
        await assertMention(abortSignal);
        try {
          await appResult.waitFor({
            state: "visible",
            timeout: 30_000,
            signal: abortSignal,
          });
          await capture("connector-menu-visible");
          break;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
          await assertMention(abortSignal);
          const visibleRows = await this.connectorMentionRowTitles(menuRows, abortSignal);
          const knownIdentityMismatch = this.config.appName === CHATGPT_CONNECTOR_NAME
            && (
              visibleRows.includes(DEV_CHATGPT_CONNECTOR_NAME)
              || LEGACY_CHATGPT_CONNECTOR_NAMES.some(name => visibleRows.includes(name))
            );
          if (knownIdentityMismatch) {
            await capture("connector-menu-missing");
            throw chatGptConnectorUnavailableError(
              await this.connectorMentionFailure(menuRows, attemptBudget.triggerAttempts, abortSignal),
            );
          }
          if (
            catalogRefreshAvailable
            && visibleRows.length > 0
            && !visibleRows.includes(this.config.appName)
            && attemptBudget.triggerAttempts < MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS
          ) {
            throw new ChatGptConnectorCatalogStaleError(
              this.config.appName,
              attemptBudget.triggerAttempts,
            );
          }
          if (attemptBudget.triggerAttempts >= MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS) {
            await capture("connector-menu-missing");
            throw chatGptConnectorUnavailableError(
              await this.connectorMentionFailure(menuRows, attemptBudget.triggerAttempts, abortSignal),
            );
          }
        }
      }
      const exactResultCount = await withBrowserTurnAbort(
        withChatGptBrowserObservationTimeout(appResult.count()),
        abortSignal,
      );
      if (exactResultCount !== 1) {
        throw chatGptConnectorUnavailableError(
          `ChatGPT connector menu did not expose one exact ${JSON.stringify(this.config.appName)} row`
          + ` after ${attemptBudget.triggerAttempts} complete mention trigger attempt(s)`,
        );
      }
      // Hidden launcher maintenance keeps a 1x1 Chromium viewport, so pointer activation cannot
      // reach this menu. Require the exact row to own ChatGPT's keyboard highlight first;
      // otherwise move the menu highlight until it does. Keep
      // focus on the composer, activate through the menu's real keyboard owner, then prove the exact
      // selected connector pill below.
      const rowHighlighted = async () => {
        const options = { signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS };
        return await appResult.getAttribute("data-highlighted", options) !== null
          || await appResult.getAttribute("aria-current", options) === "true";
      };
      if (!await rowHighlighted()) {
        const visibleRowCount = await withBrowserTurnAbort(
          withChatGptBrowserObservationTimeout(menuRows.filter({ visible: true }).count()),
          abortSignal,
        );
        for (let step = 0; step < visibleRowCount && !await rowHighlighted(); step += 1) {
          await composer.press("ArrowDown", {
            signal: abortSignal,
            timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
          });
        }
      }
      if (!await rowHighlighted()) {
        throw new Error(`ChatGPT connector menu could not highlight ${JSON.stringify(this.config.appName)}`);
      }
      await composer.press("Enter", {
        signal: abortSignal,
        timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      });
      await capture("connector-choice-activated");
      // Selecting a connector replaces the Lexical composer subtree. Resolve the active composer
      // again instead of returning the pre-selection locator, otherwise the real turn can focus a
      // detached/hidden editor even though verification just succeeded.
      const selectedComposer = await this.activeComposer(page, 60_000, abortSignal);
      const selectedConnector = this.selectedConnectorControl(selectedComposer);
      await selectedConnector.waitFor({
        state: "visible",
        timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
        signal: abortSignal,
      });
      if (!await this.connectorIsSelected(selectedComposer, abortSignal)) {
        throw new Error(`ChatGPT composer did not select ${JSON.stringify(this.config.appName)} connector`);
      }
      await capture("connector-selected");
      return selectedComposer;
    } catch (error) {
      try {
        await this.clearChatGptComposerState(page);
      } catch (cleanupError) {
        throw new ChatGptPersistentBrowserStateError(
          [error, cleanupError],
          "ChatGPT connector selection failed and its composer state could not be cleared",
        );
      }
      throw error;
    }
  }

  private async attachPrompt(
    page: Page,
    prompt: string,
    localTools: boolean,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
    catalogRefreshAvailable = false,
    connectorAttemptBudget?: ChatGptConnectorAttemptBudget,
    reuseConnector = false,
    requireThink = false,
  ): Promise<void> {
    throwIfPromptAttachmentAborted(abortSignal);
    await throwIfChatGptRateLimitDialog(page);
    throwIfPromptAttachmentAborted(abortSignal);
    const connectorMode = chatGptConnectorAttachmentMode(localTools, reuseConnector);
    let composerMutationStarted = false;
    try {
      if (connectorMode !== "mention") {
        // Playwright's multiline fill maps through an input action that ChatGPT's Lexical editor can
        // collapse to the first paragraph on the launcher-owned Electron surface. Clear separately,
        // then transport the complete text through the browser's plain-text editing command.
        composerMutationStarted = true;
        await this.clearChatGptComposerState(page, abortSignal, "preparation");
        const composer = await this.activeComposer(page, 60_000, abortSignal);
        await composer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
        if (requireThink) {
          await setChatGptThinkMode(composer.locator("xpath=ancestor::form[1]"), true, captureDiagnostic, abortSignal);
        }
        await this.insertPromptText(page, prompt, abortSignal);
        await this.assertPromptAttached(page, prompt, abortSignal);
        return;
      }
      const selectedComposer = await this.selectConnector(
        page,
        captureDiagnostic,
        catalogRefreshAvailable,
        connectorAttemptBudget,
        abortSignal,
      );
      // selectConnector owns and rolls back every mutation until it returns. From this point the
      // attachment owns the selected pill and prompt text as one transaction.
      composerMutationStarted = true;
      if (requireThink) {
        await setChatGptThinkMode(selectedComposer.locator("xpath=ancestor::form[1]"), true, captureDiagnostic, abortSignal);
      }
      await selectedComposer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
      await selectedComposer.press(CHATGPT_COMPOSER_DOCUMENT_END_KEY, {
        signal: abortSignal,
        timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      });
      await this.insertPromptText(page, ` ${prompt}`, abortSignal);
      await this.assertPromptAttached(page, prompt, abortSignal);
    } catch (error) {
      if (!composerMutationStarted || error instanceof ChatGptPersistentBrowserStateError) throw error;
      try {
        await this.clearChatGptComposerState(page);
      } catch (cleanupError) {
        throw new ChatGptPersistentBrowserStateError(
          [error, cleanupError],
          "ChatGPT prompt attachment failed and its composer state could not be cleared",
        );
      }
      throw error;
    }
  }

  private async waitForSubmissionAcceptedWithRecovery(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    abortSignal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    initialToolBatchRevision = externalProgress?.snapshot().lastToolBatchRevision ?? 0,
    completionTracker?: ChatGptCompletionTracker,
    recoverObservation?: ChatGptObservationRecovery,
    responseAccepted?: () => boolean,
  ): Promise<ChatGptSubmissionEvidence> {
    let observationPage = page;
    let observationBaseline = baseline;
    let recoveryAttempts = 0;
    for (;;) {
      try {
        const evidence = await this.waitForSubmissionAccepted(
          observationPage,
          observationBaseline,
          abortSignal,
          externalProgress,
          initialToolBatchRevision,
          completionTracker,
          responseAccepted,
        );
        return evidence;
      } catch (error) {
        if (responseAccepted?.() && !abortSignal?.aborted) return "response_stream";
        if (!(error instanceof ChatGptBrowserObservationTimeoutError) || !recoverObservation) throw error;
        recoveryAttempts += 1;
        if (recoveryAttempts > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
          throw new Error(
            `ChatGPT submission DOM remained unresponsive after ${MAX_CHATGPT_BROWSER_PAGE_REBINDS} same-page rebinds`,
            { cause: error },
          );
        }
        const recovered = await recoverObservation(
          recoveryAttempts,
          error,
          observationBaseline,
          abortSignal,
        );
        observationPage = recovered.page;
        observationBaseline = recovered.baseline;
      }
    }
  }

  private sendControlState(button: Locator) {
    return withChatGptBrowserObservationTimeout(button.evaluate(element => {
      const visible = (node: Element) => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, rect.left) + (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) / 2;
      const y = Math.max(0, rect.top) + (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) / 2;
      const inViewport = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
        && rect.left < innerWidth && rect.top < innerHeight;
      const hit = inViewport ? document.elementFromPoint(x, y) : null;
      return { connected: element.isConnected, visible: visible(element), inViewport,
        enabled: !element.matches(":disabled") && !element.closest('[aria-disabled="true"], [inert], [aria-hidden="true"]'),
        modal: [...document.querySelectorAll('dialog[open], [aria-modal="true"], [role="dialog"]')].some(visible),
        focused: element === document.activeElement,
        blocked: !!hit && element !== hit && !element.contains(hit) };
    }));
  }

  private async assertKeyboardSendReady(button: Locator) {
    const ready = await this.sendControlState(button);
    if (!ready.connected || !ready.visible || !ready.enabled || !ready.inViewport || ready.modal || !ready.focused) {
      throw new Error("ChatGPT Send is not ready for keyboard activation; no Enter was dispatched");
    }
  }

  /** A trial performs actionability checks without dispatching a click. Only that
   * pre-input failure can choose another activation; a real click failure never can. */
  private async prepareSendMethod(page: Page, abortSignal?: AbortSignal): Promise<"click" | "enter"> {
    const composer = await this.activeComposer(page);
    const button = composer.locator("xpath=ancestor::form[1]").locator(CHATGPT_SEND_BUTTON_SELECTOR);
    try {
      // Keep the existing enable grace separate from pointer actionability. A new
      // preflight must not shorten the time allowed for ChatGPT to enable Send.
      await this.waitForSendReady(page, button, abortSignal);
      await button.click({ trial: true, timeout: browserStageTimeouts.send, signal: abortSignal });
      throwIfPromptAttachmentAborted(abortSignal);
      return "click";
    } catch (error) {
      throwIfPromptAttachmentAborted(abortSignal);
      if (page.isClosed()) throw chatGptBrowserTabClosedError();
      await throwIfChatGptSessionFailureAlert(page);
      await throwIfChatGptRateLimitDialog(page);
      const ready = await this.sendControlState(button).catch(() => undefined);
      diagnosticEvent("warning", "browser.send_click_preflight_failed", { error: diagnosticError(error), control: ready });
      throwIfPromptAttachmentAborted(abortSignal);
      if (ready?.connected && ready.visible && ready.enabled && ready.inViewport && ready.blocked && !ready.modal) {
        diagnosticEvent("info", "browser.send_fallback_selected", { method: "enter", reason: "click_not_dispatched" });
        return "enter";
      }
      throw new ChatGptWebAdapterError("ChatGPT Send could not be prepared; the request was not sent.", {
        status: 502, errorType: "server_error", code: "chatgpt_send_control_unavailable", retryable: false, cause: error,
      });
    }
  }

  private async waitForSendReady(page: Page, sendButton: Locator, abortSignal?: AbortSignal,
    captureDiagnostic?: (checkpoint: string) => Promise<void>): Promise<void> {
    await sendButton.waitFor({ state: "visible", timeout: browserStageTimeouts.send });
    await settleChatGptUi();
    const sendEnableDeadline = Date.now() + browserStageTimeouts.sendEnable;
    for (;;) {
      throwIfPromptAttachmentAborted(abortSignal);
      if (page.isClosed()) throw chatGptBrowserTabClosedError();
      await throwIfChatGptSessionFailureAlert(page);
      await throwIfChatGptRateLimitDialog(page);
      if (await sendButton.isEnabled()) return;
      if (Date.now() >= sendEnableDeadline) {
        await captureDiagnostic?.("send-disabled");
        throw new Error("ChatGPT send button remained disabled after the complete prompt was attached");
      }
      await settleChatGptUi();
    }
  }

  private async sendAttachedPrompt(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    submissionLifecycle?: Pick<BrowserTurn, "onSendActivated" | "onSubmitted"> & {
      onInputProgress?: (progress: "sending" | "awaiting_ack") => Promise<void>;
    },
    completionTracker?: ChatGptCompletionTracker,
    recoverObservation?: ChatGptObservationRecovery,
    responseAccepted?: () => boolean,
    inputMethod: "click" | "enter" = "click",
  ): Promise<ChatGptSubmissionEvidence> {
    const composer = await this.activeComposer(page);
    const sendButton = composer
      .locator("xpath=ancestor::form[1]")
      .locator(CHATGPT_SEND_BUTTON_SELECTOR);
    await this.waitForSendReady(page, sendButton, abortSignal, captureDiagnostic);
    await captureDiagnostic?.("send-ready");
    if (inputMethod === "enter") {
      await sendButton.focus({ timeout: browserStageTimeouts.send });
      throwIfPromptAttachmentAborted(abortSignal);
      await this.assertKeyboardSendReady(sendButton);
    }
    const initialToolBatchRevision = externalProgress?.snapshot().lastToolBatchRevision ?? 0;
    let inputEvidence: (() => Promise<unknown>) | undefined;
    let collectedInput: Promise<void> | undefined;
    let inputFailed = false, inputFailure: unknown;
    const collectInput = () => collectedInput ??= (async () => {
      if (inputEvidence) diagnosticEvent("info", "browser.send_input_evidence", { activation: await inputEvidence() });
    })();
    diagnosticEvent("info", "browser.send_activation_started", { phase: "send" });
    try {
      await withBrowserTurnAbort(withChatGptBrowserObservationTimeout(
        Promise.resolve().then(() => submissionLifecycle?.onSendActivated?.()), 60_000,
      ), abortSignal);
      // The lifecycle callback may outlive the stage budget. It must never release a late click
      // after the caller has already classified this preparation as unsent/cancelled.
      throwIfPromptAttachmentAborted(abortSignal);
      if (page.isClosed()) throw chatGptBrowserTabClosedError();
      inputEvidence = await observeSendInput(page, CHATGPT_SEND_BUTTON_SELECTOR);
      await submissionLifecycle?.onInputProgress?.("sending");
      // The permit/ready callback can yield to page changes. Never bypass a new modal,
      // disabled control or lost focus with the selected keyboard fallback.
      if (inputMethod === "enter") await this.assertKeyboardSendReady(sendButton);
      throwIfPromptAttachmentAborted(abortSignal);
      const inputStartedAt = Date.now();
      diagnosticEvent("info", "browser.send_input_started", { phase: "send", method: inputMethod });
      try {
        if (inputMethod === "enter") await sendButton.press("Enter", { signal: abortSignal, timeout: browserStageTimeouts.send });
        else await sendButton.click({
          // Preserve Playwright's post-input hit-target check. noWaitAfter also skips that
          // result and can report a returned click whose input the interceptor suppressed.
          signal: abortSignal,
          // A click owns its own limit. Failure can occur after submission; the semantic
          // acknowledgement below still decides acceptance, without activating Send again.
          timeout: browserStageTimeouts.send,
        });
      } catch (error) {
        // A detached target/transport can fail after input reached the page. Never activate again.
        // The same semantic acknowledgement check below decides whether the send succeeded.
        inputFailed = true; inputFailure = error;
        diagnosticEvent("warning", "browser.send_input_failed", { phase: "send", method: inputMethod, error: diagnosticError(error) });
        if (abortSignal?.aborted || page.isClosed()) throw error;
      } finally {
        diagnosticEvent("info", "browser.send_input_completed", { phase: "send", method: inputMethod,
          outcome: inputFailed ? "failed" : "returned", durationMs: Date.now() - inputStartedAt });
        // Freeze page input facts as soon as the one original input operation settles.
        // Acceptance may take longer than the listener lifetime; it is a separate observation.
        await collectInput();
      }
      await submissionLifecycle?.onInputProgress?.("awaiting_ack");
      const traceId = diagnosticContext.getStore()?.traceId;
      const evidence = await this.runStage(typeof traceId === "string" ? traceId : "send", "send_acknowledgement",
        browserStageTimeouts.submissionAcknowledgement, stageSignal => this.waitForSubmissionAcceptedWithRecovery(
        page,
        baseline,
        abortSignal ? AbortSignal.any([abortSignal, stageSignal]) : stageSignal,
        externalProgress,
        initialToolBatchRevision,
        completionTracker,
        recoverObservation,
        responseAccepted,
      ));
      throwIfPromptAttachmentAborted(abortSignal);
      await submissionLifecycle?.onSubmitted?.();
      return evidence;
    } catch (error) {
      if (inputFailed && inputFailure !== error && !abortSignal?.aborted
        && !(error instanceof ChatGptWebAdapterError) && !(error instanceof ChatGptPersistentBrowserStateError)) {
        throw new AggregateError([inputFailure, error], "ChatGPT Send input failed and acceptance could not be verified");
      }
      throw error;
    } finally {
      await collectInput();
    }
  }

  private async resetCompactionComposerForRetry(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    throwIfPromptAttachmentAborted(abortSignal);
    const before = await this.currentSubmissionEvidence(page, baseline, abortSignal);
    if (before) {
      throw new ChatGptPromptAttachmentIntegrityError(
        "ChatGPT changed while the compaction prompt was being prepared. Check the ChatGPT tab before retrying.",
        new Error(`Submission evidence appeared after prompt attachment failed: ${before}`),
      );
    }

    await this.clearChatGptComposerState(page, abortSignal, "preparation");
    throwIfPromptAttachmentAborted(abortSignal);

    const after = await this.currentSubmissionEvidence(page, baseline, abortSignal);
    if (after) {
      throw new ChatGptPromptAttachmentIntegrityError(
        "ChatGPT changed while the compaction prompt was being reset. Check the ChatGPT tab before retrying.",
        new Error(`Submission evidence appeared while resetting the prompt: ${after}`),
      );
    }
    const observed = await this.attachedPromptText(page, abortSignal);
    if (observed.length > 0) {
      throw new ChatGptPromptAttachmentIntegrityError(
        `ChatGPT composer could not reset cleanly for compaction retry (actualChars=${observed.length})`,
      );
    }
  }

  private async attachPromptWithCompactionRetry(
    page: Page,
    prompt: string,
    localTools: boolean,
    compaction: boolean,
    baseline: ChatGptSubmissionBaseline,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
    catalogRefreshAvailable = false,
    connectorAttemptBudget?: ChatGptConnectorAttemptBudget,
    reuseConnector = false,
    requireThink = false,
  ): Promise<void> {
    let retryAvailable = compaction;
    for (;;) {
      try {
        await this.attachPrompt(
          page,
          prompt,
          localTools,
          captureDiagnostic,
          abortSignal,
          catalogRefreshAvailable,
          connectorAttemptBudget,
          reuseConnector,
          requireThink,
        );
        return;
      } catch (error) {
        if (!retryAvailable || !(error instanceof ChatGptPromptAttachmentIntegrityError)) throw error;
        retryAvailable = false;
        const evidence = await this.currentSubmissionEvidence(page, baseline, abortSignal);
        if (evidence) {
          throw new ChatGptPromptAttachmentIntegrityError(
            "ChatGPT changed while the compaction prompt was being prepared. Check the ChatGPT tab before retrying.",
            new Error(`Prompt attachment failed before submission evidence appeared: ${evidence}`, { cause: error }),
          );
        }
        await captureDiagnostic?.("prompt-attachment-integrity-retry");
        await this.resetCompactionComposerForRetry(page, baseline, abortSignal);
      }
    }
  }

  private async insertPromptText(page: Page, text: string, abortSignal?: AbortSignal): Promise<void> {
    throwIfPromptAttachmentAborted(abortSignal);
    const composer = await this.activeComposer(page, 60_000, abortSignal);
    await composer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
    // CDP Input.insertText is interpreted as live typing by ChatGPT's Lexical plugins. On a large
    // JSON transport it can turn literal Markdown backticks into rich code nodes, remove the
    // delimiters from textContent, and leave the next insertion outside the intended block. The
    // browser's plain-text editing command updates the same focused contenteditable atomically
    // without running those Markdown shortcuts. Exact readback below remains the authority.
    const inserted = await composer.evaluate(insertPlainTextIntoComposer, text, {
      timeout: 60_000,
      signal: abortSignal,
    });
    throwIfPromptAttachmentAborted(abortSignal);
    if (!inserted) {
      throw new ChatGptPromptAttachmentIntegrityError(
        "ChatGPT composer rejected the plain-text editing command",
      );
    }
  }

  private async verifyConnectorExclusive(
    traceId = `verify_${randomUUID().replaceAll("-", "")}`,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    abortSignal?.throwIfAborted();
    const page = await this.ensurePage();
    const diagnostics = new ChatGptBrowserDiagnostics(
      traceId,
      this.config.browserDiagnosticsPath ?? join(getConfigDir(), "diagnostics", "browser-turns"),
      this.config.appName,
    );
    const captureDiagnostic = (checkpoint: string): Promise<void> => diagnostics.capture(page, checkpoint);
    try {
      await captureDiagnostic("connector-verification-started");
      await this.prepareChatSurface(page, captureDiagnostic, false, { signal: abortSignal });
      // The launcher refreshes its owned ChatGPT document before starting this helper. A second
      // reload here can discard the first catalog's exact mismatch evidence and report a generic
      // menu failure instead of identifying the connector the account actually exposes.
      await this.selectConnector(page, captureDiagnostic, false, undefined, abortSignal);
      // Verification proves selection but does not submit a turn. Leaving the selected plugin in
      // ChatGPT's persisted composer draft makes the next hard refresh restore half-hydrated plugin
      // state; clearing it through native editor deletion keeps repeated verification transactional.
      await this.clearChatGptComposerState(page, abortSignal);
      await captureDiagnostic("connector-verification-cleared");
      await captureDiagnostic("connector-verification-succeeded");
      return this.config.appName;
    } catch (error) {
      await diagnostics.capture(page, "connector-verification-failed", error);
      throw error;
    }
  }

  private async inspectSessionExclusive(detectCapabilities: boolean, abortSignal?: AbortSignal): Promise<{
    authenticated: true;
    temporary: true;
    url: string;
    solAvailable?: boolean;
    extraHighAvailable?: boolean;
    proAvailable?: boolean;
  }> {
    abortSignal?.throwIfAborted();
    const page = await this.ensurePage();
    await this.prepareChatSurface(page, undefined, false, { signal: abortSignal });
    const url = page.url();
    if (!detectCapabilities) return { authenticated: true, temporary: true, url };
    const capabilities = await detectChatGptAccountCapabilities(page);
    abortSignal?.throwIfAborted();
    return { authenticated: true, temporary: true, url, ...capabilities };
  }

  private async smokeTestExclusive(abortSignal?: AbortSignal, traceId = `smoke_${randomUUID().replaceAll("-", "")}`): Promise<{ effort: string; response: string }> {
    abortSignal?.throwIfAborted();
    const page = await this.ensurePage();
    await this.prepareChatSurface(page, undefined, false, { signal: abortSignal });
    const account = await detectChatGptAccountCapabilities(page);
    abortSignal?.throwIfAborted();
    // Core smoke runs before the optional MCP connector is configured, so it must remain a
    // browser-only transport check. Connector setup has its own explicit verification operation.
    const capabilities: ChatGptWebCapabilities = { ...account, localToolsEnabled: false, nativeToolsEnabled: false };
    const modelId = account.solAvailable ? CHATGPT_WEB_MODEL_ID : CHATGPT_WEB_LUNA_MODEL_ID;
    const reasoning = account.solAvailable ? "high" : "low";
    const mode = resolveChatGptWebModelMode(modelId, reasoning, capabilities);
    const smokeTurn: BrowserTurn = {
      traceId,
      modelId,
      reasoning,
      capabilities,
      prepare: async () => ({ text: CHATGPT_SMOKE_TEXT, images: [], release: () => {} }),
      abortSignal,
      onTextDelta: () => {},
    };
    const response = this.config.browserHost === "launcher"
      ? await withQueuedRequest({
        descriptorPath: this.config.browserHostDescriptorPath!, traceId, signal: abortSignal,
        job: { id: createHash("sha256").update(traceId).digest("hex"), groupId: "launcher-smoke",
          model: modelId, effort: reasoning, mode: "browser-only", bytes: Buffer.byteLength(CHATGPT_SMOKE_TEXT) },
        execute: (queueTicket, signal) => this.runExclusive({ ...smokeTurn, queueTicket, abortSignal: signal }),
      })
      : await this.run(smokeTurn);
    if (response.trim() !== CHATGPT_SMOKE_EXPECTED) {
      throw new Error(
        `ChatGPT smoke test returned an unexpected answer (${JSON.stringify(response.trim().slice(0, 200))})`,
      );
    }
    return { effort: mode.displayLabel, response: CHATGPT_SMOKE_EXPECTED };
  }

  private async attachFiles(page: Page, prompt: CompiledChatGptWebPrompt, abortSignal?: AbortSignal, timeoutMs: number = browserStageTimeouts.fileAttachment, baseline?: ChatGptSubmissionBaseline): Promise<void> {
    const files = chatGptPromptFilePayloads(prompt);
    if (files.length === 0) return;
    const composer = await this.activeComposer(page);
    const composerForm = composer.locator("xpath=ancestor::form[1]");
    const submissionBaseline = baseline ?? await this.captureSubmissionBaseline(page);
    await attachChatGptFilesWithRetry(page, composerForm, files, abortSignal, timeoutMs, async () => {
      if (await this.currentSubmissionEvidence(page, submissionBaseline, abortSignal)) {
        throw new Error("Submission evidence appeared while an attachment was being prepared; it was not uploaded again");
      }
    });
    const send = composerForm.locator(CHATGPT_SEND_BUTTON_SELECTOR);
    const sendDeadline = Date.now() + 120_000;
    while (Date.now() < sendDeadline) {
      abortSignal?.throwIfAborted();
      if (await send.isEnabled().catch(() => false)) return;
      await new Promise(resolveSleep => setTimeout(resolveSleep, 100));
    }
    throw new Error("ChatGPT accepted the prompt attachments but did not make the message ready to send");
  }

  private responseDomSnapshot(
    responseTurn: Locator,
    cache?: ChatGptResponseDomCache,
  ): Promise<ChatGptResponseDomSnapshot> {
    return readChatGptResponseDom(responseTurn, cache);
  }

  private stalledTurnDiagnostic(page: Page, responseTurn: Locator): Promise<string> {
    return describeStalledChatGptTurn(page, responseTurn);
  }

  private async runExclusive(turn: BrowserTurn): Promise<string> {
    if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if (this.config.browserHost !== "launcher") return this.runBrowserTurn(turn);

    const lease = await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
      phase: "start",
      traceId: turn.traceId,
      helperPid: process.pid,
      ...(turn.conversationKey ? { conversationKey: turn.conversationKey } : {}),
      ...(turn.savedChat ? { savedChat: turn.savedChat } : {}),
      ...((turn.conversationKey
        && (turn.nativeConnector || turn.capabilities.localToolsEnabled || turn.requireRetainedConversation))
        ? { connectorIdentity: this.config.appName }
        : {}),
      ...(turn.requireRetainedConversation ? { requireRetainedConversation: true } : {}),
    }, undefined, turn.abortSignal).catch(error => {
      if (error instanceof LauncherBrowserTurnCancelledError) throw chatGptBrowserTabClosedError();
      if (error instanceof LauncherRetainedConversationUnavailableError) {
        throw chatGptRetainedConversationUnavailableError();
      }
      throw error;
    });
    const surfaceId = lease.surfaceId;
    const reused = lease.reused === true;
    let terminal: "completed" | "failed" | "aborted" = "completed";
    let terminalMessage: string | undefined;
    let originalError: unknown;
    let awaitingToolResults = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatInFlight = false;
    let lastHeartbeatFailureAt = 0;
    const sendHeartbeat = () => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      void notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
        phase: "heartbeat",
        traceId: turn.traceId,
        helperPid: process.pid,
      }, LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS).catch(error => {
        const now = Date.now();
        if (now - lastHeartbeatFailureAt < 30_000) return;
        lastHeartbeatFailureAt = now;
        console.warn(
          `[chatgpt-web] launcher turn heartbeat failed for ${turn.traceId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }).finally(() => {
        heartbeatInFlight = false;
      });
    };
    try {
      if (!surfaceId) throw new Error("Launcher did not lease a browser tab for the ChatGPT turn");
      if (turn.requireRetainedConversation && !reused) {
        throw chatGptRetainedConversationUnavailableError();
      }
      if (reused && !turn.prepareResume) {
        throw new Error("Launcher reused a ChatGPT conversation without a continuation prompt");
      }
      await turn.onPreparedSelected?.(reused);
      heartbeatTimer = setInterval(sendHeartbeat, LAUNCHER_TURN_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
      const observedTurn = turn.completionFence ? { ...turn, completionFence: {
        begin: () => turn.completionFence!.begin(),
        commit: async (revision: number, reply?: string) => {
          const result = await turn.completionFence!.commit(revision, reply);
          if (result.state === "committed") awaitingToolResults = result.awaitingToolResults === true;
          return result;
        },
      } } : turn;
      const answer = await this.runBrowserTurn(observedTurn, surfaceId, undefined, reused, lease.trackUsage === true, lease.expectedConversationId);
      if (turn.nativeToolDefinitions) {
        const reply = parseNativeToolCallReply(answer, turn.nativeToolDefinitions);
        awaitingToolResults = reply.issues.length === 0 && reply.calls.length > 0;
      }
      return answer;
    } catch (error) {
      originalError = error;
      terminal = error instanceof ChatGptCompactionHandoffAccepted
        ? "completed"
        : (error instanceof DOMException && error.name === "AbortError")
        || (error instanceof ChatGptWebAdapterError && error.code === "client_cancelled")
        ? "aborted"
        : "failed";
      terminalMessage = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        const release = await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
          phase: "end",
          traceId: turn.traceId,
          helperPid: process.pid,
          status: terminal,
          ...(terminalMessage ? { message: terminalMessage } : {}),
          ...(terminal === "failed" && originalError instanceof ChatGptWebAdapterError
            && originalError.code === "browser_stream_inconsistent"
            ? { failureCode: "browser_stream_inconsistent" as const } : {}),
          ...(terminal === "completed" && turn.retainConversation ? { retain: true } : {}),
          ...(terminal === "completed" && turn.retainConversation && awaitingToolResults ? { awaitingToolResults: true } : {}),
          ...(terminal === "completed" && (turn.nativeConnector || turn.capabilities.localToolsEnabled)
            ? { connectorBound: true }
            : {}),
        });
        if (release.cancelledByUser) throw chatGptBrowserTabClosedError();
        if (release.authenticationRequired && terminal !== "aborted") {
          throw new ChatGptWebAdapterError(
            "ChatGPT requested sign-in. Open sign in in the launcher, then retry.",
            { status: 401, errorType: "authentication_error", code: "chatgpt_sign_in_required", retryable: false },
          );
        }
      } catch (controlError) {
        if (controlError instanceof ChatGptWebAdapterError
          && ["client_cancelled", "chatgpt_sign_in_required"].includes(controlError.code)) {
          throw controlError;
        }
        if (!originalError) throw controlError;
        if (originalError instanceof ChatGptWebAdapterError && originalError.code === CHATGPT_UNSUBMITTED_PREPARATION) {
          throw new AggregateError([originalError, controlError], "ChatGPT preparation failed and its page release was not acknowledged");
        }
        console.error(
          `[chatgpt-web] launcher turn-end notification failed after browser error: ${controlError instanceof Error ? controlError.message : String(controlError)}`,
        );
      }
    }
  }

  private async runBrowserTurn(
    turn: BrowserTurn, launcherSurfaceId?: string, maintenancePage?: Page, reuseConversation = false,
    trackUsage = false, expectedConversationId?: string,
  ): Promise<string> {
    return diagnosticContext.run({ ...diagnosticContext.getStore(), traceId: turn.traceId,
      requestedModel: turn.modelId, requestedEffort: turn.reasoning ?? "default", modelFamily: turn.modelFamily }, () =>
      this.runBrowserTurnObserved(turn, launcherSurfaceId, maintenancePage, reuseConversation, trackUsage, expectedConversationId));
  }

  private async runBrowserTurnObserved(
    turn: BrowserTurn,
    launcherSurfaceId?: string,
    maintenancePage?: Page,
    reuseConversation = false,
    trackUsage = false,
    expectedConversationId?: string,
  ): Promise<string> {
    if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if ((turn.externalProgress !== undefined) !== (turn.completionFence !== undefined)) {
      throw new Error("Tool-capable ChatGPT turns require both progress and terminal-fence transports");
    }
    if ((turn.captureLunaCheckpoint === true) !== (turn.onLunaCheckpoint !== undefined)) {
      throw new Error("ChatGPT Luna checkpoint capture requires exactly one checkpoint callback");
    }
    if (turn.captureLunaCheckpoint && turn.modelId !== CHATGPT_WEB_LUNA_MODEL_ID) {
      throw new Error("Private rolling checkpoint capture is valid only for ChatGPT Luna");
    }
    if (turn.textDelivery === "buffered" && (turn.completionFence || turn.captureLunaCheckpoint)) {
      throw new Error("Buffered Markdown delivery is only supported for private native replies");
    }
    const browserCapabilities = turn.nativeConnector
      ? { ...turn.capabilities, localToolsEnabled: true }
      : turn.capabilities;
    const requestedMode = resolveChatGptWebModelMode(turn.modelId, turn.reasoning, browserCapabilities);
    // Source delivery is buffered before the first outward byte. MCP and Luna retain their own
    // completion/streaming contracts; this path never replaces a broker-authorized handoff.
    const useResponseSource = !requestedMode.localTools && !turn.captureLunaCheckpoint;
    const prepare = reuseConversation ? turn.prepareResume : turn.prepare;
    if (!prepare) throw new Error("The retained ChatGPT conversation has no continuation prompt");
    const prepared = await prepare();
    const diagnosticsRoot = this.config.browserDiagnosticsPath ?? join(getConfigDir(), "diagnostics", "browser-turns");
    const diagnostics = new ChatGptBrowserDiagnostics(
      turn.traceId,
      diagnosticsRoot,
      this.config.appName,
    );
    let turnConnection: Browser | undefined;
    let managedPage: Page | undefined;
    let diagnosticPage: Page | undefined;
    let completionAnnouncementKey: string | undefined;
    let responseDomCache: ChatGptResponseDomCache = {};
    let responsePhase: "preparation" | "generation" | "extraction" | "delivery" = "preparation";
    const observationLifetime = new AbortController();
    const observationSignal = turn.abortSignal
      ? AbortSignal.any([turn.abortSignal, observationLifetime.signal]) : observationLifetime.signal;
    const usageWrites: Promise<void>[] = [];
    const submissionRejection = new ChatGptSubmissionRejectionObserver();
    const evidence = new ChatGptTurnEvidence();
    const streamEvidence = new ChatGptStreamEvidence(prepared.handoffBinding);
    const responseSource = new ChatGptResponseStream({ captureEvidence: useResponseSource, savedChatReadback: this.config.useSavedChats });
    let readinessSnapshot: ChatGptReadinessSnapshot | undefined;
    let preparationFailed = false;
    try {
      if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      // Validate only the selected physical message, not canonical history used for usage estimates.
      assertChatGptPromptAttachments(prepared);
      const estimatedInputTokens = estimateCompiledChatGptWebInputTokens(prepared, turn.modelId);
      const estimatedMessageTokens = estimateCompiledChatGptWebMessageTokens(prepared, turn.modelId);
      const maxMessageChars = compiledChatGptWebMaxMessageChars(prepared);
      assertChatGptWebInputWithinLimits(
        estimatedInputTokens, estimatedMessageTokens, turn.modelId, requestedMode.effort,
        browserCapabilities, maxMessageChars,
      );
      // An explicitly configured response ceiling starts at acceptance, never during preparation.
      let deadline: number | undefined;
      let page = await this.runStage(turn.traceId, "browser_page", undefined, async (stageSignal) => {
        const abortSignal = turn.abortSignal ? AbortSignal.any([turn.abortSignal, stageSignal]) : stageSignal;
        if (maintenancePage) return maintenancePage;
        if (!launcherSurfaceId) {
          const managed = await this.pageForNewTurn(turn);
          managedPage = managed;
          if (abortSignal.aborted) {
            throw new DOMException("ChatGPT browser page acquisition aborted", "AbortError");
          }
          return managed;
        }
        const connection = await connectLauncherBrowserHost(
          this.config.browserHostDescriptorPath!,
          browserStageTimeouts.browserPage,
          launcherSurfaceId,
          abortSignal,
        );
        if (abortSignal.aborted) {
          await connection.browser.close().catch(() => {});
          throw new DOMException("ChatGPT browser page acquisition aborted", "AbortError");
        }
        turnConnection = connection.browser;
        await waitForOperationalChatGptViewport(connection.page, abortSignal);
        return connection.page;
      }, chatGptSuspensionClock, !launcherSurfaceId);
      if (!maintenancePage && !launcherSurfaceId) managedPage = page;
      diagnosticPage = page;
      // The sign-in/smoke homepage is shared maintenance state, not an exclusive task document.
      const stageRetirement = maintenancePage ? undefined : {
        graceMs: CHATGPT_PERSONALIZATION_CLEANUP_TIMEOUT_MS,
        closeOwnedPage: async () => {
          if (!page.isClosed()) await page.close({ runBeforeUnload: false });
          if (!page.isClosed()) throw new Error("Owned task page remained open after close");
        },
      };
      evidence.attach(page);
      await streamEvidence.attach(page);
      if (useResponseSource) await responseSource.attach(page);
      assertSavedChatIdentity(page, expectedConversationId);
      const rebindLauncherPage = async (
        attempt: number,
        cause: Error,
        callerSignal?: AbortSignal,
      ): Promise<void> => {
        if (!launcherSurfaceId || !this.config.browserHostDescriptorPath) throw cause;
        console.warn(
          `[chatgpt-web] browser turn ${turn.traceId} is rebinding its existing launcher page after a stalled DOM probe:`
          + ` ${redactChatGptUiDiagnostic(cause.message)}`,
        );
        const previousConnection = turnConnection;
        // The observation timeout races the Playwright operation but cannot cancel the underlying
        // page.evaluate by itself. A failed disconnect is terminal: opening a replacement while
        // the stale probe still owns its transport would recreate the contention this rebind is
        // meant to remove.
        const connection = await connectAfterClosingBrowserConnection(
          previousConnection,
          () => {
            turnConnection = undefined;
            return this.runStage(
              turn.traceId,
              `response_page_rebind_${attempt}`,
              undefined,
              async (stageSignal) => {
                const signal = callerSignal
                  ? AbortSignal.any([stageSignal, callerSignal])
                  : turn.abortSignal
                    ? AbortSignal.any([stageSignal, turn.abortSignal])
                    : stageSignal;
                await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
                  phase: "heartbeat",
                  traceId: turn.traceId,
                  helperPid: process.pid,
                  refreshViewport: true,
                });
                const rebound = await connectLauncherBrowserHost(
                  this.config.browserHostDescriptorPath!,
                  browserStageTimeouts.browserPage,
                  launcherSurfaceId,
                  signal,
                );
                // Own the connection before validating its page: viewport failure still needs
                // the outer diagnostic capture and finally block to release this exact transport.
                turnConnection = rebound.browser;
                diagnosticPage = rebound.page;
                await waitForOperationalChatGptViewport(rebound.page, signal);
                return rebound;
              },
            );
          },
        );
        turnConnection = connection.browser;
        page = connection.page;
        diagnosticPage = page;
        evidence.attach(page);
        await streamEvidence.attach(page);
        if (useResponseSource) await responseSource.attach(page);
        console.warn(
          `[chatgpt-web] browser turn ${turn.traceId} rebound its existing launcher page after a stalled DOM probe`,
        );
      };
      const recoverPageObservation = async (
        attempt: number,
        cause: ChatGptBrowserObservationTimeoutError,
        baseline: ChatGptSubmissionBaseline,
        checkpoint: "submission-page-rebound" | "assistant-page-rebound",
        abortSignal?: AbortSignal,
      ): Promise<ChatGptSubmissionObservationRecovery> => {
        await rebindLauncherPage(attempt, cause, abortSignal);
        const reboundBaseline = this.reboundSubmissionBaseline(page, baseline);
        await diagnostics.capture(page, checkpoint);
        return { page, baseline: reboundBaseline };
      };
      const recoverSubmissionObservation: ChatGptObservationRecovery = (
        attempt,
        cause,
        baseline,
        abortSignal,
      ) => recoverPageObservation(
        attempt,
        cause,
        baseline,
        "submission-page-rebound",
        abortSignal,
      );
      const recoverAssistantObservation: ChatGptObservationRecovery = (
        attempt,
        cause,
        baseline,
        abortSignal,
      ) => recoverPageObservation(
        attempt,
        cause,
        baseline,
        "assistant-page-rebound",
        abortSignal,
      );
      // Rebinding the exact leased page is a browser-ownership operation. Read-only
      // compaction needs it too; acquiring MCP tools is not a prerequisite.
      const launcherObservationRecovery = launcherSurfaceId !== undefined
        && this.config.browserHostDescriptorPath !== undefined;
      await diagnostics.capture(page, "browser-page-acquired");
      console.info(
        `[chatgpt-web] browser turn ${turn.traceId} opened (transport=${prepared.contextFile ? "context-file" : "inline"}, maxMessageChars=${maxMessageChars}, estimatedInputTokens=${estimatedInputTokens}, images=${prepared.images.length}, compactionTrimmedMessages=${prepared.trimmedCompactionMessages ?? 0})`,
      );
      if (!reuseConversation) {
        try { await this.runStage(
          turn.traceId,
          "temporary_chat_preparation",
          undefined,
          stageSignal => this.prepareChatSurface(
            page,
            checkpoint => diagnostics.capture(page, checkpoint),
            this.config.useSavedChats,
            { signal: turn.abortSignal
              ? AbortSignal.any([turn.abortSignal, stageSignal]) : stageSignal,
            onSnapshot: snapshot => { readinessSnapshot = snapshot; } },
          ),
          chatGptSuspensionClock, true, stageRetirement,
        ); } catch (error) {
          preparationFailed = true;
          turn.abortSignal?.throwIfAborted();
          // Read fresh state; an old pre-navigation snapshot cannot prove absence of a submission.
          const current = await readChatGptReadiness(page, 2_000).catch(() => undefined);
          readinessSnapshot = current;
          if (!(error instanceof ChatGptWebAdapterError) || error.code === "chatgpt_composer_unavailable"
            || error.code === "chatgpt_preparation_timeout") {
            if (proveUnsubmittedPreparation(current, { reused: reuseConversation,
              submissionStarted: evidence.submissionStarted,
              conversationRequestObserved: evidence.conversationRequestObserved,
              progress: turn.externalProgress?.snapshot() })) throw preparationError(CHATGPT_UNSUBMITTED_PREPARATION);
          }
          throw error;
        }
      }
      // A retained lease proves conversation ownership, not the next message's model or tools.
      // Reconcile the model and attach the exact connector before every submission.
      const selectRequestedMode = () => (
        this.selectModelAndEffort(
          page,
          turn.modelId,
          requestedMode.effort,
          browserCapabilities,
          checkpoint => diagnostics.capture(page, checkpoint),
          trackUsage,
          turn.modelFamily,
        )
      );
      let mode = await this.runStage(turn.traceId, "effort_selection", undefined, selectRequestedMode);
      await diagnostics.capture(page, "effort-selection-complete");

      // One receipt per physical Send, not per native tool call or stream attachment.
      // The ID survives observation recovery; a new actual Send receives a new ID.
      const usageSubmission = async () => {
        if (!trackUsage) return undefined;
        let identity: { accountKey: string; plan: ReturnType<typeof chatGptUsagePlan> } | undefined;
        try {
          const account = await readChatGptUsageAccount(page);
          identity = { accountKey: account.accountKey, plan: chatGptUsagePlan(account) };
        } catch {
          // A missing identity is reported as a tracking gap, never charged to the previous account.
        }
        const model = mode.usageModel ?? (mode.effort === "max" ? "pro-unknown" : "other");
        return createUsageDelivery({ descriptorPath: this.config.browserHostDescriptorPath!, traceId: turn.traceId,
          identity, model, effort: mode.effort, purpose: turn.usagePurpose ?? (turn.compaction ? "compaction" : "task") });
      };

      let finalPrompt = prepared.text;
      let submissionBaseline = await this.captureSubmissionBaseline(page, finalPrompt);
      let catalogRefreshAvailable = mode.localTools && !reuseConversation;
      const connectorAttemptBudget: ChatGptConnectorAttemptBudget = { triggerAttempts: 0 };
      for (;;) {
        try {
          await this.runStage(
            turn.traceId,
            "prompt_attachment",
            undefined,
            (stageSignal) => {
              const promptAbortSignal = turn.abortSignal
                ? AbortSignal.any([stageSignal, turn.abortSignal])
                : stageSignal;
              return this.attachPromptWithCompactionRetry(
                page,
                finalPrompt,
                mode.localTools,
                turn.compaction === true,
                submissionBaseline,
                checkpoint => diagnostics.capture(page, checkpoint),
                promptAbortSignal,
                catalogRefreshAvailable,
                connectorAttemptBudget,
                reuseConversation,
                mode.thinkEnabled,
              );
            },
            chatGptSuspensionClock,
            true,
            stageRetirement,
          );
          break;
        } catch (error) {
          if (!(error instanceof ChatGptConnectorCatalogStaleError) || !catalogRefreshAvailable) throw error;
          catalogRefreshAvailable = false;
          await diagnostics.capture(page, "connector-catalog-stale");
          await this.runStage(
            turn.traceId,
            "connector_catalog_refresh",
            undefined,
            async () => {
              await page.reload({ waitUntil: "domcontentloaded", timeout: browserStageTimeouts.navigation });
              await this.prepareChatSurface(
                page,
                checkpoint => diagnostics.capture(page, checkpoint),
                this.config.useSavedChats,
              );
              mode = await this.selectModelAndEffort(
                page,
                turn.modelId,
                turn.reasoning,
                turn.capabilities,
                checkpoint => diagnostics.capture(page, checkpoint),
                trackUsage,
                turn.modelFamily,
              );
              submissionBaseline = await this.captureSubmissionBaseline(page, finalPrompt);
            },
          );
          await diagnostics.capture(page, "connector-catalog-refreshed");
        }
      }
      await diagnostics.capture(page, "prompt-attachment-complete");
      const attachmentTimeoutMs = turn.attachmentTimeoutMs ?? browserStageTimeouts.fileAttachment;
      await this.runStage(turn.traceId, "file_attachment", undefined, (stageSignal) => (
        this.attachFiles(page, prepared, turn.abortSignal ? AbortSignal.any([stageSignal, turn.abortSignal]) : stageSignal, attachmentTimeoutMs, submissionBaseline)
      ));
      await diagnostics.capture(page, "file-attachment-complete");
      completionAnnouncementKey = await armCompletionAnnouncement(page);
      const completionTracker = new ChatGptCompletionTracker(completionAnnouncementKey);
      const recordFinalUsage = await usageSubmission();
      const queueTarget = turn.queueTicket ? await this.requestQueueTarget() : undefined;
      const reportSendProgress = async (progress: "preflight" | "waiting_permit" | "sending" | "awaiting_ack" | "reconciling") => {
        if (!turn.queueTicket) return;
        try { await queueRequest(queueTarget!, "send-progress", { ...turn.queueTicket, progress }); }
        catch (error) { diagnosticEvent("warning", "browser.send_progress_failed", { error: diagnosticError(error) }); }
      };
      await reportSendProgress("preflight");
      let sendMethod: "click" | "enter" = "click";
      // Model-menu preparation has no remote send effect and must not reserve the global
      // send permit. The ready identity/selection check still runs immediately before input.
      await this.runStage(turn.traceId, "send_preflight", undefined, async () => {
        await this.assertSelectedEffort(page, mode);
        assertSavedChatIdentity(page, expectedConversationId);
        sendMethod = await this.prepareSendMethod(page, turn.abortSignal);
      });
      throwIfPromptAttachmentAborted(turn.abortSignal);
      await reportSendProgress("waiting_permit");
      const queuePermit = turn.queueTicket ? await waitForSendPermit(queueTarget!, turn.queueTicket, turn.abortSignal) : undefined;
      let sendActivated = false, sendAcknowledged = false;
      let acknowledgementClosed = false;
      let acknowledgement: Promise<void> | undefined;
      const acknowledgeSubmission = (): Promise<void> => {
        if (acknowledgementClosed) return Promise.reject(new DOMException("Send acknowledgement retired", "AbortError"));
        // The normal path, late source evidence and a delayed original callback share one receipt.
        // In particular, never send a conflicting unknown receipt while confirmation is in flight.
        return acknowledgement ??= (async () => {
          const source = responseSource.snapshot();
          if (useResponseSource && (source.matchedRequests > 1 || source.reason === "response_request_ambiguous"
            || source.projection?.reason === "response_identity_mismatch")) {
            throw new Error("The original send has conflicting response identity evidence");
          }
          if (turn.queueTicket && queuePermit) {
            await queueRequest(queueTarget!, "send-end", { ...turn.queueTicket, permit: queuePermit, outcome: "confirmed" });
          }
          sendAcknowledged = true;
          if (!turn.compaction && this.config.turnTimeoutMs !== undefined) deadline = Date.now() + this.config.turnTimeoutMs;
          if (turn.queueTicket) await queueRequest(queueTarget!, "phase", { ...turn.queueTicket, phase: "running" });
          if (recordFinalUsage) usageWrites.push(recordFinalUsage.submitted());
          await turn.onSubmitted?.();
        })();
      };
      const finalSubmissionEvidence = await (async () => {
        return this.runStage(
          turn.traceId,
          "send",
          undefined,
          (stageSignal) => this.sendAttachedPrompt(
            page,
            submissionBaseline,
            checkpoint => diagnostics.capture(page, checkpoint),
            turn.abortSignal ? AbortSignal.any([stageSignal, turn.abortSignal]) : stageSignal,
            turn.externalProgress,
            { ...turn, onInputProgress: reportSendProgress, onSubmitted: acknowledgeSubmission, onSendActivated: async () => {
              // Check the ready controls again without reopening the verified picker.
              await this.assertSelectedEffort(page, mode, false);
              assertSavedChatIdentity(page, expectedConversationId);
              await turn.onSendActivated?.();
              throwIfPromptAttachmentAborted(stageSignal);
              throwIfPromptAttachmentAborted(turn.abortSignal);
              evidence.submissionStarted = true;
              if (useResponseSource) responseSource.activate(finalPrompt, expectedConversationId);
              streamEvidence.mcp.activate();
              submissionRejection.begin(page);
              recordFinalUsage?.activate();
              sendActivated = true;
            } },
            completionTracker,
            launcherObservationRecovery
              ? async (...args) => {
                const recovered = await recoverSubmissionObservation(...args);
                submissionBaseline = recovered.baseline;
                return recovered;
              }
              : undefined,
            useResponseSource ? () => responseSource.submissionAccepted() : undefined,
            sendMethod,
          ),
        );
      })().catch(async error => {
        let drainedAcknowledgement: Promise<void> | undefined;
        // The send budget can expire before its original queue acknowledgement resolves. Drain
        // that single operation before deciding whether any uncertainty remains.
        if (acknowledgement) {
          drainedAcknowledgement = acknowledgement;
          try { await withChatGptBrowserObservationTimeout(acknowledgement, 10_000); }
          catch (acknowledgementError) { error = acknowledgementError; }
        } else if (sendActivated && useResponseSource && !turn.abortSignal?.aborted
          && !(error instanceof ChatGptWebAdapterError) && !(error instanceof ChatGptPersistentBrowserStateError)) {
          diagnosticEvent("info", "browser.send_reconciliation_started", { traceId: turn.traceId, source: responseSource.snapshot() });
          await reportSendProgress("reconciling");
          const reconciled = await reconcileSendAcceptance({
            read: () => responseSource.snapshot(), connected: () => !page.isClosed(), signal: turn.abortSignal,
          });
          diagnosticEvent("info", "browser.send_reconciliation_completed", { traceId: turn.traceId, outcome: reconciled, source: responseSource.snapshot() });
          if (reconciled === "confirmed" && !turn.abortSignal?.aborted) {
            await acknowledgeSubmission();
            return "response_stream" as const;
          }
        }
        // A delayed original callback may have started while the read-only window was open.
        if (acknowledgement && acknowledgement !== drainedAcknowledgement && !sendAcknowledged) {
          try { await withChatGptBrowserObservationTimeout(acknowledgement, 10_000); }
          catch (acknowledgementError) { error = acknowledgementError; }
        }
        acknowledgementClosed = true;
        if (turn.queueTicket && queuePermit && !sendAcknowledged) {
          try { await queueRequest(queueTarget!, "send-end", {
            ...turn.queueTicket, permit: queuePermit, outcome: sendActivated ? "unknown" : "not-sent",
          }); } catch { /* Queue settlement preserves the unresolved permit and pauses dispatch. */ }
        }
        throwIfPromptAttachmentAborted(turn.abortSignal);
        if (sendActivated && !sendAcknowledged && !(error instanceof ChatGptWebAdapterError)
          && !turn.abortSignal?.aborted) {
          diagnosticEvent("error", "browser.send_outcome_unknown", { source: responseSource.snapshot() });
          throw new ChatGptWebAdapterError("ChatGPT send was activated but acceptance could not be confirmed. The request was not resent; inspect the browser task before resuming the queue.", {
            status: 502, errorType: "server_error", code: "chatgpt_send_outcome_unknown", retryable: false, cause: error,
          });
        }
        throw error;
      });
      diagnosticEvent("info", "browser.submission_accepted", { traceId: turn.traceId, evidence: finalSubmissionEvidence, submission: "accepted", source: responseSource.snapshot() });
      responsePhase = "generation";
      const checkedSource = () => {
        const source = responseSource.result();
        if (responseSourceBlocksFallback(source)) {
          throw new ChatGptWebAdapterError(`ChatGPT response source could not be verified: ${source.state === "rejected" ? source.reason : "invalid"}`, {
            status: 502, errorType: "server_error", code: "chatgpt_response_source_invalid", retryable: false,
          });
        }
        return source;
      };
      let responseTurn: ChatGptAssistantTurnBinding | undefined;
      // Binding observes its own stages. Keeping it pending lets a complete public source
      // finish even when the renderer has not mounted an answer or its read is blocked.
      let bindingObservation = new ChatGptPendingObservation<ChatGptAssistantTurnBinding | undefined>(Number.POSITIVE_INFINITY);
      const bindAssistantTurn = () => this.waitForNewAssistantTurn(
        page,
        submissionBaseline,
        undefined, // The main loop owns generation/extraction limits, never this observation workflow.
        observationSignal,
        turn.externalProgress,
        CHATGPT_RESPONSE_DOM_GRACE_MS,
        completionTracker,
        launcherObservationRecovery
          ? async (...args) => {
            const recovered = await recoverAssistantObservation(...args);
            submissionBaseline = recovered.baseline;
            return recovered;
          }
          : undefined,
        useResponseSource ? () => checkedSource().state === "complete" : undefined,
        useResponseSource ? () => responseSource.submissionAccepted()
          && responseSource.result().state === "collecting" && !responseSource.snapshot().transportFailed : undefined,
      );
      await diagnostics.capture(page, "send-accepted");
      if (this.config.useSavedChats) expectedConversationId ??= savedChatId(page.url());

      let lastHeartbeat = 0;
      let finalText = "";
      let selectedSource: "response" | "dom" = "dom";
      let responseCompletion: Promise<void> | undefined;
      let extractionDeadline: number | undefined;
      const responseCompleted = () => {
        if (!responseCompletion) {
          // Generation and extraction are different operations. Earlier generation time does
          // not spend the allowance for obtaining the completed answer.
          deadline = undefined;
          extractionDeadline ??= Date.now() + CHATGPT_RESPONSE_EXTRACTION_TIMEOUT_MS;
          responsePhase = "extraction";
          diagnosticEvent("info", "browser.response_completed", { phase: "generation", outcome: "completed" });
          responseCompletion = Promise.resolve().then(() => turn.onResponseCompleted?.());
        }
        return responseCompletion;
      };
      let sawRunning = false;
      let loggedCompletionWait = false;
      let capturedResponse = false;
      const sentAt = Date.now();
      const visibleTrace = new ChatGptVisibleTraceTracker();
      const markdownBuffer = new ChatGptMarkdownBuffer(undefined, useResponseSource ? "buffered" : turn.textDelivery);
      const checkpointStream = turn.captureLunaCheckpoint
        ? new ChatGptLunaCheckpointStream()
        : undefined;
      const emitMarkdownDelta = (delta: string): void => {
        const visible = checkpointStream ? checkpointStream.push(delta) : delta;
        if (visible) turn.onTextDelta(visible);
      };
      const throwMarkdownConsistencyError = (error: unknown): never => {
        if (!(error instanceof ChatGptMarkdownConsistencyError)) throw error;
        diagnosticEvent("error", "browser.markdown_conflict", {
          ...markdownBuffer.deliveryState(), conflict: error.diagnostic,
        });
        try {
          const artifact = markdownBuffer.failureEvidence();
          if (artifact) {
            const evidenceRef = persistChatGptResponseEvidence(diagnosticsRoot, { traceId: turn.traceId, ...artifact }, "response-dom.private.json");
            diagnosticEvent("info", "browser.markdown_evidence", { evidence: evidenceRef });
          }
        } catch (evidenceError) {
          diagnosticEvent("warning", "browser.markdown_evidence_failed", {
            reason: evidenceError instanceof ChatGptResponseEvidenceStorageError ? evidenceError.code : "response_evidence_write_failed",
          });
        }
        throw chatGptMarkdownFailure(turn.uiLanguage, error);
      };
      const domHealthTracker = new ChatGptTurnDomHealthTracker();
      const readResponseObservation = async (observedPage: Page, locator: Locator, cache: ChatGptResponseDomCache) => {
        const read = <T>(operation: () => Promise<T>) => withBrowserTurnAbort(
          withChatGptBrowserObservationTimeout(Promise.resolve().then(operation), 120_000), observationSignal,
        );
        throwIfPromptAttachmentAborted(observationSignal);
        await read(() => throwIfChatGptSessionFailureAlert(observedPage));
        throwIfPromptAttachmentAborted(observationSignal);
        await read(() => throwIfChatGptTerminalErrorAlert(locator));
        throwIfPromptAttachmentAborted(observationSignal);
        const snapshot = await withBrowserTurnAbort(this.responseDomSnapshot(locator, cache), observationSignal);
        throwIfPromptAttachmentAborted(observationSignal);
        const running = await read(() => observedPage.locator(CHATGPT_STOP_BUTTON_SELECTOR).last().isVisible());
        const completion = await read(() => readCompletionAnnouncement(observedPage, completionAnnouncementKey));
        return { snapshot, running, completion };
      };
      // Each read above owns its limit; the batch has no shared cross-step allowance.
      let responseObservation = new ChatGptPendingObservation<Awaited<ReturnType<typeof readResponseObservation>>>(Number.POSITIVE_INFINITY);
      let consecutiveObservationRebinds = 0;
      let internalObservationFaults = 0;
      let observedThisIteration = false;
      let completionFenceRevision: number | undefined;
      const completionFenceWait = new CompletionFenceWait();
      const finalActivity = new ChatGptPendingObservation<boolean>(120_000);
      let nextFinalActivityRead = 0;
      let savedReadbackStarted = false;
      let savedReadback: Promise<void> | undefined;
      for (;;) {
        // The heartbeat is a consumer callback, so it stays outside the observation-fault region:
        // a defect in the caller must not be retried as though the page could not be read.
        if (Date.now() - lastHeartbeat >= 10_000) {
          turn.onHeartbeat?.();
          lastHeartbeat = Date.now();
        }
       try {
        observedThisIteration = false;
        if (page.isClosed()) {
          throw chatGptBrowserTabClosedError();
        }
        if (turn.abortSignal?.aborted) {
          const stop = page.locator(CHATGPT_STOP_BUTTON_SELECTOR).last();
          await withChatGptBrowserObservationTimeout((async () => {
            if (await stop.isVisible().catch(() => false)) await stop.press("Enter", { timeout: 30_000 });
          })(), 30_000).catch(() => {});
          throw new DOMException("ChatGPT web turn aborted", "AbortError");
        }
        if (deadline !== undefined && Date.now() >= deadline) {
          throw chatGptResponseFailure("chatgpt_response_timeout");
        }
        if (extractionDeadline !== undefined && Date.now() >= extractionDeadline) {
          if (useResponseSource && responseSource.result().state === "awaiting_final") {
            throw new ChatGptWebAdapterError("ChatGPT ended this turn without a verifiable public final answer. Existing tool results were preserved; no generation was resent.", {
              status: 502, errorType: "upstream_error", code: "chatgpt_public_answer_missing", retryable: false,
            });
          }
          // Retain the existing read-only failed-answer page and bilingual recovery help.
          // The distinct cause/phase still identifies extraction expiry without a new UI protocol.
          throw chatGptMarkdownFailure(turn.uiLanguage, chatGptResponseFailure("chatgpt_response_extraction_timeout"));
        }
        if (useResponseSource) {
          const source = checkedSource();
          if (source.state === "awaiting_final" && Date.now() >= nextFinalActivityRead) {
            const activity = finalActivity.poll(async () => {
              await throwIfChatGptSessionFailureAlert(page);
              return page.locator(CHATGPT_STOP_BUTTON_SELECTOR).last().isVisible();
            });
            if (activity.state === "ready") {
              nextFinalActivityRead = Date.now() + 1_000;
              if (!activity.value && !chatGptExternalProgressSuppressesDomHealth(turn.externalProgress?.snapshot(), Date.now())) {
                if (extractionDeadline === undefined) {
                  deadline = undefined;
                  extractionDeadline = Date.now() + CHATGPT_RESPONSE_EXTRACTION_TIMEOUT_MS;
                  responsePhase = "extraction";
                  diagnosticEvent("info", "browser.response_reconciliation", { reason: "public_final_pending", savedChat: this.config.useSavedChats });
                }
                if (this.config.useSavedChats && !savedReadbackStarted && savedChatId(page.url()) === source.conversationId) {
                  savedReadbackStarted = true;
                  // Reload only this already-saved, idle conversation once. Its normal GET is
                  // observed passively; no bearer extraction, alternate tab, or new generation.
                  savedReadback = page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 })
                    .then(() => {})
                    .catch(() => { diagnosticEvent("warning", "browser.response_readback_unavailable", { reason: "saved_page_reload_failed" }); })
                    .finally(() => {
                      responseDomCache = { ownerKey: responseDomCache.ownerKey };
                      responseObservation = new ChatGptPendingObservation(Number.POSITIVE_INFINITY);
                      bindingObservation = new ChatGptPendingObservation(Number.POSITIVE_INFINITY);
                      responseTurn = undefined;
                      savedReadback = undefined;
                    });
                }
              }
            }
          }
          if (responseSource.lifecycle().state === "complete") {
            observedThisIteration = true;
            await responseCompleted();
            observedThisIteration = false;
          }
          if (source.state === "complete") {
            const rejection = await submissionRejection.failure();
            if (rejection) throw rejection;
            observedThisIteration = true;
            await responseCompleted();
            finalText = source.text;
            selectedSource = "response";
            if (finalText.trim() === "api_tool unavailable") throw new Error("ChatGPT selected mode rejected the Codex Native MCP tool (api_tool unavailable)");
            responsePhase = "delivery";
            turn.onTextDelta(finalText);
            diagnosticEvent("info", "browser.response_source_committed", { chars: finalText.length, source: responseSource.snapshot() });
            break;
          }
        }
        if (savedReadback) {
          await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
          continue;
        }
        if (!responseTurn) {
          const binding = bindingObservation.poll(bindAssistantTurn);
          if (binding.state === "ready") responseTurn = binding.value;
          if (!responseTurn) {
            await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
            continue;
          }
        }

        if (mode.localTools && await resolveChatGptToolConfirmation(
          page,
          this.config.appName,
          this.config.autoApproveToolCalls,
          turn.abortSignal,
          CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS,
          () => diagnostics.capture(page, "tool-confirmation-visible"),
        )) {
          internalObservationFaults = 0;
          await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
          continue;
        }

        const observedPage = page;
        const observedLocator = responseTurn.locator;
        const observedCache = responseDomCache;
        const observation = responseObservation.poll(() => readResponseObservation(observedPage, observedLocator, observedCache));
        if (observation.state === "pending") {
          await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
          continue;
        }
        let { snapshot } = observation.value;
        const { running, completion } = observation.value;
        if (!snapshot.responsePresent && !(useResponseSource && responseSource.result().state === "collecting")) {
          try {
            const rebound = await withChatGptBrowserObservationTimeout(
              this.reconcileAssistantTurnBinding(
                page,
                submissionBaseline,
                responseTurn,
                turn.abortSignal,
              ),
            );
            if (rebound.identity !== responseTurn.identity) {
              responseTurn = rebound;
              responseDomCache.key = undefined;
              responseDomCache.snapshot = undefined;
              snapshot = await this.responseDomSnapshot(responseTurn.locator, responseDomCache);
            }
          } catch (error) {
            if (!(error instanceof ChatGptBrowserObservationTimeoutError) || !launcherSurfaceId) throw error;
            consecutiveObservationRebinds += 1;
            if (consecutiveObservationRebinds > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
              throw new Error(
                `ChatGPT browser DOM remained unresponsive after ${MAX_CHATGPT_BROWSER_PAGE_REBINDS} same-page rebinds`,
                { cause: error },
              );
            }
            await rebindLauncherPage(consecutiveObservationRebinds, error, turn.abortSignal);
            submissionBaseline = this.reboundSubmissionBaseline(page, submissionBaseline);
            responseTurn = {
              ...responseTurn,
              locator: page.locator(chatGptAssistantTurnSelector(responseTurn.identity)),
            };
            responseDomCache = { ownerKey: responseDomCache.ownerKey };
            responseObservation = new ChatGptPendingObservation(Number.POSITIVE_INFINITY);
            await diagnostics.capture(page, "response-page-rebound");
            continue;
          }
        }
        if (snapshot.stoppedThinkingVisible) throw chatGptStoppedThinkingError();
        if (snapshot.responsePresent) consecutiveObservationRebinds = 0;
        // The page was read successfully, so the fault budget is genuinely consecutive even when
        // this iteration goes on to `continue` for a rebind, confirmation, or liveness pause.
        internalObservationFaults = 0;
        observedThisIteration = true;
        // Liveness may postpone a verdict, never waive it: once activity goes stale the DOM alone
        // decides, so a tool call that never returns cannot hold a turn with no explicit deadline open forever.
        const externalProgressSnapshot = turn.externalProgress?.snapshot();
        if (turn.externalProgress
          && externalProgressSnapshot
          && completionTracker.needsToolBatchObservation(externalProgressSnapshot.lastToolBatchRevision)) {
          completionTracker.observeToolBatch(
            externalProgressSnapshot.lastToolBatchRevision,
            completion.revision,
          );
          await turn.externalProgress.acknowledgeToolBatch(externalProgressSnapshot.lastToolBatchRevision);
        }
        const externalProgressLive = chatGptExternalProgressSuppressesDomHealth(
          externalProgressSnapshot,
          Date.now(),
        );
        const externalToolCallsInFlight = chatGptExternalToolCallsAreInFlight(externalProgressSnapshot);
        if (!snapshot.responsePresent && externalProgressLive) {
          // Current-turn MCP activity proves that ChatGPT is still executing even if its renderer
          // temporarily cannot expose the response subtree. DOM remains authoritative for text and
          // completion; this only prevents a live turn from being misclassified as vanished.
          domHealthTracker.clearMissingResponse();
          await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
          continue;
        }
        if (running) sawRunning = true;
        if (snapshot.responsePresent) {
          if (!capturedResponse) {
            capturedResponse = true;
            diagnosticEvent("info", "browser.response_visible", { phase: "response", outcome: "observed" });
            await diagnostics.capture(page, "response-visible");
          }
          for (const trace of visibleTrace.observe(snapshot.traceBlocks, snapshot.completionActionVisible)) {
            if (trace.kind === "commentary") turn.onCommentary?.(trace.text, trace.continuation === true);
            else turn.onReasoningSummary?.(trace.text, trace.continuation === true);
          }
          const domError = domHealthTracker.update({
            responsePresent: snapshot.responsePresent,
            running,
            currentText: snapshot.visibleText,
            completionActionVisible: snapshot.completionActionVisible,
            externalProgressLive,
            sourceAvailable: useResponseSource && responseSource.result().state === "collecting",
          });
          if (domError && !(useResponseSource && responseSource.result().state === "awaiting_final")) throw new Error(domError);
          const sourceCompletion = useResponseSource ? responseSource.lifecycle() : undefined;
          if (snapshot.messageId && sourceCompletion?.messageId && snapshot.messageId !== sourceCompletion.messageId) {
            throw chatGptMarkdownFailure(turn.uiLanguage, new Error("Complete DOM belongs to a different response message"));
          }
          const completionReady = completionTracker.update({
            responsePresent: snapshot.responsePresent,
            running,
            externalToolCallsInFlight,
            normalCompletion: completion.complete || sourceCompletion?.state === "complete",
            completionRevision: sourceCompletion?.state === "complete" ? 1 : completion.revision,
          });
          if (completionReady) await responseCompleted();
          // Native final text is extracted only after normal completion. Draft revisions
          // remain renderer data; they never enter a historical Markdown commitment ledger.
          if (snapshot.contentState === "complete" && (!useResponseSource || completionReady)) {
            let delta: string;
            try { delta = markdownBuffer.observe(snapshot.markdownSegments); }
            catch (error) { return throwMarkdownConsistencyError(error); }
            if (delta) emitMarkdownDelta(delta);
          }
          if (!completionReady) {
            completionFenceRevision = undefined;
            completionFenceWait.reset();
          }
          if (completionReady) {
            if (useResponseSource) {
              const source = checkedSource();
              if (source.state === "complete") continue; // Commit through the source branch above.
              if (source.state === "collecting" && responseSource.snapshot().matchedRequests > 0) {
                // A UI completion does not turn an unfinished source into a valid answer.
                // This wait owns the independent extraction deadline established above.
                await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                continue;
              }
              diagnosticEvent("info", "browser.response_source_fallback", {
                reason: source.state === "rejected" ? source.reason : "response_source_unavailable", source: responseSource.snapshot(),
              });
            }
            if (snapshot.contentState === "unsupported") {
              throw chatGptMarkdownFailure(turn.uiLanguage, new Error(snapshot.contentReason ?? "Semantic response component is unsupported"));
            }
            if (snapshot.contentState !== "complete") {
              await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
              continue;
            }
            if (snapshot.visibleText === "api_tool unavailable") {
              throw new Error("ChatGPT selected mode rejected the Codex Native MCP tool (api_tool unavailable)");
            }
            const final = (() => {
              try { return markdownBuffer.prepareFinal(); }
              catch (error) { return throwMarkdownConsistencyError(error); }
            })();
            if (!final.markdown && snapshot.visibleText) {
              throw new Error("ChatGPT completed with visible text that could not be serialized as Markdown");
            }
            if (turn.completionFence) {
              if (completionFenceRevision === undefined) {
                const fence = observeMcpCompletion(await turn.completionFence.begin(), streamEvidence.mcp.snapshot(),
                  completionFenceWait, Date.now(), CHATGPT_EMPTY_RESPONSE_GRACE_MS);
                if (fence.state === "awaiting_intent" || fence.state === "activity_in_flight") {
                  await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                  continue;
                }
                completionFenceRevision = fence.revision;
                // The fence revision is captured after this DOM projection. Force one fresh read
                // before commit so an MCP activity that just settled cannot disappear between a
                // stale cached completion and the broker's terminal decision.
                responseDomCache.key = undefined;
                responseDomCache.snapshot = undefined;
                await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                continue;
              }
              // A connector call can appear after the first DOM/fence read. Recheck
              // before accepting prose; the broker commit still guards late local claims.
              if (observeMcpCompletion({ state: "ready", revision: completionFenceRevision }, streamEvidence.mcp.snapshot(),
                completionFenceWait, Date.now(), CHATGPT_EMPTY_RESPONSE_GRACE_MS).state === "awaiting_intent") {
                completionFenceRevision = undefined;
                responseDomCache.key = undefined;
                responseDomCache.snapshot = undefined;
                await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                continue;
              }
              if ((await turn.completionFence.commit(completionFenceRevision, final.markdown)).state !== "committed") {
                completionFenceRevision = undefined;
                responseDomCache.key = undefined;
                responseDomCache.snapshot = undefined;
                await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                continue;
              }
            }
            responsePhase = "delivery";
            if (final.delta) emitMarkdownDelta(final.delta);
            if (checkpointStream) {
              const completed = checkpointStream.finishOptional(snapshot.visibleText);
              if (completed.visibleRemainder) turn.onTextDelta(completed.visibleRemainder);
              if (completed.captured) turn.onLunaCheckpoint!(completed.captured);
              else console.warn(`[chatgpt-web] browser turn ${turn.traceId} completed without a Luna rolling checkpoint; preserving full native history`);
              finalText = completed.answer;
            } else {
              finalText = final.markdown;
            }
            break;
          }
          if (!loggedCompletionWait && Date.now() - sentAt >= 60_000) {
            loggedCompletionWait = true;
            await diagnostics.capture(page, "response-stalled-60s");
            const diagnostic = await this.stalledTurnDiagnostic(page, responseTurn.locator).catch(error => JSON.stringify({
              diagnosticError: error instanceof Error ? error.message : String(error),
            }));
            console.warn(
              `[chatgpt-web] waiting for completed-turn evidence (running=${running}, sawRunning=${sawRunning}, textChars=${snapshot.visibleText.length}, completionActionVisible=${snapshot.completionActionVisible}, ui=${diagnostic})`,
            );
          }
        } else {
          const domError = domHealthTracker.update({
            responsePresent: false,
            running,
            currentText: "",
            completionActionVisible: false,
            externalProgressLive,
            sourceAvailable: useResponseSource && responseSource.result().state === "collecting",
          });
          if (domError && !(useResponseSource && responseSource.result().state === "awaiting_final")) throw new Error(domError);
        }
        await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
       } catch (error) {
        // A DOM read timeout does not invalidate an independent, active source. Keep its
        // single outstanding read while the source, cancellation and phase timers advance.
        if (error instanceof ChatGptBrowserObservationTimeoutError && !observedThisIteration
          && useResponseSource && responseSource.result().state === "collecting"
          && responseSource.submissionAccepted()) {
          await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
          continue;
        }
        // Only a defect in this worker is retried here. Every deliberate signal — adapter errors,
        // aborts, closed tabs, DOM-health verdicts — still fails the turn immediately.
        // Retry only faults raised while reading the page. Once observation succeeded, a
        // TypeError belongs to a consumer - Markdown buffering, text/trace callbacks, checkpoint
        // capture - and retrying it would rerun an iteration whose side effects already happened.
        if (!(error instanceof TypeError) || observedThisIteration) throw error;
        internalObservationFaults += 1;
        if (internalObservationFaults > MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS) {
          throw new Error(
            `ChatGPT browser observation failed ${internalObservationFaults} times in a row: ${error.message}`,
            { cause: error },
          );
        }
        console.warn(
          `[chatgpt-web] browser turn ${turn.traceId} tolerated internal observation fault`
          + ` ${internalObservationFaults}/${MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS}: ${error.message}`,
        );
        await diagnostics.capture(page, "internal-observation-fault");
        responseDomCache.key = undefined;
        responseDomCache.snapshot = undefined;
        await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
       }
      }

      const finalRejection = await submissionRejection.failure();
      if (finalRejection) throw finalRejection;
      if (this.context && this.config.browserHost === "managed-chrome") {
        const state = await this.context.storageState();
        atomicWriteFile(this.config.storageStatePath, `${JSON.stringify(state)}\n`);
      }
      diagnosticEvent("info", "browser.turn_completed", { outcome: "completed" });
      diagnosticEvent("info", "browser.response_delivery", { traceId: turn.traceId, source: selectedSource,
        markdownChars: finalText.length, resumed: responseSource.snapshot().resumed });
      if (useResponseSource && process.env.WEB2HARNESS_BROWSER_DIAGNOSTICS === "1") {
        try {
          // Capture the logical source (including automatic resume) and the bound final DOM
          // before cleanup. Optional evidence must never change or resend an accepted answer.
          const source = responseSource.result();
          const locator = responseTurn?.locator ?? (source.state === "complete"
            ? page.locator(`[data-message-id=${JSON.stringify(source.messageId)}][data-message-author-role="assistant"]`) : undefined);
          responseDomCache.key = undefined;
          const dom = locator && await locator.count() === 1
            ? await this.responseDomSnapshot(locator, responseDomCache).catch(() => undefined) : undefined;
          const artifact = chatGptResponseDeliveryEvidence({ traceId: turn.traceId, selectedSource, delivered: finalText, source: responseSource, dom });
          const evidenceRef = persistChatGptResponseEvidence(diagnosticsRoot, artifact, "response-delivery.private.json");
          diagnosticEvent("info", "browser.response_delivery_evidence", { traceId: turn.traceId, evidence: evidenceRef });
        } catch (error) {
          diagnosticEvent("warning", "browser.response_delivery_evidence_failed", { traceId: turn.traceId,
            reason: error instanceof ChatGptResponseEvidenceStorageError ? error.code : "response_evidence_write_failed" });
        }
      }
      await diagnostics.capture(page, "turn-completed");
      diagnosticEvent("info", "browser.response_evidence", { traceId: turn.traceId,
        stream: streamEvidence.snapshot(), transport: evidence.snapshot(), source: responseSource.snapshot(), markdownChars: finalText.length,
        toolProgress: turn.externalProgress?.snapshot() });
      if (this.config.useSavedChats && launcherSurfaceId) {
        const conversationId = savedChatId(page.url());
        if (conversationId) {
          try {
            assertSavedChatIdentity(page, expectedConversationId);
            const update = await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
              phase: "conversation", traceId: turn.traceId, helperPid: process.pid, conversationId,
            });
            if (update.conversationTitle) {
              await renameSavedChat(page, conversationId, update.conversationTitle);
              await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
                phase: "conversation", traceId: turn.traceId, helperPid: process.pid, conversationId, named: true,
              });
            }
          } catch {
            // The answer was already accepted. Never resend it because a cosmetic update failed.
            console.warn(`[chatgpt-web] saved chat naming unavailable trace=${turn.traceId}`);
          }
        }
      }
      console.info(
        `[chatgpt-web] browser turn ${turn.traceId} completed`
        + ` (markdownChars=${finalText.length}, domFullScans=${responseDomCache.fullScans ?? 0}, domCacheHits=${responseDomCache.cacheHits ?? 0})`,
      );
      return finalText;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")
        && !(error instanceof ChatGptWebAdapterError && error.code === "client_cancelled")) {
        error = await submissionRejection.failure() ?? error;
      }
      if (error instanceof DOMException && error.name === "AbortError"
        && turn.abortSignal?.reason instanceof ChatGptCompactionHandoffAccepted) {
        console.info(`[chatgpt-web] browser turn ${turn.traceId} ended after accepted structured compaction handoff`);
        if (diagnosticPage && !diagnosticPage.isClosed()) {
          await diagnostics.capture(diagnosticPage, "compaction-handoff-accepted");
        }
        throw turn.abortSignal.reason;
      }
      console.error(
        `[chatgpt-web] browser turn ${turn.traceId} failed:`
        + ` ${redactChatGptUiDiagnostic(error instanceof Error ? error.message : String(error))}`,
      );
      if (useResponseSource && !(error instanceof DOMException && error.name === "AbortError")
        && !(error instanceof ChatGptWebAdapterError && error.code === "client_cancelled")) {
        try {
          // Export before detach clears the bounded, privacy-projected event buffer. This also
          // works after page loss; no browser action or fresh network request is involved.
          const artifact = responseSource.takeEvidence();
          if (artifact) {
            const evidenceRef = persistChatGptResponseEvidence(diagnosticsRoot, { traceId: turn.traceId, ...artifact });
            diagnosticEvent("info", "browser.response_source_evidence", { traceId: turn.traceId, evidence: evidenceRef, summary: artifact.summary });
          }
        } catch (evidenceError) {
          // Diagnostic I/O must neither replace the original failure nor print private records.
          diagnosticEvent("warning", "browser.response_source_evidence_failed", {
            traceId: turn.traceId,
            reason: evidenceError instanceof ChatGptResponseEvidenceStorageError ? evidenceError.code : "response_evidence_write_failed",
          });
        }
      }
      if (diagnosticPage && !diagnosticPage.isClosed()) {
        const failure = diagnosticError(error);
        diagnosticEvent(failure.category === "cancelled" ? "info" : "error", "browser.turn_failed", { phase: responsePhase, outcome: failure.category === "cancelled" ? "cancelled" : "failed", error: failure });
        diagnosticEvent("info", "browser.failure_evidence", { traceId: turn.traceId, preparationFailed,
          readiness: readinessSnapshot, transport: evidence.snapshot(), stream: streamEvidence.snapshot(), source: responseSource.snapshot(),
          toolProgress: turn.externalProgress?.snapshot() });
        await diagnostics.capture(diagnosticPage, "turn-failed", error);
      }
      throw error;
    } finally {
      observationLifetime.abort();
      evidence.detach();
      await streamEvidence.detach();
      await responseSource.detach();
      submissionRejection.dispose();
      if (diagnosticPage && completionAnnouncementKey) {
        await withChatGptBrowserObservationTimeout(disposeCompletionAnnouncement(diagnosticPage, completionAnnouncementKey), 30_000).catch(() => {});
      }
      if (diagnosticPage) {
        await withChatGptBrowserObservationTimeout(disposeChatGptResponseDom(diagnosticPage, responseDomCache), 30_000).catch(() => {});
      }
      await Promise.all(usageWrites);
      prepared.release();
      if (turnConnection) {
        await turnConnection.close().catch(error => {
          if (preparationFailed) throw new Error("ChatGPT preparation failed and its browser connection could not be released", { cause: error });
          console.error(
            `[chatgpt-web] failed to release launcher browser connection for ${turn.traceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      } else if (managedPage) {
        if (!managedPage.isClosed()) await managedPage.close();
        this.managedPageReleases.get(managedPage)?.();
        this.managedPageReleases.delete(managedPage);
      }
    }
  }
}
