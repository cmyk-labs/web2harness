import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { readChatGptModelSnapshot } from "../../../../src/browser/session";
import { assertChatGptModelFamily, chatGptModelFailureEvidence } from "../../../../src/adapters/chatgpt-web/browser/model-selection";
import { ChatGptBrowserDiagnostics } from "../../../../src/adapters/chatgpt-web/browser/browser-diagnostics";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER).each([
  ["即时", "Instant", "low", 0], ["中", "Medium", "medium", 1],
  ["高", "High", "high", 2], ["极高", "Extra High", "xhigh", 3], ["Pro", "Pro", "max", 4],
] as const)("the Chinese %s picker validates actual DOM descriptions and still rejects selection conflicts", async (label, english, effort, index) => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
    await page.goto("https://model-fixture.invalid");
    await page.setContent(`<html lang="zh-CN"><body>
      <button id="owner" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="true">${label}</button>
      <div id="picker" role="menu" aria-labelledby="owner">
        <div id="family" role="menuitemradio" aria-checked="true">最新</div>
        <button data-model-picker-view-toggle="true"><span data-menu-row-content id="header">6 ${label}</span></button>
        <div role="menuitem" aria-describedby="status instruction">
          <div data-model-picker-power-slider><span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${index}"></span></div>
        </div><span id="status">6 ${label}，第 ${index + 1} 项，共 5 项。</span><span id="instruction">使用左右方向键调整强度</span>
      </div></body></html>`);
    const slider = page.locator('[role="slider"]');
    const menu = { menu: page.locator("#picker"), slider } as never;
    const snapshot = await readChatGptModelSnapshot(slider);
    expect(snapshot?.descriptions).toEqual([`6 ${label}，第 ${index + 1} 项，共 5 项。`, "使用左右方向键调整强度", `6 ${label}`]);
    expect(snapshot?.descriptionSources).toEqual(["aria", "aria", "header"]);
    await assertChatGptModelFamily(menu, "6", effort, index);
    // English/Chinese observations may overlap while the picker updates.
    await page.locator("#header").evaluate((element, value) => { element.textContent = value; }, `6 ${english}`);
    await assertChatGptModelFamily(menu, "6", effort, index);
    await page.locator("#status").evaluate((element, value) => { element.textContent = value; }, `6 ${english}, ${index + 1} of 5.`);
    await page.locator("#header").evaluate((element, value) => { element.textContent = value; }, `6 ${label}`);
    await assertChatGptModelFamily(menu, "6", effort, index);
    for (const text of [effort === "high" ? "6 中" : "6 高", `5.6 ${english}`, "6 未知", `6 ${label}强度`]) {
      await page.locator("#header").evaluate((element, value) => { element.textContent = value; }, text);
      await expect(assertChatGptModelFamily(menu, "6", effort, index)).rejects.toMatchObject({ code: "model_version_unavailable" });
    }
    await page.locator("#header").evaluate((element, value) => { element.textContent = value; }, `6 ${label}`);
    await page.locator("#family").evaluate(element => element.setAttribute("aria-checked", "false"));
    await expect(assertChatGptModelFamily(menu, "6", effort, index)).rejects.toMatchObject({ code: "model_version_unavailable" });
    await page.locator("#family").evaluate(element => element.setAttribute("aria-checked", "true"));
    await slider.evaluate((element, value) => element.setAttribute("aria-valuenow", value), String((index + 1) % 5));
    await expect(assertChatGptModelFamily(menu, "6", effort, index)).rejects.toMatchObject({ code: "model_version_unavailable" });
  } finally { await browser.close(); }
}, 15_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("model snapshot binds references, owners and remounted nodes without expanding private samples", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, "web2harness-model-evidence-"));
  try {
    const page = await browser.newPage();
    // A local HTTPS response provides the secure-context APIs used by the real picker.
    // Intercept every request; this fixture makes no external network connection.
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
    await page.goto("https://model-fixture.invalid");
    await page.setContent(`<html lang="zh-CN"><body>
      <button id="owner" data-tone="neutral" aria-haspopup="menu" aria-controls="picker" aria-expanded="true">PRIVATE_BUTTON</button>
      <div id="picker" role="menu" aria-labelledby="owner">
        <div role="menuitemradio" aria-checked="true">Latest</div>
        <div role="menuitem" aria-describedby="status missing external r3 r4 r5 r6 r7 r8 r9">
          <div data-model-picker-power-slider><span role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="3"></span></div>
        </div><span id="status">${"UNKNOWN_PRIVATE ".repeat(100)}</span>
        ${Array.from({ length: 7 }, (_, index) => `<span id="r${index + 3}">Opaque private label</span>`).join("")}
      </div><span id="external" hidden>PRIVATE_EXTERNAL</span></body></html>`);
    const slider = page.getByRole("slider");
    const first = (await readChatGptModelSnapshot(slider))!;
    expect(first.relationships).toMatchObject({ ownerCount: 1, language: "zh", menuPresent: true, menuVisible: true,
      owners: [{ connected: true, expanded: true, closed: false }] });
    expect(first.descriptionEvidence).toHaveLength(8);
    expect(first.descriptions).toHaveLength(10); // Verification never samples away a conflicting description.
    expect(first.descriptionEvidence[0]).toMatchObject({ reference: "status", inMenu: true, present: true, truncated: true });
    expect(first.descriptionEvidence[0]!.text).toHaveLength(512);
    expect(first.descriptionEvidence[1]).toMatchObject({ reference: "missing", present: false });
    expect(first.descriptionEvidence[2]).toMatchObject({ reference: "external", inMenu: false, visible: false });
    await page.locator("#status").evaluate(element => element.replaceWith(element.cloneNode(true)));
    const next = (await readChatGptModelSnapshot(slider))!;
    expect(next.controlId).toBe(first.controlId);
    expect(next.relationships.menuId).toBe(first.relationships.menuId);
    expect(next.descriptionEvidence[0]!.nodeId).not.toBe(first.descriptionEvidence[0]!.nodeId);

    const failure = await assertChatGptModelFamily({ menu: page.locator("#picker"), slider } as never, "6", "xhigh", 3)
      .catch(error => error);
    expect(chatGptModelFailureEvidence(failure)).toMatchObject({ reason: "description_unknown", omittedDescriptions: 2 });
    expect(JSON.stringify(failure)).not.toContain("PRIVATE");
    const diagnostics = new ChatGptBrowserDiagnostics("model-fixture", root, "fixture-app");
    const capturePage = { evaluate: async () => ({ privateText: "PRIVATE_PAGE_BODY" }), screenshot: async () => undefined };
    await diagnostics.capture(capturePage as never, "model-ready");
    expect(readdirSync(root).some(name => name.startsWith("response-source-"))).toBe(false);
    await diagnostics.capture(capturePage as never, "turn-failed", failure);
    const archive = JSON.parse(readFileSync(join(root, "response-source-00", "browser-failure.private.json"), "utf8"));
    expect(archive.modelVerification.descriptions).toHaveLength(8);
    expect(archive.modelVerification.descriptions[0].text).toHaveLength(512);
    expect(archive.modelVerification.descriptions[0].text).toContain("UNKNOWN_PRIVATE");
    expect(JSON.stringify(archive)).not.toContain("PRIVATE_PAGE_BODY");
    expect(JSON.stringify(archive)).not.toContain("PRIVATE_BUTTON");
    for (const directory of readdirSync(root).filter(name => name.startsWith("model-fixture-"))) {
      for (const file of readdirSync(join(root, directory)).filter(name => name.endsWith(".json"))) {
        expect(readFileSync(join(root, directory, file), "utf8")).not.toContain("PRIVATE");
      }
    }
  } finally {
    await browser.close();
    if (dirname(realpathSync(root)) !== parent || !basename(root).startsWith("web2harness-model-evidence-")) {
      throw Error("Unexpected fixture ownership");
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
