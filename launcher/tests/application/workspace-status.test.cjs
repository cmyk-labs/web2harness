const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {workspaceStatus,readRuntimeKeyFile}=require('../../electron/workspace-status.cjs');

test('workspace status exposes only approved capability fields and checks runtime ownership',()=>{
 const host={supervisor:{readState:()=>({ownerPid:process.pid,status:'ready'})},runtimeConfigSnapshot:()=>({configured:true,mode:'native-tools',config:{browserInteractionMode:'automatic',solAvailable:true,proAvailable:true,runtimeKey:'never expose'}}),mcpCredentialsConfigured:mode=>mode==='automatic'};
 const result=workspaceStatus(host);
 assert.equal(result.capabilities.solAvailable,true);assert.equal(result.capabilities.proAvailable,true);
 assert.equal(result.runtimeStatus,'ready');assert.equal(JSON.stringify(result).includes('never expose'),false);
 assert.deepEqual(Object.keys(result.capabilities).sort(),['browserInteractionMode','experimentalContextFiles','experimentalContextTripleBudget','extraHighAvailable','proAvailable','solAvailable','zeroRiskProEnabled']);
 host.supervisor.readState=()=>({ownerPid:process.pid+1,status:'ready'});assert.equal(workspaceStatus(host).runtimeStatus,'unknown');
 host.supervisor.readState=()=>{throw Error('unreadable')};assert.equal(workspaceStatus(host).runtimeStatus,'unknown');
 host.runtimeConfigSnapshot=()=>({configured:false});host.browserInteractionMode=()=> 'automatic';assert.equal(workspaceStatus(host).capabilities,null);
});
test('runtime key files reject directories, oversized files, multiline contents and relative paths',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-key-'));const file=path.join(root,'key.txt');
 try{
  assert.throws(()=>readRuntimeKeyFile('relative.txt'),/absolute/);assert.throws(()=>readRuntimeKeyFile(root),/Invalid/);
  fs.writeFileSync(file,'fixture-key-'+ 'x'.repeat(30));assert.equal(readRuntimeKeyFile(file),'fixture-key-'+'x'.repeat(30));
  fs.writeFileSync(file,'x'.repeat(17000));assert.throws(()=>readRuntimeKeyFile(file),/Invalid/);
  fs.writeFileSync(file,'x'.repeat(30)+'\nsecond');assert.throws(()=>readRuntimeKeyFile(file),/single key/);
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(root)}
});

test('onboarding no longer requires opening social links',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../electron/main.cjs'),'utf8');
 const start=source.indexOf('handle("launcher:complete-onboarding"');
 const end=source.indexOf('\n  handle(',start+8);
 assert.doesNotMatch(source.slice(start,end),/githubOpened|xOpened|openWebUrl/);
 assert.match(source.slice(start,end),/validateLanguage/);
});
