import { chromium } from '../../node_modules/playwright-core/index.mjs';
import { createServer } from '../node_modules/vite/dist/node/index.js';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve(process.env.LICENSE_SMOKE_OUTPUT || 'output/offline-licensing/ui');
await mkdir(output, { recursive: true });
const listener = createHttpServer();
const server = await createServer({ root: resolve('launcher'), configFile: resolve('launcher/vite.config.ts'),
  server: { middlewareMode: true, hmr: { server: listener }, open: false } });
listener.on('request', server.middlewares);
await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errors = [], checks = [];
try {
  for (const locale of ['zh-CN', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 1080, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await context.addInitScript(() => {
      window.__license = { state: 'missing', deviceCode: 'W2D1-WIN-' + 'a'.repeat(64) };
      const snapshot = { version: '1.2.0', startup: { status: 'ready', stage: 'ready', elapsedMs: 0 }, profile: 'development', state: { language: null, onboardingComplete: false }, browser: null, logs: [], operation: null, urls: { github: '' }, update: { status: 'disabled' } };
      window.codexWebLauncher = new Proxy({
        snapshot: async () => structuredClone(snapshot),
        licenseStatus: async () => structuredClone(window.__license),
        importLicense: async code => code === 'fixture-valid'
          ? (window.__license = { ...window.__license, state: 'active', expiresAt: null, licenseId: 'fixture' })
          : { ...window.__license, state: 'invalid' },
      }, { get(target, key) { return key in target ? target[key] : String(key).startsWith('on') ? () => () => {} : async () => {}; } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${listener.address().port}`);
    await page.locator('.license-activation').waitFor();
    await page.screenshot({ path: `${output}/initial-${locale}.png` });
    await writeFile(`${output}/initial-${locale}.txt`, await page.locator('body').innerText());
    await page.getByLabel(locale === 'zh-CN' ? '设备码' : 'Device code', { exact: true }).waitFor();
    assert.equal(await page.locator('.onboarding').count(), 0);
    assert.equal(await page.locator('.app-shell').count(), 0);
    await page.screenshot({ path: `${output}/activation-${locale}.png` });
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/activation-mobile-${locale}.png`, fullPage: true });
    await page.setViewportSize({ width: 640, height: 360 });
    const primary = page.getByRole('button', { name: locale === 'zh-CN' ? '激活并继续' : 'Activate and continue' });
    await primary.scrollIntoViewIfNeeded();
    assert.equal(await primary.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 46 && r.bottom <= innerHeight; }), true);
    await page.screenshot({ path: output + '/activation-short-' + locale + '.png' });
    await page.setViewportSize({ width: 1080, height: 900 });
    const input = page.getByLabel(locale === 'zh-CN' ? '授权码' : 'License', { exact: true });
    await input.fill('invalid');
    await page.getByRole('button', { name: locale === 'zh-CN' ? '激活并继续' : 'Activate and continue' }).click();
    await page.getByText(locale === 'zh-CN' ? '授权码无效' : 'Invalid license', { exact: true }).waitFor();
    assert.equal(await page.locator('.onboarding').count(), 0);
    await input.fill('fixture-valid');
    await page.getByRole('button', { name: locale === 'zh-CN' ? '激活并继续' : 'Activate and continue' }).click();
    await page.locator('.onboarding').waitFor();
    await page.screenshot({ path: `${output}/after-activation-${locale}.png` });
    await page.evaluate(() => { window.__license.state = 'expired'; window.dispatchEvent(new Event('focus')); });
    await page.locator('.license-activation').waitFor();
    assert.equal(await page.locator('.onboarding').count(), 0);
    checks.push(`${locale}: activation before language, invalid rejection, valid continuation, expiry return, responsive layout`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ fixtureOnly: true, checks, errors }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser.close(); await server.close(); await new Promise(done => listener.close(done)); }
