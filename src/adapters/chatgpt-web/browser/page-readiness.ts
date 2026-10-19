import type { Locator, Page } from "playwright-core";
import { CHATGPT_COMPOSER_SELECTOR, CHATGPT_USER_TURN_SELECTOR, CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_STOP_BUTTON_SELECTOR } from "../../../browser/session";
import { ChatGptWebAdapterError } from "../adapter-error";
import type { ChatGptExternalTurnProgressSnapshot } from "../tools/turn-progress";
import { ChatGptBrowserObservationTimeoutError, withChatGptBrowserObservationTimeout } from "./turn-observation";

export const MAX_CHATGPT_PREPARATION_RECOVERIES = 1;
// This internal code is produced only after checking the unsent page, never from error text.
export const CHATGPT_UNSUBMITTED_PREPARATION = "chatgpt_preparation_unsubmitted";

export function preparationError(code: "chatgpt_composer_unavailable" | "chatgpt_preparation_timeout"
  | "chatgpt_page_structure_unsupported" | "chatgpt_sign_in_required" | "chatgpt_session_expired"
  | "chatgpt_verification_required" | "chatgpt_subscription_unavailable" | typeof CHATGPT_UNSUBMITTED_PREPARATION,
  cause?: unknown): ChatGptWebAdapterError {
  const messages = {
    chatgpt_composer_unavailable: "ChatGPT did not expose a ready message composer. Check the ChatGPT page before retrying.",
    chatgpt_preparation_timeout: "A ChatGPT page preparation operation timed out. The message was not submitted.",
    chatgpt_page_structure_unsupported: "ChatGPT exposed an unsupported or ambiguous message composer.",
    chatgpt_sign_in_required: "ChatGPT requested sign-in. Open sign in in Web2Harness, then retry.",
    chatgpt_session_expired: "The ChatGPT session has expired. Sign in again in Web2Harness.",
    chatgpt_verification_required: "ChatGPT requires verification in the browser before this task can continue.",
    chatgpt_subscription_unavailable: "ChatGPT could not load the account subscription. Check the ChatGPT page before retrying.",
    chatgpt_preparation_unsubmitted: "ChatGPT page initialization did not expose a ready composer before submission.",
  };
  const auth = code === "chatgpt_sign_in_required" || code === "chatgpt_session_expired";
  return new ChatGptWebAdapterError(messages[code], { status: auth ? 401 : code === "chatgpt_verification_required" ? 403
    : code === "chatgpt_preparation_timeout" ? 504 : 502,
  errorType: auth ? "authentication_error" : code === "chatgpt_verification_required" ? "permission_error" : "server_error",
  code, retryable: false, cause });
}

export interface ChatGptReadinessSnapshot {
  documentComplete: boolean; surfaceBound: boolean; composers: number; editable: boolean;
  userTurns: number; assistantTurns: number; stopButtons: number; unknownEditors: number;
  signIn: boolean; expired: boolean; verification: boolean; subscriptionFailure: boolean;
}

/** Returns counts and known UI categories only; no page text, credentials, or arbitrary attributes. */
export async function readChatGptReadiness(page: Page, timeoutMs: number): Promise<ChatGptReadinessSnapshot> {
  return withChatGptBrowserObservationTimeout(observeChatGptReadiness(page), Math.max(1, timeoutMs));
}

const pendingReadinessObservations = new WeakMap<Page, Promise<ChatGptReadinessSnapshot>>();

function observeChatGptReadiness(page: Page): Promise<ChatGptReadinessSnapshot> {
  const pending = pendingReadinessObservations.get(page);
  if (pending) return pending;
  const operation = page.evaluate(({ composer, user, assistant, stop }) => {
    const visible = (e: Element) => {
      const style = getComputedStyle(e); const rect = e.getBoundingClientRect();
      return e.isConnected && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
        && rect.width > 0 && rect.height > 0;
    };
    const all = (selector: string) => [...document.querySelectorAll(selector)].filter(visible);
    const editors = all(composer);
    const alerts = all('[role="alert"], [role="dialog"]');
    const alertMatches = (pattern: RegExp) => alerts.some(e => pattern.test(e.textContent ?? ""));
    const first = editors[0];
    return {
      documentComplete: document.readyState === "complete", surfaceBound: innerWidth > 0 && innerHeight > 0,
      composers: editors.length,
      editable: !!first && (first instanceof HTMLTextAreaElement ? !first.disabled && !first.readOnly
        : first instanceof HTMLElement && first.isContentEditable),
      userTurns: all(user).length, assistantTurns: all(assistant).length, stopButtons: all(stop).length,
      unknownEditors: all('textarea, [contenteditable="true"]').filter(e => !e.matches(composer)).length,
      signIn: all('button, a, [role="button"]').some(e => /^(Log in|Sign in|登录|登入|登錄)$/i.test((e.textContent ?? "").trim())),
      expired: alertMatches(/Your session has expired|你的工作階段已過期|您的工作階段已過期|你的会话已过期|您的会话已过期/i),
      verification: all('#challenge-stage, #challenge-form, iframe[src*="challenges.cloudflare.com"]').length > 0,
      subscriptionFailure: alertMatches(/Failed to load subscription/i),
    };
  }, { composer: CHATGPT_COMPOSER_SELECTOR, user: CHATGPT_USER_TURN_SELECTOR,
    assistant: CHATGPT_ASSISTANT_TURN_SELECTOR, stop: CHATGPT_STOP_BUTTON_SELECTOR });
  pendingReadinessObservations.set(page, operation);
  const settled = () => {
    if (pendingReadinessObservations.get(page) === operation) pendingReadinessObservations.delete(page);
  };
  void operation.then(settled, settled);
  return operation;
}

export function assertReadinessFailure(snapshot: ChatGptReadinessSnapshot): void {
  if (snapshot.expired) throw preparationError("chatgpt_session_expired");
  // Navigation can expose a sign-in placeholder before the authenticated page hydrates.
  // Keep waiting within the existing deadline; a complete sign-in page still fails immediately.
  if (snapshot.documentComplete && snapshot.signIn) throw preparationError("chatgpt_sign_in_required");
  if (snapshot.verification) throw preparationError("chatgpt_verification_required");
  if (snapshot.subscriptionFailure) throw preparationError("chatgpt_subscription_unavailable");
  if (snapshot.composers > 1) throw preparationError("chatgpt_page_structure_unsupported");
}

export function noToolActivity(progress?: ChatGptExternalTurnProgressSnapshot): boolean {
  return !progress || (progress.revision === 0 && progress.activeToolCalls === 0 && progress.lastToolBatchRevision === 0);
}

export function proveUnsubmittedPreparation(snapshot: ChatGptReadinessSnapshot | undefined, evidence: {
  reused: boolean; submissionStarted: boolean; conversationRequestObserved: boolean;
  progress?: ChatGptExternalTurnProgressSnapshot;
}): boolean {
  return !!snapshot && !evidence.reused && !evidence.submissionStarted && !evidence.conversationRequestObserved
    && snapshot.userTurns === 0 && snapshot.assistantTurns === 0 && snapshot.stopButtons === 0
    && !snapshot.signIn && !snapshot.expired && !snapshot.verification && !snapshot.subscriptionFailure
    && snapshot.composers <= 1 && noToolActivity(evidence.progress);
}

export async function waitForChatGptReadiness(page: Page, options: {
  deadline: number; signal?: AbortSignal; onSnapshot?: (snapshot: ChatGptReadinessSnapshot) => void;
  read?: typeof readChatGptReadiness; now?: () => number; sleep?: (ms: number) => Promise<void>;
}): Promise<Locator> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let pending: Promise<ChatGptReadinessSnapshot> | undefined;
  let pendingSettled = false;
  let observationError: ChatGptBrowserObservationTimeoutError | undefined;
  for (;;) {
    options.signal?.throwIfAborted();
    const remaining = options.deadline - now();
    if (remaining <= 0) throw preparationError("chatgpt_composer_unavailable", observationError);
    const budget = Math.min(2_000, remaining);
    let snapshot: ChatGptReadinessSnapshot;
    try {
      // Timing out a Promise.race does not cancel evaluate. Keep one outstanding read:
      // retrying a slow renderer must not queue overlapping probes or renew preparation.
      if (!pending) {
        pendingSettled = false;
        pending = (options.read ?? observeChatGptReadiness)(page, budget);
        void pending.then(() => { pendingSettled = true; }, () => { pendingSettled = true; });
      }
      snapshot = await withChatGptBrowserObservationTimeout(pending, budget);
      pending = undefined;
      observationError = undefined;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof ChatGptBrowserObservationTimeoutError)) throw error;
      if (pendingSettled) pending = undefined;
      observationError = error;
      if (now() >= options.deadline) throw preparationError("chatgpt_composer_unavailable", error);
      await sleep(Math.min(100, Math.max(1, options.deadline - now())));
      continue;
    }
    options.signal?.throwIfAborted();
    options.onSnapshot?.(snapshot);
    assertReadinessFailure(snapshot);
    if (now() >= options.deadline) throw preparationError("chatgpt_composer_unavailable");
    if (!snapshot.signIn && snapshot.surfaceBound && snapshot.composers === 1 && snapshot.editable) {
      return page.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true }).first();
    }
    await sleep(Math.min(100, Math.max(1, options.deadline - now())));
  }
}

/** Recovery count survives reconnects; elapsed time in another step cannot consume this attempt. */
export class ChatGptPreparationRecovery {
  recoveries = 0;
  closedAt?: number;
  recover(): boolean {
    if (this.closedAt !== undefined || this.recoveries >= MAX_CHATGPT_PREPARATION_RECOVERIES) return false;
    this.recoveries += 1;
    return true;
  }
}
