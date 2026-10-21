import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { RequestQueue } from '../electron/runtime/request-queue.cjs';
import { setWindowFixtureSize } from './window-fixture-size.mjs';

// Shared renderer and queue, synthetic browser outcomes; no account or model calls.
export async function runBrowserCheckSmoke({ context, origin, out, check, errors }) {
  const directory = await mkdtemp(join(out, 'check-queue-'));
  const queue = await new RequestQueue({ directory, logger: { info() {}, error() {} }, hasResource: () => false }).start();
  queue.core.pause('send_outcome_unknown');
  await context.exposeBinding('__checkQueueStatus', () => ({ status: 'ready', settings: queue.snapshot().settings,
    savedRevision: 1, currentMcpScope: null, scheduler: queue.snapshot() }));
  await context.exposeBinding('__checkQueueControl', (_, action, id, token) => queue.control(action, id, token));
  await context.addInitScript(() => {
    const api = window.codexWebLauncher, f = window.__fixture;
    api.queueStatus = () => window.__checkQueueStatus();
    api.queryQueue = async () => ({ items: [], groups: [], total: 0, limit: 50, offset: 0 });
    api.controlQueue = (action, id, token) => window.__checkQueueControl(action, id, token);
    const patchCheck = result => {
      f.snapshot.smokePassed = result.status === 'passed';
      f.patch({ browserSmokePassed: f.snapshot.smokePassed, browserSmokeVersion: f.snapshot.smokePassed ? '1.0.0' : null, browserCheck: result });
    };
    f.setCheck = patchCheck;
    api.smokeTest = async () => {
      const paused = (await api.queueStatus()).scheduler.pausedReason;
      const result = { version: '1.0.0', status: paused ? 'blocked' : 'passed', connection: 'passed',
        dispatch: paused ? 'blocked' : 'passed', finishedAt: Date.now(), ...(paused ? { error: { code: 'queue_blocked_send_outcome_unknown' } } : {}) };
      patchCheck(result);
      return { ok: !paused, check: result };
    };
  });
  try {
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.getByRole('navigation').getByRole('button', { name: '连接与模型', exact: true }).click();
    await page.getByRole('button', { name: '重新检查', exact: true }).click();
    await page.getByRole('button', { name: '查看队列并恢复', exact: true }).waitFor();
    check('Blocked verification clears the previous passed state', await page.getByRole('button', { name: '检查连接', exact: true }).count() === 1);
    check('Connection proof and blocked send are distinct', (await page.locator('.browser-check-result').innerText()).includes('连接与页面: 通过'));
    for (const language of ['zh-CN', 'en']) {
      if (language === 'en') await page.locator('.language-toggle').click();
      for (const width of [1280, 600]) {
        await setWindowFixtureSize(page, { width, height: 800 });
        await page.waitForTimeout(350);
        const panel = page.locator('.browser-check-result');
        await panel.scrollIntoViewIfNeeded();
        check(`${language} ${width}: recovery remains reachable`, await panel.getByRole('button').isVisible());
        await panel.screenshot({ path: join(out, `check-blocked-${language}-${width}.png`) });
      }
    }
    await page.getByRole('button', { name: 'Review queue and resume', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm recovery', exact: true }).click();
    queue.core.pause('browser_unavailable');
    await page.getByText('Pause state changed. Go back and review it again.', { exact: true }).waitFor();
    check('Stale confirmation cannot recover new failures', await page.getByRole('button', { name: 'Resume dispatch', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm recovery', exact: true }).click();
    await page.getByRole('button', { name: 'Resume dispatch', exact: true }).click();
    await page.getByText('Action accepted', { exact: true }).waitFor();
    check('Confirmed recovery releases only the owned fixture', queue.snapshot().pausedReason === null);
    await setWindowFixtureSize(page, { width: 1280, height: 900 });
    await page.getByRole('navigation').getByRole('button', { name: 'Connection & Models', exact: true }).click();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByRole('button', { name: 'Check again', exact: true }).waitFor();
    check('A new successful check can establish fresh proof', (await page.locator('.browser-check-result').innerText()).includes('Send verification: Passed'));
    await page.evaluate(() => window.__fixture.setCheck({ version: '1.0.0', status: 'failed', connection: 'failed', dispatch: 'not_run', error: { message: 'Fixture connection failed' } }));
    await page.getByText('Fixture connection failed', { exact: true }).waitFor();
    check('New failure cannot keep a prior green success', await page.getByRole('button', { name: 'Check connection', exact: true }).count() === 1);
    await page.close();
  } finally { await queue.close(); }
}
