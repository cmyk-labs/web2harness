import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import { CHATGPT_STOP_BUTTON_SELECTOR } from "../../../browser/session";

type AnnouncementWindow = Window & { __web2harnessCompletion?: {
  key: string; complete: boolean; revision: number; observer: MutationObserver; refresh: () => void;
} };

/** Observe a NEW accessibility announcement from
 * ChatGPT's document-level UI, armed before sending. Old announcements and quoted answer text
 * are never completion evidence. The caller still requires the bound turn, stopped generation,
 * complete content and any broker completion fence before releasing resources. */
export async function armCompletionAnnouncement(page: Page): Promise<string> {
  const key = randomUUID();
  await page.evaluate(({ key, stopSelector }) => {
    const target = window as AnnouncementWindow;
    target.__web2harnessCompletion?.observer.disconnect();
    const labels = new Set(["回答已完成", "Answer complete", "Response complete"]);
    let latestNonempty: "complete" | "other" | "ambiguous" | undefined;
    let wasGenerating = false;
    let epoch = 0;
    let clearedEpoch: number | undefined;
    let pendingCompletion = false;
    const scan = (changed: boolean) => {
      const state = target.__web2harnessCompletion!;
      const generating = [...document.querySelectorAll(stopSelector)].some(node => {
        if (!node.isConnected) return false;
        // An owned Electron view may have zero geometry while its renderer is active.
        // Generation follows rendered controls, not whether the host view is on screen.
        for (let current: Element | null = node; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (current.hasAttribute("hidden") || style.display === "none" || style.visibility === "hidden"
            || style.visibility === "collapse" || style.opacity === "0") return false;
        }
        return true;
      });
      if (changed && generating && !wasGenerating) {
        epoch += 1;
        clearedEpoch = undefined;
        pendingCompletion = false;
      }
      const announcements = [...document.body.querySelectorAll(':scope > span[role="status"][aria-live="polite"][aria-atomic="true"]')]
        .map(node => node.textContent?.trim() ?? "").filter(Boolean);
      if (announcements.length > 1) {
        // DOM order cannot establish which nonempty region is current.
        latestNonempty = "ambiguous";
        clearedEpoch = undefined;
        pendingCompletion = false;
      } else if (announcements.length === 0) {
        // An idle remount is not progress. An empty region observed during a new
        // generation is, even if it cleared one DOM batch before Stop appeared.
        if (changed && generating && epoch > 0) clearedEpoch = epoch;
        if (generating) pendingCompletion = false;
      } else {
        const announcement = labels.has(announcements[0]!) ? "complete" : "other";
        if (announcement === "other") {
          pendingCompletion = false;
          clearedEpoch = undefined;
        } else if (changed && (latestNonempty === undefined || latestNonempty === "other"
          || clearedEpoch === epoch)) {
          pendingCompletion = true;
          clearedEpoch = undefined;
        }
        latestNonempty = announcement;
      }
      wasGenerating = generating;
      // A completion may arrive just before Stop disappears. Preserve that candidate,
      // but never expose it while generating or carry it into the next generation.
      const complete = !generating && pendingCompletion;
      if (complete && !state.complete) state.revision += 1;
      state.complete = complete;
    };
    // A Stop/clear phase entirely lost between scans cannot establish an epoch.
    // Mutation records alone cannot prove an intermediate control was visible.
    const observer = new MutationObserver(() => scan(true));
    target.__web2harnessCompletion = { key, complete: false, revision: 0, observer, refresh: () => scan(true) };
    scan(false);
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-label", "data-testid", "type", "data-chatgpt-composer", "role", "aria-live", "aria-atomic"],
    });
  }, { key, stopSelector: CHATGPT_STOP_BUTTON_SELECTOR });
  return key;
}

export function readCompletionAnnouncement(page: Page, key?: string): Promise<{ complete: boolean; revision: number }> {
  if (!key) return Promise.resolve({ complete: false, revision: 0 });
  return page.evaluate(key => {
    const state = (window as AnnouncementWindow).__web2harnessCompletion;
    if (state?.key !== key) return { complete: false, revision: 0 };
    // Also sample CSS/layout visibility changes that do not mutate the observed body.
    state.refresh();
    return { complete: state.complete, revision: state.revision };
  }, key);
}

export async function hasFreshCompletionAnnouncement(page: Page, key: string): Promise<boolean> {
  return (await readCompletionAnnouncement(page, key)).complete;
}

export async function disposeCompletionAnnouncement(page: Page, key: string): Promise<void> {
  await page.evaluate(key => {
    const target = window as AnnouncementWindow;
    if (target.__web2harnessCompletion?.key !== key) return;
    target.__web2harnessCompletion.observer.disconnect();
    delete target.__web2harnessCompletion;
  }, key);
}
