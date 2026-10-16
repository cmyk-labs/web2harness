import { setWindowFixtureSize } from "./window-fixture-size.mjs";
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { RequestQueue } from '../electron/runtime/request-queue.cjs';

// Real host query + shared renderer, isolated receipts and mocked IPC. No browser model work.
export async function runQueueSmoke({context,origin,out,check,errors}) {
  const directory=await mkdtemp(join(out,'queue-host-'));
  const queue=await new RequestQueue({directory,settings:{maxConcurrent:1,queueTimeoutMinutes:15,minSendIntervalSeconds:3},
    logger:{info(){},error(){}},hasResource:()=>false,cancelResource:async()=>{}}).start();
  const calls=[];
  let failQueries=false;
  const add=async(name,groupId,model='gpt-6-sol',effort='medium')=>{
    const id=createHash('sha256').update(name).digest('hex');
    const result=await queue.request('enqueue',{job:{id,groupId,model,effort,mode:'native-tools',bytes:0},pid:process.pid,traceId:`queue_${name}`});
    return {id,secret:result.secret};
  };
  const finish=async ticket=>{
    const record=(await queue.request('poll',ticket)).record;
    if(record.state==='queued') await queue.request('cancel',ticket);
    else await queue.request('settle',{...ticket,outcome:'succeeded'});
  };
  try {
    await finish(await add('old','launcher-smoke','gpt-5.6-sol'));
    await context.exposeBinding('__queueQuery',(_,query)=>{calls.push(query);if(failQueries)throw Error('Fixture query unavailable');return queue.query(query)});
    await context.exposeBinding('__queueStatus',()=>({status:'ready',savedRevision:1,settings:queue.snapshot().settings,scheduler:queue.snapshot()}));
    await context.addInitScript(()=>{
      window.codexWebLauncher.queryQueue=query=>window.__queueQuery(query);
      window.codexWebLauncher.queueStatus=()=>window.__queueStatus();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.getByRole('region',{name:'概览',exact:true}).waitFor();
    await page.locator('#workspace-sidebar').getByRole('button',{name:'运行控制',exact:true}).click();
    const panel=page.locator('.request-queue'), state=panel.getByLabel('状态',{exact:true}), session=panel.getByLabel('会话',{exact:true});
    const search=panel.getByLabel('搜索',{exact:true});
    await panel.getByText('暂无任务',{exact:true}).waitFor();
    check('Empty active queue excludes retained history sessions',await session.isDisabled()&&await session.locator('option').count()===1);
    const typography=await panel.evaluate(el=>{
      const queue=getComputedStyle(el),note=getComputedStyle([...document.querySelectorAll('.row p')].find(p=>p.textContent.includes('DEV 环境')));
      return {queue:{size:queue.fontSize,color:queue.color,font:queue.fontFamily},note:{size:note.fontSize,color:note.color,font:note.fontFamily}};
    });
    check('Queue typography matches surrounding DEV explanatory text',JSON.stringify(typography.queue)===JSON.stringify(typography.note));
    await panel.screenshot({path:join(out,'queue-empty-zh.png')});
    const group='01a1399b-1ca2-77f2-8b2b-ddc39f2fa796';
    const first=await add('active',group);
    await panel.locator('td').filter({hasText:/^gpt-6-sol/}).first().waitFor();
    check('First page detects an arrival after an empty snapshot',await session.isEnabled()&&await session.locator('option').count()===2);
    check('Opaque session IDs are shortened with the full ID retained',await session.locator('option').last().textContent()==='01a1399b…9f2fa796'&&await session.locator('option').last().getAttribute('title')===group);
    await session.focus();
    check('Session selector retains visible keyboard focus',await session.evaluate(el=>getComputedStyle(el).outlineStyle)==='solid');
    await session.selectOption(group);
    await panel.locator('td').filter({hasText:/^gpt-6-sol/}).first().waitFor();
    await finish(first);
    await panel.getByText('暂无任务',{exact:true}).waitFor();
    check('A session disappears when its last active task finishes',await session.isDisabled()&&await session.inputValue()==='');
    await state.selectOption('ended');
    await page.waitForFunction(()=>document.querySelector('.queue-table tbody').textContent.includes('launcher-smoke'));
    check('Finished state exposes sessions with finished tasks',await session.locator('option').count()===3);
    await session.selectOption('launcher-smoke');
    await panel.locator('td').filter({hasText:/^gpt-5\.6-sol/}).first().waitFor();
    await state.selectOption('active');
    await panel.getByText('暂无任务',{exact:true}).waitFor();
    check('Changing state clears the previous session filter',await session.inputValue()==='');
    for(let i=0;i<26;i++) await add(`batch_${i}`,group);
    await add('other','another-session','gpt-5.6-pro','max');
    await panel.getByLabel('每页',{exact:false}).selectOption('25');
    await page.waitForFunction(()=>document.querySelector('.queue-pagination').textContent.includes('/ 27'));
    check('Session options include matches outside the displayed page',await session.locator('option').count()===3);
    await panel.getByRole('button',{name:'下一页',exact:true}).click();
    await panel.locator('td').filter({hasText:/^gpt-5\.6-pro/}).first().waitFor();
    await add('late','late-session');
    await page.waitForTimeout(2200);
    check('Later pages preserve membership and use the snapshot',await session.locator('option').count()===3&&calls.at(-1).offset===25&&!!calls.at(-1).snapshotId);
    await panel.getByRole('button',{name:'上一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.queue-pagination').textContent.includes('/ 28'));
    check('Returning to first page includes new arrivals',await session.locator('option').count()===4&&!calls.at(-1).snapshotId);
    await session.selectOption('another-session');
    await panel.locator('td').filter({hasText:/^gpt-5\.6-pro/}).first().waitFor();
    await search.fill('gpt-6');await panel.getByRole('button',{name:'查询',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.queue-pagination').textContent.includes('/ 27'));
    check('Model search clears stale session and excludes other families',await session.inputValue()===''&&await session.locator('option').count()===3&&await panel.locator('td').filter({hasText:/^gpt-5\.6-pro/}).first().count()===0);
    await search.fill('missing-model');await panel.getByRole('button',{name:'查询',exact:true}).click();
    await panel.getByText('没有符合筛选条件的任务',{exact:true}).waitFor();
    check('No-match search has no selectable empty sessions',await session.isDisabled());
    await search.fill('gpt-5.6-pro');await panel.getByRole('button',{name:'查询',exact:true}).click();
    await panel.locator('td').filter({hasText:/^gpt-5\.6-pro/}).first().waitFor();
    check('Pro label and effort render together',await panel.locator('tbody').innerText().then(text=>text.includes('gpt-5.6-pro')&&text.includes('max')));
    await panel.screenshot({path:join(out,'queue-filtered-zh.png')});
    await page.locator('.language-toggle').click();await panel.getByLabel('Session',{exact:true}).waitFor();
    await panel.screenshot({path:join(out,'queue-filtered-en.png')});
    failQueries=true;
    await panel.getByText('Unable to read tasks. Refresh to retry.',{exact:true}).waitFor();
    check('Query failure is visible and does not present stale tasks',await panel.locator('tbody tr').count()===1);
    await panel.screenshot({path:join(out,'queue-error-en.png')});
    failQueries=false;await panel.getByRole('button',{name:'Refresh',exact:true}).click();
    await panel.locator('td').filter({hasText:/^gpt-5\.6-pro/}).first().waitFor();
    for(const width of [900,390]) {
      await setWindowFixtureSize(page, {width,height:850});await page.waitForTimeout(350);
      check(`Queue at ${width}px keeps horizontal scrolling inside the table`,await page.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await panel.screenshot({path:join(out,`queue-en-${width}.png`)});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    if(await page.locator('.app-shell:not(.is-sidebar-open)').count())await page.locator('.app-titlebar .icon-button').first().click();
    await page.locator('.language-toggle').click();await panel.getByLabel('会话',{exact:true}).waitFor();
    await page.waitForTimeout(350);
    check('Scaled queue keeps the manually opened sidebar',await page.locator('#workspace-sidebar').getAttribute('inert')===null);
    await panel.screenshot({path:join(out,'queue-zh-390.png')});
    check('Chinese narrow queue remains usable with reduced motion',await panel.getByLabel('会话',{exact:true}).isEnabled());
    await page.close();
  } finally { await queue.close(); }
}
