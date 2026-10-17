import { setWindowFixtureSize } from './window-fixture-size.mjs';

export async function runRuntimeParametersSmoke({ context, origin, out, check, errors }) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('region', { name: '概览', exact: true }).waitFor();
  await page.getByRole('navigation').getByRole('button', { name: '运行参数', exact: true }).click();
  await page.getByRole('region', { name: '运行参数', exact: true }).waitFor();
  const select = name => page.getByLabel(name, { exact: true });
  const save = () => page.getByRole('button', { name: '保存设置', exact: true });
  check('Context windows use k with one shared percentage explanation',
    await select('Fast 上下文窗口').inputValue() === '80' && await select('非Fast上下文窗口').inputValue() === '272'
    && await page.locator('.context-budget-settings output').count() === 0
    && (await page.locator('.context-budget-notes').innerText()).includes('95%')
    && (await page.locator('.context-budget-notes').innerText()).includes('90%'));
  await page.locator('.context-budget-settings').screenshot({path:out+'/budget-zh.png'});
  await select('Fast 上下文窗口').fill('16.383');
  check('k input retains the existing lower token bound', !await save().isEnabled());
  await select('Fast 上下文窗口').fill('96.001');
  check('Fractional k is valid without saving core values', await save().isEnabled()
    && await page.evaluate(() => window.__fixture.state.contextWindows.fast === 80000));
  await page.evaluate(() => { window.__fixture.failBudgetSave = true; });
  await save().click();await page.getByRole('alert').filter({hasText:'Fixture budget save failed'}).waitFor();
  check('Failed budget transaction preserves the editable draft', await select('Fast 上下文窗口').inputValue() === '96.001');
  await page.evaluate(() => { window.__fixture.failBudgetSave = false; });
  await save().click();await page.getByText('已保存。请重启对应 Codex，使上下文容量和压缩阈值生效。',{exact:true}).waitFor();
  check('Window saves retain explicit user provenance', await page.evaluate(() => window.__fixture.state.contextWindows.fast === 96001 && window.__fixture.state.contextWindowSources.fast === 'user' && window.__fixture.state.contextWindows.standard === 272000));
  await page.evaluate(() => window.__fixture.patch({experimentalContextFiles:true}));
  await page.getByRole('radio',{name:'三倍预算（实验性）',exact:true}).click();
  check('Triple choice keeps standard k inputs and explains the multiplier', await select('Fast 上下文窗口').inputValue() === '96.001'
    && (await page.locator('.context-budget-notes').innerText()).includes('×3'));
  await page.getByRole('radio',{name:'标准预算',exact:true}).click();
  await select('Fast 上下文窗口').fill('80');await save().click();
  await page.getByText('已保存。请重启对应 Codex，使上下文容量和压缩阈值生效。',{exact:true}).waitFor();
  check('Current execution defaults remain visible', await select('标签页保留数量').inputValue() === '5'
    && await select('空闲标签保留时间').inputValue() === '30' && await select('网页无进展超时').inputValue() === '5'
    && await select('附件上传与处理等待时间').inputValue() === '2');
  check('Manual-only settings are absent in automatic mode', await select('普通请求提交等待').count() === 0);
  check('Advanced retry choices start collapsed', !await page.locator('.runtime-advanced').evaluate(el => el.open));
  await select('标签页保留数量').selectOption('12');
  await select('附件上传与处理等待时间').selectOption('10');
  await page.locator('.runtime-advanced summary').click();
  await select('失败重试次数').selectOption('0');
  check('Editing leaves persisted values alone', await page.evaluate(() => window.__fixture.state.runtimeParameters.retainedTabTarget === 5));
  await save().click(); await page.getByText('已保存并生效', { exact: true }).waitFor();
  check('One save includes execution and scheduling values', await page.evaluate(() => {
    const call = window.__fixture.calls.filter(c => c[0] === 'saveQueueSettings').at(-1);
    return call[1].maxConcurrent === 4 && call[3].retainedTabTarget === 12 && call[3].attachmentMinutes === 10 && call[3].maxRetries === 0
      && call[4].retainedTabTarget === 'user' && call[4].attachmentMinutes === 'user' && call[4].maxRetries === 'user';
  }));
  await select('空闲标签保留时间').selectOption('120');
  await page.getByRole('navigation').getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('dialog', { name: '有未保存的修改' }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  check('Unsaved execution choices survive cancelled navigation', await select('空闲标签保留时间').inputValue() === '120');
  await page.evaluate(() => { window.__fixture.failQueueSave = true; });
  await save().click(); await page.getByRole('alert').filter({ hasText: 'Fixture queue save failed' }).waitFor();
  check('Save failure preserves execution draft', await select('空闲标签保留时间').inputValue() === '120');
  await page.evaluate(() => { window.__fixture.failQueueSave = false; window.__fixture.patch({ requestSchedulingRevision: 10 }); });
  await save().click(); await page.getByRole('alert').filter({ hasText: 'Queue settings changed' }).waitFor();
  check('Revision conflicts do not overwrite runtime settings', await page.evaluate(() => window.__fixture.state.runtimeParameters.idleTabMinutes === 30));
  await page.getByRole('navigation').getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('region', { name: '偏好设置', exact: true }).waitFor();
  await page.getByRole('navigation').getByRole('button', { name: '运行参数', exact: true }).click();
  await page.getByRole('region', { name: '运行参数', exact: true }).waitFor();
  check('Discard returns to saved execution values', await select('空闲标签保留时间').inputValue() === '30');
  await page.getByRole('button', { name: '恢复默认值', exact: true }).click();
  check('Restore defaults remains an unsaved edit', await select('标签页保留数量').inputValue() === '5'
    && await page.evaluate(() => window.__fixture.state.runtimeParameters.retainedTabTarget === 12));
  check('Reset provenance is retained with the unsaved draft', await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('web2harness.runtimeParametersDraft.v1'));
    return Object.keys(draft.parameterEdits).length === 7 && Object.values(draft.parameterEdits).every(source => source === 'default');
  }));
  await save().click(); await page.getByText('已保存并生效', { exact: true }).waitFor();
  check('Restore sends explicit default intent for every runtime parameter', await page.evaluate(() => {
    const call = window.__fixture.calls.filter(c => c[0] === 'saveQueueSettings').at(-1);
    return Object.values(call[4]).every(source => source === 'default') && Object.keys(call[4]).length === 7;
  }));
  await select('空闲标签保留时间').selectOption('60');
  await select('空闲标签保留时间').selectOption('30');
  check('An explicit choice equal to the default remains saveable', await save().isEnabled());
  await save().click(); await page.getByText('已保存并生效', { exact: true }).waitFor();
  check('Explicit numeric default is marked user, not inferred default', await page.evaluate(() => {
    const call = window.__fixture.calls.filter(c => c[0] === 'saveQueueSettings').at(-1);
    return call[3].idleTabMinutes === 30 && call[4].idleTabMinutes === 'user';
  }));
  await page.getByRole('button', { name: '恢复默认值', exact: true }).click();
  check('Restoring only provenance remains saveable even when all numbers match', await save().isEnabled());
  await save().click(); await page.getByText('已保存并生效', { exact: true }).waitFor();
  await page.screenshot({ path: out + '/parameters-zh.png', fullPage: true });
  await page.evaluate(() => window.__fixture.patch({ browserInteractionMode: 'manual' }));
  await select('普通请求提交等待').waitFor();
  check('Manual submission defaults and supported controls are scoped', await select('普通请求提交等待').inputValue() === '60'
    && await select('压缩请求提交等待').inputValue() === '120' && await select('附件上传与处理等待时间').count() === 0);
  await select('普通请求提交等待').selectOption('300'); await select('压缩请求提交等待').selectOption('600');
  await save().click(); await page.getByText('已保存并生效', { exact: true }).waitFor();
  check('Manual timeout values save together', await page.evaluate(() => window.__fixture.state.runtimeParameters.manualSubmitSeconds === 300 && window.__fixture.state.runtimeParameters.manualCompactionSubmitSeconds === 600));
  await page.screenshot({ path: out + '/parameters-manual-zh.png', fullPage: true });
  await page.evaluate(() => window.__fixture.patch({ browserInteractionMode: 'automatic' }));
  await page.locator('.language-toggle').click();
  await page.getByRole('region', { name: 'Runtime parameters', exact: true }).waitFor();
  check('Existing save feedback follows language changes', await page.getByText('Saved and applied', { exact: true }).isVisible()
    && await page.getByText('已保存并生效', { exact: true }).count() === 0);
  check('Runtime parameter labels follow English locale', await select('Attachment processing timeout').count() === 1 && await select('Idle tab retention').count() === 1);
  await page.locator('.context-budget-settings').screenshot({path:out+'/budget-en.png'});
  await page.screenshot({ path: out + '/parameters-en.png', fullPage: true });
  await setWindowFixtureSize(page, { width: 900, height: 600 });
  await page.waitForTimeout(350);
  check('Small desktop window retains controls without horizontal overflow', await page.locator('.content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.locator('.context-budget-settings').screenshot({path:out+'/budget-small.png'});
  await page.screenshot({ path: out + '/parameters-small.png', fullPage: true });
  await page.close();
}
