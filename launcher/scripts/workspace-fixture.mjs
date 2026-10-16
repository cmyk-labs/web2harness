// Presentation fixture only. Never used by a production or DEV runtime.
export const installWorkspaceFixture = ()=>{
 const listeners={};const state={version:1,language:'zh-CN',onboardingComplete:true,browserInteractionMode:'automatic',sidebarOpen:true,sidebarWidth:224,mcpGuideStep:0,sessionRefreshReminderAt:null,mcpRuntimeInstalled:false,mcpSetupComplete:false,coreSetupComplete:true,codexCatalogVerified:true,experimentalContextFiles:false,contextPreferenceSources:{files:"user",budget:"default"},experimentalContextTripleBudget:false,experimentalSkillAttachments:false,experimentalFreshConversationPerTurn:false,useSavedChats:false,keepRunningOnClose:true,showBrowserDuringTurns:true,autoStart:false,zeroRiskProEnabled:false};
 const browser={status:'ready',authenticated:true,visible:false,tabs:[],activeTabId:'idle',maxTabs:5,zoomFactor:1};
 const status={configured:true,mode:'native-tools',interactionMode:'automatic',runtimeStatus:'ready',credentials:{automatic:false,manual:false},capabilities:{solAvailable:true,proAvailable:true,browserInteractionMode:'automatic'}};
 const snapshot={startup:{status:'ready',stage:'ready',elapsedMs:0},profile:'development',profilePaths:{coreHome:'fixture',codexHome:'fixture',userData:'fixture'},state,browser,connectorName:'DEV fixture',connectorNames:{automatic:'DEV fixture',manual:'Manual fixture'},mcpCredentialsConfigured:false,logs:[{at:'2026-09-30T08:30:00Z',event:'runtime.started',level:'info',detail:{mode:'native-tools',status:'ready',port:12345}},{at:'2026-09-30T08:31:00Z',event:'browser.connection_failed',level:'error',detail:{message:'Fixture connection error',retry:false,traceId:'trace-fixture',durationMs:1234,errorDescription:'ERR_CONNECTION_RESET'}}],urls:{github:'https://example.invalid',connectors:'https://example.invalid',tunnels:'https://example.invalid',keys:'https://example.invalid'},platform:'win32',packaged:false,version:'1.0.0',smokePassed:true,operation:null,update:{status:'disabled'}};
 window.__fixture={state,status,snapshot,browser,calls:[],failApply:false,emitStartup:startup=>{snapshot.startup=startup;listeners.onStartupState?.(structuredClone(startup))},emitBrowser:delta=>{Object.assign(browser,delta);listeners.onBrowserState?.(structuredClone(browser))}};
 state.logPageSize=100;
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
 const license=window.__fixture.license={state:'active',deviceCode:'W2D1-WIN-'+'a'.repeat(64),licenseId:'fixture',expiresAt:null};
 state.requestScheduling={maxConcurrent:4,queueTimeoutMinutes:15,minSendIntervalSeconds:3};state.requestSchedulingRevision=1;
 window.codexWebLauncher=new Proxy({
 queueStatus:async()=>({status:'ready',savedRevision:state.requestSchedulingRevision,settings:state.requestScheduling,scheduler:{settings:state.requestScheduling,configRevision:state.requestSchedulingRevision,active:0,waiting:0,groups:[],pauseReasons:[],pausedReason:null}}),
 queryQueue:async(query)=>({items:[],groups:[],total:0,offset:query.offset??0,limit:query.limit??50,snapshotId:'fixture-queue'}),
 saveQueueSettings:async(value,revision)=>{window.__fixture.calls.push(['saveQueueSettings',value,revision]);if(window.__fixture.holdQueueSave)await new Promise(resolve=>window.__fixture.releaseQueueSave=resolve);if(window.__fixture.failQueueSave)throw new Error('Fixture queue save failed');if(revision!==state.requestSchedulingRevision)throw new Error('Queue settings changed');const saved=patch({requestScheduling:value,requestSchedulingRevision:revision+1});return {state:saved,persistedRevision:revision+1,appliedRevision:window.__fixture.failQueueApply?revision:revision+1,applyState:window.__fixture.failQueueApply?'apply-failed':'applied'}},
 controlQueue:async action=>{window.__fixture.calls.push(['controlQueue',action]);return {}},
 licenseStatus:async()=>({...license}),
 importLicense:async code=>{if(window.__fixture.failLicenseImport)throw new Error('Fixture import unavailable');return code==='fixture-valid'?{...license}:{...license,state:'invalid'}},
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
 queryLogs:async(query={})=>{
   window.__fixture.calls.push(['queryLogs',query]);
   if(window.__fixture.expireLogs)return {records:[],total:0,available:{start:null,end:null},partial:false,expired:true};
   const all=(window.__fixture.logRecords??snapshot.logs).map((record,index)=>({...record,id:String(index),source:record.event.startsWith('browser')?'browser':'runtime'}));
   const filtered=all.filter(record=>(!query.level||query.level==='all'||record.level===query.level)&&(!query.source||query.source==='all'||record.source===query.source)&&(!query.search||JSON.stringify(record).toLowerCase().includes(query.search.toLowerCase()))&&(!query.before||record.at<=query.before)&&(!query.correlation||record.detail[query.correlation.field]===query.correlation.value)).reverse();
   const offset=Number(query.cursor??0),limit=query.pageSize??100,records=[];let bytes=0;
   for(const record of filtered.slice(offset,offset+limit)){const size=new TextEncoder().encode(JSON.stringify(record)+'\n').length;if(records.length&&bytes+size>512*1024)break;records.push(record);bytes+=size}
   const next=offset+records.length;
   if(query.cursor===undefined)window.__fixture.logStarts=[0];
   const starts=window.__fixture.logStarts??=[0];if(!starts.includes(next))starts.push(next);
   return {records,total:filtered.length,offset,cursor:String(offset),nextCursor:next<filtered.length?String(next):null,previousCursor:offset?String(starts[starts.indexOf(offset)-1]??0):null,available:{start:all[0]?.at??null,end:all.at(-1)?.at??null},partial:false};
 },
 exportLogs:async(range)=>{window.__fixture.calls.push(['exportLogs',range]);if(window.__fixture.failExport)throw new Error('Fixture export error');return window.__fixture.cancelExport?null:{path:'fixture-diagnostics.zip',partial:window.__fixture.partialExport??false,recordCount:2}},
 getLimits:async()=>({...{enabled:true,trackingSince:null,checkedAt:null,plan:null,totalMessages:0,unknownProMessages:0,incomplete:false,gapAt:null,models:["gpt-6-pro","gpt-5.6-pro","gpt-6-sol","gpt-5.6-sol"].map(model=>({model,last24Hours:0,last7Days:0})),windows:[]},...window.__fixture.usage}),
 setSidebarState:async ({open,width})=>patch({sidebarOpen:open,sidebarWidth:width}),
 setLanguage:async language=>patch({language}),setPreference:async(key,value)=>{if(key==='logPageSize'&&window.__fixture.failLogPageSize)throw Error('Fixture preference save failed');return patch({[key]:value})},setContextFiles:async value=>patch({experimentalContextFiles:value,...(!value?{experimentalContextTripleBudget:false}:{})}),setContextTripleBudget:async value=>patch({experimentalContextTripleBudget:value}),setSkillAttachments:async value=>patch({experimentalSkillAttachments:value}),setFreshConversationPerTurn:async value=>patch({experimentalFreshConversationPerTurn:value}),setUseSavedChats:async value=>patch({useSavedChats:value}),
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
};
