import { chromium } from '../../node_modules/playwright-core/index.mjs';
import { createServer } from '../node_modules/vite/dist/node/index.js';
import { createServer as httpServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { installWorkspaceFixture } from './workspace-fixture.mjs';
const out=resolve(process.env.BROWSER_INPUT_UI_OUTPUT||'output/2026-10-16-browser-lock/ui');await mkdir(out,{recursive:true});
const listener=httpServer();
const server=await createServer({root:resolve('launcher'),configFile:resolve('launcher/vite.config.ts'),server:{middlewareMode:true,hmr:{server:listener},open:false}});
listener.on('request',server.middlewares);await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[];const check=(name,yes)=>{assert.ok(yes,name);checks.push(name);};
try {
 const ctx=await browser.newContext({viewport:{width:1120,height:720}});
 await ctx.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await ctx.addInitScript(installWorkspaceFixture);
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${listener.address().port}`);await page.locator('.sidebar-nav').waitFor();
 for(const language of ['zh-CN','en']) {
  await page.evaluate(language=>window.__fixture.patch({language}),language);
  await page.locator('.sidebar-nav').getByRole('button',{name:language==='zh-CN'?'浏览器':'Browser',exact:true}).click();
  await page.evaluate(()=>{
   const f=window.__fixture;
   window.codexWebLauncher.stopBrowserTab=async id=>{f.calls.push(['stopBrowserTab',id]);return f.browser;};
   window.codexWebLauncher.setBrowserInputOverride=async(id,allowed)=>{
    f.calls.push(['setBrowserInputOverride',id,allowed]);
    f.emitBrowser({inputLocked:!allowed,inputOverrideActive:allowed});return f.browser;
   };
   window.codexWebLauncher.hideBrowser=async()=>{f.calls.push(['hideBrowser']);return f.browser;};
   f.emitBrowser({visible:true,status:'running',inputLocked:true,inputLockReason:'running',automationBusy:true,zoomLocked:true,canOverrideInput:true,inputOverrideActive:false,activeTabId:'auto',
    tabs:[{id:'home',title:'ChatGPT',status:'ready',active:false,closable:false},{id:'auto',title:'ChatGPT 1',status:'running',active:true,closable:false,canStop:true,inputLocked:true}]});
  });
  const z=language==='zh-CN';
  for(const label of z?['后退','前进','重新加载','放大','缩小']:['Back','Forward','Reload','Zoom in','Zoom out']) {
   check(`${language}: ${label} disabled`,await page.getByRole('button',{name:label,exact:true}).isDisabled());
  }
  check(`${language}: close unavailable while owned`,await page.getByRole('button',{name:z?'关闭标签页':'Close tab',exact:true}).count()===0);
  check(`${language}: no duplicate toolbar status`,await page.locator('.browser-toolbar [role="status"]').count()===0);
  await page.getByRole('button',{name:z?'取消只读':'Exit view-only',exact:true}).click();
  await page.getByRole('button',{name:z?'恢复只读':'Restore view-only',exact:true}).waitFor();
  check(`${language}: override enables navigation while automation remains active`,await page.getByRole('button',{name:z?'重新加载':'Reload',exact:true}).isEnabled());
  check(`${language}: override leaves global zoom protected`,await page.getByRole('button',{name:z?'放大':'Zoom in',exact:true}).isDisabled());
  await page.screenshot({path:resolve(out,`override-${language}.png`)});
  check(`${language}: toolbar stays inside browser pane`,await page.locator('.browser-toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.getByRole('button',{name:z?'恢复只读':'Restore view-only',exact:true}).click();
  await page.getByRole('button',{name:z?'取消只读':'Exit view-only',exact:true}).waitFor();
  check(`${language}: restoring read-only disables navigation`,await page.getByRole('button',{name:z?'重新加载':'Reload',exact:true}).isDisabled());
  await page.getByRole('button',{name:z?'停止网页任务':'Stop browser task',exact:true}).click();
  check(`${language}: stop uses explicit IPC`,await page.evaluate(()=>window.__fixture.calls.some(c=>c[0]==='stopBrowserTab'&&c[1]==='auto')));
  await page.evaluate(()=>{const f=window.__fixture;f.emitBrowser({status:'ready',inputLockReason:'waiting-tools',tabs:f.browser.tabs.map(t=>t.id==='auto'?{...t,status:'ready',awaitingToolResults:true,canStop:false}:t)});});
  await page.getByRole('button',{name:z?'停止网页任务':'Stop browser task',exact:true}).waitFor({state:'hidden'});
  check(`${language}: waiting gap keeps zoom blocked`,await page.getByRole('button',{name:z?'放大':'Zoom in',exact:true}).isDisabled());
  check(`${language}: waiting does not claim it can stop Codex tools`,await page.getByRole('button',{name:z?'停止网页任务':'Stop browser task',exact:true}).count()===0);
  await page.screenshot({path:resolve(out,`waiting-${language}.png`)});
  await page.evaluate(()=>{const f=window.__fixture;f.emitBrowser({status:'ready',inputLocked:false,inputLockReason:null,automationBusy:false,zoomLocked:false,canOverrideInput:false,inputOverrideActive:false,activeTabId:'home',tabs:[{id:'home',title:'ChatGPT',status:'ready',active:true,closable:false}]});});
  await page.waitForFunction(()=>!document.querySelector('.browser-zoom-controls button').disabled);
  check(`${language}: idle navigation returns`,await page.getByRole('button',{name:z?'重新加载':'Reload',exact:true}).isEnabled());
  check(`${language}: idle zoom returns`,await page.getByRole('button',{name:z?'放大':'Zoom in',exact:true}).isEnabled());
 }
 check('no renderer errors',errors.length===0);
 await writeFile(resolve(out,'result.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));console.log(JSON.stringify({passed:checks.length}));
}finally{await browser.close();await server.close();await new Promise(r=>listener.close(r));}
