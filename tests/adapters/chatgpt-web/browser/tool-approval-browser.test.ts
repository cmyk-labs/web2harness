import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { resolveChatGptToolConfirmation } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("observed Chinese approval card preserves one-shot, manual, and connector boundaries", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    const card = (app: string) => `<div data-codex-approval-surface="true"><p>允许 ChatGPT 使用 ${app}？</p>
      <p>提交一个不会立即执行的本地命令调用。</p><form><button type="button">始终允许</button>
      <button type="button">拒绝</button><button type="button">允许一次</button></form></div>`;
    for (const auto of [false, true]) {
      await page.setContent(card("Fixture (DEV)+") + `<output></output><script>
        for(const button of document.querySelectorAll('button'))button.onclick=()=>{
          document.querySelector('output').textContent=button.textContent;button.closest('[data-codex-approval-surface]').remove();
        };</script>`);
      expect(await resolveChatGptToolConfirmation(page, "Fixture (DEV)+", auto, undefined, 10)).toBeTrue();
      expect(await page.locator("output").textContent()).toBe(auto ? "允许一次" : "拒绝");
    }
    await page.setContent(card("Fixture (DEV)+ Other"));
    expect(await resolveChatGptToolConfirmation(page, "Fixture (DEV)+", true)).toBeFalse();
    expect(await page.getByRole("button", { name: "允许一次", exact: true }).isVisible()).toBeTrue();
    // Quoted prose and unrelated controls are not approval surfaces.
    await page.setContent('<p>允许 ChatGPT 使用 Fixture (DEV)+？</p><button>允许一次</button>');
    expect(await resolveChatGptToolConfirmation(page, "Fixture (DEV)+", true)).toBeFalse();
  } finally { await browser.close(); }
}, 20_000);
