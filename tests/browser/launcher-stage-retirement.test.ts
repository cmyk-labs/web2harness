import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { _electron } from "playwright-core";
import { ChatGptBrowserWorker, insertPlainTextIntoComposer } from "../../src/adapters/chatgpt-web/browser/browser-worker";

test.skipIf(!process.env.LAUNCHER_TEST_ELECTRON)("a stalled Electron editor is retired without closing sibling task pages", async () => {
  const userData = mkdtempSync(join(tmpdir(), "launcher-stage-retirement-"));
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined)) as Record<string, string>;
  const app = await _electron.launch({ executablePath: process.env.LAUNCHER_TEST_ELECTRON,
    args: [resolve("launcher/tests/browser/fixtures/viewport.cjs"), `--user-data-dir=${userData}`], env });
  try {
    const deadline = Date.now() + 5_000;
    while (!await app.evaluate(() => Boolean((globalThis as any).viewportFixture)) && Date.now() < deadline) await Bun.sleep(20);
    const page = app.context().pages().find(p => p.url().endsWith("#first"))!;
    const sibling = app.context().pages().find(p => p.url().endsWith("#second"))!;
    expect(page).toBeDefined();
    expect(sibling).toBeDefined();
    await page.setContent('<div id="editor" contenteditable="true">draft</div>');
    await page.evaluate(() => {
      document.getElementById("editor")!.addEventListener("input", () => {
        console.log("owned-editor-entered-stall");
        // A synchronous editor fault: aborting a locator does not stop this renderer work.
        for (;;) { /* released by closing this fixture's WebContents only */ }
      });
    });
    let entered = false;
    page.on("console", message => { if (message.text() === "owned-editor-entered-stall") entered = true; });
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const start = Date.now();
    await expect(worker.runStage("owned-editor-stall", "prompt_attachment", 1_000,
      // Model an operation that ignores the stage abort, as an unresponsive DOM cleanup can.
      () => page.locator("#editor").evaluate(insertPlainTextIntoComposer, "next prompt", { timeout: 0 }),
      { suspendedMs: () => 0 }, true, {
        graceMs: 2_000,
        closeOwnedPage: async () => {
          await page.close({ runBeforeUnload: false });
          if (!page.isClosed()) throw new Error("Fixture page did not close");
        },
      })).rejects.toMatchObject({ code: "chatgpt_browser_unresponsive", retryable: false });
    expect(entered).toBeTrue();
    expect(page.isClosed()).toBeTrue();
    expect(Date.now() - start).toBeLessThan(8_000);
    expect(sibling.isClosed()).toBeFalse();
    expect(await sibling.evaluate(() => 1 + 1)).toBe(2);
    expect(await app.evaluate(() => (globalThis as any).viewportFixture.window.isDestroyed())).toBeFalse();
  } finally {
    await app.close();
    if (dirname(resolve(userData)) !== resolve(tmpdir()) || !basename(userData).startsWith("launcher-stage-retirement-")) {
      throw new Error("Refusing to remove an unowned stage-retirement fixture");
    }
    rmSync(userData, { recursive: true, force: true });
  }
}, 30_000);
