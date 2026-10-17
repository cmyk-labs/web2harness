import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { ChatGptBrowserWorker } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";
import { activateChatGptEffortMenu, chatGptEffortSlider, detectChatGptAccountCapabilities,
  readChatGptEffortSnapshot } from "../../../../src/browser/session";

// Local DOM only. chromium.launch owns a fresh temporary profile for each test;
// no login, saved profile, production or DEV application is involved.
async function installHydratingEffortPicker(page: Page, options: { hidden?: boolean; delayMs?: number } = {}) {
  await page.route("**/*", route => route.abort());
  await page.setContent(`<form><div id="prompt-textarea" contenteditable="true">Draft</div>
    <button type="button" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="false">Instant</button></form>
    <div id="picker" role="menu" hidden><div role="menuitemradio" aria-checked="true">GPT-5.6 Sol</div>
      <div role="menuitemradio" aria-checked="false">GPT-5.6 Luna</div>
      <div id="effort-owner" role="menuitem" tabindex="0">${options.hidden ? '<div data-model-picker-power-slider hidden style="height:30px;width:250px"></div>' : ''}</div></div>
    <script>
      const control=document.querySelector('button'), menu=document.querySelector('#picker'), owner=document.querySelector('#effort-owner');
      let value=0, timer;
      window.fixture={clicks:0, pointers:0, arrows:[], modelClicks:0, submissions:0, hydrated:false};
      window.hydrateEffort=()=>{
        owner.innerHTML='<div data-model-picker-power-slider style="height:30px;width:250px"><span data-orientation="horizontal" aria-disabled="false">'
          +Array.from({length:4},(_,i)=>'<span data-selected="'+(i<=value)+'"></span>').join('')
          +'<span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="3" aria-valuenow="'+value+'"></span></span></div>';
        window.fixture.hydrated=true;
      };
      function open(){
        menu.hidden=false;control.setAttribute('aria-expanded','true');
        ${options.delayMs === undefined ? '' : `timer=setTimeout(window.hydrateEffort,${options.delayMs});`}
      }
      control.onclick=()=>{window.fixture.clicks++;open();};
      control.onpointerdown=e=>{if(!e.isTrusted){window.fixture.pointers++;open();}};
      document.querySelectorAll('[role=menuitemradio]').forEach(row=>row.onclick=()=>window.fixture.modelClicks++);
      document.querySelector('form').onsubmit=e=>{e.preventDefault();window.fixture.submissions++;};
      document.addEventListener('keydown',e=>{
        if(e.key==='Escape'){clearTimeout(timer);menu.hidden=true;control.setAttribute('aria-expanded','false');control.textContent=['Instant','Medium','High','Extra High'][value];}
        else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
          window.fixture.arrows.push(e.key);value+=e.key==='ArrowRight'?1:-1;window.hydrateEffort();e.preventDefault();
        }
      });
    </script>`);
}

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("visible menu waits for a delayed visible slider before activation returns", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await installHydratingEffortPicker(page, { hidden: true });
    let finished = false;
    const pending = activateChatGptEffortMenu(page, page.locator("button"), { settleMs: 2_000 });
    void pending.then(() => { finished = true; }, () => { finished = true; });
    await page.waitForFunction(() => document.querySelector("button")?.getAttribute("aria-expanded") === "true");
    await page.waitForTimeout(100);
    expect(await page.locator("#picker").isVisible()).toBeTrue();
    expect(await page.locator("[data-model-picker-power-slider]").isVisible()).toBeFalse();
    expect(finished).toBeFalse();
    await page.evaluate(() => (window as any).hydrateEffort());
    const activation = await pending;
    expect(activation.method).toBe("click");
    expect(await activation.sliderContainer.isVisible()).toBeTrue();
    expect(await readChatGptEffortSnapshot(activation.sliderContainer)).toMatchObject({
      min: 0, max: 3, value: 0, available: [true, true, true, true],
    });
    expect(await page.evaluate(() => (window as any).fixture))
      .toMatchObject({ clicks: 1, pointers: 0, arrows: [], modelClicks: 0, submissions: 0 });
  } finally { await browser.close(); }
}, 10_000);

for (const hidden of [false, true])
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`visible menu with ${hidden ? "hidden" : "absent"} slider fails within activation budget`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await installHydratingEffortPicker(page, { hidden });
    const started = performance.now();
    const error = await activateChatGptEffortMenu(page, page.locator("button"), { settleMs: 1_000 }).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("did not expose its owned menu or structural slider");
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(await page.locator("#picker").isVisible()).toBeTrue();
    expect(await page.evaluate(() => (window as any).fixture))
      .toMatchObject({ clicks: 1, pointers: 1, arrows: [], modelClicks: 0, submissions: 0, hydrated: false });
  } finally { await browser.close(); }
}, 10_000);

for (const disappears of [false, true])
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`effort snapshot bounds locator waiting when the slider ${disappears ? "disappears" : "never appears"}`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await installHydratingEffortPicker(page);
    await page.locator("button").click();
    const { sliderContainer } = chatGptEffortSlider(page);
    if (disappears) {
      await page.evaluate(() => (window as any).hydrateEffort());
      expect(await readChatGptEffortSnapshot(sliderContainer)).toMatchObject({ value: 0, max: 3 });
      await page.locator("[data-model-picker-power-slider]").evaluate(element => element.remove());
    }
    const started = performance.now();
    const error = await readChatGptEffortSnapshot(sliderContainer, 150).catch(error => error);
    expect(error).toMatchObject({ name: "TimeoutError" });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(await page.locator("#picker").isVisible()).toBeTrue();
    expect(await page.evaluate(() => (window as any).fixture))
      .toMatchObject({ arrows: [], modelClicks: 0, submissions: 0 });
  } finally { await browser.close(); }
}, 10_000);

for (const delayed of [true, false])
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`requested Sol xhigh ${delayed ? "survives delayed slider hydration" : "fails on missing slider without downgrade"}`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await installHydratingEffortPicker(page, delayed ? { delayMs: 150 } : {});
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const started = performance.now();
    const result = worker.selectModelAndEffort(page, "gpt-5.6-sol", "xhigh", {
      localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false,
    });
    if (delayed) {
      expect(await result).toMatchObject({ modelId: "gpt-5.6-sol", effort: "xhigh", selection: { label: "Extra High" } });
      expect(await page.locator('[role="slider"]').getAttribute("aria-valuenow")).toBe("3");
    } else {
      const error = await result.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("did not expose its owned menu or structural slider");
      expect(performance.now() - started).toBeLessThan(10_000);
    }
    expect(await page.locator('[role="menuitemradio"][aria-checked="true"]').textContent()).toBe("GPT-5.6 Sol");
    expect(await page.evaluate(() => (window as any).fixture)).toMatchObject({
      arrows: delayed ? ["ArrowRight", "ArrowRight", "ArrowRight"] : [], modelClicks: 0, submissions: 0,
    });
    expect(await page.locator("#prompt-textarea").innerText()).toBe("Draft");
  } finally { await browser.close(); }
}, 20_000);

for (const picker of ["classic", "power", "track"])
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`model selection reuses the ${picker} picker without racing Escape cleanup`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(2_000);
    await page.setContent(`<form><div id="prompt-textarea" contenteditable="true">Draft</div>
      <button type="button" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="false">Extra High</button></form>
      <div id="picker" role="menu" hidden><div ${picker !== 'classic' ? 'data-model-picker-view="simple"' : ''}>
        <div aria-hidden="false"><div id="toggle" role="menuitem" ${picker === "track" ? "" : 'aria-hidden="false"'} aria-expanded="false" data-model-picker-view-toggle="true">Select model</div></div>
        ${picker === "track" ? '<div aria-hidden="true" inert><div data-model-picker-view-toggle="true">Inactive toggle</div></div>' : ""}
        <div id="models" hidden><div role="menuitemradio" aria-checked="true">Latest</div>
          <div role="menuitemradio" aria-checked="false">GPT-5.6 Sol</div></div>
        <span id="announcement">5.6 Extra High, 4 of 4.</span>
        <div role="menuitem" tabindex="0" aria-describedby="announcement">
          <div data-model-picker-power-slider style="height:30px;width:250px"><span data-orientation="horizontal" aria-disabled="false">
            ${Array(4).fill('<span data-selected="true"></span>').join('')}
            <span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="3" aria-valuenow="3"></span>
          </span></div></div>
      </div></div>
      <script>
        const control=document.querySelector('button'),menu=document.querySelector('#picker'),toggle=document.querySelector('#toggle');
        let selected=false;
        window.pickerOpens=0;
        function close(){menu.hidden=true;control.setAttribute('aria-expanded','false');control.textContent=selected?'5.6 Sol Extra High':'Extra High';}
        control.onclick=()=>{window.pickerOpens++;menu.hidden=false;control.setAttribute('aria-expanded','true');};
        toggle.onclick=()=>{document.querySelector('#models').hidden=false;toggle.setAttribute('aria-expanded','true');};
        document.querySelectorAll('[role=menuitemradio]')[1].onclick=()=>{
          selected=true;
          document.querySelectorAll('[role=menuitemradio]').forEach((e,i)=>e.setAttribute('aria-checked',String(i===1)));
          document.querySelector('#models').hidden=true;
        };
        document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();setTimeout(close,150);}});
      </script>`);
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const result = await worker.selectModelAndEffort(page, "gpt-5.6-sol", "xhigh", {
      localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
    }, undefined, false, "5.6");
    expect(result.selection.label).toBe("5.6 Sol Extra High");
    expect(await page.evaluate(() => (window as any).pickerOpens)).toBe(2);
    expect(await page.locator('#prompt-textarea').innerText()).toBe("Draft");
  } finally { await browser.close(); }
}, 30_000);

for (const scenario of ["hydrate", "shrink", "locked", "pro-disappears"])
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`real slider ${scenario} keeps the requested available effort`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><div id="prompt-textarea" contenteditable="true">Draft</div>
      <button type="button" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="false">Instant</button></form>
      <div id="picker" role="menu" hidden><div role="menuitem" tabindex="0"><div data-model-picker-power-slider style="height:30px;width:250px"></div></div></div>
      <script>
        let value=0, max=4, opens=0;
        const scenario=${JSON.stringify(scenario)}, control=document.querySelector('button'), menu=document.querySelector('#picker');
        function render(ticks=max+1) {
          document.querySelector('[data-model-picker-power-slider]').innerHTML='<span data-orientation="horizontal" aria-disabled="false">'
            +Array.from({length:ticks},(_,i)=>'<span data-selected="'+(i<=value)+'"'+(scenario==='locked'&&opens>1&&i===2?' data-locked="true"':'')+'></span>').join('')
            +'<span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="'+max+'" aria-valuenow="'+value+'"></span></span>';
        }
        control.onclick=()=>{
          opens++; menu.hidden=false; control.setAttribute('aria-expanded','true');
          if(opens>1&&(scenario==='shrink'||scenario==='pro-disappears'))max=3;
          value=Math.min(value,max); render(scenario==='hydrate'&&opens===1?4:max+1);
          if(scenario==='hydrate'&&opens===1)setTimeout(()=>{max=3;render()},100);
        };
        document.addEventListener('keydown',e=>{
          if(e.key==='Escape'){menu.hidden=true;control.setAttribute('aria-expanded','false');control.textContent=['Instant','Medium','High','Extra High','Pro'][value];}
          else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){value+=e.key==='ArrowRight'?1:-1;render();e.preventDefault();}
        });
        render();
      </script>`);
    if (scenario === "hydrate") {
      expect(await detectChatGptAccountCapabilities(page)).toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: false });
    } else {
      const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
      const effort = scenario === "pro-disappears" ? "max" : scenario === "locked" ? "high" : "xhigh";
      const result = worker.selectModelAndEffort(page, "gpt-5.6-sol", effort, {
        localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true,
      });
      if (scenario === "shrink") expect((await result).selection.label).toBe("Extra High");
      else await expect(result).rejects.toMatchObject({ retryable: false });
    }
    expect(await page.locator('#prompt-textarea').innerText()).toBe("Draft");
    await page.close();
  } finally { await browser.close(); }
}, 120_000);
