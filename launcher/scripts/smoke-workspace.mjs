import { chromium } from '../../node_modules/playwright-core/index.mjs';
import { createServer } from '../node_modules/vite/dist/node/index.js';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
const brandMark=JSON.parse(await readFile(resolve('assets/brand/brand-mark.json'),'utf8'));
const out=resolve(process.env.WORKSPACE_SMOKE_OUTPUT || 'output/context-files/ui');await mkdir(out,{recursive:true});
// Own the HTTP listener so port 0 really requests an ephemeral OS port. Vite's
// standalone listen path treats 0 as its default port, which can be occupied.
const server=await createServer({root:resolve('launcher'),configFile:resolve('launcher/vite.config.ts'),server:{middlewareMode:true,hmr:false,open:false}});
const listener=createHttpServer(server.middlewares);
await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve)});
const origin=`http://127.0.0.1:${listener.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[],checks=[];const check=(label,value)=>{assert.ok(value,label);checks.push(label)};
try{
const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN'});
await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
await context.addInitScript(()=>{
 const listeners={};const state={version:1,language:'zh-CN',onboardingComplete:true,browserInteractionMode:'automatic',sidebarOpen:true,sidebarWidth:224,mcpGuideStep:0,sessionRefreshReminderAt:null,mcpRuntimeInstalled:false,mcpSetupComplete:false,coreSetupComplete:true,codexCatalogVerified:true,experimentalContextFiles:false,experimentalContextTripleBudget:false,experimentalSkillAttachments:false,experimentalFreshConversationPerTurn:false,useSavedChats:false,keepRunningOnClose:true,showBrowserDuringTurns:true,autoStart:false,zeroRiskProEnabled:false};
 const browser={status:'ready',authenticated:true,visible:false,tabs:[],activeTabId:'idle',maxTabs:5,zoomFactor:1};
 const status={configured:true,mode:'native-tools',interactionMode:'automatic',runtimeStatus:'ready',credentials:{automatic:false,manual:false},capabilities:{solAvailable:true,proAvailable:true,browserInteractionMode:'automatic'}};
 const snapshot={startup:{status:'ready',stage:'ready',elapsedMs:0},profile:'development',profilePaths:{coreHome:'fixture',codexHome:'fixture',userData:'fixture'},state,browser,connectorName:'DEV fixture',connectorNames:{automatic:'DEV fixture',manual:'Manual fixture'},mcpCredentialsConfigured:false,logs:[{at:'2026-09-30T08:30:00Z',event:'runtime.started',level:'info',detail:{mode:'native-tools',status:'ready',port:12345}},{at:'2026-09-30T08:31:00Z',event:'browser.connection_failed',level:'error',detail:{message:'Fixture connection error',retry:false}}],urls:{github:'https://example.invalid',connectors:'https://example.invalid',tunnels:'https://example.invalid',keys:'https://example.invalid'},platform:'win32',packaged:false,version:'1.0.0',smokePassed:true,operation:null,update:{status:'disabled'}};
 window.__fixture={state,status,snapshot,browser,calls:[],failApply:false,emitStartup:startup=>{snapshot.startup=startup;listeners.onStartupState?.(structuredClone(startup))},emitBrowser:delta=>{Object.assign(browser,delta);listeners.onBrowserState?.(structuredClone(browser))}};
 const boot=new URL(location.href).searchParams;
 state.githubOpened=false;
 snapshot.urls.github='https://github.com/cmyk-labs/web2harness';
 Object.assign(snapshot.urls, {
  documentation: snapshot.urls.github+'/blob/main/README.md#documentation',
  documentationZhCN: snapshot.urls.github+'/blob/main/README.zh-CN.md#documentation',
  license: snapshot.urls.github+'/blob/main/LICENSE',
 });
 // A presentation fixture only: all IPC remains mocked; no installed app is opened.
 if(boot.has('production-ui'))snapshot.profile='production';
 if(boot.has('preparing'))snapshot.startup={status:'preparing',stage:'checking-installation',elapsedMs:0};
 if(boot.has('first-run')){state.language=null;state.onboardingComplete=false}
 const heldSnapshots=[];
 window.__fixture.releaseSnapshots=()=>{window.__fixture.holdSnapshot=false;heldSnapshots.splice(0).forEach(resolve=>resolve())};
 window.__fixture.prematureContent=false;
 if(boot.has('preparing'))new MutationObserver(()=>{
  if(snapshot.startup.status!=='ready'&&document.querySelector('.app-shell,.onboarding'))window.__fixture.prematureContent=true;
 }).observe(document,{childList:true,subtree:true});
 window.__fixture.emitUpdate=update=>{snapshot.update=update;listeners.onUpdateState?.(structuredClone(update))};
 const patch=delta=>{Object.assign(state,delta);listeners.onStateChanged?.({...state});return {...state}};
 Object.assign(window.__fixture,{patch,emitOperation:operation=>listeners.onOperation?.(operation)});
 const success=()=>{if(window.__fixture.failApply)throw new Error('Fixture setup failed')};
 window.codexWebLauncher=new Proxy({
 openRepository:async()=>{
  window.__fixture.calls.push(['openRepository',snapshot.urls.github]);
  if(window.__fixture.failRepository)throw new Error('Fixture repository opening failed');
  if(window.__fixture.holdRepository)await new Promise(resolve=>window.__fixture.releaseRepository=resolve);
  return patch({githubOpened:true});
 },
 checkUpdate:async()=>{window.__fixture.calls.push(['checkUpdate']);const update={status:'up-to-date',lastCheckedAt:'2026-10-05T01:00:00Z'};window.__fixture.emitUpdate(update);return update},
 snapshot:async()=>{if(window.__fixture.holdSnapshot)await new Promise(resolve=>heldSnapshots.push(resolve));if(window.__fixture.failSnapshot)throw new Error('Fixture snapshot error');return structuredClone(snapshot)},workspaceStatus:async()=>{if(window.__fixture.failStatus)throw new Error('Fixture status unavailable');return structuredClone(status)},windowState:async()=>({fullScreen:false,maximized:false}),
 cancelTurns:async()=>{
  window.__fixture.calls.push(['cancelTurns']);
  if(window.__fixture.failCancel)throw new Error('Fixture cancellation failed');
  if(window.__fixture.holdCancel)await new Promise(resolve=>window.__fixture.releaseCancel=resolve);
  window.__fixture.emitBrowser({status:'ready',tabs:[]});return {stdout:'Cancelled'};
 },
 uninstallIntegration:async()=>{
  window.__fixture.calls.push(['uninstallIntegration']);
  if(window.__fixture.failRemoval)throw new Error('Fixture removal failed');
  if(!window.__fixture.confirmRemoval)return {cancelled:true};
  status.configured=false;status.mode=null;status.runtimeStatus='stopped';
  return {cancelled:false,state:patch({coreSetupComplete:false,codexCatalogVerified:false,mcpSetupComplete:false})};
 },
 exportLogs:async()=>{window.__fixture.calls.push(['exportLogs']);if(window.__fixture.failExport)throw new Error('Fixture export error');return window.__fixture.cancelExport?null:'fixture-diagnostics.jsonl'},
 getLimits:async()=>({...{enabled:true,trackingSince:null,checkedAt:null,plan:null,totalMessages:0,unknownProMessages:0,incomplete:false,gapAt:null,models:["gpt-6-pro","gpt-5.6-pro","gpt-6-sol","gpt-5.6-sol"].map(model=>({model,last24Hours:0,last7Days:0})),windows:[]},...window.__fixture.usage}),
 setLanguage:async language=>patch({language}),setPreference:async(key,value)=>patch({[key]:value}),setContextFiles:async value=>patch({experimentalContextFiles:value,...(!value?{experimentalContextTripleBudget:false}:{})}),setContextTripleBudget:async value=>patch({experimentalContextTripleBudget:value}),setSkillAttachments:async value=>patch({experimentalSkillAttachments:value}),setFreshConversationPerTurn:async value=>patch({experimentalFreshConversationPerTurn:value}),setUseSavedChats:async value=>patch({useSavedChats:value}),
 setupCore:async()=>{window.__fixture.calls.push(['setupCore']);success();status.configured=true;status.mode='native-tools';status.interactionMode='automatic';status.capabilities.browserInteractionMode='automatic';patch({coreSetupComplete:true,mcpSetupComplete:false,codexCatalogVerified:false,browserInteractionMode:'automatic'});return {ok:true,stdout:'',restartRequired:true}},
 smokeTest:async()=>{window.__fixture.calls.push(['smokeTest']);snapshot.smokePassed=true;return {ok:true}},
 setupMcp:async input=>{window.__fixture.calls.push(['setupMcp',input]);success();status.mode='mcp-bridge';status.interactionMode=input.interactionMode;status.capabilities.browserInteractionMode=input.interactionMode;status.credentials[input.interactionMode]=true;patch({coreSetupComplete:true,mcpRuntimeInstalled:true,mcpSetupComplete:false,codexCatalogVerified:false,browserInteractionMode:input.interactionMode});return {ok:true}},
 setToolMode:async(mode,interaction)=>{window.__fixture.calls.push(['setToolMode',mode,interaction]);success();status.mode=mode;status.interactionMode=interaction;status.capabilities.browserInteractionMode=interaction;return {state:patch({coreSetupComplete:true,mcpRuntimeInstalled:mode==='mcp-bridge',mcpSetupComplete:false,codexCatalogVerified:false,browserInteractionMode:interaction}),credentialsRequired:false}},
 doctor:async()=>window.__fixture.doctorReport??({ok:false,checks:[{id:'runtime',status:'error',message:'Fixture failure',detail:'Original fixture diagnostic detail'},{id:'route',status:'warning',message:'Fixture route warning'}]}),
 verifyMcp:async()=>{window.__fixture.calls.push(['verifyMcp',state.browserInteractionMode]);patch({mcpSetupComplete:true});return {ok:true,checks:[{id:state.browserInteractionMode==='manual'?'local-runtime':'connector',status:'ok',message:state.browserInteractionMode==='manual'?'Local fixture ready':'Connected'}]}},
 completeOnboarding:async(language,interaction)=>{
  window.__fixture.calls.push(['completeOnboarding',language,interaction]);
  if(window.__fixture.failOnboarding)throw new Error('Fixture onboarding failed');
  return patch({language,browserInteractionMode:interaction,onboardingComplete:true});
 },
 showBrowser:async()=>browser,setBrowserSurfaceActive:async()=>browser,
 },{get:(target,key)=>key in target?target[key]:String(key).startsWith('on')?fn=>{listeners[key]=fn;return()=>delete listeners[key]}:async(...args)=>{window.__fixture.calls.push([key,...args]);return {}}});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByRole('region',{name:'概览',exact:true}).waitFor();await page.waitForTimeout(600);
await page.screenshot({path:out+'/overview-zh.png'});
check('No unsolicited recommendation modal',await page.locator('.bigger-context-recommendation-backdrop').count()===0);
const metrics=await page.evaluate(()=>({sidebar:document.querySelector('.app-sidebar').getBoundingClientRect().width,padding:getComputedStyle(document.querySelector('.content')).padding,background:getComputedStyle(document.querySelector('.ui-page')).backgroundColor}));
check('Workspace uses the shared sidebar and readable page spacing',metrics.sidebar===252&&metrics.padding==='32px 8px 64px');
check('No page breadcrumb or workspace kicker',await page.locator('.topbar,.eyebrow').count()===0);
check('Sidebar uses the approved H logo without repeated overview branding',await page.locator('.sidebar-brand-identity .brand-mark svg path').getAttribute('d')===brandMark.path&&await page.locator('.overview-intro .brand-mark,.overview-intro .overview-brand').count()===0);
check('Ready overview has one management action and no setup warning',await page.locator('.content button').count()===1&&await page.getByRole('button',{name:'管理连接',exact:true}).count()===1&&await page.locator('.overview-notice').count()===0);
check('Healthy overview status values share the success tone',await page.locator('.card .value').evaluateAll(nodes=>new Set(nodes.map(node=>getComputedStyle(node).color)).size===1));
check('Sidebar restores three Chinese groups',JSON.stringify(await page.locator('.sidebar-group h2').allTextContents())===JSON.stringify(['工作区','设置','应用']));
check('Healthy sidebar has a success indicator',await page.locator('.side-status .status-dot.status-success').count()===1);
check('Sidebar footer is one compact status line',await page.locator('.side-status').innerText()==='已就绪 · 原生工具'&&await page.locator('.side-status-text').evaluate(el=>getComputedStyle(el).whiteSpace)==='nowrap');
check('Interaction detail remains accessible without an extra line',(await page.locator('.side-status').getAttribute('aria-label')).includes('自动交互')&&(await page.locator('.side-status').getAttribute('title')).includes('自动交互'));
check('Chinese type uses a consistent local font family',await page.locator('.sidebar-item span').first().evaluate(el=>getComputedStyle(el).fontFamily.startsWith('"PingFang SC"')&&getComputedStyle(el).fontFamily.includes('Microsoft YaHei UI')&&!getComputedStyle(el).fontFamily.includes('Yu Gothic')));
check('Overview explains positioning, capabilities and account usage value',await page.locator('.content h1').count()===1&&(await page.locator('.overview-lead').innerText()).includes('工作空间概览')&&(await page.locator('.overview-description').innerText()).includes('原生工具或 MCP 桥接')&&(await page.locator('.overview-description').innerText()).includes('Web 模型额度')&&await page.locator('.configuration-summary .row').count()===1);
check('Usage instructions are an always-visible three-step flow',await page.locator('.usage-flow li').count()===3&&await page.locator('.usage-guide').count()===0&&await page.locator('.usage-flow').isVisible());
check('Flow retains all original Chinese descriptions',JSON.stringify(await page.locator('.usage-flow p').allTextContents())===JSON.stringify(['使用你熟悉的客户端或命令行。','模型名称以 (Web) 标识。','在这里查看连接和运行状态。']));
check('Flow uses three numbered nodes and two connectors',await page.locator('.usage-flow .flow-number').count()===3&&await page.locator('.usage-flow .flow-connector').count()===2);
check('Preferences follows Connection under Settings',JSON.stringify(await page.getByRole('region',{name:'设置',exact:true}).getByRole('button').allTextContents())===JSON.stringify(['连接与模型','偏好设置'])&&await page.locator('.sidebar-footer .language-toggle').count()===1);
await page.getByRole('button',{name:'在 GitHub 打开项目仓库',exact:true}).click();
check('The sidebar GitHub icon opens the current project repository',await page.evaluate(()=>window.__fixture.calls.some(call=>call[0]==='openExternal'&&call[1]==='https://github.com/cmyk-labs/web2harness')));
check('Usage steps retain three outlined flow boxes',await page.locator('.usage-flow li').evaluateAll(nodes=>nodes.length===3&&nodes.every(node=>getComputedStyle(node).borderBottomWidth==='1px'&&getComputedStyle(node).borderTopWidth==='1px')));
check('Open sidebar shows only its DEV badge',await page.locator('.titlebar-dev-profile').count()===0&&await page.locator('.sidebar-brand-identity .dev-profile-badge').count()===1);
await page.locator('.app-titlebar .icon-button').first().click();await page.locator('.titlebar-dev-profile').waitFor();check('Collapsed sidebar moves DEV identification to titlebar',await page.locator('.app-shell:not(.is-sidebar-open)').count()===1);await page.locator('.app-titlebar .icon-button').first().click();await page.waitForTimeout(600);
await page.getByRole('navigation').getByRole('button',{name:'用量与诊断',exact:true}).hover();await page.waitForTimeout(200);
check('Hover background differs from current page',await page.locator('.sidebar-item.is-active').evaluate(el=>getComputedStyle(el).backgroundColor)!==await page.getByRole('navigation').getByRole('button',{name:'用量与诊断',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor));await page.locator('.overview-intro').hover();
const normalTone=await page.locator('.card .value').first().evaluate(el=>getComputedStyle(el).color);
check('Success uses the original project green',normalTone==='rgb(64, 201, 119)');
await page.evaluate(()=>window.__fixture.emitBrowser({status:'error'}));
check('Browser error is red even when cached login was healthy',await page.locator('.card .value.status-error').count()===1&&await page.locator('.side-status .status-error').count()===1);
check('Faults use the original project red',await page.locator('.card .value.status-error').evaluate(el=>getComputedStyle(el).color)==='rgb(255, 103, 100)');
await page.evaluate(()=>window.__fixture.emitBrowser({status:'signed-out',authenticated:false}));
check('Waiting for login is neutral, not a fault',await page.locator('.card .value.status-error').count()===0&&await page.locator('.side-status .status-neutral').count()===1);
await page.evaluate(()=>window.__fixture.emitBrowser({status:'ready',authenticated:true}));
await page.screenshot({path:out+'/overview-groups-zh.png'});
await page.setViewportSize({width:390,height:1050});await page.waitForTimeout(350);await page.screenshot({path:out+'/overview-zh-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1050});await page.waitForTimeout(350);
const waitLayout=()=>page.waitForFunction(()=>{
  const shell=document.querySelector('.app-shell');
  const sidebar=document.querySelector('.app-sidebar');
  const target=shell.classList.contains('is-sidebar-open')?parseFloat(getComputedStyle(sidebar).getPropertyValue('--sidebar-width')):0;
  const surface=document.querySelector('.surface-transition');
  return window.matchMedia('(max-width:820px)').matches===shell.classList.contains('is-compact')&&Math.abs(sidebar.getBoundingClientRect().width-target)<.5&&(!surface||Number(getComputedStyle(surface).opacity)>.99);
});
const nav=async name=>{await waitLayout();if(await page.locator('.app-shell.is-compact:not(.is-sidebar-open)').count())await page.locator('.app-titlebar .icon-button').first().click();await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();if(['Overview','概览'].includes(name))await page.getByRole('region',{name,exact:true}).waitFor();else if(!['Browser','浏览器'].includes(name))await page.getByRole('region',{name,exact:true}).waitFor();await waitLayout()};
const pref=async name=>{await waitLayout();if(await page.locator('.app-shell.is-compact:not(.is-sidebar-open)').count())await page.locator('.app-titlebar .icon-button').first().click();await page.getByRole('button',{name,exact:true}).click();await page.getByRole('region',{name,exact:true}).waitFor()};
await nav('连接与模型');
check('Completed simple steps align actions beside text',await page.locator('.connection-step.is-complete').first().evaluate(el=>{const copy=el.querySelector('.step-heading').getBoundingClientRect(),action=el.querySelector('.step-action').getBoundingClientRect();return action.left>=copy.right&&action.top<el.getBoundingClientRect().bottom}));
check('Native Tools fixes automatic interaction without a manual selector',await page.getByRole('radio',{name:'手动',exact:true}).count()===0&&await page.locator('.interaction-setting > strong').textContent()==='自动');
check('Native setup uses four ordered steps',JSON.stringify(await page.locator('.connection-step h3').allTextContents())===JSON.stringify(['登录 ChatGPT','检查浏览器连接','应用配置','在 Codex 刷新模型目录']));
check('Web model list starts collapsed',!await page.locator('.model-list').evaluate(el=>el.open)&&!await page.locator('.model').first().isVisible());
await page.locator('.model-list summary').click();
check('Web models expand in place',await page.locator('.model').first().isVisible());
check('Refresh sits in the model heading without a spare action row',await page.locator('.model-list').evaluate(el=>{const heading=el.querySelector('summary').getBoundingClientRect(),button=el.querySelector('.model-list-actions').getBoundingClientRect(),description=el.querySelector('.model-list-description').getBoundingClientRect();return button.top>=heading.top&&button.bottom<=heading.bottom&&description.top-heading.bottom<=4}));
await page.evaluate(()=>window.__fixture.patch({codexRestartRequired:true,codexCatalogVerified:false}));
check('Pending catalog has one scoped explanation',await page.locator('.model-catalog-notice').count()===1&&(await page.locator('.model-catalog-notice').innerText()).includes('请在 DEV Codex 中刷新模型目录'));
await page.evaluate(()=>window.__fixture.patch({codexCatalogVerified:true}));
check('Successful catalog read hides the stale restart reminder',await page.locator('.model-catalog-notice').count()===0&&await page.locator('.model-catalog-status').count()===0);
await page.evaluate(()=>window.__fixture.patch({codexRestartRequired:false}));

check('Shared runtime rules expose four Pro-account Web models',await page.locator('.model').count()===4);
await page.locator('.model-list summary').click();
await page.screenshot({path:out+'/connection-native-zh.png',fullPage:true});
const mutations=()=>page.evaluate(()=>window.__fixture.calls.filter(c=>['setupCore','setupMcp','setToolMode','smokeTest','verifyMcp'].includes(c[0])).length);
const beforeDraft=await mutations();
await page.getByRole('radio',{name:/MCP 桥接/}).click();
check('Mode selection is draft only',await page.evaluate(()=>window.__fixture.status.mode==='native-tools')&&await mutations()===beforeDraft);
check('Pending mode clearly identifies still-active native configuration',(await page.locator('.pending-configuration').innerText()).includes('当前仍使用: 原生工具')&&(await page.locator('.connection-active').innerText()).includes('原生工具'));
check('MCP applies configuration before binding checks in reading order',await page.locator('.connection-credentials').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.connection-check'))&Node.DOCUMENT_POSITION_FOLLOWING)));
check('Missing credentials block apply',await page.getByRole('button',{name:'应用配置',exact:true}).isDisabled());
check('Binding checks are disabled until configuration is applied',await page.getByRole('button',{name:'验证连接器绑定',exact:true}).isDisabled());
await page.locator('input[placeholder="tunnel_…"]').fill('tunnel_'+'a'.repeat(32));
await page.getByLabel('API key',{exact:true}).fill('short');
check('Incomplete API key blocks apply',await page.getByRole('button',{name:'应用配置',exact:true}).isDisabled());
await page.getByLabel('API key',{exact:true}).fill('fixture-runtime-key-not-a-real-secret');
check('API key input is masked',await page.getByLabel('API key',{exact:true}).getAttribute('type')==='password');
await page.evaluate(()=>window.__fixture.patch({codexCatalogVerified:false}));
await page.waitForFunction(()=>document.querySelector('.connection-apply button.primary').disabled);
check('Automatic MCP requires a refreshed catalog even with valid credentials',await page.getByRole('button',{name:'应用配置',exact:true}).isDisabled());
// This fixture event represents a catalog read; it is not a real Codex acceptance task.
await page.evaluate(()=>window.__fixture.patch({codexCatalogVerified:true}));
await page.waitForFunction(()=>!document.querySelector('.connection-apply button.primary').disabled);
await page.evaluate(()=>window.__fixture.failApply=true);
await page.getByRole('button',{name:'应用配置',exact:true}).click();
await page.locator('.connection-credentials [role="alert"]').getByText('Fixture setup failed',{exact:true}).waitFor();
check('Failed apply keeps the active mode and reports next to credentials',await page.evaluate(()=>window.__fixture.status.mode==='native-tools'&&window.__fixture.state.browserInteractionMode==='automatic')&&(await page.locator('.connection-active').innerText()).includes('原生工具')&&await page.locator('.error-toast').count()===0);
await page.evaluate(()=>window.__fixture.failApply=false);
await page.getByRole('button',{name:'应用配置',exact:true}).click();
await page.waitForFunction(()=>window.__fixture.status.mode==='mcp-bridge');
await page.getByRole('button',{name:'更换凭据',exact:true}).waitFor();
check('Direct API key reaches existing setup IPC',await page.evaluate(()=>{const input=window.__fixture.calls.filter(c=>c[0]==='setupMcp').at(-1)[1];return input.runtimeKey==='fixture-runtime-key-not-a-real-secret'&&!('runtimeKeyFile' in input)}));
check('Applying MCP does not pretend binding or catalog checks passed',await page.evaluate(()=>window.__fixture.state.coreSetupComplete&&!window.__fixture.state.mcpSetupComplete&&!window.__fixture.state.codexCatalogVerified));
await page.getByRole('button',{name:'更换凭据',exact:true}).click();
check('Successful apply clears API key from the form',await page.getByLabel('API key',{exact:true}).inputValue()==='');
check('Credential replacement disables binding verification',await page.getByRole('button',{name:'验证连接器绑定',exact:true}).isDisabled());
await page.getByRole('button',{name:'放弃更改',exact:true}).click();
check('Discard restores saved credentials and verification',await page.getByRole('button',{name:'更换凭据',exact:true}).count()===1&&await page.getByLabel('API key',{exact:true}).count()===0&&await page.getByRole('button',{name:'验证连接器绑定',exact:true}).isEnabled());
await page.getByRole('button',{name:'验证连接器绑定',exact:true}).click();
await page.getByText('已验证连接器绑定。',{exact:true}).waitFor();
await page.evaluate(()=>window.__fixture.patch({codexCatalogVerified:true}));
await page.screenshot({path:out+'/connection-mcp-automatic-zh.png',fullPage:true});
const beforeManual=await mutations();
await page.getByRole('radio',{name:'手动',exact:true}).click();
check('Manual selection stays a draft and requires its own credentials',await page.getByRole('button',{name:'应用配置',exact:true}).isDisabled()&&await page.evaluate(()=>window.__fixture.state.browserInteractionMode==='automatic'&&!window.__fixture.status.credentials.manual)&&await mutations()===beforeManual);
check('Manual explains user-managed login and removes browser checks',await page.getByText('手动管理',{exact:true}).count()===1&&await page.getByRole('button',{name:'重新检查',exact:true}).count()===0&&await page.getByRole('button',{name:'检查连接',exact:true}).count()===0&&await page.getByText('无需自动检测',{exact:true}).count()===1);
await page.locator('input[placeholder="tunnel_…"]').fill('tunnel_'+'b'.repeat(32));
await page.getByLabel('API key',{exact:true}).fill('fixture-manual-key-not-a-real-secret');
const smokeCount=await page.evaluate(()=>window.__fixture.calls.filter(c=>c[0]==='smokeTest').length);
await page.getByRole('button',{name:'应用配置',exact:true}).click();
await page.waitForFunction(()=>window.__fixture.state.browserInteractionMode==='manual');
await page.getByRole('button',{name:'检查本地运行环境',exact:true}).click();
await page.getByText('本地检查通过；远端绑定需人工确认。',{exact:true}).waitFor();
check('Manual applies separate credentials and performs no automated browser check',await page.evaluate(smokeCount=>{const input=window.__fixture.calls.filter(c=>c[0]==='setupMcp').at(-1)[1];return input.interactionMode==='manual'&&input.tunnelId==='tunnel_'+'b'.repeat(32)&&window.__fixture.status.credentials.automatic&&window.__fixture.status.credentials.manual&&window.__fixture.calls.filter(c=>c[0]==='smokeTest').length===smokeCount},smokeCount));
check('Manual local checks explicitly do not verify remote binding',await page.getByText('请在网页确认连接器绑定到对应隧道。本地检查通过仅代表本地环境可用，不验证远端绑定。',{exact:true}).count()===1);
await page.screenshot({path:out+'/connection-mcp-manual-zh.png',fullPage:true});
await page.setViewportSize({width:390,height:1050});
await page.waitForTimeout(350);
check('Manual MCP narrow layout has no horizontal overflow',await page.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth));
await page.screenshot({path:out+'/connection-mcp-manual-zh-mobile.png',fullPage:true});
await page.setViewportSize({width:1440,height:1050});await page.waitForTimeout(350);
const beforeNative=await mutations();
await page.getByRole('radio',{name:/原生工具/}).click();
check('Selecting Native Tools from manual resets only the draft to automatic',await page.getByRole('radio',{name:'手动',exact:true}).count()===0&&await page.locator('.interaction-setting > strong').textContent()==='自动'&&await page.evaluate(()=>window.__fixture.status.mode==='mcp-bridge'&&window.__fixture.state.browserInteractionMode==='manual')&&await mutations()===beforeNative);
check('Automatic browser checks stay disabled until manual-to-native is applied',await page.getByRole('button',{name:'重新检查',exact:true}).isDisabled());
await page.getByRole('button',{name:'应用配置',exact:true}).click();
await page.waitForFunction(()=>window.__fixture.status.mode==='native-tools'&&window.__fixture.state.browserInteractionMode==='automatic');
await page.evaluate(()=>window.__fixture.patch({codexCatalogVerified:true}));
check('Applying native commits automatic interaction through existing mode IPC',await page.evaluate(()=>{const last=window.__fixture.calls.filter(c=>c[0]==='setToolMode').at(-1);return last[1]==='native-tools'&&last[2]==='automatic'}));
await page.getByRole('radio',{name:/MCP 桥接/}).click();await page.getByRole('button',{name:'更换凭据',exact:true}).click();
await page.evaluate(()=>window.__fixture.emitOperation({status:'running',kind:'fixture',message:'Fixture operation in progress'}));
await page.waitForFunction(()=>document.querySelector('.mode').disabled);
check('Busy operation locks mode, interaction, credential fields and apply controls',await page.locator('.mode-list button,.interaction-setting button,.fields input,.connection-apply button').evaluateAll(nodes=>nodes.length>=7&&nodes.every(node=>node.disabled)));
await page.evaluate(()=>window.__fixture.emitOperation({status:'idle'}));
await page.getByRole('button',{name:'放弃更改',exact:true}).click();
await page.evaluate(()=>window.__fixture.emitBrowser({status:'running'}));
await page.waitForFunction(()=>document.querySelector('.mode').disabled);
check('An active browser turn also locks configuration',await page.getByRole('radio',{name:/MCP 桥接/}).isDisabled()&&await page.getByRole('button',{name:'应用配置',exact:true}).isDisabled());
await page.evaluate(()=>window.__fixture.emitBrowser({status:'ready'}));
await page.screenshot({path:out+'/connection-zh.png',fullPage:true});
await pref('偏好设置');
await page.evaluate(()=>window.__fixture.patch({codexRestartRequired:true,codexCatalogVerified:false}));
check('Preferences does not repeat the model-catalog reminder',await page.getByText('配置已更新。请在 DEV Codex 中刷新模型目录；如果列表仍未更新，再重启对应的 DEV Codex 会话。',{exact:true}).count()===0);
await page.evaluate(()=>window.__fixture.patch({codexRestartRequired:false,codexCatalogVerified:true}));
check('Preferences relies on controls without a redundant mode summary',await page.locator('.content').getByRole('radiogroup',{name:'界面语言',exact:true}).count()===0&&await page.getByText('仅提供简体中文和英文。',{exact:true}).count()===0&&await page.locator('p.preference-summary').count()===0);await page.getByRole('radio',{name:'每轮新建',exact:true}).click();await page.getByRole('radio',{name:'保存到历史',exact:true}).click();check('Chat preferences are independent and persisted through IPC',await page.evaluate(()=>window.__fixture.state.experimentalFreshConversationPerTurn&&window.__fixture.state.useSavedChats));
await page.locator('.feedback').waitFor();
check('Success feedback floats without taking layout space',await page.locator('.feedback').evaluate(el=>getComputedStyle(el).position)==='absolute');
await page.getByRole('button',{name:'关闭提示',exact:true}).click();
check('Success feedback can be dismissed',await page.locator('.feedback').count()===0);
await page.getByRole('radio',{name:'保存到历史',exact:true}).click();await page.locator('.feedback').waitFor();
await page.waitForTimeout(2200);
await page.getByRole('radio',{name:'保存到历史',exact:true}).click();await page.locator('.feedback').waitFor();
await page.waitForTimeout(1200);
check('Repeated identical success restarts timer without stacking',await page.locator('.feedback').count()===1&&!await page.locator('.feedback').evaluate(el=>el.classList.contains('is-leaving')));
await page.locator('.feedback').waitFor({state:'detached',timeout:4000});
check('Success feedback automatically disappears',await page.locator('.feedback').count()===0);
await page.getByText('实验功能 · 按需启用',{exact:true}).click();
check('File transport starts off and budget is hidden',await page.getByRole('switch',{name:'上下文文件传输（实验性）',exact:true}).getAttribute('aria-checked')==='false'&&await page.getByRole('radiogroup',{name:'上下文预算'}).count()===0);
await page.getByRole('switch',{name:'上下文文件传输（实验性）',exact:true}).click();
check('Enabling file transport uses standard budget',await page.getByRole('radio',{name:'标准预算（默认）',exact:true}).getAttribute('aria-checked')==='true');
await page.getByRole('radio',{name:'三倍预算（实验性）',exact:true}).click();
check('Triple budget requires explicit choice',await page.evaluate(()=>window.__fixture.state.experimentalContextFiles&&window.__fixture.state.experimentalContextTripleBudget));
await page.getByRole('switch',{name:'上下文文件传输（实验性）',exact:true}).click();
check('Disabling file transport also clears triple budget',await page.evaluate(()=>!window.__fixture.state.experimentalContextFiles&&!window.__fixture.state.experimentalContextTripleBudget));
await page.getByRole('switch',{name:'上下文文件传输（实验性）',exact:true}).click();
check('Re-enabling returns to standard budget',await page.getByRole('radio',{name:'标准预算（默认）',exact:true}).getAttribute('aria-checked')==='true');
await page.screenshot({path:out+'/context-settings-zh.png'});
await page.locator('.language-toggle').click();await page.getByRole('region',{name:'Preferences',exact:true}).waitFor();await page.screenshot({path:out+'/preferences-en.png',fullPage:true});
check('English footer retains compact state and mode',await page.locator('.side-status').innerText()==='Ready · Native Tools');
check('English type uses local system fonts',await page.locator('.sidebar-item span').first().evaluate(el=>getComputedStyle(el).fontFamily.includes('Segoe UI')));
check('Sidebar groups are localized in English',JSON.stringify(await page.locator('.sidebar-group h2').allTextContents())===JSON.stringify(['Workspace','Settings','Application']));
const captureConnection = async name => {
  await page.locator('.content').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
  await page.setViewportSize({width:390,height:1050});
  await waitLayout();await page.waitForTimeout(250);
  check(name+' narrow mode choices use a readable single column',await page.locator('.mode-list .mode').evaluateAll(nodes=>new Set(nodes.map(el=>Math.round(el.getBoundingClientRect().left))).size===1));
  check(name+' narrow view has no horizontal overflow',await page.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:out+'/'+name+'-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1050});await waitLayout();await page.waitForTimeout(250);
};
await nav('Overview');await page.screenshot({path:out+'/overview-en.png'});
await nav('Connection & Models');await captureConnection('connection-native-en');
await page.getByRole('radio',{name:/MCP Bridge/}).click();
await page.getByRole('button',{name:'Apply configuration',exact:true}).click();
await page.getByRole('button',{name:'Verify connector binding',exact:true}).click();
await page.getByText('Connector binding verified.',{exact:true}).waitFor();
await page.evaluate(()=>window.__fixture.patch({codexCatalogVerified:true}));
await captureConnection('connection-mcp-automatic-en');
await page.getByRole('radio',{name:'Manual',exact:true}).click();
check('English manual draft reuses only its own saved profile',await page.getByRole('button',{name:'Replace credentials',exact:true}).count()===1&&(await page.locator('.pending-configuration').innerText()).includes('Still active: MCP Bridge · Automatic'));
await page.getByRole('button',{name:'Apply configuration',exact:true}).click();
await page.getByRole('button',{name:'Check local runtime',exact:true}).click();
await page.getByText('Local checks passed; confirm the remote binding manually.',{exact:true}).waitFor();
await captureConnection('connection-mcp-manual-en');
await page.getByRole('radio',{name:/Native Tools/}).click();
await page.getByRole('button',{name:'Apply configuration',exact:true}).click();
await page.waitForFunction(()=>window.__fixture.status.mode==='native-tools'&&window.__fixture.state.browserInteractionMode==='automatic');
await page.evaluate(()=>window.__fixture.patch({codexCatalogVerified:true}));
await nav('Usage & Diagnostics');
const localRow=model=>page.locator('.local-usage tbody tr').filter({has:page.getByRole('cell',{name:model,exact:true})});
check('Empty total and all four models remain visible without effort details',await page.locator('.usage-total-value').innerText()==='0'&&await page.locator('.local-usage tbody tr').count()===4&&(await page.locator('.local-usage tbody td:not(:first-child)').allTextContents()).every(value=>value==='0')&&await page.locator('.usage-details').count()===0);
const emptyLocalCounts=await page.locator('.local-usage table').innerText();
check('Browsing policy does not pretend to identify a plan',await page.getByRole('combobox',{name:'Plan reference'}).inputValue()==='other'&&(await page.locator('.official-limits tbody td:last-child').allTextContents()).every(value=>value==='-'));
await page.getByRole('combobox',{name:'Plan reference'}).selectOption('pro_200');
check('Requested future policy remains the default view',await page.getByRole('combobox',{name:'Reference period'}).inputValue()==='future');
const policyRow=model=>page.locator('.official-limits tbody tr').filter({has:page.locator('td:first-child').filter({hasText:new RegExp('^'+model.replaceAll('.','\\.')+'$')})});
check('Future weekly reference count is preserved',await policyRow('GPT-6 Pro').locator('td').nth(2).innerText()==='100');
check('Ordinary models do not inherit Pro counts',await policyRow('GPT-6').locator('td').nth(2).innerText()==='-'&&await policyRow('GPT-5.6 Sol').locator('td').nth(2).innerText()==='-');
check('Reference table has three columns and no source buttons',await page.locator('.official-limits th').count()===3&&await page.locator('.official-limits button,.official-limits .note').count()===0);
await page.getByRole('combobox',{name:'Reference period'}).selectOption('prior');
check('Earlier policy is visible without changing sends',await policyRow('GPT-6 Pro').locator('td').nth(2).innerText()==='200'&&await page.locator('.local-usage table').innerText()===emptyLocalCounts);
await page.getByRole('combobox',{name:'Reference period'}).selectOption('future');
await page.getByRole('combobox',{name:'Plan reference'}).selectOption('pro_100');
check('Pro 100 exposes only the shared numeric reference',await policyRow('Both Pro models combined').locator('td').nth(2).innerText()==='50');
await page.getByRole('combobox',{name:'Plan reference'}).selectOption('pro_500');
check('Unknown Pro 500 counts use dashes',(await page.locator('.official-limits tbody td:last-child').allTextContents()).every(value=>value==='-'));
await page.getByRole('combobox',{name:'Plan reference'}).selectOption('business_premium');
check('Business shared allowance is preserved',await policyRow('Both Pro models combined').locator('td').nth(2).innerText()==='50');
await page.getByRole('combobox',{name:'Plan reference'}).selectOption('pro_200');
await page.evaluate(()=>{window.__fixture.usage={plan:'pro_200',totalMessages:10,models:[{model:'gpt-6-pro',last24Hours:2,last7Days:4},{model:'gpt-5.6-pro',last24Hours:1,last7Days:2},{model:'gpt-6-sol',last24Hours:2,last7Days:3},{model:'gpt-5.6-sol',last24Hours:0,last7Days:0},{model:'pro-unknown',last24Hours:1,last7Days:1}],trackingSince:Date.now()-10000,lastRecordedAt:Date.now(),pendingMessages:1,pendingReceipts:1,incomplete:true,details:[{model:'gpt-6-sol',effort:'high',purpose:'tool-result',last24Hours:1,last7Days:2},{model:'gpt-6-sol',effort:'medium',purpose:'task',last24Hours:1,last7Days:1},{model:'gpt-6-pro',effort:'max',purpose:'task',last24Hours:2,last7Days:4},{model:'gpt-5.6-pro',effort:'max',purpose:'task',last24Hours:1,last7Days:2},{model:'pro-unknown',effort:'unknown',purpose:'unknown',last24Hours:1,last7Days:1}]};});
await page.locator('.local-usage').getByRole('button',{name:'Refresh',exact:true}).click();
await page.getByText('Records may be incomplete',{exact:true}).waitFor();
check('Total equals model counts without adding pending sends or the Pro subtotal',await page.locator('.usage-total-value').innerText()==='10'&&(await page.locator('.local-usage tbody td:last-child').allTextContents()).reduce((sum,value)=>sum+Number(value),0)===10&&await localRow('GPT-6').locator('td').last().innerText()==='3'&&(await page.locator('.local-usage').innerText()).includes('Acceptance unconfirmed')&&(await page.locator('.local-usage').innerText()).includes('awaiting ledger write'));
check('All efforts and purposes remain grouped into one model row',await localRow('GPT-6').count()===1&&await localRow('GPT-6').innerText()==='GPT-6\t2\t3'&&await page.locator('.local-usage details').count()===0);
check('Pro total includes both families and unidentified Pro without Sol',await page.locator('.local-usage tfoot tr').innerText()==='Pro total\t4\t7'&&await localRow('Pro (unknown model)').count()===1);
check('Explanations follow their respective tables',await page.locator('.usagegrid .card').evaluateAll(cards=>cards.every(card=>card.querySelector('.usage-footnote').getBoundingClientRect().top>=card.querySelector('table').getBoundingClientRect().bottom)));
await page.screenshot({path:out+'/usage-en.png',fullPage:true});
check('Reference footer shows only check date and reference notice',await page.locator('.official-limits .usage-footnote').innerText()==='Checked · 2026-10-05 · For reference only');
await page.locator('.language-toggle').click();await page.getByRole('region',{name:'用量与诊断',exact:true}).waitFor();
check('Chinese usage distinguishes local sends and references',await page.getByRole('heading',{name:'本地使用次数',exact:true}).count()===1&&await page.getByRole('heading',{name:'模型限额参考',exact:true}).count()===1);
check('Chinese reference preserves the period and compact footer',(await page.locator('.official-limits').innerText()).includes('2026-10-30 起参考')&&await page.locator('.official-limits .usage-footnote').innerText()==='核对日期 · 2026-10-05 · 仅供参考');
await page.screenshot({path:out+'/usage-zh.png',fullPage:true});
await page.getByRole('combobox',{name:'套餐',exact:true}).click();await page.screenshot({path:out+'/plan-menu-zh.png'});await page.keyboard.press('Escape');
await page.setViewportSize({width:390,height:1050});await page.waitForTimeout(250);
check('Chinese usage fits narrow windows',await page.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth));
await page.screenshot({path:out+'/usage-zh-mobile.png',fullPage:true});
await page.locator('.official-limits').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/usage-zh-mobile-policy.png',fullPage:true});
await page.setViewportSize({width:1440,height:1050});await page.locator('.language-toggle').click();await page.getByRole('region',{name:'Usage & Diagnostics',exact:true}).waitFor();
await page.getByRole('tab',{name:'Health checks',exact:true}).click();await page.locator('.content button.primary').click();await page.locator('.doctor-check-content > p').filter({hasText:'Fixture failure'}).waitFor();check('All failed doctor checks remain visible',await page.locator('.doctor-check-content > p').filter({hasText:'Fixture route warning'}).isVisible());
check('Doctor faults are red and warnings remain neutral',await page.locator('.doctor-check .status-error').count()===1&&await page.locator('.doctor-check .status-neutral').count()===1);
check('Health rows use readable names and distinct failure and warning states',await page.getByRole('heading',{name:'Runtime environment',exact:true}).count()===1&&await page.getByRole('heading',{name:'Codex model route',exact:true}).count()===1&&await page.locator('.doctor-check-status').allTextContents().then(values=>values.join('|')==='Failed|Needs attention'));
await page.locator('.doctor-check-details summary').first().click();
check('Technical details retain the original identifier message and error evidence',await page.locator('.doctor-check-details').first().locator('code').allTextContents().then(values=>values.join('|')==='runtime|Fixture failure|Original fixture diagnostic detail'));
await page.evaluate(()=>{window.__fixture.doctorReport={ok:false,checks:[{id:'dev-tunnel-credentials',status:'error',message:'This mode does not require an MCP tunnel'},{id:'future-check',status:'warning',message:'Unknown fixture diagnostic'}]}});
await page.locator('.content button.primary').click();
check('Not-required text never overrides a failed result and unknown checks remain visible',await page.locator('.doctor-check-status').allTextContents().then(values=>values.join('|')==='Failed|Needs attention')&&await page.getByRole('heading',{name:'Additional check',exact:true}).count()===1&&await page.locator('.doctor-check-content > p').filter({hasText:'Unknown fixture diagnostic'}).isVisible());
await page.evaluate(()=>{window.__fixture.doctorReport={ok:true,mode:'native-tools',checks:[{id:'config',status:'ok',message:'Configuration is valid (fixture/config.json)'},{id:'browser-host',status:'ok',message:'Embedded launcher browser is authenticated and reachable (pid 123)'},{id:'codex',status:'ok',message:'Codex native model route is installed'},{id:'proxy',status:'ok',message:'Responses proxy is healthy on 127.0.0.1:12345'}]}});
await page.locator('.content button.primary').click();
check('Production report names application configuration without adding a DEV check',await page.getByRole('heading',{name:'Application configuration',exact:true}).count()===1&&await page.getByRole('heading',{name:'Development configuration',exact:true}).count()===0&&await page.locator('.doctor-check').count()===4);
await page.evaluate(()=>{window.__fixture.doctorReport={ok:true,mode:'native-tools',checks:[{id:'dev-profile',status:'ok',message:'Isolated DEV harness configuration is valid'},{id:'dev-tunnel-credentials',status:'ok',message:'This mode does not require an MCP tunnel'},{id:'responses-listener',status:'ok',message:'Isolated DEV Responses runtime is ready'}]}});
await page.locator('.content button.primary').click();
check('DEV report distinguishes a component that is not required from passed checks',await page.locator('.doctor-check-status').allTextContents().then(values=>values.join('|')==='Passed|Not required|Passed')&&await page.locator('.doctor-check .status-success').count()===2);
await page.screenshot({path:out+'/health-en.png',fullPage:true});
await page.locator('.language-toggle').click();await page.getByRole('region',{name:'用量与诊断',exact:true}).waitFor();
check('Chinese health checks have semantic names explanations and states',await page.getByRole('heading',{name:'开发环境配置',exact:true}).count()===1&&await page.getByRole('heading',{name:'本地连接服务',exact:true}).count()===1&&await page.getByText('当前模式不需要 MCP 隧道',{exact:true}).isVisible()&&await page.locator('.doctor-check-status').allTextContents().then(values=>values.join('|')==='通过|无需使用|通过'));
await page.screenshot({path:out+'/health-zh.png',fullPage:true});
await page.setViewportSize({width:390,height:1050});await page.waitForTimeout(250);
check('Health names and states fit narrow windows',await page.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth)&&await page.locator('.doctor-check-status').evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().right<=window.innerWidth)));
await page.screenshot({path:out+'/health-zh-mobile.png',fullPage:true});
await page.setViewportSize({width:1440,height:1050});await page.locator('.language-toggle').click();await page.getByRole('region',{name:'Usage & Diagnostics',exact:true}).waitFor();
await page.getByRole('tab',{name:'Logs',exact:true}).click();
check('Logs restore compact event, summary and time rows',await page.locator('.activity-row').count()===2&&await page.locator('.activity-row time').count()===2);
check('Latest log appears first with readable summary',await page.locator('.activity-row').first().locator('strong').textContent()==='Browser connection failed · Error'&&(await page.locator('.activity-row').first().locator('pre').textContent()).includes('retry: false'));
check('Raw JSON log blocks removed',await page.locator('.log').count()===0);
await page.screenshot({path:out+'/logs-en.png'});
for(const width of [1440,900,390]){await page.setViewportSize({width,height:1050});for(const name of ['Overview','Connection & Models','Usage & Diagnostics']){await nav(name);await page.waitForTimeout(200);if(name==='Overview')check(`${width} flow layout preserves readable content`,await page.locator('.usage-flow li').evaluateAll((nodes,width)=>new Set(nodes.map(el=>Math.round(el.getBoundingClientRect().top))).size===(width>560?1:3),width));check(`${width} ${name} no horizontal overflow`,await page.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth));if(name==='Overview')await page.screenshot({path:out+'/overview-en-'+width+'.png',fullPage:true});}await pref('Preferences');check(`${width} Preferences no horizontal overflow`,await page.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth));}
await page.waitForFunction(()=>getComputedStyle(document.querySelector('.surface-transition')).opacity==='1');
await page.screenshot({path:out+'/preferences-en-mobile.png'});
await page.setViewportSize({width:1440,height:1050});await nav('Browser');await page.locator('.browser-surface').waitFor();check('Existing browser toolbar retained',await page.locator('.browser-tab-strip').count()===1);
await nav('Overview');
await page.evaluate(()=>window.__fixture.emitBrowser({status:'running',tabs:[{id:'test-turn',traceId:'test-trace',active:true,status:'running',interactionMode:'automatic',title:'Fixture turn'}]}));
await page.locator('.browser-surface').waitFor();check('Automatic task respects show-browser preference from Overview',true);
await page.evaluate(()=>window.__fixture.emitBrowser({status:'ready',tabs:[]}));
await nav('Overview');await page.evaluate(async()=>{await window.codexWebLauncher.setPreference('showBrowserDuringTurns',false);window.__fixture.emitBrowser({status:'running',tabs:[{id:'second',traceId:'second',active:true,status:'running',interactionMode:'automatic'}]})});
await page.waitForTimeout(250);check('Disabled show-browser preference preserves current page',await page.locator('.overview-intro').count()===1);
await page.evaluate(async()=>{window.__fixture.emitBrowser({status:'ready',tabs:[]});await window.codexWebLauncher.setPreference('coreSetupComplete',false)});await pref('Preferences');await nav('Overview');
check('Usage flow remains visible during first-time setup',await page.locator('.usage-flow li').count()===3&&await page.locator('.usage-flow').isVisible());
await page.evaluate(()=>window.__fixture.emitStartup({status:'preparing',stage:'verifying-copy',elapsedMs:200,completedFiles:2,totalFiles:5}));
await page.getByText('Verifying the installed files',{exact:true}).waitFor();
check('Startup reports measured per-stage progress',await page.locator('.startup-progress progress').getAttribute('value')==='2'&&await page.locator('.startup-progress progress').getAttribute('max')==='5');
check('Startup replaces the entire workspace and navigation',await page.locator('.app-shell,.onboarding').count()===0&&await page.getByRole('navigation').count()===0);
check('Startup identifies file counts as current-stage progress',await page.getByText('Current stage · 2 / 5 files',{exact:true}).count()===1);
check('Startup preserves a native draggable title region',await page.locator('.startup-titlebar').evaluate(el=>getComputedStyle(el).webkitAppRegion==='drag'));
await page.screenshot({path:out+'/startup-progress-en.png'});
await page.evaluate(()=>window.__fixture.emitStartup({status:'preparing',stage:'initializing-browser',elapsedMs:0}));
await page.getByText('Initializing the browser',{exact:true}).waitFor();
check('Unmeasurable stages clear stale file counts and percentages',await page.getByRole('progressbar').getAttribute('aria-valuenow')===null&&await page.locator('.startup-progress progress').count()===0&&!(await page.locator('.startup-progress-detail').textContent()).includes('files'));
await page.emulateMedia({reducedMotion:'reduce'});
check('Activity respects reduced motion',await page.locator('.startup-activity span').evaluate(el=>getComputedStyle(el).animationName==='none'));
await page.emulateMedia({reducedMotion:'no-preference'});
await page.screenshot({path:out+'/startup-activity-en.png'});
await page.evaluate(()=>window.__fixture.emitStartup({status:'failed',stage:'verifying-copy',elapsedMs:300,message:'Fixture disk error'}));
await page.getByRole('button',{name:'Restart',exact:true}).waitFor();
check('Failure stops progress and retains inline diagnostics',await page.getByRole('progressbar').count()===0&&await page.locator('.app-shell').count()===0&&await page.getByRole('button',{name:'Export diagnostic log',exact:true}).isEnabled());
await page.getByText('View details',{exact:true}).click();
check('Failure details expand without entering the workspace',await page.getByText('Fixture disk error',{exact:true}).isVisible());
await page.getByRole('button',{name:'Export diagnostic log',exact:true}).click();
await page.getByText('Diagnostic log exported.',{exact:true}).waitFor();
check('Failure exports through the safe log API',await page.evaluate(()=>window.__fixture.calls.some(call=>call[0]==='exportLogs')));
await page.evaluate(()=>{window.__fixture.cancelExport=true});
await page.getByRole('button',{name:'Export diagnostic log',exact:true}).click();
check('Cancelling export does not report success',await page.getByText('Diagnostic log exported.',{exact:true}).count()===0);
await page.evaluate(()=>{window.__fixture.failExport=true});
await page.getByRole('button',{name:'Export diagnostic log',exact:true}).click();
await page.getByText('Fixture export error',{exact:true}).waitFor();
check('Export failures remain recoverable on the startup screen',await page.getByRole('button',{name:'Restart',exact:true}).isEnabled());
await page.getByRole('button',{name:'Restart',exact:true}).click();
check('Restart uses the existing startup recovery API',await page.evaluate(()=>window.__fixture.calls.some(call=>call[0]==='retryStartup')));
await page.screenshot({path:out+'/startup-failed-en.png'});
await page.evaluate(()=>{window.__fixture.holdSnapshot=true;window.__fixture.emitStartup({status:'ready',stage:'ready',elapsedMs:0})});
check('Ready event waits for the initialized snapshot',await page.locator('.app-shell,.onboarding').count()===0);
await page.evaluate(()=>{window.__fixture.failSnapshot=true;window.__fixture.releaseSnapshots()});
await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
check('Snapshot failure exposes recovery instead of an endless startup indicator',await page.getByRole('progressbar').count()===0&&await page.locator('.app-shell').count()===0);
await page.evaluate(()=>{window.__fixture.failSnapshot=false});
await page.getByRole('button',{name:'Retry',exact:true}).click();
await page.getByRole('region',{name:'Overview',exact:true}).waitFor();
check('Ready snapshot replaces startup with the workspace',await page.locator('.startup-screen').count()===0);

// Exercise real initial renderer mounting as well as events on an already mounted renderer.

// Visual review of the shared system and the About page uses the same isolated IPC fixture.
await nav('About');
check('About retains both README slogan lines',await page.getByRole('heading',{name:'Reason with web models. Get it done in Codex.',exact:true}).count()===1);
check('About explains three capabilities and identifies the current build',await page.locator('.about-capabilities section').count()===3&&(await page.locator('.about-footer').innerText()).includes('Windows · v1.0.0 · DEV'));
await page.getByRole('button',{name:'Documentation',exact:true}).click();
check('Documentation opens the localized repository entry through IPC',await page.evaluate(()=>window.__fixture.calls.some(call=>call[0]==='openExternal'&&call[1]==='https://github.com/cmyk-labs/web2harness/blob/main/README.md#documentation')));
await page.getByRole('button',{name:'Open-source license',exact:true}).click();
check('About retains the project license but omits X and the third-party shortcut',await page.locator('.about-links button').count()===3&&await page.getByRole('button',{name:/Third-party|Project updates/}).count()===0&&await page.evaluate(()=>window.__fixture.calls.some(call=>call[0]==='openExternal'&&call[1]==='https://github.com/cmyk-labs/web2harness/blob/main/LICENSE')));
check('About uses one compact page header without a repeated logo',await page.locator('.about-header h1').textContent()==='About'&&await page.locator('.about-header .brand-mark').count()===0&&await page.locator('.about-header').evaluate(el=>el.getBoundingClientRect().height<80));
check('The operating diagram identifies three components and preserves tool boundaries',await page.locator('.operating-node').count()===3&&await page.locator('.operating-connector').count()===2&&await page.locator('.operating-modes > div').count()===3&&(await page.locator('.operating-loop').innerText()).includes('Codex sandbox and approval rules'));
await page.evaluate(()=>window.__fixture.emitUpdate({status:'available',version:'1.0.1'}));
await page.locator('.row').getByRole('button',{name:'Update to v1.0.1',exact:true}).click();
check('About retains the existing update action',await page.evaluate(()=>window.__fixture.calls.some(call=>call[0]==='installUpdate')));
check('Sidebar displays a blue version update action',await page.locator('.sidebar-update').textContent()==='Update to v1.0.1'&&await page.locator('.sidebar-update').evaluate(el=>getComputedStyle(el).backgroundColor==='rgba(51, 156, 255, 0.14)'));
await page.getByRole('navigation').getByRole('button',{name:'About',exact:true}).focus();
await page.keyboard.press('Tab');
check('Sidebar update is keyboard accessible',await page.locator('.sidebar-update').evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineWidth==='2px'));
const beforeSidebarUpdate=await page.evaluate(()=>window.__fixture.calls.filter(c=>c[0]==='installUpdate').length);
await page.locator('.sidebar-update').click();
check('Sidebar invokes the same update API once',await page.evaluate(()=>window.__fixture.calls.filter(c=>c[0]==='installUpdate').length)===beforeSidebarUpdate+1);
await page.evaluate(()=>window.__fixture.emitOperation({status:'running',name:'fixture',message:'Busy'}));
await page.waitForFunction(()=>document.querySelector('.sidebar-update')?.disabled&&document.querySelector('.update-install')?.disabled);
check('Both update entries are disabled during an operation',await page.locator('.sidebar-update').isDisabled()&&await page.locator('.update-install').isDisabled());
await page.evaluate(()=>window.__fixture.emitOperation({status:'completed',name:'fixture',message:'Done'}));
await page.waitForFunction(()=>!document.querySelector('.sidebar-update')?.disabled);
await page.evaluate(()=>window.__fixture.emitBrowser({status:'running'}));
await page.waitForFunction(()=>document.querySelector('.sidebar-update')?.disabled);
check('Browser turns block sidebar updates',await page.locator('.sidebar-update').isDisabled());
await page.evaluate(()=>window.__fixture.emitBrowser({status:'ready'}));
await page.waitForFunction(()=>!document.querySelector('.sidebar-update')?.disabled);
for(const language of ['en','zh-CN']) {
 if(language==='zh-CN') { await page.locator('.language-toggle').click();await page.getByRole('region',{name:'关于',exact:true}).waitFor(); }
 for(const width of [1440,760]) {
  await page.setViewportSize({width,height:1050});await waitLayout();
  if(await page.locator('.app-shell:not(.is-sidebar-open)').count()) { await page.locator('.app-titlebar .icon-button').first().click();await waitLayout(); }
  check(`Update notice fits sidebar ${language} ${width}`,await page.locator('.sidebar-update').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().bottom<=innerHeight));
  await page.screenshot({path:`${out}/update-${language}-${width}.png`});
 }
 await page.setViewportSize({width:1440,height:1050});await waitLayout();
}
await page.locator('.language-toggle').click();await page.getByRole('region',{name:'About',exact:true}).waitFor();
await page.evaluate(()=>window.__fixture.emitUpdate({status:'downloading',version:'1.0.1'}));
await page.waitForFunction(()=>document.querySelector('.sidebar-update')?.textContent==='Downloading update…');
check('Downloading update cannot be started twice',await page.locator('.update-install').isDisabled());
check('Sidebar shows download progress state',await page.locator('.sidebar-update').isDisabled()&&await page.locator('.sidebar-update').textContent()==='Downloading update…');
await page.evaluate(()=>window.__fixture.emitUpdate({status:'downloading',version:'1.0.1',downloadedBytes:50,totalBytes:100}));
await page.waitForFunction(()=>document.querySelector('.sidebar-update')?.textContent==='Downloading update… 50%');
check('Known download length shows measured percentage',await page.locator('.sidebar-update').textContent()==='Downloading update… 50%');
await page.evaluate(()=>window.__fixture.emitUpdate({status:'installing',version:'1.0.1'}));
await page.waitForFunction(()=>document.querySelector('.sidebar-update')?.textContent==='Installing update…');
check('Sidebar shows installation progress state',await page.locator('.sidebar-update').isDisabled()&&await page.locator('.sidebar-update').textContent()==='Installing update…');
await page.evaluate(()=>window.__fixture.emitUpdate({status:'error',message:'offline'}));
await page.getByRole('button',{name:'Check for updates',exact:true}).click();
await page.getByText('You have the latest stable version.',{exact:true}).waitFor();
check('Manual update retry refreshes status and check time',await page.evaluate(()=>window.__fixture.calls.some(c=>c[0]==='checkUpdate'))&&(await page.locator('.content').innerText()).includes('Last checked:'));
await page.evaluate(()=>window.__fixture.emitUpdate({status:'disabled'}));
await page.waitForFunction(()=>!document.querySelector('.sidebar-update'));
check('Sidebar update stays hidden when no update is available',await page.locator('.sidebar-update').count()===0);
await page.getByRole('button',{name:'Documentation',exact:true}).focus();
await page.keyboard.press('Tab');
check('Keyboard focus is visible on resource controls',await page.getByRole('button',{name:'GitHub repository',exact:true}).evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineWidth==='2px'));
await page.locator('.content').evaluate(el=>{el.scrollTop=0});
await page.screenshot({path:out+'/about-en.png'});
await page.locator('.language-toggle').click();await page.getByRole('region',{name:'关于',exact:true}).waitFor();
check('About has the original Chinese project slogan',(await page.locator('.about-statement h2').innerText()).includes('用 Web 模型推理。'));
await page.getByRole('button',{name:'使用文档',exact:true}).click();
check('Chinese documentation resolves independently',await page.evaluate(()=>window.__fixture.calls.some(call=>call[0]==='openExternal'&&call[1]==='https://github.com/cmyk-labs/web2harness/blob/main/README.zh-CN.md#documentation')));
await page.locator('.operating-diagram').scrollIntoViewIfNeeded();
await page.screenshot({path:out+'/operating-diagram-zh.png'});
await page.locator('.content').evaluate(el=>{el.scrollTop=0});
await page.screenshot({path:out+'/about-zh.png'});
await page.locator('.language-toggle').click();await page.getByRole('region',{name:'About',exact:true}).waitFor();
const contrast=await page.evaluate(()=>{
  const style=getComputedStyle(document.documentElement);
  const luminance=hex=>{const c=hex.trim().slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
  const background=luminance(style.getPropertyValue('--color-background-surface'));
  return ['--color-text-primary','--color-text-secondary','--color-text-tertiary'].map(key=>(luminance(style.getPropertyValue(key))+.05)/(background+.05));
});
check('All three text levels exceed 4.5:1 on the workspace',contrast.every(ratio=>ratio>=4.5));
for(const width of [1440,900,390]){
  await page.setViewportSize({width,height:900});
  await nav('About');await waitLayout();
  await page.locator('.content').evaluate(el=>{el.scrollTop=0});
  check(width+' About has no clipped content',await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:out+'/about-en-'+width+'.png'});
  await page.locator('.operating-diagram').scrollIntoViewIfNeeded();
  check(width+' operating diagram preserves readable nodes',await page.locator('.operating-node').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth)));
  await page.screenshot({path:out+'/operating-diagram-en-'+width+'.png'});
}
await page.setViewportSize({width:1280,height:720});
for(const name of ['Overview','Runtime controls','Connection & Models','Preferences','Usage & Diagnostics','About']){
  await nav(name);await waitLayout();
  check(name+' has one heading and usable compact desktop layout',await page.locator('.content h1').count()===1&&await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:out+'/desktop-'+name.replaceAll(/[^a-z]/gi,'').toLowerCase()+'.png'});
}
await nav('Usage & Diagnostics');await page.getByRole('tab',{name:'Usage',exact:true}).focus();await page.keyboard.press('ArrowRight');
check('Diagnostics supports keyboard tab selection',await page.getByRole('tab',{name:'Health checks',exact:true}).getAttribute('aria-selected')==='true');
await page.keyboard.press('End');check('Diagnostics End key opens logs',await page.getByRole('tab',{name:'Logs',exact:true}).getAttribute('aria-selected')==='true');
await page.emulateMedia({reducedMotion:'reduce'});
await page.locator('.app-titlebar .icon-button').first().click();
check('Collapsed navigation is excluded from keyboard interaction',await page.locator('#workspace-sidebar').getAttribute('inert')!==null);
check('Navigation toggle exposes its expanded state',await page.locator('.app-titlebar .icon-button').first().getAttribute('aria-expanded')==='false');
await page.locator('.app-titlebar .icon-button').first().click();
await page.emulateMedia({reducedMotion:'no-preference'});
await nav('Browser');await page.locator('.browser-surface').waitFor();
await page.screenshot({path:out+'/browser-en.png'});
await page.setViewportSize({width:390,height:900});await waitLayout();
check('Browser toolbar controls fit a narrow window',await page.locator('.browser-toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth));
await page.screenshot({path:out+'/browser-en-mobile.png'});
await page.setViewportSize({width:1440,height:1050});
await nav('Runtime controls');
check('Runtime controls follows Browser in the workspace sidebar',JSON.stringify(await page.getByRole('region',{name:'Workspace',exact:true}).getByRole('button').allTextContents())===JSON.stringify(['Overview','Browser','Runtime controls']));
check('DEV omits integration removal and explains the restriction',await page.getByRole('button',{name:'Remove Codex integration',exact:true}).count()===0&&await page.getByText('DEV uses a separate configuration. Integration removal is unavailable here.',{exact:true}).isVisible());
await nav('Usage & Diagnostics');
await page.getByRole('tab',{name:'Health checks',exact:true}).click();
check('Health checks no longer contain runtime mutation actions',await page.getByRole('button',{name:'Cancel active Codex turn',exact:true}).count()===0&&await page.getByRole('heading',{name:'Runtime controls',exact:true}).count()===0);

// Test the regular-profile presentation through mocked IPC only. No installed
// application, native confirmation dialog or real integration is controlled.
const controlsPage = await context.newPage();
controlsPage.on('pageerror', error => errors.push(error.message));
await controlsPage.goto(`${origin}/?production-ui`);
await controlsPage.getByRole('navigation').getByRole('button', { name: '运行控制', exact: true }).click();
await controlsPage.getByRole('region', { name: '运行控制', exact: true }).waitFor();
const waitControlsLayout = () => controlsPage.waitForFunction(() => {
  const shell = document.querySelector('.app-shell');
  const sidebar = document.querySelector('.app-sidebar');
  const target = shell.classList.contains('is-sidebar-open')
    ? parseFloat(getComputedStyle(sidebar).getPropertyValue('--sidebar-width')) : 0;
  return window.matchMedia('(max-width:820px)').matches === shell.classList.contains('is-compact')
    && Math.abs(sidebar.getBoundingClientRect().width - target) < .5
    && Number(getComputedStyle(document.querySelector('.surface-transition')).opacity) > .99;
});
await waitControlsLayout();
check('Runtime controls has three state summaries and two separate actions',await controlsPage.locator('.runtime-control-status .card').count()===3&&await controlsPage.locator('.panel .row button').count()===2);
await controlsPage.setViewportSize({ width: 1280, height: 720 });
await waitControlsLayout();
await controlsPage.screenshot({ path: out + '/runtime-controls-zh.png' });
await controlsPage.locator('.language-toggle').click();
await controlsPage.getByRole('region', { name: 'Runtime controls', exact: true }).waitFor();
check('Both runtime actions are visible in a 720px desktop window',await controlsPage.locator('.panel .row button').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().bottom<=window.innerHeight)));
await controlsPage.screenshot({ path: out + '/runtime-controls-en.png' });
await controlsPage.setViewportSize({ width: 390, height: 900 });
await waitControlsLayout();
check('Runtime controls fits a narrow window',await controlsPage.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth));
await controlsPage.screenshot({ path: out + '/runtime-controls-en-mobile.png' });
await controlsPage.getByRole('button', { name: 'Remove Codex integration', exact: true }).scrollIntoViewIfNeeded();
await controlsPage.screenshot({ path: out + '/runtime-controls-en-mobile-actions.png' });
await controlsPage.setViewportSize({ width: 1280, height: 720 });
await waitControlsLayout();
const cancelTurn = controlsPage.getByRole('button', { name: 'Cancel active Codex turn', exact: true });
const removeIntegration = controlsPage.getByRole('button', { name: 'Remove Codex integration', exact: true });
await controlsPage.evaluate(() => {
  window.__fixture.patch({ showBrowserDuringTurns: false });
  window.__fixture.emitBrowser({ status: 'running', tabs: [] });
  window.__fixture.holdCancel = true;
});
await controlsPage.getByText('Processing tasks', { exact: true }).waitFor();
check('An active task can be cancelled but prevents integration removal',await cancelTurn.isEnabled()&&await removeIntegration.isDisabled());
await cancelTurn.click();
const cancelling = controlsPage.getByRole('button', { name: 'Cancelling…', exact: true });
await cancelling.waitFor();
check('Cancellation disables repeated submission and removal',await cancelling.isDisabled()&&await removeIntegration.isDisabled());
await cancelling.evaluate(button => button.click());
check('A repeated click does not send a second cancellation',await controlsPage.evaluate(()=>window.__fixture.calls.filter(call=>call[0]==='cancelTurns').length===1));
await controlsPage.evaluate(() => { window.__fixture.holdCancel = false; window.__fixture.releaseCancel(); });
await controlsPage.getByText('Active Codex turn cancelled', { exact: true }).waitFor();
await cancelTurn.waitFor();
check('Cancellation preserves integration and updates observed activity',await controlsPage.evaluate(()=>window.__fixture.status.configured)&&await controlsPage.getByText('No observed active tasks',{exact:true}).isVisible());
await controlsPage.evaluate(() => { window.__fixture.failCancel = true; });
await cancelTurn.click();
await controlsPage.getByText('Fixture cancellation failed', { exact: true }).waitFor();
check('Cancellation failure does not show a success notification',await controlsPage.locator('.feedback').count()===0&&await cancelTurn.isEnabled());
await controlsPage.evaluate(() => {
  window.__fixture.failCancel = false;
  window.__fixture.emitOperation({ name: 'fixture', status: 'running', message: 'Fixture operation' });
});
await controlsPage.getByText('Operation in progress', { exact: true }).waitFor();
check('An in-progress operation blocks conflicting actions',await cancelTurn.isDisabled()&&await removeIntegration.isDisabled());
await controlsPage.evaluate(() => window.__fixture.emitOperation({ name: 'fixture', status: 'completed', message: 'Fixture operation completed' }));
await controlsPage.waitForFunction(() => !document.querySelector('.panel .row button').disabled);
await removeIntegration.click();
await controlsPage.waitForFunction(() => [...document.querySelectorAll('.panel .row button')].some(button=>button.textContent==='Remove Codex integration'&&!button.disabled));
check('Declining native removal preserves integration without success feedback',await controlsPage.evaluate(()=>window.__fixture.status.configured&&window.__fixture.state.coreSetupComplete)&&await controlsPage.locator('.feedback').count()===0);
await controlsPage.evaluate(() => { window.__fixture.failRemoval = true; });
await removeIntegration.click();
await controlsPage.getByText('Fixture removal failed', { exact: true }).waitFor();
check('Failed removal preserves integration without success feedback',await controlsPage.evaluate(()=>window.__fixture.status.configured)&&await controlsPage.locator('.feedback').count()===0);
await controlsPage.evaluate(() => {
  window.__fixture.failRemoval = false;
  window.__fixture.failStatus = true;
  window.__fixture.patch({});
  window.__fixture.emitBrowser({ status: 'error' });
});
await controlsPage.getByText('Status unavailable', { exact: true }).waitFor();
check('Missing status is explicit rather than reported as idle or ready',await controlsPage.getByText('Status unknown',{exact:true}).isVisible()&&await controlsPage.getByText('Not confirmed',{exact:true}).isVisible());
await controlsPage.evaluate(() => {
  window.__fixture.failStatus = false;
  window.__fixture.confirmRemoval = true;
  window.__fixture.emitBrowser({ status: 'ready' });
  window.__fixture.patch({});
});
await removeIntegration.click();
await controlsPage.getByText('Integration removed; restart Codex once', { exact: true }).waitFor();
check('Confirmed removal applies returned state and refreshes connection status',await controlsPage.evaluate(()=>!window.__fixture.status.configured&&!window.__fixture.state.coreSetupComplete)&&await controlsPage.locator('.runtime-control-status').getByText('Not configured',{exact:true}).count()>0);
await controlsPage.close();
const startupPage=await context.newPage();startupPage.on('pageerror',e=>errors.push(e.message));
for(const firstRun of [false,true]){
 await startupPage.goto(`${origin}/?preparing${firstRun?'&first-run':''}`);
 await startupPage.getByText('正在检查本地安装',{exact:true}).waitFor();
 check(`Initial startup gates ${firstRun?'onboarding':'workspace'}`,await startupPage.locator('.app-shell,.onboarding').count()===0&&!await startupPage.evaluate(()=>window.__fixture.prematureContent));
 check(`Initial startup uses ${firstRun?'system':'saved'} language`,await startupPage.locator('.startup-subtitle').textContent()==='正在启动工作空间'&&await startupPage.locator('html').getAttribute('lang')==='zh-CN');
 check('Warm path omits installation explanation',(await startupPage.locator('.startup-hint').textContent()).trim()==='');
 await startupPage.evaluate(()=>window.__fixture.emitStartup({status:'preparing',stage:'verifying-source',elapsedMs:200,completedFiles:697,totalFiles:3944}));
 await startupPage.getByText('当前阶段 · 697 / 3,944 个文件',{exact:true}).waitFor();
 await startupPage.setViewportSize({width:732,height:492});
 await startupPage.screenshot({path:out+`/startup-progress-zh-${firstRun?'first-run':'returning'}.png`});
 check('Startup fits compact windows without horizontal overflow',await startupPage.locator('.startup-screen').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await startupPage.evaluate(()=>window.__fixture.emitStartup({status:'ready',stage:'ready',elapsedMs:0}));
 await startupPage.locator(firstRun?'.onboarding':'.app-shell').waitFor();
 if(firstRun){
   await startupPage.screenshot({path:out+'/onboarding-zh.png'});
   await startupPage.getByRole('radio',{name:'简体中文',exact:true}).focus();await startupPage.keyboard.press('ArrowRight');
   check('First-run language selection supports the keyboard',await startupPage.getByRole('radio',{name:'English',exact:true}).getAttribute('aria-checked')==='true');
   await startupPage.setViewportSize({width:1280,height:720});
   await startupPage.screenshot({path:out+'/onboarding-en.png'});
   check('First-run setup has no inactive sidebar control',await startupPage.locator('.app-titlebar .icon-button').count()===0);
 }
 check(`Ready startup opens ${firstRun?'onboarding':'workspace'}`,await startupPage.locator('.startup-screen').count()===0&&!await startupPage.evaluate(()=>window.__fixture.prematureContent));
}
await startupPage.close();
const welcomePage = await context.newPage();
welcomePage.on('pageerror', error => errors.push(error.message));
await welcomePage.goto(`${origin}/?first-run&production-ui`);
await welcomePage.getByRole('button', { name: '跳过，开始配置', exact: true }).waitFor();
await welcomePage.setViewportSize({ width: 1280, height: 720 });
await welcomePage.screenshot({ path: out + '/welcome-star-zh.png' });
check('First-use invitation is optional and does not open GitHub automatically',await welcomePage.evaluate(()=>window.__fixture.calls.every(call=>call[0]!=='openRepository'))&&await welcomePage.getByRole('button',{name:'跳过，开始配置',exact:true}).isEnabled());
await welcomePage.getByRole('radio', { name: 'English', exact: true }).click();
await welcomePage.setViewportSize({ width: 390, height: 900 });
check('The first-use invitation fits a narrow window',await welcomePage.locator('.ui-page').evaluate(el=>el.scrollWidth<=el.clientWidth));
await welcomePage.screenshot({ path: out + '/welcome-star-en-mobile.png' });
await welcomePage.evaluate(() => { window.__fixture.failOnboarding = true; });
await welcomePage.getByRole('button', { name: 'Skip and start setup', exact: true }).click();
await welcomePage.getByText('Fixture onboarding failed', { exact: true }).waitFor();
check('Failed completion retains the welcome screen for retry',await welcomePage.locator('.onboarding').count()===1&&!await welcomePage.evaluate(()=>window.__fixture.state.onboardingComplete));
await welcomePage.evaluate(() => { window.__fixture.failOnboarding = false; });
await welcomePage.getByRole('button', { name: 'Skip and start setup', exact: true }).click();
await welcomePage.getByRole('region', { name: 'Overview', exact: true }).waitFor();
check('Skipping completes onboarding without claiming a repository visit',await welcomePage.evaluate(()=>window.__fixture.state.onboardingComplete&&!window.__fixture.state.githubOpened&&window.__fixture.state.language==='en'));
await welcomePage.goto(`${origin}/?first-run&production-ui`);
await welcomePage.getByRole('button', { name: '在 GitHub 上 Star', exact: true }).waitFor();
await welcomePage.evaluate(() => { window.__fixture.failRepository = true; });
await welcomePage.getByRole('button', { name: '在 GitHub 上 Star', exact: true }).click();
await welcomePage.getByText('Fixture repository opening failed', { exact: true }).waitFor();
check('A failed repository launch leaves the skip path available',await welcomePage.getByRole('button',{name:'跳过，开始配置',exact:true}).isEnabled()&&!await welcomePage.evaluate(()=>window.__fixture.state.githubOpened));
await welcomePage.evaluate(() => {
  window.__fixture.failRepository = false;
  window.__fixture.holdRepository = true;
});
await welcomePage.getByRole('button', { name: '在 GitHub 上 Star', exact: true }).click();
const openingRepository = welcomePage.getByRole('button', { name: '正在打开…', exact: true });
await openingRepository.waitFor();
await openingRepository.evaluate(button => button.click());
check('Pending repository opening prevents duplicate IPC calls',await openingRepository.isDisabled()&&await welcomePage.evaluate(()=>window.__fixture.calls.filter(call=>call[0]==='openRepository').length===2));
await welcomePage.evaluate(() => { window.__fixture.holdRepository = false; window.__fixture.releaseRepository(); });
await welcomePage.getByRole('button', { name: '继续配置', exact: true }).waitFor();
check('Opening the repository never pretends that a Star was verified',await welcomePage.locator('.onboarding-repository-opened').isVisible()&&await welcomePage.evaluate(()=>window.__fixture.state.githubOpened&&!window.__fixture.state.onboardingComplete));
await welcomePage.getByRole('button', { name: '继续配置', exact: true }).click();
await welcomePage.getByRole('region', { name: '概览', exact: true }).waitFor();
check('Continue after visiting GitHub enters the workspace',await welcomePage.locator('.onboarding').count()===0&&await welcomePage.evaluate(()=>window.__fixture.state.onboardingComplete));
await welcomePage.close();
check('Renderer has no JavaScript errors',errors.length===0);
await writeFile(out+'/results.json',JSON.stringify({passed:checks.length,checks,metrics,errors},null,2));console.log(JSON.stringify({passed:checks.length,metrics,errors}));
}catch(error){
 await writeFile(out+'/failure.json',JSON.stringify({message:error.message,checks,errors},null,2));
 throw error;
}finally{await browser.close();await new Promise(resolve=>listener.close(resolve));await server.close()}
