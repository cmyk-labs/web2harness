import { _electron } from '../../node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { installWorkspaceFixture } from './workspace-fixture.mjs';

const out = resolve(process.env.WINDOW_SESSION_OUTPUT || 'output/window-session');
const sizingOnly = process.env.WINDOW_SESSION_SCOPE === 'sizing';
const { DEFAULT_WINDOW_STATE, MIN_WINDOW_BOUNDS } = createRequire(import.meta.url)('../electron/window-state.cjs');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, 'window-session-profile-'));
const env = { ...process.env, WEB2HARNESS_WINDOW_FIXTURE_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
  args: [resolve('launcher/scripts/fixtures/window-session.cjs')], env, timeout: 30000 });
const checks = [], errors = [], metrics = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
try {
  const context = app.context();
  await context.route('https://**/*', route => route.abort());
  const customizeFixture = () => {
    const f = window.__fixture;
    f.state.experimentalContextFiles = true;
    f.state.contextPreferenceSources = { files: 'default', budget: 'default' };
    f.snapshot.smokePassed = false;
    f.state.browserSmokePassed = true;
    f.state.browserSmokeVersion = '2.0.0';
    f.snapshot.version = '2.1.0';
    f.browser.authenticated = false;
    f.browser.authenticationStatus = 'unknown';
    window.codexWebLauncher.setSidebarState = async ({ open, width }) => f.patch({ sidebarOpen: open, sidebarWidth: width });
    window.codexWebLauncher.checkAuthentication = async () => {
      f.calls.push(['checkAuthentication']);
      f.emitBrowser({ authenticated: false, authenticationStatus: 'checking', authenticationMessage: '' });
      await new Promise(resolve => { f.completeAuthenticationCheck = resolve; });
      f.emitBrowser({ authenticated: true, authenticationStatus: 'authenticated', authenticationMessage: '' });
      return f.browser;
    };
  };
  await context.addInitScript({ content: `(${installWorkspaceFixture.toString()})(); (${customizeFixture.toString()})();` });
  const page = await app.firstWindow();
  // Native capture of a hidden window can precede its first compositor frame.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('../dist/index.html', import.meta.url).href);
  await page.locator('.workspace-shell').waitFor();
  const minimum = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize());
  check('native minimum matches window policy', minimum[0] === MIN_WINDOW_BOUNDS.width && minimum[1] === MIN_WINDOW_BOUNDS.height);
  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await page.waitForTimeout(250);
    const native = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { content: w.getContentSize(), zoom: w.webContents.getZoomFactor(), bounds: w.getBounds() };
    });
    await page.waitForFunction(({ content, zoom }) => Math.abs(innerWidth - content[0] / zoom) < 2 && Math.abs(innerHeight - content[1] / zoom) < 2, native, { timeout: 5000 });
    const layout = await page.evaluate(() => {
      const root = document.querySelector('.app-root').getBoundingClientRect();
      const sidebar = document.querySelector('.app-sidebar').getBoundingClientRect();
      return { root: { x: root.x, y: root.y, width: root.width, height: root.height }, sidebarWidth: sidebar.width,
        compact: document.querySelector('.workspace-shell').classList.contains('is-compact'), width: innerWidth, height: innerHeight };
    });
    metrics.push({ native, layout });
    check(`${width}x${height}: native size matches requested size`, native.bounds.width === width && native.bounds.height === height);
    check(`${width}x${height}: design canvas remains 1120x720`, Math.abs(layout.root.width - 1120) < 0.1 && Math.abs(layout.root.height - 720) < 0.1);
    check(`${width}x${height}: entire canvas fits`, layout.root.x >= -1 && layout.root.y >= -1
      && (layout.root.x + layout.root.width) * native.zoom <= native.content[0] + 2
      && (layout.root.y + layout.root.height) * native.zoom <= native.content[1] + 2);
    check(`${width}x${height}: no compact drawer`, !layout.compact);
    return layout;
  };
  const capture = async name => {
    await page.waitForFunction(() => [...document.querySelectorAll('.surface-transition')].every(el => Number(getComputedStyle(el).opacity) > .99));
    await page.waitForTimeout(350);
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(resolve(out, name), Buffer.from(png, 'base64'));
  };
  for (const language of ['zh-CN', 'en']) {
    await page.evaluate(language => window.__fixture.patch({ language }), language);
    const connection = language === 'zh-CN' ? '连接与模型' : 'Connection & Models';
    const preferences = language === 'zh-CN' ? '偏好设置' : 'Preferences';
    for (const [width, height] of [[1120, 720], [DEFAULT_WINDOW_STATE.bounds.width, DEFAULT_WINDOW_STATE.bounds.height], [MIN_WINDOW_BOUNDS.width, MIN_WINDOW_BOUNDS.height]]) {
      const layout = await resize(width, height);
      check(`${language}/${width}: sidebar stays open`, layout.sidebarWidth > 200);
      if (sizingOnly) {
        await page.locator('.sidebar-nav').getByRole('button', { name: language === 'zh-CN' ? '概览' : 'Overview', exact: true }).click();
        await capture(`overview-${language}-${width}.png`);
        continue;
      }
      await page.locator('.sidebar-nav').getByRole('button', { name: connection, exact: true }).click();
      await page.getByText(language === 'zh-CN' ? '尚未检测' : 'Not checked', { exact: true }).waitFor();
      await capture(`connection-${language}-${width}.png`);
      await page.locator('.sidebar-nav').getByRole('button', { name: preferences, exact: true }).click();
      await page.getByRole('region', { name: preferences, exact: true }).waitFor();
      await page.locator('summary').filter({ hasText: language === 'zh-CN' ? '实验功能' : 'Experimental features' }).click();
      const files = page.getByRole('switch', { name: language === 'zh-CN' ? '上下文文件传输（实验性）' : 'Context as File (Experimental)', exact: true });
      await page.locator('.context-budget').scrollIntoViewIfNeeded();
      check(language + '/' + width + ': files default on', await files.getAttribute('aria-checked') === 'true');
      check(language + '/' + width + ': standard budget selected', await page.getByRole('radio', { name: language === 'zh-CN' ? '标准预算（默认）' : 'Standard (default)', exact: true }).getAttribute('aria-checked') === 'true');
      await capture(`preferences-${language}-${width}.png`);
    }
    await page.locator('.sidebar-nav').getByRole('button', { name: language === 'zh-CN' ? '概览' : 'Overview', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await page.waitForTimeout(500);
    const chrome = await page.evaluate(() => {
      const bar = document.querySelector('.app-titlebar').getBoundingClientRect();
      const root = document.getElementById('root');
      return { x: bar.x, y: bar.y, width: bar.width, viewport: innerWidth,
        background: getComputedStyle(root).backgroundColor,
        sidebarExtension: getComputedStyle(root, '::before').backgroundColor };
    });
    check(`${language}: maximized titlebar follows window edges`, Math.abs(chrome.x) < 1 && Math.abs(chrome.y) < 1 && Math.abs(chrome.width - chrome.viewport) < 1);
    check(`${language}: maximized surplus continues pane colors`, chrome.background === 'rgb(27, 31, 36)' && chrome.sidebarExtension === 'rgb(21, 25, 30)');
    await capture(`maximized-${language}.png`);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  }
  if (!sizingOnly) {
    await page.locator('.sidebar-nav').getByRole('button', { name: 'Connection & Models', exact: true }).click();
    const smoke = page.getByRole('button', { name: 'Check connection', exact: true });
    check('unauthenticated smoke stays disabled', await smoke.isDisabled());
    await page.getByRole('button', { name: 'Recheck sign-in', exact: true }).click();
    await page.getByRole('button', { name: 'Checking sign-in…', exact: true }).waitFor();
    check('checking sign-in keeps smoke disabled', await smoke.isDisabled());
    await page.evaluate(() => window.__fixture.completeAuthenticationCheck());
    await page.getByText('Signed in', { exact: true }).waitFor();
    check('verified sign-in enables smoke', await smoke.isEnabled());
    await page.evaluate(() => window.__fixture.emitBrowser({ authenticated: false, authenticationStatus: 'error', authenticationMessage: 'Fixture session timeout' }));
    await page.getByText('Fixture session timeout', { exact: true }).waitFor();
    check('failed verification is retryable', await page.getByRole('button', { name: 'Recheck sign-in', exact: true }).isEnabled());
    check('failure does not enable smoke', await smoke.isDisabled());
  }
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await resize(DEFAULT_WINDOW_STATE.bounds.width, DEFAULT_WINDOW_STATE.bounds.height);
  check('manual sidebar choice survives resize', await page.locator('.app-sidebar').getAttribute('inert') !== null);
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await page.waitForTimeout(200);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await page.waitForTimeout(250);
  check('restore keeps the sidebar open', await page.locator('.app-sidebar').getAttribute('inert') === null);
  check('no renderer errors', errors.length === 0);
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ kind: 'native Electron presentation fixture; mocked IPC, no authenticated DEV', checks, metrics, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors }));
} catch (error) {
  await writeFile(resolve(out, `failure-${Date.now()}.json`), JSON.stringify({ message: error.message, checks, metrics, errors }, null, 2));
  throw error;
} finally { await app.close(); }
