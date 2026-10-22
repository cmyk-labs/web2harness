import { expect, spyOn, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import * as session from "../../../../src/browser/session";
import { ChatGptBrowserWorker } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { ChatGptModelMenuRecovery } from "../../../../src/adapters/chatgpt-web/browser/model-menu-recovery";
import * as modelSelection from "../../../../src/adapters/chatgpt-web/browser/model-selection";

// Owned, temporary Chromium profile and local DOM only; every network request is blocked.
async function fixture(page: Page, fault: "once" | "twice" | "locked" | "unsupported" | "mismatch" | "none") {
  await page.route("**/*", route => route.abort());
  await page.setContent(`<form><div id="prompt-textarea" contenteditable="true">Draft</div>
    <button type="button" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="false">High</button></form>
    <div id="picker" role="menu" hidden><div role="menuitemradio" aria-checked="true">Latest</div>
    <span id="announcement">6 High, 3 of 4.</span>
    <div role="menuitem" tabindex="0" aria-describedby="announcement"><div data-model-picker-power-slider style="width:250px;height:30px"></div></div></div>
    <script>
      const fault=${JSON.stringify(fault)}, control=document.querySelector('button'), menu=document.querySelector('#picker');
      window.fixture={opens:0,arrows:0,submissions:0};
      function close(){menu.hidden=true;control.setAttribute('aria-expanded','false');control.textContent='High';}
      control.onclick=()=>{
        window.fixture.opens++; menu.hidden=false;control.setAttribute('aria-expanded','true');
        const container=document.querySelector('[data-model-picker-power-slider]');
        const max=fault==='unsupported'?1:3,value=fault==='mismatch'?1:Math.min(2,max);
        container.innerHTML='<span data-orientation="horizontal" aria-disabled="false">'
          +Array.from({length:max+1},(_,i)=>'<span data-selected="'+(i<=value)+'"'+(fault==='locked'&&i===2?' data-locked="true"':'')+'></span>').join('')
          +'<span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="'+max+'" aria-valuenow="'+value+'"></span></span>';
        const original=Element.prototype.querySelectorAll;
        container.querySelectorAll=function(selector){
          const result=original.call(this,selector);
          if(selector==='[data-selected]'&&(fault==='twice'||fault==='once'&&window.fixture.opens===1)) {
            this.querySelectorAll=original;queueMicrotask(close);
          }
          return result;
        };
      };
      document.querySelector('form').onsubmit=e=>{e.preventDefault();window.fixture.submissions++;};
      document.addEventListener('keydown',e=>{if(e.key==='Escape')close();else if(e.key.startsWith('Arrow'))window.fixture.arrows++;});
    </script>`);
}

for (const fault of ["once", "twice", "locked", "unsupported"] as const)
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`worker model selection handles ${fault} without downgrading or sending`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  const read = session.readChatGptEffortSnapshot;
  // Keep actual locator reads and DOM state, shortening only the fixture's failure deadline.
  const snapshot = spyOn(session, "readChatGptEffortSnapshot").mockImplementation((container, _timeout, signal) => read(container, 3_000, signal));
  try {
    const page = await browser.newPage();
    await fixture(page, fault);
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const result = worker.selectModelAndEffort(page, "gpt-5.6-sol", "high", {
      localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
    }, undefined, false, "6");
    if (fault === "once") expect(await result).toMatchObject({ modelFamily: "6", effort: "high", selection: { label: "High" } });
    else if (fault === "twice") await expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    else await expect(result).rejects.toMatchObject({ retryable: false });
    expect(await page.evaluate(() => (window as any).fixture)).toEqual({ opens: ["once", "twice"].includes(fault) ? 2 : 1, arrows: 0, submissions: 0 });
    expect(await page.locator('#prompt-textarea').innerText()).toBe("Draft");
  } finally { snapshot.mockRestore(); await browser.close(); }
}, 60_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("preflight reopens a vanished menu and re-verifies the exact family and effort", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  const assertFamily = modelSelection.assertChatGptModelFamily;
  const verification = spyOn(modelSelection, "assertChatGptModelFamily").mockImplementation((menu, family, effort, index, _settle, signal) =>
    assertFamily(menu, family, effort, index, 500, signal));
  try {
    const page = await browser.newPage(); await fixture(page, "once");
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    await worker.assertSelectedEffort(page, {
      selection: { url: page.url(), label: "High" }, modelFamily: "6", effort: "high", uiEffortIndex: 2,
    });
    expect(await page.evaluate(() => (window as any).fixture)).toEqual({ opens: 2, arrows: 0, submissions: 0 });
    expect(await page.locator('#prompt-textarea').innerText()).toBe("Draft");
    expect(await page.locator('button').getAttribute('aria-expanded')).toBe("false");
  } finally { verification.mockRestore(); await browser.close(); }
}, 60_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("preflight rejects a real effort mismatch without reopening or changing it", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage(); await fixture(page, "mismatch");
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    await expect(worker.assertSelectedEffort(page, {
      selection: { url: page.url(), label: "High" }, modelFamily: "6", effort: "high", uiEffortIndex: 2,
    })).rejects.toMatchObject({ retryable: false });
    expect(await page.evaluate(() => (window as any).fixture)).toEqual({ opens: 1, arrows: 0, submissions: 0 });
  } finally { await browser.close(); }
}, 30_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("a rebuilt container is recovered while a zero-width semantic slider is not a closed menu", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage(); await fixture(page, "none");
    const control = page.locator('button');
    const recovery = new ChatGptModelMenuRecovery();
    let attempts = 0;
    await recovery.run(async () => {
      const menu = await session.activateChatGptEffortMenu(page, control);
      const read = await recovery.observe(page, control, menu);
      await read(async () => {
        if (++attempts === 1) {
          await menu.sliderContainer.evaluate(element => element.replaceWith(element.cloneNode(true)));
          throw Object.assign(new Error("Fixture read during remount"), { name: "TimeoutError" });
        }
        expect(await menu.slider.isVisible()).toBeFalse();
        expect(await session.readChatGptEffortSnapshot(menu.sliderContainer)).toMatchObject({ value: 2 });
      });
    });
    expect(attempts).toBe(2);
    expect(await page.evaluate(() => (window as any).fixture)).toEqual({ opens: 1, arrows: 0, submissions: 0 });
  } finally { await browser.close(); }
}, 30_000);
