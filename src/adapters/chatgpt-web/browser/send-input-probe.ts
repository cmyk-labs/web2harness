import type { Page } from "playwright-core";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";

export const CHATGPT_SEND_RECONCILIATION_MS = 30_000;
export interface SendAcceptanceSnapshot {
  armed: boolean;
  matchedRequests: number;
  responseReceived: boolean;
  status?: number;
  accepted: boolean;
  reason?: string;
  projection?: { inputBound: boolean; reason?: string };
}
export type SendReconciliationResult = "confirmed" | "cancelled" | "disconnected" | "ambiguous" | "unavailable" | "timeout";

/** Read the observer for the original click only. No navigation, new fetch, input, or retry.
 * A missing/late signal is uncertainty, never proof that the server did not accept a request. */
export async function reconcileSendAcceptance(options: {
  read: () => SendAcceptanceSnapshot;
  connected: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SendReconciliationResult> {
  const budget = options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs)
    ? Math.min(CHATGPT_SEND_RECONCILIATION_MS, Math.max(0, options.timeoutMs)) : CHATGPT_SEND_RECONCILIATION_MS;
  const deadline = performance.now() + budget;
  for (;;) {
    if (options.signal?.aborted) return "cancelled";
    if (!options.connected()) return "disconnected";
    let state: SendAcceptanceSnapshot;
    try { state = options.read(); } catch { return "unavailable"; }
    if (state.matchedRequests > 1 || state.reason === "response_request_ambiguous"
      || state.reason === "response_identity_mismatch" || state.projection?.reason === "response_identity_mismatch") return "ambiguous";
    if (state.reason || state.projection?.reason || !state.armed) return "unavailable";
    if (state.matchedRequests === 1 && state.responseReceived && state.status === 200
      && state.accepted && state.projection?.inputBound) return "confirmed";
    const remaining = deadline - performance.now();
    if (remaining <= 0) return "timeout";
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, Math.min(100, remaining));
      options.signal?.addEventListener("abort", finish, { once: true });
      if (options.signal?.aborted) finish();
    });
  }
}

/** Passive, bounded input evidence. No text, keys other than Enter, or DOM HTML is retained. */
export async function observeSendInput(page: Page, selector: string): Promise<() => Promise<unknown>> {
  const key = `__w2hSendProbe_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await withChatGptBrowserObservationTimeout(page.evaluate(({ key, selector }) => {
      // A task owns one page. Retain one bounded result after the listener expires, until
      // collection or the next owner replaces it; waiting for acceptance must not erase it.
      const previous = (window as any).__w2hSendInput;
      previous?.stop();
      const state = { key, expired: false, droppedEvents: 0,
        events: [] as Array<{ type: string; trusted: boolean; prevented: boolean; sendTarget: boolean; focused: boolean }>,
        settle: [] as Array<() => void>, stop: () => {} };
      const observe = (event: Event) => {
        if (event instanceof KeyboardEvent && event.key !== "Enter") return;
        if (state.events.length >= 16) { state.droppedEvents++; return; }
        const target = event.target instanceof Element ? event.target : undefined;
        const entry = { type: event.type, trusted: event.isTrusted, prevented: event.defaultPrevented,
          sendTarget: !!target?.closest(selector), focused: target === document.activeElement };
        state.events.push(entry);
        // Read after the input operation settles, not at a capture-listener microtask checkpoint.
        state.settle.push(() => { entry.prevented = event.defaultPrevented; });
      };
      const types = ["keydown", "keyup", "pointerdown", "pointerup", "mousedown", "mouseup", "click", "submit"];
      for (const type of types) document.addEventListener(type, observe, true);
      const timer = setTimeout(() => { state.expired = true; state.stop(); }, 120_000);
      state.stop = () => {
        clearTimeout(timer);
        for (const type of types) document.removeEventListener(type, observe, true);
        for (const settle of state.settle.splice(0)) settle();
      };
      (window as any).__w2hSendInput = state;
    }, { key, selector }), 1_000);
  } catch { return async () => ({ available: false, reason: "install_failed" }); }
  return async () => {
    try {
      return await withChatGptBrowserObservationTimeout(page.evaluate(key => {
        const state = (window as any).__w2hSendInput;
        if (!state) return { available: false, reason: "missing" };
        if (state.key !== key) return { available: false, reason: "replaced" };
        state.stop(); delete (window as any).__w2hSendInput;
        return { available: true, expired: state.expired, droppedEvents: state.droppedEvents, events: state.events };
      }, key), 1_000);
    } catch { return { available: false, reason: "read_failed" }; }
  };
}
