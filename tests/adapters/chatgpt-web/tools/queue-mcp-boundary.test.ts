import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultBrokerEndpoint } from "../../../../src/config";
import { toolIdentityKey } from "../../../../src/types";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../../../../src/adapters/chatgpt-web/tools/turn-broker";

// Protocol evidence, not live ChatGPT acceptance: the actual broker must retain a
// delivered tool invocation until Codex supplies its real result. A scheduler must
// not regard tool delivery or a compaction request as physical browser settlement.
for (const manual of [false, true]) {
  test(`MCP ${manual ? "manual" : "automatic"}: delivered child wait cannot yield through existing compaction`, async () => {
    const tempRoot = resolve(process.platform === "win32" ? tmpdir() : "/tmp");
    const root = mkdtempSync(join(tempRoot, "w2h-queue-boundary-"));
    const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
    try {
      const environment = {
        cwd: root, roots: [root], writableRoots: [],
        sandboxPolicy: { type: "readOnly" as const, networkAccess: false }, tools: [],
      };
      const nonce = "surface_nonce_queue_0123456789";
      const token = manual
        ? await broker.registerSafe(environment, nonce, 30_000, "queue-parent")
        : await broker.register(environment, 30_000, "queue-parent");
      if (manual) {
        broker.confirmSafeTurnSent(token, nonce);
        broker.startSafeTurn(token);
      }
      const claim = await callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath, {
        method: "claim", token, contract: manual ? "safe" : "native",
      });
      let returned = false;
      const pending = callTurnBroker<BrokerToolResult>(broker.socketPath, {
        method: "invoke", bindingId: claim.bindingId,
        wireName: toolIdentityKey(undefined, "wait_agent"), arguments: { ids: ["child-fixture"] },
      }, null);
      // Observe rejection even when a failed assertion sends execution into finally.
      void pending.catch(() => {});
      void pending.then(() => { returned = true; }, () => {});
      const [call] = await broker.nextToolBatch(token);
      expect(call).toBeDefined();
      expect(returned).toBeFalse();
      expect(broker.beginCompletionFence(token)).toMatchObject({ state: "activity_in_flight" });
      expect(broker.commitCompletionFence(token, 0)).toMatchObject({ state: "activity_in_flight" });

      // Compaction only intercepts undelivered/later calls. The delivered child wait
      // is untouched and still requires its real result.
      expect(broker.requestCompaction(token, { content: [{ type: "text", text: "checkpoint requested" }], isError: true })).toBe(0);
      expect(broker.compactionDeliveryCount(token)).toBe(0);
      expect(broker.beginCompletionFence(token)).toMatchObject({ state: "activity_in_flight" });
      if (manual) expect(() => broker.completeSafeTurn(token, "not completed")).toThrow("pending Codex tool invocation");
      expect(returned).toBeFalse();

      const actual = { content: [{ type: "text" as const, text: "real child result" }] };
      broker.completeTool(token, call!.callId, actual);
      expect(await pending).toEqual(actual);
      expect(broker.beginCompletionFence(token)).toMatchObject({ state: "activity_in_flight" });
      await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claim.activityId });
      const revision = broker.beginCompletionFence(token);
    if (!("revision" in revision)) throw new Error("Expected a ready fence");
      expect(revision.state).toBe("ready");
      expect(broker.commitCompletionFence(token, revision.revision)).toMatchObject({ state: "committed" });
    } finally {
      await broker.close();
      // This exact directory was individually created above; never remove a shared root.
      if (resolve(root).startsWith(join(tempRoot, "w2h-queue-boundary-"))) rmSync(root, { recursive: true });
    }
  });
}
