import { withChatGptBrowserObservationTimeout } from "./turn-observation";

/** Creation can complete after a transport timeout. Retire that exact late resource. */
export async function acquireOwnedBrowserResource<T>(
  open: () => Promise<T>,
  close: (resource: T) => Promise<void>,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<T> {
  signal?.throwIfAborted();
  let abandoned = false;
  let acquired: { value: T } | undefined;
  let cleanup: Promise<void> | undefined;
  const retire = (value: T) => cleanup ??= withChatGptBrowserObservationTimeout(close(value), 120_000);
  let onAbort: (() => void) | undefined;
  const opening = open().then(async value => {
    acquired = { value };
    if (abandoned) {
      await retire(value);
      throw new DOMException("Browser resource acquisition ended", "AbortError");
    }
    return value;
  });
  // A late cleanup failure remains diagnostic evidence, without replacing the original error.
  void opening.catch(() => {
    if (abandoned && cleanup) void cleanup.catch(cleanupError => console.error(
      `[chatgpt-web] late owned resource cleanup failed: ${String(cleanupError)}`,
    ));
  });
  try {
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal?.reason ?? new DOMException("Browser resource acquisition aborted", "AbortError"));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    return await withChatGptBrowserObservationTimeout(Promise.race([opening, cancelled]), timeoutMs);
  } catch (error) {
    abandoned = true;
    if (acquired) await retire(acquired.value).catch(cleanupError => console.error(
      `[chatgpt-web] owned resource cleanup failed: ${String(cleanupError)}`,
    ));
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
