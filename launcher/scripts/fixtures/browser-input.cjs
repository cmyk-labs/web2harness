const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { BrowserHost } = require("../../electron/browser/browser-host.cjs");
const profile = path.resolve(process.env.WEB2HARNESS_INPUT_FIXTURE_PROFILE || "missing");
if (!path.basename(profile).startsWith("input-profile-")) throw new Error("Expected an owned input fixture profile");
app.setPath("userData", profile);
app.setName("Web2Harness input fixture");
process.on("uncaughtException", error => { console.error(error); app.exit(1); });
process.on("unhandledRejection", error => { console.error(error); app.exit(1); });
const html = `<!doctype html><meta charset="utf-8"><title>Input fixture page</title>
  <style>body{background:#1b1f24;color:#eee;font:18px system-ui;margin:24px;height:1800px}input,button{font:18px system-ui;padding:12px;margin:10px 10px 10px 0}#report{white-space:pre-wrap}#modelmenu[hidden]{display:none}</style>
  <h2>Task page — local fixture</h2><input id="input" placeholder="Text input"><button id="click" onclick="clicks++;report()">Count click</button>
  <button id="models" onclick="document.querySelector('#modelmenu').hidden=false">Models</button>
  <div id="modelmenu" hidden><button id="model" onclick="chosen++;report()">Fixture model</button></div>
  <input id="file" type="file"><p id="report"></p>
  <script>window.clicks=0;window.chosen=0;window.keys=0;function report(){document.querySelector('#report').textContent=JSON.stringify({clicks,chosen,keys,value:document.querySelector('#input').value,scroll:scrollY})}addEventListener('keydown',()=>{keys++;report()});addEventListener('input',report);addEventListener('scroll',report);addEventListener('resize',()=>document.querySelector('#modelmenu').hidden=true);report()</script>`;
app.whenReady().then(async () => {
  const win = new BrowserWindow({width:1000,height:700,show:false,title:"Web2Harness input fixture",webPreferences:{sandbox:true,contextIsolation:true}});
  win.setMenu(null);
  await win.loadURL("data:text/html,"+encodeURIComponent('<title>Web2Harness input fixture</title><body style="background:#15191e;color:white;font:18px system-ui"><h3>Isolated browser input fixture</h3>'));
  const host = new BrowserHost({window:win,descriptorPath:path.join(profile,"descriptor.json"),cdpPort:0,control:{},helper:{},
    logger:{info(){},warn(){},error:console.error},getConnectorName:()=>"fixture",loginWithPasskey:async()=>{},
    profile:"development",partition:"persist:web2harness-dev-chatgpt",getLanguage:()=>global.fixtureLanguage || "zh-CN",
    cancelTurn:async()=>({status:"ok"}),getBrowserInteractionMode:()=>global.fixtureMode || "automatic"});
  await host.ready();
  host.setBounds({x:20,y:65,width:950,height:560});
  await host.view.webContents.loadURL("data:text/html,"+encodeURIComponent(html)+"#home");
  const owned = await host.beginTurn("fixture_trace_one",false,process.pid,"a".repeat(64));
  const tab = host.turnTabs.get(owned.tabId);
  await tab.view.webContents.loadURL("data:text/html,"+encodeURIComponent(html)+"#task");
  win.showInactive(); host.show();
  global.inputFixture={win,host,tab,html};
  win.on("closed",()=>host.destroy());
});
app.on("window-all-closed",()=>app.quit());
