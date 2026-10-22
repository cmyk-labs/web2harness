import type { Locator, Page } from "playwright-core";
import { setTimeout as delay } from "node:timers/promises";
import { diagnosticEvent } from "../../../diagnostics";
import { ChatGptAttachmentUploadError, observeChatGptAttachmentUploads } from "./attachment-upload";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";

type UploadFile = { name: string; mimeType: string; buffer: Buffer };
export const CHATGPT_ATTACHMENT_RETRY_DELAY_MS = 3_000;

function removeLabel(name: string): RegExp {
  return new RegExp(`^(?:移除|Remove) ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

export function chatGptAttachmentCard(page: Page, form: Locator, name: string): Locator {
  const wrapper = '[class~="group/composer-attachment"]';
  const group = `[role="group"][aria-label=${JSON.stringify(name)}]`;
  // The current page nests a named surface button inside the attachment wrapper.
  // Select its outer card once; keep standalone surfaces for older layouts. Do not
  // use first(), which could conceal two genuinely distinct same-name cards.
  // Card identity must not depend on a hover-only remove control being exposed to
  // accessibility. The outer card still has to be visible; removal still uses actionability.
  return form.locator(wrapper).filter({ has: page.getByRole("button", { name: removeLabel(name), includeHidden: true }) }).or(
    form.getByRole("group", { name, exact: true }).and(form.locator(`:not(${wrapper} *)`)),
  ).or(form.locator(`.composer-attachment-surface:is(button, [role="button"])[aria-label=${JSON.stringify(name)}]:not(${wrapper} *, ${group} *)`));
}

/** The caller owns an unsent composer. Recovery never clicks Send or replays the turn. */
export async function attachChatGptFilesWithRetry(
  page: Page, form: Locator, files: UploadFile[], signal: AbortSignal | undefined,
  timeoutMs: number, assertUnsubmitted: () => Promise<void>,
): Promise<void> {
  // Upstream cdfceafd: saved chats can retain another file input outside the active composer.
  const input = form.locator('input[data-testid="upload-photos-input"], input[type="file"][multiple]:not([accept])');
  await input.waitFor({ state: "attached", timeout: 60_000, signal });
  const uploads = await observeChatGptAttachmentUploads(page, files.map(file => file.name));
  const lifetime = new AbortController();
  const waiting = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const removing = new Set<string>();
  let mutations = Promise.resolve();
  let watcher: Promise<void> | undefined;
  let work: Promise<void[]> | undefined;
  const mutate = (action: () => Promise<void>) => {
    const next = mutations.then(() => { waiting.throwIfAborted(); return action(); });
    mutations = next.catch(() => {});
    return next;
  };
  try {
    waiting.throwIfAborted();
    for (const file of files) uploads.started(file.name);
    await input.setInputFiles(files, { timeout: 60_000 });
    waiting.throwIfAborted();
    // Read all owned cards together. Upload-byte failures can precede the processing endpoint,
    // so waiting on processing events alone misses the explicit terminal UI failure.
    watcher = (async () => {
      while (!waiting.aborted) {
        const states = await withChatGptBrowserObservationTimeout(form.evaluate((element, names) => {
          const cards = [...element.querySelectorAll('[role="group"][aria-label], [class~="group/composer-attachment"], .composer-attachment-surface:is(button, [role="button"])[aria-label]')];
          return names.map(name => {
            const owned = cards.filter(card => card.getAttribute("aria-label") === name || [...card.querySelectorAll("button")].some(button =>
              button.getAttribute("aria-label") === `移除 ${name}` || button.getAttribute("aria-label") === `Remove ${name}`));
            const outer = owned.filter(card => !owned.some(parent => parent !== card && parent.contains(card)));
            return { name, count: outer.length, failedCount: outer.filter(card =>
              /上传未成功|上传失败|Upload failed|Upload unsuccessful|Unable to upload/i.test(card.textContent ?? "")).length };
          });
        }, files.map(file => file.name)));
        for (const state of states) if (!removing.has(state.name)) {
          uploads.recordCardState(state.name, state.count, state.failedCount);
          if (state.failedCount > 0) uploads.fail(state.name, "the attachment card reports upload failure");
        }
        await delay(250, undefined, { signal: waiting });
      }
    })();
    work = Promise.all(files.map(async (file, index) => {
      try {
        await uploads.waitFor(file.name, waiting, timeoutMs);
      } catch (firstError) {
        waiting.throwIfAborted();
        if (!(firstError instanceof ChatGptAttachmentUploadError)) throw firstError;
        if (!firstError.recoverable) throw firstError;
        try {
          await mutate(async () => {
            await assertUnsubmitted();
            waiting.throwIfAborted();
            const card = chatGptAttachmentCard(page, form, file.name);
            const remove = card.getByRole("button", { name: removeLabel(file.name), includeHidden: true });
            if (await remove.count() !== 1) throw new Error("The failed attachment has no unique remove control");
            removing.add(file.name);
            await card.hover({ timeout: 60_000 });
            waiting.throwIfAborted();
            await remove.click({ timeout: 60_000, signal: waiting });
            await card.waitFor({ state: "hidden", timeout: 60_000, signal: waiting });
            diagnosticEvent("info", "browser.attachment_retry", { fileIndex: index, attempt: 2, delayMs: CHATGPT_ATTACHMENT_RETRY_DELAY_MS });
            await delay(CHATGPT_ATTACHMENT_RETRY_DELAY_MS, undefined, { signal: waiting });
            await assertUnsubmitted();
            waiting.throwIfAborted();
            uploads.reset(file.name);
            uploads.started(file.name);
            await input.setInputFiles([file], { timeout: 60_000 });
            removing.delete(file.name);
          });
          await uploads.waitFor(file.name, waiting, timeoutMs);
        } catch (retryError) {
          waiting.throwIfAborted();
          // Preserve the first failure as the caller-visible cause. Subsequent errors are
          // diagnostic metadata only, never a reason to replay a submitted task.
          diagnosticEvent("warning", "browser.attachment_retry_failed", { fileIndex: index, attempt: 2,
            status: retryError instanceof ChatGptAttachmentUploadError ? retryError.status : undefined,
            reason: retryError instanceof ChatGptAttachmentUploadError ? retryError.code : "attachment_retry_incomplete" });
          throw firstError;
        }
      }
    }));
    await Promise.race([work, watcher]);
    uploads.throwIfFailed();
    await Promise.all(files.map(file => chatGptAttachmentCard(page, form, file.name)
      .waitFor({ state: "visible", timeout: 120_000, signal: waiting })));
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    lifetime.abort();
    await Promise.allSettled([...(watcher ? [watcher] : []), ...(work ? [work] : []), mutations]);
    await uploads.dispose();
  }
}
