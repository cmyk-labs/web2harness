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
  await context.exposeBinding('__windowFixtureBounds', (_, bounds) => app.evaluate((_, bounds) => global.windowSessionFixture.setBounds(bounds), bounds));
  await context.exposeBinding('__windowFixtureSurface', (_, active) => app.evaluate((_, active) => global.windowSessionFixture.setActive(active), active));
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
    window.codexWebLauncher.setBrowserBounds = async bounds => {
      await window.__windowFixtureBounds(bounds);
      f.browserBounds = bounds;
      return true;
    };
    window.codexWebLauncher.setBrowserSurfaceActive = async active => {
      await window.__windowFixtureSurface(active);
      return f.browser;
    };
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
    // Windows can enforce a native minimum one DIP above the configured height
    // (observed on Electron 42/43). Keep ordinary sizes exact and never accept
    // undersizing; do not change the application's minimum to satisfy a fixture.
    const nativeMinimum = process.platform === 'win32' && height === MIN_WINDOW_BOUNDS.height
      && native.bounds.height === height + 1;
    check(`${width}x${height}: native size respects request and minimum constraint`,
      native.bounds.width === width && (native.bounds.height === height || nativeMinimum));
    check(`${width}x${height}: application fills the logical viewport`, Math.abs(layout.root.x) < 1 && Math.abs(layout.root.y) < 1
      && Math.abs(layout.root.width - layout.width) < 1 && Math.abs(layout.root.height - layout.height) < 1);
    check(`${width}x${height}: compact scaling never magnifies controls`, native.zoom > 0 && native.zoom <= 1);
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
    for (const [width, height] of [[1120, 720], [DEFAULT_WINDOW_STATE.bounds.width, DEFAULT_WINDOW_STATE.bounds.height], [MIN_WINDOW_BOUNDS.width + 2, MIN_WINDOW_BOUNDS.height + 2], [MIN_WINDOW_BOUNDS.width, MIN_WINDOW_BOUNDS.height]]) {
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
    const native = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { content: w.getContentSize(), zoom: w.webContents.getZoomFactor(), maximized: w.isMaximized() };
    });
    const chrome = await page.evaluate(() => {
      const bar = document.querySelector('.app-titlebar').getBoundingClientRect();
      const root = document.querySelector('.app-root').getBoundingClientRect();
      const sidebar = document.querySelector('.app-sidebar').getBoundingClientRect();
      const content = document.querySelector('.content-scroll');
      return { x: bar.x, y: bar.y, width: bar.width, viewport: innerWidth,
        height: innerHeight, root: { x: root.x, y: root.y, width: root.width, height: root.height },
        sidebar: sidebar.width, contentWidth: content.getBoundingClientRect().width, contentHeight: content.clientHeight,
        devicePixelRatio,
        font: getComputedStyle(content).fontSize, title: getComputedStyle(document.querySelector('h1')).fontSize };
    });
    metrics.push({ name: `${language}: maximized`, native, layout: chrome });
    check(`${language}: maximized titlebar follows window edges`, Math.abs(chrome.x) < 1 && Math.abs(chrome.y) < 1 && Math.abs(chrome.width - chrome.viewport) < 1);
    check(`${language}: maximized application fills the window`, Math.abs(chrome.root.x) < 1 && Math.abs(chrome.root.y) < 1
      && Math.abs(chrome.root.width - chrome.viewport) < 1 && Math.abs(chrome.root.height - chrome.height) < 1);
    check(`${language}: large windows retain normal zoom and type`, native.zoom <= 1
      && (native.content[0] < 1120 || native.content[1] < 720 || native.zoom === 1)
      && chrome.font === '14px' && chrome.title === '24px' && Math.abs(chrome.sidebar - 252) < 1);
    check(`${language}: overview expands within a readable width`, Math.abs(chrome.contentWidth - Math.min(chrome.viewport - 252, 1264)) < 2);
    await capture(`maximized-${language}.png`);
    await page.locator('.sidebar-nav').getByRole('button', { name: language === 'zh-CN' ? '关于' : 'About', exact: true }).click();
    await page.locator('.about-product').waitFor();
    check(`${language}: About introduction fills its product section without overflow`, await page.locator('.about-product > p').evaluate(el =>
      Math.abs(el.getBoundingClientRect().width - el.parentElement.getBoundingClientRect().width) < 1 && el.scrollWidth <= el.clientWidth));
    await capture(`about-maximized-${language}.png`);
    await page.locator('.sidebar-nav').getByRole('button', { name: language === 'zh-CN' ? '用量与诊断' : 'Usage & Diagnostics', exact: true }).click();
    await page.getByRole('tab', { name: language === 'zh-CN' ? '运行日志' : 'Logs', exact: true }).click();
    await page.locator('.log-viewer').waitFor();
    check(`${language}: logs use the available width and height`, await page.locator('.content-scroll').evaluate(el => {
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      const pagination = el.querySelector('.log-pagination').getBoundingClientRect();
      return Math.abs(el.getBoundingClientRect().width - workspace.width) < 1
        && el.scrollWidth <= el.clientWidth && pagination.bottom <= innerHeight;
    }));
    await capture(`logs-maximized-${language}.png`);
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

  await page.evaluate(() => {
    const f = window.__fixture;
    f.emitBrowser({ authenticated: true, authenticationStatus: 'authenticated', visible: true,
      url: 'https://example.invalid/layout-fixture', activeTabId: 'layout-a',
      tabs: ['a', 'b'].map((suffix, index) => ({
        id: `layout-${suffix}`, title: `Layout fixture ${suffix.toUpperCase()}`, traceId: null,
        status: 'ready', loading: false, active: index === 0, closable: index === 1,
      })),
    });
    window.codexWebLauncher.selectBrowserTab = async id => {
      f.calls.push(['selectBrowserTab', id]);
      f.emitBrowser({ activeTabId: id, tabs: f.browser.tabs.map(tab => ({ ...tab, active: tab.id === id })) });
      return f.browser;
    };
    window.codexWebLauncher.closeBrowserTab = async id => {
      f.calls.push(['closeBrowserTab', id]);
      const tabs = f.browser.tabs.filter(tab => tab.id !== id);
      const activeId = (tabs.find(tab => tab.active) ?? tabs[0]).id;
      f.emitBrowser({ activeTabId: activeId, tabs: tabs.map(tab => ({ ...tab, active: tab.id === activeId })) });
      return f.browser;
    };
  });
  await app.evaluate(() => global.windowSessionFixture.openPane());
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Browser', exact: true }).click();
  await page.locator('.browser-viewport').waitFor();
  const pane = context.pages().find(page => page.url().endsWith('#window-layout-pane'));
  check('native browser fixture exists', Boolean(pane));
  let clicks = 0;
  const checkPane = async label => {
    await page.waitForFunction(() => {
      const rect = document.querySelector('.browser-viewport').getBoundingClientRect();
      const sent = window.__fixture.browserBounds;
      return sent && ['x', 'y', 'width', 'height'].every(key => Math.abs(sent[key] - rect[key]) < 0.5);
    });
    const rect = await page.locator('.browser-viewport').boundingBox();
    const native = await app.evaluate(() => global.windowSessionFixture.state());
    const chrome = await page.evaluate(() => {
      const bar = document.querySelector('.app-titlebar');
      const tabs = document.querySelector('.browser-tab-strip').getBoundingClientRect();
      const toolbar = document.querySelector('.browser-toolbar').getBoundingClientRect();
      return { titlebarBottom: bar.getBoundingClientRect().bottom, draggable: getComputedStyle(bar).webkitAppRegion,
        tabsTop: tabs.top, tabsBottom: tabs.bottom, toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom };
    });
    check(`${label}: browser controls follow the shared window titlebar`, chrome.draggable === 'drag'
      && Math.abs(chrome.tabsTop - chrome.titlebarBottom) < 1
      && Math.abs(chrome.toolbarTop - chrome.tabsBottom) < 1 && rect.y >= chrome.toolbarBottom - 1);
    check(`${label}: native browser aligns with the renderer`, ['x', 'y', 'width', 'height'].every(key =>
      Math.abs(native.bounds[key] - rect[key] * native.zoom) <= 2));
    check(`${label}: browser uses the full remaining pane`, Math.abs(native.bounds.x + native.bounds.width - native.content[0]) <= 2
      && Math.abs(native.bounds.y + native.bounds.height - native.content[1]) <= 2);
    const suffix = clicks % 2 === 0 ? 'b' : 'a';
    const tab = page.locator('.browser-tab').filter({ hasText: `Layout fixture ${suffix.toUpperCase()}` });
    await tab.click();
    check(`${label}: tab click selects the intended tab below the titlebar`, await tab.getAttribute('aria-selected') === 'true'
      && await page.evaluate(id => window.__fixture.calls.some(call => call[0] === 'selectBrowserTab' && call[1] === id), `layout-${suffix}`));
    await pane.getByRole('button', { name: 'Layout click target', exact: true }).click();
    check(`${label}: native browser click reaches its target`, Number(await pane.locator('button').getAttribute('data-clicks')) === ++clicks);
    metrics.push({ name: label, native, chrome, browserRect: rect });
  };
  await resize(MIN_WINDOW_BOUNDS.width, MIN_WINDOW_BOUNDS.height);
  await checkPane('minimum window');
  await resize(DEFAULT_WINDOW_STATE.bounds.width, DEFAULT_WINDOW_STATE.bounds.height);
  await checkPane('normal window');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await page.waitForTimeout(300);
  await checkPane('maximized window');
  await capture('browser-maximized.png');
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.waitForTimeout(300);
  await checkPane('maximized without sidebar');
  await capture('browser-maximized-without-sidebar.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await page.waitForTimeout(300);
  await checkPane('restored without sidebar');
  await capture('browser-restored-without-sidebar.png');
  await page.locator('.browser-tab').filter({ hasText: 'Layout fixture B' }).hover();
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  check('restored without sidebar: tab close remains clickable', await page.locator('.browser-tab').count() === 1
    && await page.evaluate(() => window.__fixture.calls.some(call => call[0] === 'closeBrowserTab' && call[1] === 'layout-b')));
  check('no renderer errors', errors.length === 0);
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ kind: 'native Electron presentation fixture; mocked IPC, no authenticated DEV', checks, metrics, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors }));
} catch (error) {
  await writeFile(resolve(out, `failure-${Date.now()}.json`), JSON.stringify({ message: error.message, checks, metrics, errors }, null, 2));
  throw error;
} finally { await app.close(); }
