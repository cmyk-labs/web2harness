import type { ChatGptSubmissionEvidence } from "./turn-observation";

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(operation: Promise<T>): Promise<Outcome<T>> => operation.then(
  value => ({ ok: true, value }), error => ({ ok: false, error }),
);

/** Observe acceptance while input is pending, but never leave its losing action running.
 * The caller still owns the page/permit until this function and normal cleanup settle.
 * Observation faults are returned for the existing post-input recovery, not treated as input faults.
 */
export async function runSendInputWithAcceptance(
  input: (signal: AbortSignal) => Promise<void>,
  observe: (signal: AbortSignal) => Promise<ChatGptSubmissionEvidence>,
  signal?: AbortSignal,
): Promise<{
  evidence?: ChatGptSubmissionEvidence;
  inputError?: unknown;
  observationFailure?: { error: unknown };
}> {
  signal?.throwIfAborted();
  const inputAbort = new AbortController(), observationAbort = new AbortController();
  const inputSignal = signal ? AbortSignal.any([signal, inputAbort.signal]) : inputAbort.signal;
  const observationSignal = signal ? AbortSignal.any([signal, observationAbort.signal]) : observationAbort.signal;
  let observationFailure: { error: unknown } | undefined;
  const observation = settle(Promise.resolve().then(() => observe(observationSignal)).catch(error => {
    // A real timeout can finish in the same tick as our cancellation. Only our abort
    // is disposable; a transport/DOM error must reach the established recovery path.
    if (!observationSignal.aborted || !(error instanceof Error && error.name === "AbortError")) {
      observationFailure = { error };
    }
    throw error;
  }));
  const action = settle(Promise.resolve().then(() => {
    inputSignal.throwIfAborted();
    return input(inputSignal);
  }));
  try {
    const first = await Promise.race([
      action.then(result => ({ kind: "input" as const, result })),
      observation.then(result => ({ kind: "observation" as const, result })),
    ]);
    if (first.kind === "observation" && first.result.ok) {
      inputAbort.abort(new DOMException("Send accepted; stop pending input", "AbortError"));
      const completedInput = await action;
      signal?.throwIfAborted();
      return { evidence: first.result.value, ...(!completedInput.ok ? { inputError: completedInput.error } : {}) };
    }
    // An unavailable observation cannot cancel input or select Enter. Finish the input first.
    const completedInput = await action;
    observationAbort.abort();
    const completedObservation = await observation;
    signal?.throwIfAborted();
    if (completedObservation.ok) {
      return { evidence: completedObservation.value, ...(!completedInput.ok ? { inputError: completedInput.error } : {}) };
    }
    if (!completedInput.ok) throw completedInput.error;
    return { observationFailure };
  } finally {
    inputAbort.abort();
    observationAbort.abort();
    // Abort is a request, not proof that the browser stopped. Drain both operations.
    await Promise.all([action, observation]);
  }
}
