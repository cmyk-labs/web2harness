import { setWindowFixtureSize } from './window-fixture-size.mjs';

// Renderer/IPC presentation fixture. Backend persistence is tested separately.
export async function runPendingSettingsSmoke({ context, origin, out, check, errors }) {
  for (const language of ['zh-CN', 'en']) for (const license of ['missing', 'expired']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const t = (zh, en) => language === 'zh-CN' ? zh : en;
    const nav = async (zh, en) => {
      const name = t(zh, en);
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await page.getByRole('region', { name, exact: true }).waitFor();
    };
    await page.goto(`${origin}/?production-ui&license=${license}&language=${language}`);
    await nav('偏好设置', 'Preferences');
    const prefix = `${language}/${license}: `;
    for (const name of [t('关闭窗口后在后台运行', 'Keep running in the background after closing'),
      t('自动任务开始时显示内置浏览器', 'Show the built-in browser when an automatic task starts'),
      t('开机启动（登录后）', 'Start automatically at sign-in')]) {
      const control = page.getByRole('switch', { name, exact: true });
      check(prefix + name + ' editable', await control.isEnabled());
      await control.click();
      await page.waitForFunction(() => !document.querySelector('.panel button[disabled]'));
    }
    check(prefix + 'ordinary shell preferences saved', await page.evaluate(() => {
      const s = window.__fixture.state;
      return !s.keepRunningOnClose && !s.showBrowserDuringTurns && s.autoStart;
    }));
    await page.getByRole('radio', { name: t('每轮新建', 'New each turn'), exact: true }).click();
    await page.getByRole('radio', { name: t('保存到历史', 'Save to history'), exact: true }).click();
    const apply = page.getByRole('button', { name: t('应用已保存设置', 'Apply saved settings'), exact: true });
    check(prefix + 'business configuration saved while application remains blocked', await apply.isDisabled()
      && await page.evaluate(() => window.__fixture.state.pendingSettings.useSavedChats === true && !window.__fixture.state.useSavedChats));
    await page.evaluate(() => window.__fixture.patch({ experimentalContextFiles: true }));
    await page.screenshot({ path: `${out}/preferences-${language}-${license}.png`, fullPage: true });
    await nav('运行参数', 'Runtime parameters');
    check(prefix + 'applicable runtime inputs editable', await page.locator('.queue-settings select:disabled,.queue-settings input:disabled').count() === 0);
    await page.getByLabel(t('Web 同时执行数', 'Concurrent Web turns'), { exact: true }).selectOption('2');
    await page.getByLabel(t('空闲标签保留时间', 'Idle tab retention'), { exact: true }).selectOption('120');
    await page.getByRole('radio', { name: t('三倍预算（实验性）', 'Triple budget (experimental)'), exact: true }).click();
    const save = page.getByRole('button', { name: t('保存设置', 'Save settings'), exact: true });
    await save.click();
    await page.waitForFunction(() => window.__fixture.state.pendingSettings.runtimeParameters?.idleTabMinutes === 120);
    check(prefix + 'runtime save preserves active configuration', await page.evaluate(() => {
      const s = window.__fixture.state;
      return s.requestScheduling.maxConcurrent === 4 && s.runtimeParameters.idleTabMinutes === 30
        && s.pendingSettings.requestScheduling.maxConcurrent === 2 && s.pendingSettings.experimentalContextTripleBudget;
    }));
    await page.getByRole('button', { name: t('恢复默认值', 'Restore defaults'), exact: true }).click();
    await save.click();
    await page.waitForFunction(() => window.__fixture.state.pendingSettings.runtimeParameters?.idleTabMinutes === 30);
    check(prefix + 'restore defaults works while inactive', await apply.isDisabled());
    await page.getByLabel(t('Web 同时执行数', 'Concurrent Web turns'), { exact: true }).selectOption('3');
    await page.getByRole('navigation').getByRole('button', { name: t('偏好设置', 'Preferences'), exact: true }).click();
    await page.getByRole('button', { name: t('保存并离开', 'Save and leave'), exact: true }).click();
    await page.getByRole('region', { name: t('偏好设置', 'Preferences'), exact: true }).waitFor();
    check(prefix + 'navigation save works while inactive', await page.evaluate(() => window.__fixture.state.pendingSettings.requestScheduling.maxConcurrent === 3));
    await nav('运行参数', 'Runtime parameters');
    await setWindowFixtureSize(page, { width: 900, height: 600 });
    check(prefix + 'small layout has no horizontal overflow', await page.locator('.content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: `${out}/parameters-${language}-${license}.png`, fullPage: true });
    await page.evaluate(() => { window.__fixture.license.state = 'active'; window.dispatchEvent(new Event('focus')); });
    await page.getByRole('region', { name: t('概览', 'Overview'), exact: true }).waitFor();
    await nav('运行参数', 'Runtime parameters');
    await apply.click();
    await page.waitForFunction(() => Object.keys(window.__fixture.state.pendingSettings).length === 0);
    check(prefix + 'explicit application clears pending values', await page.evaluate(() => window.__fixture.state.useSavedChats));
    await page.close();
  }
}
