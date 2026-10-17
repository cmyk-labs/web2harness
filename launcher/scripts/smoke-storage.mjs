import { setWindowFixtureSize } from './window-fixture-size.mjs';
export async function runStorageSmoke({ context, origin, out, check, errors }) {
  for (const language of ['zh-CN', 'en']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole('region', { name: '概览', exact: true }).waitFor();
    if (language === 'en') await page.evaluate(() => window.__fixture.patch({ language: 'en' }));
    await page.getByRole('button', { name: language === 'en' ? 'Usage & Diagnostics' : '用量与诊断', exact: true }).click();
    await page.getByRole('tab', { name: language === 'en' ? 'Storage & cache' : '存储与缓存', exact: true }).click();
    const clear = page.getByRole('button', { name: language === 'en' ? 'Clear caches' : '清理缓存', exact: true });
    await page.getByText('120.0 MiB', { exact: true }).waitFor();
    check(`${language} storage shows measured cache sizes`, await clear.isEnabled());
    await page.evaluate(() => window.__fixture.emitBrowser({ status: 'running', activeTraceId: 'fixture-active' }));
    check(`${language} cleanup disabled during work`, await clear.isDisabled());
    await page.evaluate(() => window.__fixture.emitBrowser({ status: 'ready', activeTraceId: null }));
    await clear.click();
    await page.getByRole('status').filter({ hasText: language === 'en' ? 'preserved' : '已保留' }).waitFor();
    check(`${language} cleanup uses the cache-only API`, await page.evaluate(() => window.__fixture.calls.some(call => call[0] === 'clearCaches')));
    check(`${language} fresh sizes shown after cleanup`, await page.getByText('0.0 KiB', { exact: true }).count() === 2);
    await page.screenshot({ path: `${out}/storage-${language}.png` });
    await page.evaluate(() => { window.__fixture.failCleanup = true; });
    await clear.click();
    await page.getByRole('alert').filter({ hasText: 'Fixture cache cleanup failed' }).waitFor();
    check(`${language} cleanup error is visible`, await clear.isEnabled());
    await setWindowFixtureSize(page, { width: 840, height: 720 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/storage-narrow-${language}.png` });
    check(`${language} narrow page has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.close();
  }
}
