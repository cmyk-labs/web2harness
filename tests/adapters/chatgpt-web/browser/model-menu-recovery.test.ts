import { expect, spyOn, test } from "bun:test";
import { ChatGptModelMenuRecovery, ChatGptModelMenuObservationUnavailableError } from "../../../../src/adapters/chatgpt-web/browser/model-menu-recovery";
import { assertChatGptModelFamily } from "../../../../src/adapters/chatgpt-web/browser/model-selection";
import { diagnosticError } from "../../../../src/diagnostics";

function fixture() {
  let closed = false, nodeId = 1, url = "https://chatgpt.com/", connected = true, visible = true;
  const control = { evaluateAll: async () => ({ connected: true, closed }) };
  const menu = { menu: {} as never, sliderContainer: { evaluateAll: async () => ({ count: 1, connected, visible, nodeId }) } as never };
  const page = { url: () => url, isClosed: () => false } as never;
  return { page, control: control as never, menu,
    close: () => { closed = true; visible = false; },
    reopen: () => { closed = false; visible = true; },
    remount: () => { nodeId++; },
    navigate: () => { url += "other"; },
    hide: () => { visible = false; },
  };
}
const timeout = () => Object.assign(new Error("Fixture locator timed out"), { name: "TimeoutError" });

for (const kind of ["closed", "rebuilt"] as const)
test(`a confirmed ${kind} menu retries exactly once and retains the first error reference`, async () => {
  const f = fixture(), recovery = new ChatGptModelMenuRecovery();
  const first = timeout(), logs: any[] = [];
  const log = spyOn(console, "error").mockImplementation(value => {
    if (String(value).startsWith("@web2harness/diagnostic ")) logs.push(JSON.parse(String(value).slice("@web2harness/diagnostic ".length)));
  });
  let attempts = 0, captures = 0;
  try {
    const result = await recovery.run(async () => {
      f.reopen();
      const read = await recovery.observe(f.page, f.control, f.menu);
      return read(async () => {
        if (++attempts === 1) { kind === "closed" ? f.close() : f.remount(); throw first; }
        return { family: "6", effort: "high" };
      });
    }, async () => { captures++; });
    expect(result).toEqual({ family: "6", effort: "high" });
    expect(attempts).toBe(2); expect(captures).toBe(1);
    const completed = logs.find(row => row.event === "browser.model_menu_recovery" && row.detail.outcome === "verified");
    expect(completed.detail.cause.errorRef).toBe(diagnosticError(first).errorRef);
  } finally { log.mockRestore(); }
});

test("a second disappearance terminates with both errors retained instead of looping", async () => {
  const f = fixture(), recovery = new ChatGptModelMenuRecovery();
  let attempts = 0;
  const errors = [timeout(), timeout()];
  await expect(recovery.run(async () => {
    f.reopen();
    const read = await recovery.observe(f.page, f.control, f.menu);
    return read(async () => { f.close(); throw errors[attempts++]; });
  })).rejects.toBe(errors[1]);
  expect(attempts).toBe(2);
});

for (const scenario of ["no-change", "invalid-range", "locked", "mismatch", "navigation", "never-visible"])
test(`menu recovery does not retry ${scenario}`, async () => {
  const f = fixture(), recovery = new ChatGptModelMenuRecovery();
  let attempts = 0;
  const error = ["invalid-range", "locked", "mismatch"].includes(scenario)
    ? new Error(scenario) : timeout();
  if (scenario === "never-visible") f.hide();
  await expect(recovery.run(async () => {
    attempts++;
    const read = await recovery.observe(f.page, f.control, f.menu);
    return read(async () => {
      if (scenario !== "no-change") f.close();
      if (scenario === "navigation") f.navigate();
      throw error;
    });
  })).rejects.toBe(error);
  expect(attempts).toBe(1);
});

test("cancellation and navigation during evidence capture cannot reopen a menu", async () => {
  for (const cancel of [true, false]) {
    const f = fixture(), abort = new AbortController(), recovery = new ChatGptModelMenuRecovery(abort.signal);
    let attempts = 0;
    const error = timeout();
    const result = recovery.run(async () => {
      attempts++;
      const read = await recovery.observe(f.page, f.control, f.menu);
      return read(async () => { f.close(); throw error; });
    }, async () => { cancel ? abort.abort() : f.navigate(); });
    if (cancel) await expect(result).rejects.toMatchObject({ name: "AbortError" });
    else await expect(result).rejects.toBe(error);
    expect(attempts).toBe(1);
  }
});

test("family verification distinguishes missing reads from a real mismatch followed by disappearance", async () => {
  for (const mismatchFirst of [false, true]) {
    let reads = 0;
    const menu = {
      menu: { getByRole: () => ({ evaluateAll: async () => ({ count: mismatchFirst && reads === 0 ? 1 : 0, checked: true }) }) },
      slider: { evaluateAll: async () => ++reads === 1 && mismatchFirst
        ? { min: "0", max: "3", value: "2", descriptions: ["5.6 High"] } : undefined },
    } as unknown as Parameters<typeof assertChatGptModelFamily>[0];
    const error = await assertChatGptModelFamily(menu, "6", "high", 2, 70).catch(error => error);
    expect(error).toMatchObject({ code: "model_version_unavailable", retryable: false });
    expect(error instanceof ChatGptModelMenuObservationUnavailableError).toBe(!mismatchFirst);
  }
});
