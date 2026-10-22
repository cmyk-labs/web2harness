import type { Locator, Page } from "playwright-core";
import { diagnosticError, diagnosticEvent } from "../../../diagnostics";
import { ChatGptWebAdapterError } from "../adapter-error";

type Menu = { menu: Locator; sliderContainer: Locator };
type Surface = { count: number; connected: boolean; visible: boolean; nodeId?: number };

/** Missing observations, distinct from a readable but mismatching model/effort. */
export class ChatGptModelMenuObservationUnavailableError extends ChatGptWebAdapterError {
  constructor(message: string) {
    super(message, { status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false });
  }
}

async function surface(locator: Locator): Promise<Surface | undefined> {
  try {
    return await locator.evaluateAll(elements => {
      if (elements.length !== 1) return { count: elements.length, connected: false, visible: false };
      const element = elements[0]!;
      const doc = element.ownerDocument as Document & { __web2harnessMenuNodes?: { ids: WeakMap<Element, number>; next: number } };
      const nodes = doc.__web2harnessMenuNodes ??= { ids: new WeakMap<Element, number>(), next: 0 };
      let nodeId = nodes.ids.get(element);
      if (nodeId === undefined) { nodeId = ++nodes.next; nodes.ids.set(element, nodeId); }
      const style = getComputedStyle(element);
      return { count: 1, connected: element.isConnected, nodeId,
        visible: element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden" };
    });
  } catch { return undefined; } // Observation failure is not proof of a disappearing menu.
}

class TransientMenuReadError extends Error {
  constructor(readonly reason: "menu_closed" | "menu_rebuilt", cause: unknown, readonly stillSamePage: () => boolean) {
    super("ChatGPT model menu disappeared during a read", { cause });
  }
}

/** One recovery per selection/preflight; validation errors never enter this path. */
export class ChatGptModelMenuRecovery {
  private firstError?: unknown;
  private attempts = 0;
  constructor(private readonly signal?: AbortSignal) {}

  checkCancelled(): void {
    if (this.signal?.aborted) throw new DOMException("ChatGPT model selection aborted", "AbortError");
  }

  async observe(page: Page, control: Locator, menu: Menu) {
    this.checkCancelled();
    const url = page.url();
    const before = await surface(menu.sliderContainer);
    // Observe the visible container, never the zero-width semantic slider.
    return async <T>(read: () => Promise<T>): Promise<T> => {
      this.checkCancelled();
      try { return await read(); }
      catch (error) {
        this.checkCancelled();
        // Unsupported schemas, invalid ranges, locks and real selection mismatches are terminal.
        const transientRead = error instanceof ChatGptModelMenuObservationUnavailableError || error instanceof Error && (error.name === "TimeoutError"
          || /element (?:is |was )?(?:not attached|detached)|element is not attached/i.test(error.message));
        if (!transientRead || !before?.connected || !before.visible || page.url() !== url || page.isClosed()) throw error;
        const owner = await control.evaluateAll(elements => elements.length === 1 ? {
          connected: elements[0]!.isConnected,
          closed: elements[0]!.getAttribute("aria-expanded") === "false" || elements[0]!.getAttribute("data-state") === "closed",
        } : undefined).catch(() => undefined);
        const after = await surface(menu.sliderContainer);
        const reason = owner?.connected && owner.closed ? "menu_closed"
          : after?.connected && before.nodeId !== undefined && after.nodeId !== undefined && before.nodeId !== after.nodeId ? "menu_rebuilt" : undefined;
        if (!reason) throw error;
        diagnosticEvent("warning", "browser.model_menu_read_failed", {
          stage: "selection_read", reason, attempts: this.attempts, submission: "not-sent", error: diagnosticError(error),
          checks: { connected: after?.connected ?? false, visible: after?.visible ?? false },
        });
        throw new TransientMenuReadError(reason, error, () => page.url() === url && !page.isClosed());
      }
    };
  }

  async run<T>(operation: () => Promise<T>, capture?: (checkpoint: string) => Promise<void>): Promise<T> {
    for (;;) {
      this.checkCancelled();
      try {
        const result = await operation();
        if (this.attempts) diagnosticEvent("info", "browser.model_menu_recovery", {
          outcome: "verified", attempts: this.attempts, submission: "not-sent",
          cause: diagnosticError(this.firstError),
        });
        return result;
      } catch (error) {
        this.checkCancelled();
        if (!(error instanceof TransientMenuReadError) || this.attempts >= 1) {
          if (this.firstError) diagnosticEvent("warning", "browser.model_menu_recovery", {
            outcome: "failed", attempts: this.attempts, submission: "not-sent",
            cause: diagnosticError(this.firstError), error: diagnosticError(error instanceof TransientMenuReadError ? error.cause : error),
          });
          throw error instanceof TransientMenuReadError ? error.cause : error;
        }
        this.firstError = error.cause;
        diagnosticEvent("warning", "browser.model_menu_recovery", {
          outcome: "started", reason: error.reason, attempts: ++this.attempts, submission: "not-sent",
          cause: diagnosticError(this.firstError),
        });
        await capture?.("effort-menu-read-failed-before-recovery");
        this.checkCancelled();
        if (!error.stillSamePage()) throw error.cause;
      }
    }
  }
}
