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
      window.__calls = [];
      const listeners = {};
      const snapshot = { version: '2.0.0', platform: 'win32', startup: { status: 'ready', stage: 'ready', elapsedMs: 0 }, profile: 'development',
        state: { language: null, onboardingComplete: false, browserInteractionMode: 'automatic', sessionRefreshReminderAt: null, logPageSize: 100 },
        connectorNames: { automatic: 'Fixture', manual: 'Fixture manual' }, browser: null, logs: [], operation: null, urls: { github: '' }, update: { status: 'disabled' } };
      window.codexWebLauncher = new Proxy({
        snapshot: async () => structuredClone(snapshot),
        licenseStatus: async () => structuredClone(window.__license),
        importLicense: async code => code === 'fixture-valid'
          ? (window.__license = { ...window.__license, state: 'active', expiresAt: null, licenseId: 'fixture' })
          : code === 'fixture-renew' ? (window.__license = { ...window.__license, state: 'active', expiresAt: '2050-12-31T00:00:00Z' })
          : { ...window.__license, state: 'invalid' },
        workspaceStatus: async () => ({ configured: false, mode: null, runtimeStatus: 'not-configured', credentials: { automatic: false, manual: false } }),
        getLimits: async () => ({ enabled: false, plan: null, windows: [] }),
        queryLogs: async () => ({ records: [], total: 0, offset: 0, limit: 100, sources: [], hasMore: false }),
        completeOnboarding: async language => { Object.assign(snapshot.state, { language, onboardingComplete: true }); listeners.onStateChanged?.(structuredClone(snapshot.state)); return structuredClone(snapshot.state); },
      }, { get(target, key) { return key in target ? target[key] : String(key).startsWith('on')
        ? callback => { listeners[key] = callback; return () => { delete listeners[key]; }; }
        : async (...args) => { window.__calls.push({ method: String(key), args }); }; } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${listener.address().port}`);
    await page.locator('.license-activation').waitFor();
    await page.screenshot({ path: `${output}/initial-${locale}.png` });
    await writeFile(`${output}/initial-${locale}.txt`, await page.locator('body').innerText());
    await page.getByLabel(locale === 'zh-CN' ? '设备码' : 'Device code', { exact: true }).waitFor();
    assert.equal(await page.locator('.onboarding').count(), 0);
    assert.equal(await page.locator('.app-shell').count(), 1);
    const nav = page.getByRole('navigation');
    const go = async (zh, en) => { await nav.getByRole('button', { name: locale === 'zh-CN' ? zh : en, exact: true }).click(); await page.waitForTimeout(180); };
    await go('概览', 'Overview');
    await page.locator('.overview-license').waitFor();
    assert.equal(await page.locator('.overview-license textarea').count(), 0);
    await page.getByRole('button', { name: locale === 'zh-CN' ? '前往激活' : 'Activate', exact: true }).click();
    await page.locator('.license-activation').waitFor();
    await go('连接与模型', 'Connection & Models');
    await page.getByRole('radio', { name: /^MCP/ }).click();
    await page.getByRole('radio', { name: locale === 'zh-CN' ? '手动' : 'Manual', exact: true }).click();
    assert.equal(await page.locator('.page-connection input:not(:disabled)').count(), 0);
    await go('偏好设置', 'Preferences');
    assert.equal(await page.getByRole('switch').first().isDisabled(), true);
    await go('运行控制', 'Runtime controls');
    assert.equal(await page.locator('.page-runtime-controls button:not(:disabled)').count(), 0);
    await go('用量与诊断', 'Usage & Diagnostics');
    await page.getByRole('tab', { name: locale === 'zh-CN' ? '健康检查' : 'Health checks', exact: true }).click();
    assert.equal(await page.locator('[role=tabpanel] button').first().isDisabled(), true);
    await page.getByRole('tab', { name: locale === 'zh-CN' ? '运行日志' : 'Logs', exact: true }).click();
    await page.locator('.log-viewer').waitFor();
    await go('关于', 'About');
    await page.locator('.about-details summary').click();
    assert.equal(await page.locator('.about-details').getAttribute('open'), '');
    await go('浏览器', 'Browser');
    assert.equal(await page.locator('.browser-preview:disabled').count(), 1);
    assert.equal(await page.locator('.browser-surface button:not(:disabled)').count(), 0);
    assert.equal(await page.evaluate(() => window.__calls.some(call => call.method === 'setBrowserSurfaceActive' && call.args[0] === true)), false);
    assert.equal(await page.evaluate(() => window.__calls.some(call => /setup|login|showBrowser|setToolMode|setPreference/i.test(call.method))), false);
    await go('产品授权', 'License');
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
    const input = page.getByRole('textbox', { name: locale === 'zh-CN' ? '授权码' : 'License', exact: true });
    await input.fill('invalid');
    await page.getByRole('button', { name: locale === 'zh-CN' ? '激活并继续' : 'Activate and continue' }).click();
    await page.getByText(locale === 'zh-CN' ? '授权码无效' : 'Invalid license', { exact: true }).waitFor();
    assert.equal(await page.locator('.onboarding').count(), 0);
    await input.fill('fixture-valid');
    await page.getByRole('button', { name: locale === 'zh-CN' ? '激活并继续' : 'Activate and continue' }).click();
    await page.locator('.onboarding').waitFor();
    await page.screenshot({ path: `${output}/after-activation-${locale}.png` });
    await page.getByRole('button', { name: locale === 'zh-CN' ? '继续配置' : 'Continue setup', exact: true }).click();
    await page.locator('.overview-license').waitFor();
    await page.getByRole('button', { name: locale === 'zh-CN' ? '管理授权' : 'Manage license', exact: true }).click();
    const update = page.getByRole('button', { name: locale === 'zh-CN' ? '更新授权' : 'Update license', exact: true });
    await update.click();
    await page.getByRole('textbox', { name: locale === 'zh-CN' ? '授权码' : 'License', exact: true }).fill('fixture-renew');
    await update.click();
    await page.getByText(locale === 'zh-CN' ? '授权已保存' : 'License saved', { exact: true }).waitFor();
    await go('概览', 'Overview');
    assert.match(await page.locator('.overview-license').innerText(), /2050/);
    await page.evaluate(() => { window.__license.state = 'expired'; window.dispatchEvent(new Event('focus')); });
    await page.locator('.license-activation').waitFor();
    assert.equal(await page.locator('.onboarding').count(), 0);
    checks.push(`${locale}: unified license page, all pages readable before activation, preview-only mode switching, protected actions disabled, no browser activation, invalid rejection, valid continuation before language, immediate renewal sync, expiry return, responsive layout`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ fixtureOnly: true, checks, errors }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser.close(); await server.close(); await new Promise(done => listener.close(done)); }
