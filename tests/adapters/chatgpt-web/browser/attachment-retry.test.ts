import { expect, spyOn, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { attachChatGptFilesWithRetry, chatGptAttachmentCard } from "../../../../src/adapters/chatgpt-web/browser/attachment-retry";
import { ChatGptAttachmentUploadError } from "../../../../src/adapters/chatgpt-web/browser/attachment-upload";

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
const files = [
  { name: "kept.txt", mimeType: "text/plain", buffer: Buffer.from("keep original") },
  { name: "retry[1].txt", mimeType: "text/plain", buffer: Buffer.from("retry original \u4e2d\u6587") },
];
const html = `<form><div contenteditable id="prompt-textarea">original message</div><input type="file" multiple data-testid="upload-photos-input"><button type="button" data-testid="send-button" onclick="window.sends++">Send</button></form>
<script>
window.uploads=[];window.removed=[];window.sends=0;window.attempts={};window.mode='recover';
document.querySelector('input').onchange=async e=>{for(const file of e.target.files){
const attempt=window.attempts[file.name]=(window.attempts[file.name]||0)+1;
window.uploads.push({name:file.name,attempt,at:performance.now(),body:await file.text()});
const card=document.createElement('span');card.className='group/composer-attachment';
const surface=document.createElement('button');surface.type='button';surface.className='composer-attachment-surface';surface.setAttribute('aria-label',file.name);card.append(surface);
const name=document.createElement('span');name.textContent=file.name;card.append(name);
const status=document.createElement('span');status.textContent='Processing';card.append(status);
const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','移除 '+file.name);remove.textContent='×';
remove.onclick=()=>{window.removed.push({name:file.name,at:performance.now()});card.remove()};card.append(remove);document.querySelector('form').append(card);
if(file.name==='retry[1].txt'&&attempt===1&&window.mode!=='network'&&window.mode!=='quota'){
if(window.mode!=='pending')setTimeout(()=>status.textContent='上传未成功',window.mode==='slow'?900:30);continue;
}
fetch('/backend-api/files/process_upload_stream',{method:'POST',body:JSON.stringify({file_name:file.name,file_id:file.name,attempt,mode:window.mode})})
.then(async r=>{await r.text();status.textContent=r.ok?'Ready':'上传未成功'}).catch(()=>status.textContent='上传未成功');
}};
</script>`;

async function fixture(run: (page: Page) => Promise<void>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (request.method !== "POST") return new Response("");
    const body = await request.json() as { file_name: string; attempt: number; mode: string };
    if (body.mode === "slow") await Bun.sleep(1_000);
    if (body.mode === "quota") return new Response("quota", { status: 429 });
    if (body.mode.startsWith("http-")) return new Response("blocked", { status: Number(body.mode.slice(5)) });
    if (body.file_name === files[1]!.name && (body.mode === "twice" || body.mode === "network")) {
      return new Response("unavailable", { status: body.attempt === 1 ? 503 : 500 });
    }
    return new Response(JSON.stringify({ event: body.mode === "unconfirmed" ? "file.processing.file_ready" : "file.processing.completed", file_id: body.file_name }) + "\n",
      { headers: { "content-type": "application/x-ndjson" } });
  } });
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.port}`); await run(page);
  } finally { await browser.close(); server.stop(true); }
}
const state = (page: Page): Promise<any> => page.evaluate(() => ({
  uploads: (window as any).uploads, removed: (window as any).removed, sends: (window as any).sends,
  text: document.querySelector("#prompt-textarea")?.textContent,
}));

test.skipIf(!executable)("visible cards remain identifiable when their remove control is hidden until hover", async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      (window as any).mode = "hidden-remove";
      const style = document.createElement("style");
      style.textContent = '[class~="group/composer-attachment"] button[aria-label^="移除 "] {visibility:hidden} [class~="group/composer-attachment"]:hover button {visibility:visible}';
      document.head.append(style);
    });
    await attachChatGptFilesWithRetry(page, page.locator("form"), [files[0]!], AbortSignal.timeout(5000), 3000, async () => {});
    expect(await chatGptAttachmentCard(page, page.locator("form"), files[0]!.name).count()).toBe(1);
    expect((await state(page)).uploads).toHaveLength(1);
    expect((await state(page)).sends).toBe(0);
  });
}, 10_000);

test.skipIf(!executable)("attachment lookup uses the outer card while preserving legacy surfaces and real duplicates", async () => {
  await fixture(async page => {
    const form = page.locator("form"), name = files[1]!.name;
    await page.evaluate(name => {
      const form = document.querySelector("form")!;
      const wrapper = document.createElement("span"); wrapper.className = "group/composer-attachment";
      const group = document.createElement("div"); group.setAttribute("role", "group"); group.setAttribute("aria-label", name);
      const surface = document.createElement("button"); surface.className = "composer-attachment-surface"; surface.setAttribute("aria-label", name);
      const remove = document.createElement("button"); remove.setAttribute("aria-label", "Remove " + name);
      group.append(surface, remove); wrapper.append(group); form.append(wrapper);
    }, name);
    expect(await chatGptAttachmentCard(page, form, name).count()).toBe(1);
    expect(await chatGptAttachmentCard(page, form, name).getAttribute("class")).toBe("group/composer-attachment");
    await page.evaluate(() => { const card = document.querySelector('[class~="group/composer-attachment"]')!; card.after(card.cloneNode(true)); });
    expect(await chatGptAttachmentCard(page, form, name).count()).toBe(2);
    await page.evaluate(() => { for (const card of document.querySelectorAll('[class~="group/composer-attachment"]')) {
      const surface = card.querySelector('.composer-attachment-surface')!; card.replaceWith(surface);
    } });
    expect(await chatGptAttachmentCard(page, form, name).count()).toBe(2);
  });
}, 30_000);

test.skipIf(!executable)("failed UI card retries once after three seconds, preserving other attachments and exact bytes", async () => {
  await fixture(async page => {
    let checks = 0;
    await attachChatGptFilesWithRetry(page, page.locator("form"), files, AbortSignal.timeout(15_000), 5_000, async () => { checks++; });
    const result = await state(page);
    expect(result.uploads.map((u: any) => u.name)).toEqual(["kept.txt", "retry[1].txt", "retry[1].txt"]);
    expect(result.uploads[2].body).toBe(files[1]!.buffer.toString());
    expect(result.uploads[2].at - result.removed[0].at).toBeGreaterThanOrEqual(2_950);
    expect(result.removed.map((u: any) => u.name)).toEqual(["retry[1].txt"]);
    expect(result.sends).toBe(0); expect(result.text).toBe("original message"); expect(checks).toBe(2);
    expect(await page.locator('[class~="group/composer-attachment"]').count()).toBe(2);
  });
}, 25_000);

test.skipIf(!executable)("second failure returns the first HTTP error and never attempts a third upload", async () => {
  await fixture(async page => {
    await page.evaluate(() => { (window as any).mode = "network"; });
    const error = await attachChatGptFilesWithRetry(page, page.locator("form"), [files[1]!], AbortSignal.timeout(15_000), 5_000, async () => {}).catch(error => error);
    expect(error).toBeInstanceOf(ChatGptAttachmentUploadError);
    expect(error.message).toContain("HTTP 503"); expect(error.status).toBe(503);
    const result = await state(page);
    expect(result.uploads).toHaveLength(2); expect(result.removed).toHaveLength(1); expect(result.sends).toBe(0);
  });
}, 25_000);

test.skipIf(!executable)("retry receives a full independent processing timeout", async () => {
  await fixture(async page => {
    await page.evaluate(() => { (window as any).mode = "slow"; });
    await attachChatGptFilesWithRetry(page, page.locator("form"), [files[1]!], AbortSignal.timeout(30_000), 3_500, async () => {});
    expect((await state(page)).uploads).toHaveLength(2);
  });
}, 25_000);

test.skipIf(!executable)("explicit upload quota error preserves the card and never schedules a retry", async () => {
  await fixture(async page => {
    await page.evaluate(() => { (window as any).mode = "quota"; });
    const error = await attachChatGptFilesWithRetry(page, page.locator("form"), [files[1]!], AbortSignal.timeout(15_000), 5_000,
      async () => { throw new Error("Quota must not mutate the composer"); }).catch(error => error);
    expect(error).toBeInstanceOf(ChatGptAttachmentUploadError);
    expect(error.code).toBe("upload_quota_exceeded"); expect(error.status).toBe(429);
    const result = await state(page); expect(result.uploads).toHaveLength(1); expect(result.removed).toHaveLength(0);
    expect(result.text).toBe("original message"); expect(result.sends).toBe(0);
  });
}, 20_000);

test.skipIf(!executable)("cancelling the backoff stops reupload and leaves successful attachments", async () => {
  await fixture(async page => {
    const controller = new AbortController();
    const pending = attachChatGptFilesWithRetry(page, page.locator("form"), files, controller.signal, 5_000, async () => {}).catch(error => error);
    await page.waitForFunction(() => (window as any).removed.length === 1);
    const reason = new DOMException("Task cancelled", "AbortError"); controller.abort(reason);
    expect(await pending).toBe(reason);
    expect((await state(page)).uploads).toHaveLength(2);
    expect(await page.getByRole("button", { name: "移除 kept.txt", exact: true }).count()).toBe(1);
  });
}, 15_000);

test.skipIf(!executable)("submission evidence during backoff prevents reupload and preserves the original failure", async () => {
  await fixture(async page => {
    let checks = 0;
    const error = await attachChatGptFilesWithRetry(page, page.locator("form"), [files[1]!], AbortSignal.timeout(15_000), 5_000,
      async () => { if (++checks === 2) throw new Error("Already sent"); }).catch(error => error);
    expect(error).toBeInstanceOf(ChatGptAttachmentUploadError);
    expect((await state(page)).uploads).toHaveLength(1);
    expect(checks).toBe(2);
  });
}, 25_000);

for (const status of [400, 401, 403, 413, 415, 422, 501]) test.skipIf(!executable)(`HTTP ${status} never removes or reuploads an owned attachment`, async () => {
  await fixture(async page => {
    await page.evaluate(mode => { (window as any).mode = mode; }, `http-${status}`);
    const error = await attachChatGptFilesWithRetry(page, page.locator("form"), [files[0]!],
      AbortSignal.timeout(5_000), 2_000, async () => { throw new Error("Permanent failures must not mutate"); }).catch(error => error);
    expect(error).toBeInstanceOf(ChatGptAttachmentUploadError);
    expect(error.status).toBe(status);
    const result = await state(page);
    expect(result.uploads).toHaveLength(1); expect(result.removed).toHaveLength(0); expect(result.sends).toBe(0);
    expect(result.text).toBe("original message");
  });
}, 15_000);

test.skipIf(!executable)("an unconfirmed processing timeout does not authorize removing or retrying an attachment", async () => {
  await fixture(async page => {
    await page.evaluate(() => { (window as any).mode = "pending"; });
    await expect(attachChatGptFilesWithRetry(page, page.locator("form"), [files[1]!], AbortSignal.timeout(30_000), 400,
      async () => { throw new Error("Must not retry"); })).rejects.toThrow("processing timed out");
    const result = await state(page); expect(result.uploads).toHaveLength(1); expect(result.removed).toHaveLength(0);
  });
}, 45_000);

test.skipIf(!executable)("a completed response without processing confirmation preserves the card and does not reupload", async () => {
  await fixture(async page => {
    await page.evaluate(() => { (window as any).mode = "unconfirmed"; });
    const error = await attachChatGptFilesWithRetry(page, page.locator("form"), [files[0]!], AbortSignal.timeout(10_000), 5_000,
      async () => { throw new Error("Unconfirmed processing must not mutate the composer"); }).catch(error => error);
    expect(error).toMatchObject({ code: "chatgpt_attachment_observation_failed", retryable: false });
    const result = await state(page);
    expect(result.uploads).toHaveLength(1); expect(result.removed).toHaveLength(0); expect(result.sends).toBe(0);
    expect(result.text).toBe("original message");
  });
}, 15_000);

test.skipIf(!executable)("CDP observation failure cannot remove or reupload an otherwise successful attachment", async () => {
  await fixture(async page => {
    const context = page.context(), create = context.newCDPSession.bind(context);
    const observation = spyOn(context, "newCDPSession").mockImplementation(async target => {
      const session = await create(target), send = session.send.bind(session);
      session.send = (async (method: string, params?: any) => {
        if (method === "Network.streamResourceContent" || method === "Network.getResponseBody") throw new Error("Fixture observation unavailable");
        return send(method as never, params);
      }) as typeof session.send;
      return session;
    });
    try {
      const error = await attachChatGptFilesWithRetry(page, page.locator("form"), [files[0]!], AbortSignal.timeout(10_000), 5_000,
        async () => { throw new Error("Observation failure must not mutate the composer"); }).catch(error => error);
      expect(error).toMatchObject({ code: "chatgpt_attachment_observation_failed", retryable: false });
      const result = await state(page);
      expect(result.uploads).toHaveLength(1); expect(result.removed).toHaveLength(0); expect(result.sends).toBe(0);
      expect(result.text).toBe("original message");
    } finally { observation.mockRestore(); }
  });
}, 15_000);
