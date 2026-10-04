import type { Page } from "playwright-core";
import { savedChatId } from "../../../../launcher/shared/saved-chat.cjs";
import { ChatGptWebAdapterError } from "../adapter-error";

export function assertSavedChatIdentity(page: Pick<Page, "url">, expected: string | undefined): void {
  if (expected && savedChatId(page.url()) !== expected) {
    throw new ChatGptWebAdapterError("The saved ChatGPT conversation changed before submission. Retry with the full Codex context.", {
      status: 409, errorType: "invalid_request_error", code: "saved_conversation_changed", retryable: false,
    });
  }
}

/** Observed DEV history-row menu/editor; target by remote ID, never by an auto-generated title. */
export async function renameSavedChat(page: Page, id: string, title: string): Promise<void> {
  assertSavedChatIdentity(page, id);
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(id) || title.length > 220 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new Error("Invalid saved chat title request");
  }
  const link = page.locator(`a[data-interactive-row-link="true"][href="/c/${id}"]`).filter({ visible: true });
  await link.waitFor({ state: "visible", timeout: 5_000 });
  if (await link.getAttribute("aria-label") === title) return;
  const row = link.locator('xpath=ancestor::*[@role="group"][1]');
  let opened = false;
  try {
    await row.hover({ timeout: 3_000 });
    assertSavedChatIdentity(page, id);
    await row.locator('button[aria-haspopup="menu"]').click({ timeout: 3_000 });
    opened = true;
    await page.getByRole("menu").filter({ visible: true })
      .getByRole("menuitem", { name: /^(重命名|Rename)$/ }).click({ timeout: 3_000 });
    const editor = page.getByRole("textbox", { name: /^(聊天标题|Chat title)$/ }).filter({ visible: true });
    await editor.fill(title, { timeout: 3_000 });
    assertSavedChatIdentity(page, id);
    await editor.press("Enter", { timeout: 3_000 });
    // Success requires the exact owned history row to reflect the title after the editor closes.
    await editor.waitFor({ state: "hidden", timeout: 5_000 });
    await page.waitForFunction(({ id, title }) => {
      const links = [...document.querySelectorAll('a[data-interactive-row-link="true"]')];
      return links.some(link => link.getAttribute("href") === `/c/${id}` && link.getAttribute("aria-label") === title);
    }, { id, title }, { timeout: 5_000 });
    assertSavedChatIdentity(page, id);
    opened = false;
  } finally {
    if (opened) await page.keyboard.press("Escape").catch(() => {});
  }
}
