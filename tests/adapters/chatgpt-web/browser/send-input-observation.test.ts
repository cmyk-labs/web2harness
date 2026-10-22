import { expect, test } from "bun:test";
import { runSendInputWithAcceptance } from "../../../../src/adapters/chatgpt-web/browser/send-input-observation";
import type { ChatGptSubmissionEvidence } from "../../../../src/adapters/chatgpt-web/browser/turn-observation";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function untilAbort(signal: AbortSignal, stopped?: () => void): Promise<never> {
  return new Promise((_resolve, reject) => {
    const stop = () => { stopped?.(); reject(signal.reason); };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
}

test("acceptance requests input cancellation but cannot release an unsettled input", async () => {
  const started = deferred<void>(), input = deferred<void>(), accepted = deferred<ChatGptSubmissionEvidence>();
  const interrupted = deferred<void>();
  let returned = false;
  const result = runSendInputWithAcceptance(async signal => {
    signal.addEventListener("abort", () => interrupted.resolve(), { once: true });
    started.resolve();
    await input.promise; // Deliberately ignores abort until the owner acknowledges settlement.
  }, () => accepted.promise).then(value => { returned = true; return value; });
  try {
    await started.promise;
    accepted.resolve("response_stream");
    await interrupted.promise;
    expect(returned).toBe(false);
  } finally { input.resolve(); }
  expect(await result).toEqual({ evidence: "response_stream" });
});

test("input returning without a receipt cancels and drains its observer", async () => {
  let stopped = false;
  const result = await runSendInputWithAcceptance(async () => {}, signal => untilAbort(signal, () => { stopped = true; }));
  expect(result.evidence).toBeUndefined();
  expect(result.observationFailure).toBeUndefined();
  expect(stopped).toBe(true);
});

test("a failed observer does not cancel input and preserves the existing recovery cause", async () => {
  const input = deferred<void>(), observed = deferred<void>();
  const failure = Error("DOM probe timed out");
  let inputSignal: AbortSignal | undefined;
  const result = runSendInputWithAcceptance(async signal => { inputSignal = signal; await input.promise; }, async () => {
    observed.resolve(); throw failure;
  });
  try {
    await observed.promise;
    await Promise.resolve();
    expect(inputSignal?.aborted).toBe(false);
  } finally { input.resolve(); }
  expect(await result).toEqual({ observationFailure: { error: failure } });
});

test("a real observation failure racing observer cancellation is still recoverable", async () => {
  const failure = Object.assign(Error("DOM transport timeout"), { name: "ChatGptBrowserObservationTimeoutError" });
  const result = await runSendInputWithAcceptance(async () => {}, signal => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(failure), { once: true });
  }));
  expect(result.observationFailure?.error).toBe(failure);
});

test("an input error without acceptance survives observer cancellation", async () => {
  const failure = Error("click failed");
  let stopped = false;
  const result = runSendInputWithAcceptance(async () => { throw failure; }, signal => untilAbort(signal, () => { stopped = true; }));
  await expect(result).rejects.toBe(failure);
  expect(stopped).toBe(true);
});

test("a concurrent receipt retains the actual input error without selecting another input", async () => {
  const started = deferred<void>(), input = deferred<void>(), receipt = deferred<ChatGptSubmissionEvidence>();
  const failure = Error("late click error");
  const result = runSendInputWithAcceptance(async () => { started.resolve(); await input.promise; }, () => receipt.promise);
  await started.promise;
  input.reject(failure);
  receipt.resolve("user_turn");
  expect(await result).toEqual({ evidence: "user_turn", inputError: failure });
});

test("task cancellation overrides a receipt while input settlement is still pending", async () => {
  const task = new AbortController(), interrupted = deferred<void>(), input = deferred<void>();
  const result = runSendInputWithAcceptance(async signal => {
    signal.addEventListener("abort", () => interrupted.resolve(), { once: true });
    await input.promise;
  }, async () => "response_stream", task.signal);
  await interrupted.promise;
  task.abort();
  input.resolve();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});

test("an already cancelled task starts neither input nor observation", async () => {
  const task = new AbortController(); task.abort();
  let operations = 0;
  await expect(runSendInputWithAcceptance(async () => { operations++; }, async () => {
    operations++; return "response_stream";
  }, task.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(operations).toBe(0);
});
