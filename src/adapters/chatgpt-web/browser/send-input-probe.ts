import type { Page } from "playwright-core";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";

export const CHATGPT_SEND_RECONCILIATION_MS = 5_000;
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
      const state = { events: [] as Array<{ type: string; trusted: boolean; prevented: boolean; sendTarget: boolean; focused: boolean }>,
        settle: [] as Array<() => void>, stop: () => {} };
      const observe = (event: Event) => {
        if (event instanceof KeyboardEvent && event.key !== "Enter") return;
        if (state.events.length >= 16) return;
        const target = event.target instanceof Element ? event.target : undefined;
        const entry = { type: event.type, trusted: event.isTrusted, prevented: event.defaultPrevented,
          sendTarget: !!target?.closest(selector), focused: target === document.activeElement };
        state.events.push(entry);
        // Read after the input operation settles, not at a capture-listener microtask checkpoint.
        state.settle.push(() => { entry.prevented = event.defaultPrevented; });
      };
      const types = ["keydown", "keyup", "click", "submit"];
      for (const type of types) document.addEventListener(type, observe, true);
      const timer = setTimeout(() => { state.stop(); delete (window as any)[key]; }, 120_000);
      state.stop = () => {
        clearTimeout(timer);
        for (const type of types) document.removeEventListener(type, observe, true);
      };
      (window as any)[key] = state;
    }, { key, selector }), 1_000);
  } catch { return async () => ({ available: false }); }
  return async () => {
    try {
      return await withChatGptBrowserObservationTimeout(page.evaluate(key => {
        const state = (window as any)[key];
        if (!state) return { available: false };
        for (const settle of state.settle) settle();
        state.stop(); delete (window as any)[key];
        return { available: true, events: state.events };
      }, key), 1_000);
    } catch { return { available: false }; }
  };
}
