import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { _electron } from "playwright-core";

test.skipIf(!process.env.LAUNCHER_TEST_ELECTRON)("finishing another Electron tab preserves the open model picker and viewport", async () => {
  const userData = mkdtempSync(join(tmpdir(), "launcher-viewport-"));
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined)) as Record<string, string>;
  const app = await _electron.launch({
    executablePath: process.env.LAUNCHER_TEST_ELECTRON,
    args: [resolve("launcher/tests/browser/fixtures/viewport.cjs"), `--user-data-dir=${userData}`], env,
  });
  try {
    const deadline = Date.now() + 5_000;
    while (!await app.evaluate(() => Boolean((globalThis as any).viewportFixture)) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(await app.evaluate(() => Boolean((globalThis as any).viewportFixture))).toBe(true);
    const page = app.context().pages().find(page => page.url().endsWith("#first"))!;
    expect(page).toBeDefined();
    const dimensions = () => page.evaluate(() => [innerWidth, innerHeight]);
    // Include the launcher's user zoom: native and emulated dimensions must agree in CSS pixels.
    for (const zoom of [1, 1.25]) {
      await app.evaluate((_, zoom) => {
        const host = (globalThis as any).viewportFixture;
        host.turnTabs.get("first").view.webContents.setZoomFactor(zoom);
        host.selectedTabId = "home";
        host.syncViewVisibility();
      }, zoom);
      await page.waitForTimeout(200);
      const before = await dimensions();
      // Windows can suppress input/animation frames for an offscreen native view.
      // Open this static fixture menu by DOM event; the assertions exercise the real host resize lifecycle.
      await page.getByRole("button", { name: "Models", exact: true }).dispatchEvent("click");
      expect(await page.getByRole("menu").isVisible()).toBe(true);
      await app.evaluate(() => {
        const host = (globalThis as any).viewportFixture;
        const getContentSize = host.window.getContentSize;
        host.window.getContentSize = () => [0, 0];
        try { host.setBounds({ ...host.bounds }); }
        finally { host.window.getContentSize = getContentSize; }
      });
      expect(await dimensions()).toEqual(before);
      expect(await page.getByRole("menu").isVisible()).toBe(true);
      await app.evaluate(() => {
        const host = (globalThis as any).viewportFixture;
        const second = host.turnTabs.get("second");
        if (second) {
          host.selectedTabId = second.id;
          host.removeTurnTab(second, false);
        } else host.selectTab("first");
      });
      await page.waitForTimeout(200);
      console.log(JSON.stringify({ zoom, before, after: await dimensions(), resizes: await page.evaluate(() => (window as any).resizes) }));
      expect(await dimensions()).toEqual(before);
      expect(await page.getByRole("menu").isVisible()).toBe(true);
      await page.getByRole("menuitemradio", { name: "GPT-5.6 Sol" }).click({ force: true, timeout: 2_000 });
      expect(await page.getByRole("menuitemradio").getAttribute("aria-checked")).toBe("true");
      for (const show of [false, true]) {
        await app.evaluate((_, show) => {
          const host = (globalThis as any).viewportFixture;
          if (show) host.window.showInactive();
          else host.window.hide();
          host.syncViewVisibility();
        }, show);
        await page.waitForTimeout(200);
        expect(await dimensions()).toEqual(before);
        expect(await page.getByRole("menu").isVisible()).toBe(true);
      }
    }
    // Inspect real native child-view bounds: renderer screenshots omit these layers.
    // No browser pane exists on the welcome page, so no renderer bounds IPC will arrive.
    for (const boundsReady of [false, true]) {
      await app.evaluate((_, measured) => {
        const host = (globalThis as any).viewportFixture;
        host.visible = false;
        host.surfaceActive = false;
        host.boundsReady = measured;
        host.window.setSize(720, 600);
        host.syncViewVisibility();
      }, boundsReady);
      await Bun.sleep(200);
      const initialBounds = await app.evaluate(() => {
        const host = (globalThis as any).viewportFixture;
        return [host.view, ...[...host.turnTabs.values()].map((tab: any) => tab.view)]
          .map(view => view.getBounds());
      });
      const before = await dimensions();
      await page.getByRole("button", { name: "Models", exact: true }).dispatchEvent("click");
      expect(await page.getByRole("menu").isVisible()).toBe(true);
      for (const action of ['resize', 'maximize', 'unmaximize']) {
        await app.evaluate((_, action) => {
          const window = (globalThis as any).viewportFixture.window;
          if (action === 'resize') window.setSize(1120, 760);
          else if (action === 'maximize') window.maximize();
          else window.unmaximize();
        }, action);
        await Bun.sleep(250);
        const placement = await app.evaluate(() => {
          const host = (globalThis as any).viewportFixture;
          return { size: host.window.getContentSize(), maximized: host.window.isMaximized(),
            views: [host.view, ...[...host.turnTabs.values()].map((tab: any) => tab.view)]
              .map(view => ({ bounds: view.getBounds(), visible: view.getVisible() })) };
        });
        expect(placement.maximized).toBe(action === 'maximize');
        for (const [index, view] of placement.views.entries()) {
          expect(view.visible).toBe(true);
          expect(view.bounds.x + view.bounds.width).toBeLessThan(0);
          expect(view.bounds.y + view.bounds.height).toBeLessThan(0);
          expect(view.bounds).toEqual(initialBounds[index]);
        }
        expect(await dimensions()).toEqual(before);
        expect(await page.getByRole("menu").isVisible()).toBe(true);
        console.log(JSON.stringify({ boundsReady, action, ...placement }));
      }
    }
  } finally {
    await app.close();
    if (dirname(resolve(userData)) !== resolve(tmpdir()) || !basename(userData).startsWith("launcher-viewport-")) {
      throw new Error("Refusing to remove an unowned viewport fixture");
    }
    rmSync(userData, { recursive: true, force: true });
  }
}, 30_000);
