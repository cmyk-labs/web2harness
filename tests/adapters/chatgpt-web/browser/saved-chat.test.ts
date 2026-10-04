import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { renameSavedChat } from "../../../../src/adapters/chatgpt-web/browser/saved-chat";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("rename targets only the owned saved chat and is idempotent", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: readFileSync(new URL("../../../fixtures/chatgpt-saved-chat.html", import.meta.url), "utf8") }));
    await page.goto("https://chatgpt.com/c/owned-chat");
    const title = "2026-10-04 21:49 · 修复登录问题 · 对话-01";
    await renameSavedChat(page, "owned-chat", title);
    expect(await page.locator('a[href="/c/unrelated-chat"]').getAttribute("aria-label")).toBe("Other title");
    await renameSavedChat(page, "owned-chat", title);
    expect(await page.evaluate(() => (window as any).renameWrites)).toEqual([title]);
    await page.evaluate(() => history.replaceState({}, "", "/c/unrelated-chat"));
    await expect(renameSavedChat(page, "owned-chat", "Unexpected title")).rejects.toThrow("conversation changed");
    expect(await page.evaluate(() => (window as any).renameWrites)).toEqual([title]);
  } finally { await browser.close(); }
}, 20_000);
