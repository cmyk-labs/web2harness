import { expect, test } from "bun:test";
import { defaultConfig } from "../../../src/config";
import { parseRequest } from "../../../src/responses/parser";
import { routeChatGptWebRequest } from "../../../src/server";
import { createChatGptWebAdapter } from "../../../src/adapters/chatgpt-web/adapter";
import { ChatGptBrowserWorker } from "../../../src/adapters/chatgpt-web/browser/browser-worker";
import { chatGptWebQueueModel } from "../../../src/models/chatgpt-web-queue-model";
import { RequestScheduler } from "../../../launcher/shared/request-scheduler.cjs";
import type { CodexProviderConfig } from "../../../src/types";

for (const family of ["5.6", "6"] as const) for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
  const label = `gpt-${family}-${effort === "max" ? "pro" : "sol"}`;
  test(`public route admission and search preserve ${label}/${effort}`, async () => {
    const parsed = parseRequest({ model: `chatgpt-web/${label}`, input: [{ type: "message", role: "user",
      content: [{ type: "input_text", text: "Queue metadata fixture" }],
      internal_chat_message_metadata_passthrough: { turn_id: `turn-${effort}` } }], reasoning: { effort },
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: `queue-${label}`, turn_id: `turn-${effort}` }) } });
    routeChatGptWebRequest(parsed, { ...defaultConfig("native-tools"), solAvailable: true, proAvailable: true, extraHighAvailable: true });
    const provider: CodexProviderConfig = { adapter: "chatgpt-web", baseUrl: `browser://queue-metadata-${label}-${effort}`,
      chatgptWeb: { solAvailable: true, proAvailable: true, extraHighAvailable: true, localToolsEnabled: false } };
    const worker = ChatGptBrowserWorker.forProvider(provider), original = worker.run;
    const scheduler = new RequestScheduler();
    let admitted = false;
    worker.run = async turn => {
      expect(turn.modelId).toBe("gpt-5.6-sol");
      expect(turn.modelFamily).toBe(family);
      expect(turn.reasoning).toBe(effort);
      expect(turn.scheduling).toBeDefined();
      const record = scheduler.enqueue(turn.scheduling!);
      expect(record).toMatchObject({ model: label, effort });
      expect(scheduler.query({ search: label }).items).toHaveLength(1);
      expect(scheduler.query({ search: family === "6" ? "gpt-5.6" : "gpt-6" }).total).toBe(0);
      admitted = true;
      turn.onTextDelta("Metadata accepted");
      return "Metadata accepted";
    };
    try {
      await createChatGptWebAdapter(provider).runTurn!(parsed, { headers: new Headers() }, () => {});
      expect(admitted).toBe(true);
      expect(parsed.modelId).toBe("gpt-5.6-sol");
    } finally { worker.run = original; }
  });
}

test("Luna, manual profiles and legacy backend metadata retain their meaning", () => {
  for (const model of ["gpt-5.6-luna", "chatgpt-web-zero-risk", "chatgpt-web-zero-risk-pro"])
    expect(chatGptWebQueueModel(model, undefined, "low")).toBe(model);
  expect(chatGptWebQueueModel("gpt-5.6-sol", undefined, "max")).toBe("gpt-5.6-pro");
});
