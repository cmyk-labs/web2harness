import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultBrokerEndpoint } from "../../../../src/config";
import { callTurnBroker, TurnBroker, RemoteTurnBroker } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";
import { ChatGptMarkdownBuffer } from "../../../../src/adapters/chatgpt-web/markdown";

const protocol = "web2harness-handoff-v1" as const;
async function fixture(run: (f: { broker: TurnBroker; owner: RemoteTurnBroker; token: string }) => Promise<void>, required = false) {
  const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, "w2h-browser-reply-"));
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  broker.configureHandoffJournal(join(root, "receipts"));
  const owner = new RemoteTurnBroker(broker.socketPath);
  try {
    const environment = { cwd: root, roots: [root], writableRoots: [],
      sandboxPolicy: { type: "readOnly" as const, networkAccess: false },
      tools: [{ name: "read_fixture", description: "Read", parameters: { type: "object" } }],
    };
    broker.revoke(await broker.register(environment));
    const token = await owner.registerHandoff(environment,
      { allowBrowserReply: true, ...(required ? { policy: { toolChoice: "required" } } : {}) });
    await run({ broker, owner, token });
  } finally {
    await broker.close();
    if (dirname(resolve(root)) !== parent || !root.startsWith(join(parent, "w2h-browser-reply-"))) throw new Error("Fixture ownership mismatch");
    rmSync(root, { recursive: true });
  }
}

test("ordinary completed replies cross the owner transport without MCP finish and replay unchanged", () => fixture(async ({ broker, owner, token }) => {
  expect(await owner.beginCompletionFence(token)).toEqual({ state: "ready", revision: 0 });
  expect(() => broker.confirmHandoffPhysicalSettlement(token)).toThrow("fence");
  const intent = broker.waitForHandoffIntent(token);
  expect(await owner.commitCompletionFence(token, 0, "The observed answer.")).toMatchObject({ state: "committed", awaitingToolResults: false });
  expect(await intent).toEqual({ kind: "final", answer: "The observed answer." });
  expect(await owner.deliverHandoff(token)).toEqual({ terminal: { kind: "final", answer: "The observed answer." }, requests: [] });
  await owner.commitCompletionFence(token, 0, "must not replace a committed response");
  expect((await owner.deliverHandoff(token)).terminal).toEqual({ kind: "final", answer: "The observed answer." });
  await rejects(callTurnBroker(broker.socketPath, { method: "claim", token, protocol }), /committed|finished/);
}));

test("a late inventory activity invalidates the observed reply revision", () => fixture(async ({ owner, broker, token }) => {
  const claim = await callTurnBroker<{ activityId: string }>(broker.socketPath, { method: "claim", token, protocol });
  expect(await owner.commitCompletionFence(token, 0, "stale answer")).toMatchObject({ state: "activity_in_flight" });
  await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claim.activityId });
  expect(await owner.commitCompletionFence(token, 0, "stale answer")).toMatchObject({ state: "revision_changed" });
  const ready = await owner.beginCompletionFence(token);
  if (!("revision" in ready)) throw Error("Expected revision");
  await owner.commitCompletionFence(token, ready.revision, "Fresh answer after inventory.");
  expect((await owner.deliverHandoff(token)).terminal).toEqual({ kind: "final", answer: "Fresh answer after inventory." });
}));

for (const sealed of [false, true]) test(`plain text cannot replace a ${sealed ? "sealed" : "pending"} tool batch`, () => fixture(async ({ owner, broker, token }) => {
  const claim = await callTurnBroker<{ activityId: string; bindingId: string }>(broker.socketPath, { method: "claim", token, protocol });
  await callTurnBroker(broker.socketPath, { method: "handoff_submit", bindingId: claim.bindingId, activityId: claim.activityId,
    protocol, submissionId: "read", calls: [{ name: "read_fixture", arguments: {} }], sealOnSubmit: sealed });
  await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claim.activityId });
  const state = await owner.beginCompletionFence(token);
  if (!sealed) {
    expect(state).toMatchObject({ state: "awaiting_intent" });
    expect(await owner.commitCompletionFence(token, 2, "looks complete")).toMatchObject({ state: "awaiting_intent" });
    await rejects(owner.deliverHandoff(token), /fence/);
  } else {
    if (!("revision" in state)) throw Error("Expected revision");
    expect(await owner.commitCompletionFence(token, state.revision, "Submitted read request.")).toMatchObject({ state: "committed", awaitingToolResults: true });
    const result = await owner.deliverHandoff(token);
    expect(result.terminal.kind).toBe("tools");
    expect(result.requests).toHaveLength(1);
    expect((await owner.deliverHandoff(token)).requests).toEqual(result.requests);
  }
}));

test("empty browser replies do not commit a successful model round", () => fixture(async ({ owner, token }) => {
  await rejects(owner.commitCompletionFence(token, 0, " \n "), { name: "ChatGptWebAdapterError", code: "chatgpt_empty_response", retryable: false });
  expect(await owner.beginCompletionFence(token)).toEqual({ state: "ready", revision: 0 });
  await rejects(owner.deliverHandoff(token), /fence/);
}));
test("browser replies cannot bypass a required tool choice", () => fixture(async ({ owner, token }) => {
  await rejects(owner.commitCompletionFence(token, 0, "unverified success"), /requires a tool call/);
  await rejects(owner.deliverHandoff(token), /fence/);
}, true));

test("previewing completed Markdown does not commit a tail when the fence must be retried", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const block = (text: string) => [{ key: "last", tag: "p", html: `<p>${text}</p>`, text, streamable: true }];
  buffer.observe(block("Draft"), 0);
  expect(buffer.preview()).toBe("Draft");
  buffer.observe(block("Final answer"), 1);
  expect(buffer.preview()).toBe("Final answer");
  expect(buffer.finish()).toEqual({ markdown: "Final answer", delta: "Final answer" });
});
