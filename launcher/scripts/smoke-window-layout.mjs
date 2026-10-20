import { setWindowFixtureSize } from './window-fixture-size.mjs';

export async function runWindowLayoutSmoke({ context, origin, out, check, errors }) {
  const pages = [
    ['overview', '概览', 'Overview'],
    ['runtime-controls', '运行控制', 'Runtime controls'],
    ['connection', '连接与模型', 'Connection & Models'],
    ['runtime-parameters', '运行参数', 'Runtime parameters'],
    ['preferences', '偏好设置', 'Preferences'],
    ['license', '产品授权', 'License'],
    ['diagnostics', '用量与诊断', 'Usage & Diagnostics'],
    ['about', '关于', 'About'],
    ['browser', '浏览器', 'Browser'],
  ];
  for (const language of ['zh-CN', 'en']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('.workspace-shell').waitFor();
    await page.evaluate(language => window.__fixture.patch({ language }), language);
    for (const [width, height] of [[900, 600], [1000, 660], [1120, 720], [1920, 1080], [3440, 1440]]) {
      await setWindowFixtureSize(page, { width, height });
      for (const [id, zh, en] of pages) {
        await page.getByRole('navigation').getByRole('button', { name: language === 'zh-CN' ? zh : en, exact: true }).click();
        await page.locator(id === 'browser' ? '.browser-surface' : `.page-${id}`).waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.surface-transition')].every(el => Number(getComputedStyle(el).opacity) > .99));
        const layout = await page.evaluate(() => {
          const root = document.querySelector('.app-root').getBoundingClientRect();
          const sidebar = document.querySelector('.app-sidebar').getBoundingClientRect();
          const content = document.querySelector('.content-scroll');
          const pane = document.querySelector('.browser-viewport')?.getBoundingClientRect();
          const tabs = document.querySelector('.browser-tab-strip')?.getBoundingClientRect();
          const titlebar = document.querySelector('.app-titlebar').getBoundingClientRect();
          const introduction = document.querySelector('.about-product > p');
          return {
            fills: Math.abs(root.x) < 1 && Math.abs(root.y) < 1 && Math.abs(root.width - innerWidth) < 1 && Math.abs(root.height - innerHeight) < 1,
            sidebar: sidebar.width,
            font: getComputedStyle(document.body).fontSize,
            bounded: !content || content.scrollWidth <= content.clientWidth + 1,
            paneFills: !pane || Math.abs(pane.right - innerWidth) < 1 && Math.abs(pane.bottom - innerHeight) < 1,
            chromeClear: !tabs || Math.abs(tabs.top - titlebar.bottom) < 1,
            introductionFills: !introduction || Math.abs(introduction.getBoundingClientRect().width - introduction.parentElement.getBoundingClientRect().width) < 1,
          };
        });
        const label = `${language} ${width}x${height} ${id}`;
        check(`${label}: fills window with stable navigation and readable controls`, layout.fills && Math.abs(layout.sidebar - 252) < 1
          && layout.font === '14px' && layout.bounded && layout.paneFills && layout.chromeClear && layout.introductionFills);
        if (id === 'diagnostics') {
          await page.getByRole('tab', { name: language === 'zh-CN' ? '运行日志' : 'Logs', exact: true }).click();
          await page.locator('.log-viewer').waitFor();
          check(`${label}: logs fill available width without clipping pagination`, await page.locator('.content-scroll').evaluate(el => {
            const workspace = document.querySelector('.workspace').getBoundingClientRect();
            const pagination = el.querySelector('.log-pagination').getBoundingClientRect();
            return Math.abs(el.getBoundingClientRect().width - workspace.width) < 1
              && el.scrollWidth <= el.clientWidth && pagination.bottom <= innerHeight;
          }));
        }
        if (width === 3440 && ['overview', 'diagnostics', 'browser'].includes(id)) {
          await page.screenshot({ path: `${out}/${id}-${language}-${width}.png` });
        }
      }
    }
    for (const scene of ['preparing', 'first-run']) {
      await page.goto(`${origin}/?${scene}`);
      await page.locator('.entry-screen').waitFor();
      await page.evaluate(language => window.__fixture.patch({ language }), language);
      if (scene === 'first-run') await page.getByRole('radio', { name: language === 'en' ? 'English' : '简体中文', exact: true }).click();
      for (const [width, height] of [[900, 600], [1920, 1080], [3440, 1440]]) {
        await setWindowFixtureSize(page, { width, height });
        check(`${language} ${width}x${height} ${scene}: fills the window with bounded content`, await page.locator('.app-root').evaluate(el => {
          const root = el.getBoundingClientRect();
          const content = el.querySelector('.entry-content').getBoundingClientRect();
          return Math.abs(root.x) < 1 && Math.abs(root.y) < 1
            && Math.abs(root.width - innerWidth) < 1 && Math.abs(root.height - innerHeight) < 1
            && el.scrollWidth <= el.clientWidth && content.width <= 520 && content.left >= 0 && content.right <= innerWidth;
        }));
      }
    }
    await page.close();
  }
}
