import { setWindowFixtureSize } from "./window-fixture-size.mjs";
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { RequestQueue } from '../electron/runtime/request-queue.cjs';

// Real host query + shared renderer, isolated receipts and mocked IPC. No browser model work.
export async function runQueueSmoke({context,origin,out,check,errors}) {
  const directory=await mkdtemp(join(out,'queue-host-'));
  const ownedResources=new Set();
  const queue=await new RequestQueue({directory,settings:{maxConcurrent:1,queueTimeoutMinutes:15,minSendIntervalSeconds:3},
    logger:{info(){},error(){}},hasResource:trace=>ownedResources.has(trace),
    ownsIsolatedSendResource:(trace,proof)=>trace==='queue_isolated'&&proof.surfaceId==='fixture-surface',cancelResource:async()=>{}}).start();
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
    for (const deliveryState of ['validation_failed','response_written']) {
      const ticket=await add(`native_${deliveryState}`,'launcher-smoke');
      await finish(ticket);
      await queue.request('native-delivery',{...ticket,delivery:{deliveryState,sequence:1}});
    }
    const isolated=await add('isolated','launcher-smoke');
    ownedResources.add('queue_isolated');
    const isolatedPermit=(await queue.request('send-begin',isolated)).permit;
    await queue.request('send-end',{...isolated,permit:isolatedPermit,outcome:'unknown',
      isolation:{version:1,inputSettled:true,helperPid:process.pid,surfaceId:'fixture-surface'}});
    ownedResources.delete('queue_isolated');
    await queue.request('settle',{...isolated,outcome:'failed',reason:'chatgpt_send_outcome_unknown'});
    const remoteId=createHash('sha256').update('remote-fixture').digest('hex'),remoteScope=createHash('sha256').update('fixture-tunnel').digest('hex');
    const remote=await queue.request('enqueue',{job:{id:remoteId,groupId:'launcher-smoke',model:'gpt-6-sol',mode:'mcp-bridge',bytes:0,mcpScope:remoteScope,connectorName:'Fixture DEV',retryAttempt:0},pid:process.pid,traceId:'queue_remote_fixture'});
    await queue.request('settle',{id:remoteId,secret:remote.secret,outcome:'failed',reason:'mcp_remote_rate_limited',remote:{failure:{kind:'rate_limit',source:'probe',status:429,retryAfterMs:120000}}});
    await context.exposeBinding('__queueQuery',(_,query)=>{calls.push(query);if(failQueries)throw Error('Fixture query unavailable');return queue.query(query)});
    let currentScope=null, recovered=false;
    await context.exposeBinding('__queueStatus',()=>{
      const scheduler=queue.snapshot();
      if(recovered) scheduler.mcpStatus=scheduler.mcpStatus.map(entry=>({...entry,lastVerifiedAt:Date.now(),cooldownUntil:undefined}));
      return {status:'ready',currentMcpScope:currentScope,savedRevision:1,settings:scheduler.settings,scheduler};
    });
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
    check('Native mode hides historical MCP failures', await panel.locator('.queue-mcp-status').count()===0);
    currentScope='b'.repeat(64);await page.waitForTimeout(2200);
    check('Unrelated tunnel history is hidden', await panel.locator('.queue-mcp-status').count()===0);
    currentScope=remoteScope;
    await panel.locator('.queue-mcp-status').waitFor();
    check('Current tunnel cooldown has a compact summary', (await panel.locator('.queue-mcp-status').innerText()).includes('冷却等待') && !(await panel.locator('.queue-mcp-status').innerText()).includes('HTTP'));
    recovered=true;await panel.locator('.queue-mcp-status').waitFor({state:'detached'});
    check('A newer verified receipt clears the old runtime warning', await panel.locator('.queue-mcp-status').count()===0);
    await page.getByRole('navigation').getByRole('button',{name:'用量与诊断',exact:true}).click();
    await page.getByRole('tab',{name:'健康检查',exact:true}).click();
    await page.getByText('MCP 调用历史',{exact:true}).click();
    const history=page.locator('.queue-mcp-status');
    await history.getByText(/历史失败（之后已验证接收）/).waitFor();
    check('Diagnostics preserves the dated historical failure', (await history.innerText()).includes('HTTP 429') && (await history.innerText()).includes('不代表工具执行完成'));
    await history.screenshot({path:join(out,'mcp-history-zh.png')});
    await page.getByRole('navigation').getByRole('button',{name:'运行控制',exact:true}).click();
    recovered=false;await panel.locator('.queue-mcp-status').waitFor();
    const group='01a1399b-1ca2-77f2-8b2b-ddc39f2fa796';
    const first=await add('active',group);
    await panel.locator('td').filter({hasText:/^gpt-6-sol/}).first().waitFor();
    check('First page detects an arrival after an empty snapshot',await session.isEnabled()&&await session.locator('option').count()===2);
    check('Opaque session IDs are shortened with the full ID retained',await session.locator('option').last().textContent()==='01a1399b…9f2fa796'&&await session.locator('option').last().getAttribute('title')===group);
    await session.focus();
    check('Session selector retains visible keyboard focus',await session.evaluate(el=>getComputedStyle(el).outlineStyle)==='solid');
    await session.selectOption(group);
    await panel.locator('td').filter({hasText:/^gpt-6-sol/}).first().waitFor();
    await queue.request('send-progress',{...first,progress:'preflight'});
    await queue.request('send-progress',{...first,progress:'waiting_permit'});
    await panel.getByText('内容已准备，等待发送许可',{exact:true}).waitFor();
    check('Prepared content has a distinct waiting-for-send label',true);
    await panel.screenshot({path:join(out,'queue-send-wait-zh.png')});
    await page.locator('.language-toggle').click();
    await panel.getByText('Ready, waiting to send',{exact:true}).waitFor();
    const permit=(await queue.request('send-begin',first)).permit;
    for(const progress of ['sending','awaiting_ack','reconciling']) await queue.request('send-progress',{...first,progress});
    await panel.getByText('Reconciling the original send',{exact:true}).waitFor();
    check('Reconciliation is distinct from ordinary preparation',true);
    await panel.screenshot({path:join(out,'queue-send-reconcile-en.png')});
    await queue.request('send-end',{...first,permit,outcome:'unknown'});
    await queue.request('settle',{...first,outcome:'failed',reason:'chatgpt_send_outcome_unknown'});
    await panel.getByRole('alert').getByText(/Send outcome unknown/).waitFor();
    check('Unknown sends expose the blocking task and preserve recovery confirmation',
      await panel.getByRole('button',{name:/Blocking task logs/}).count()===1
      && await panel.getByRole('button',{name:'Confirm recovery',exact:true}).isEnabled());
    await panel.screenshot({path:join(out,'queue-send-unknown-en.png')});
    await page.locator('.language-toggle').click();
    await panel.getByRole('alert').getByText(/发送结果未知/).waitFor();
    await panel.screenshot({path:join(out,'queue-send-unknown-zh.png')});
    await queue.control('recover', undefined, queue.snapshot().recoveryToken);
    await panel.getByRole('alert').waitFor({state:'detached'});
    await panel.getByText('暂无任务',{exact:true}).waitFor();
    check('A session disappears when its last active task finishes',await session.isDisabled()&&await session.inputValue()==='');
    await state.selectOption('ended');
    await page.waitForFunction(()=>document.querySelector('.queue-table tbody').textContent.includes('launcher-smoke'));
    check('Finished state exposes sessions with finished tasks',await session.locator('option').count()===3);
    await session.selectOption('launcher-smoke');
    await panel.locator('td').filter({hasText:/^gpt-5\.6-sol/}).first().waitFor();
    await panel.getByText('原生回复校验失败',{exact:true}).waitFor();
    check('Completed web work exposes native validation failure separately',await panel.locator('tbody tr').filter({hasText:'网页完成'}).count()===3);
    check('Historical native receipts do not invent delivery success',await panel.getByText('交付未确认',{exact:true}).count()===1);
    check('Writing the response is not claimed as Codex execution',(await panel.getByText('响应已写出',{exact:true}).getAttribute('title')).includes('不代表 Codex 已接收或执行工具'));
    check('Chinese isolated-send label preserves unknown outcome and slot ownership',
      (await panel.getByText('当前任务隔离',{exact:true}).getAttribute('title')).includes('发送结果仍未知'));
    await panel.screenshot({path:join(out,'queue-native-delivery-zh.png')});
    await page.locator('.language-toggle').click();
    await panel.getByText('Native reply validation failed',{exact:true}).waitFor();
    check('English distinguishes web completion from response delivery',await panel.getByText('Response written',{exact:true}).count()===1 && await panel.getByText('Delivery unconfirmed',{exact:true}).count()===1);
    check('English isolated-send label does not claim remote completion',
      (await panel.getByText('Task isolated',{exact:true}).getAttribute('title')).includes('outcome remains unknown'));
    await panel.screenshot({path:join(out,'queue-native-delivery-en.png')});
    await page.locator('.language-toggle').click();
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
