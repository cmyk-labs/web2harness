import { expect, test } from "bun:test";
import { reconcileSendAcceptance, type SendAcceptanceSnapshot } from "../../../../src/adapters/chatgpt-web/browser/send-input-probe";

const pending = (): SendAcceptanceSnapshot => ({ armed: true, matchedRequests: 1, responseReceived: true, status: 200, accepted: false });
const accepted = (): SendAcceptanceSnapshot => ({ ...pending(), accepted: true, projection: { inputBound: true } });

test("late bound input acceptance reconciles the original send without a mutation", async () => {
  let state = pending(), reads = 0;
  const timer = setTimeout(() => { state = accepted(); }, 15);
  try {
    expect(await reconcileSendAcceptance({ read: () => { reads++; return state; }, connected: () => true, timeoutMs: 300 })).toBe("confirmed");
    expect(reads).toBeGreaterThan(1);
  } finally { clearTimeout(timer); }
});

test("repeated identical observations never manufacture an input acknowledgement", async () => {
  let reads = 0;
  expect(await reconcileSendAcceptance({ read: () => { reads++; return pending(); }, connected: () => true, timeoutMs: 130 })).toBe("timeout");
  expect(reads).toBeGreaterThan(1);
});

test.each([
  { ...accepted(), matchedRequests: 2 },
  { ...accepted(), reason: "response_request_ambiguous" },
  { ...accepted(), projection: { inputBound: true, reason: "response_identity_mismatch" } },
])("conflicting identity defeats an earlier positive acceptance signal: %j", async state => {
  expect(await reconcileSendAcceptance({ read: () => state, connected: () => true })).toBe("ambiguous");
});

test("cancellation retires observation without converting late acceptance into success", async () => {
  const controller = new AbortController();
  let state = pending();
  const timer = setTimeout(() => { state = accepted(); controller.abort(); }, 15);
  try {
    expect(await reconcileSendAcceptance({ read: () => state, connected: () => true, signal: controller.signal })).toBe("cancelled");
  } finally { clearTimeout(timer); }
});

test("a disconnected page cannot use a stale positive acceptance snapshot", async () => {
  expect(await reconcileSendAcceptance({ read: accepted, connected: () => false })).toBe("disconnected");
});

test("lost observation and a transport response without bound input preserve uncertainty", async () => {
  expect(await reconcileSendAcceptance({ read: () => ({ ...pending(), reason: "response_observation_rebound" }), connected: () => true })).toBe("unavailable");
  expect(await reconcileSendAcceptance({ read: () => ({ ...accepted(), projection: { inputBound: false } }), connected: () => true, timeoutMs: 0 })).toBe("timeout");
});
