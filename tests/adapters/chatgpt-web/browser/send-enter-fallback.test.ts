import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../../../../src/adapters/chatgpt-web/browser/browser-worker";

function fixture() {
  const worker: any = Object.create(ChatGptBrowserWorker.prototype);
  const controller = new AbortController();
  const calls: string[] = [];
  const page: any = { isClosed: () => false, evaluate: async () => ({}) };
  const button = { click: async () => { calls.push("click"); } };
  const composer = { locator: () => ({ locator: () => button }), press: async (key: string) => { calls.push(key); } };
  worker.activeComposer = async () => composer;
  worker.waitForSendReady = async () => {};
  worker.sendControlState = async () => ({ blocked: false });
  worker.currentSubmissionEvidence = async () => undefined;
  worker.waitForSubmissionAcceptedWithRecovery = async () => "user_turn";
  worker.runStage = async (_trace: string, _stage: string, _ms: number, operation: Function) => operation(new AbortController().signal);
  const lifecycle = { onSendActivated: async () => { calls.push("activated"); }, onSubmitted: async () => { calls.push("submitted"); } };
  const send = (method = "click", accepted?: () => boolean) => worker.sendAttachedPrompt(
    page, {}, undefined, controller.signal, undefined, lifecycle, undefined, undefined, accepted, method,
  );
  return { worker, controller, calls, page, button, composer, lifecycle, send };
}

test.each(["unobstructed", "disabled", "missing", "modal", "unreadable"])("preflight failure selects Enter even when control is %s", async state => {
  const f = fixture();
  f.button.click = async () => { throw new Error("pointer action failed"); };
  f.worker.sendControlState = async () => {
    if (state === "unreadable") throw Error("snapshot unavailable");
    return { blocked: false, enabled: state !== "disabled", connected: state !== "missing", modal: state === "modal" };
  };
  expect(await f.worker.prepareSendMethod(f.page, f.controller.signal)).toBe("enter");
  expect(await f.send("enter")).toBe("user_turn");
  expect(f.calls).toEqual(["activated", "Enter", "submitted"]);
});

test.each(["click-error", "click-timeout", "ready-error", "ack-timeout"])("%s falls back to exactly one composer Enter", async state => {
  const f = fixture();
  if (state.startsWith("click")) f.button.click = async () => { f.calls.push("click"); throw Error(state); };
  if (state === "ready-error") f.worker.waitForSendReady = async () => { throw Error("button disabled after permit"); };
  let observations = 0;
  if (state === "ack-timeout") f.worker.waitForSubmissionAcceptedWithRecovery = async () => {
    if (++observations === 1) throw Error("acknowledgement timeout");
    return "user_turn";
  };
  expect(await f.send()).toBe("user_turn");
  expect(f.calls.filter(x => x === "Enter")).toHaveLength(1);
  expect(f.calls.filter(x => x === "activated")).toHaveLength(1);
  expect(f.calls.at(-1)).toBe("submitted");
});

test.each(["source", "dom"])("a known %s receipt suppresses Enter after a click exception", async source => {
  const f = fixture();
  let accepted = false;
  f.button.click = async () => { f.calls.push("click"); accepted = true; throw Error("late click error"); };
  if (source === "dom") f.worker.currentSubmissionEvidence = async () => "user_turn";
  expect(await f.send("click", source === "source" ? () => accepted : undefined)).toBe(source === "source" ? "response_stream" : "user_turn");
  expect(f.calls).toEqual(["activated", "click", "submitted"]);
});

test("unavailable acceptance observation does not block Enter", async () => {
  const f = fixture();
  f.button.click = async () => { throw Error("click failed"); };
  f.worker.currentSubmissionEvidence = async () => { throw Error("DOM unavailable"); };
  expect(await f.send()).toBe("user_turn");
  expect(f.calls).toEqual(["activated", "Enter", "submitted"]);
});

test("cancellation during the click never sends Enter", async () => {
  const f = fixture();
  f.button.click = async () => { f.controller.abort(); throw new DOMException("cancelled", "AbortError"); };
  await expect(f.send()).rejects.toMatchObject({ name: "AbortError" });
  expect(f.calls).toEqual(["activated"]);
});

test("both input failures are preserved and Enter is not retried", async () => {
  const f = fixture();
  const click = Error("click failed"), enter = Error("Enter failed"), ack = Error("ack failed");
  f.button.click = async () => { f.calls.push("click"); throw click; };
  f.composer.press = async () => { f.calls.push("Enter"); throw enter; };
  f.worker.waitForSubmissionAcceptedWithRecovery = async () => { throw ack; };
  const failure = await f.send().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toEqual([click, enter, ack]);
  expect(f.calls).toEqual(["activated", "click", "Enter"]);
});

test("Enter returning without a receipt cannot report success", async () => {
  const f = fixture();
  f.worker.waitForSubmissionAcceptedWithRecovery = async () => { throw Error("no receipt"); };
  await expect(f.send("enter")).rejects.toBeInstanceOf(AggregateError);
  expect(f.calls).toEqual(["activated", "Enter"]);
});

test("a receipt callback failure cannot resend an accepted input", async () => {
  const f = fixture();
  const error = Error("queue receipt failed");
  f.lifecycle.onSubmitted = async () => { throw error; };
  await expect(f.send()).rejects.toBe(error);
  expect(f.calls).toEqual(["activated", "click"]);
});

test.each(["dom-read", "progress", "composer-lookup"])("a receipt arriving during %s suppresses late Enter", async stage => {
  const f = fixture();
  let accepted = false;
  f.button.click = async () => { f.calls.push("click"); throw Error("click failed"); };
  if (stage === "dom-read") f.worker.currentSubmissionEvidence = async () => { accepted = true; return undefined; };
  if (stage === "progress") (f.lifecycle as any).onInputProgress = async () => { if (f.calls.includes("click")) accepted = true; };
  if (stage === "composer-lookup") f.worker.activeComposer = async () => { if (f.calls.includes("click")) accepted = true; return f.composer; };
  expect(await f.send("click", () => accepted)).toBe("response_stream");
  expect(f.calls).toEqual(["activated", "click", "submitted"]);
});

test("progress callback errors are not click failures", async () => {
  const f = fixture(), error = Error("metadata failed");
  (f.lifecycle as any).onInputProgress = async () => { throw error; };
  await expect(f.send()).rejects.toBe(error);
  expect(f.calls).toEqual(["activated"]);
});

test("Enter follows the verified replacement page and baseline after observation recovery", async () => {
  const f = fixture();
  const replacement = { ...f.page }, baseline = { replaced: true };
  let rebound = false, observations = 0;
  f.page.isClosed = () => rebound;
  f.worker.activeComposer = async (page: unknown) => {
    expect(page).toBe(rebound ? replacement : f.page); return f.composer;
  };
  f.worker.waitForSubmissionAcceptedWithRecovery = async (...args: any[]) => {
    if (++observations === 1) { await args[6](1, Error("lost page"), {}, f.controller.signal); throw Error("no receipt yet"); }
    expect(args[0]).toBe(replacement); expect(args[1]).toBe(baseline); return "user_turn";
  };
  const result = await f.worker.sendAttachedPrompt(f.page, {}, undefined, f.controller.signal, undefined,
    f.lifecycle, undefined, async () => { rebound = true; return { page: replacement, baseline }; });
  expect(result).toBe("user_turn");
  expect(f.calls).toEqual(["activated", "click", "Enter", "submitted"]);
});

test.each([false, true])("a late MCP tool receipt suppresses Enter even when DOM read fails=%s", async readFails => {
  const f = fixture();
  let revision = 0, reads = 0;
  f.button.click = async () => { f.calls.push("click"); throw Error("click failed"); };
  f.worker.currentSubmissionEvidence = async () => {
    if (++reads === 2) { revision = 1; if (readFails) throw Error("DOM disconnected"); }
    return undefined;
  };
  const result = await f.worker.sendAttachedPrompt(f.page, {}, undefined, f.controller.signal,
    { snapshot: () => ({ lastToolBatchRevision: revision }) }, f.lifecycle);
  expect(result).toBe("mcp_tool_call");
  expect(f.calls).toEqual(["activated", "click", "submitted"]);
});

test("a receipt already present before the first input suppresses the click", async () => {
  const f = fixture();
  expect(await f.send("click", () => true)).toBe("response_stream");
  expect(f.calls).toEqual(["activated", "submitted"]);
});

test.each(["progress", "composer", "ready"])("a receipt arriving during initial %s suppresses the first click", async stage => {
  const f = fixture();
  let accepted = false;
  if (stage === "progress") (f.lifecycle as any).onInputProgress = async () => { accepted = true; };
  if (stage === "composer") f.worker.activeComposer = async () => { accepted = true; return f.composer; };
  if (stage === "ready") f.worker.waitForSendReady = async () => { accepted = true; };
  expect(await f.send("click", () => accepted)).toBe("response_stream");
  expect(f.calls).toEqual(["activated", "submitted"]);
});

test("a verified receipt interrupts a pending click and waits for input settlement", async () => {
  const f = fixture();
  let accepted = false, interrupted = false, settled = false;
  f.button.click = async (options?: any) => {
    f.calls.push("click");
    accepted = true;
    try {
      await new Promise<void>((_resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("unnecessary full input timeout")), 150);
        const stop = () => {
          interrupted = true;
          clearTimeout(timeout);
          reject(options.signal.reason);
        };
        options?.signal?.addEventListener("abort", stop, { once: true });
        if (options?.signal?.aborted) stop();
      });
    } finally { settled = true; }
  };
  f.worker.waitForSubmissionAccepted = async (_page: unknown, _baseline: unknown, signal: AbortSignal) => {
    while (!accepted) { signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 1)); }
    return "response_stream";
  };
  f.lifecycle.onSubmitted = async () => {
    expect(interrupted).toBe(true);
    expect(settled).toBe(true);
    f.calls.push("submitted");
  };
  expect(await f.send("click", () => accepted)).toBe("response_stream");
  expect(f.calls).toEqual(["activated", "click", "submitted"]);
});
