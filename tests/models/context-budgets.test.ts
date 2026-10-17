import { expect, test } from "bun:test";
import { normalizeContextWindows, rejectContextWindowEdits } from "../../launcher/shared/context-budgets.cjs";
import { contextBudgetValues } from "../../launcher/shared/context-budget-values";
import { rejectContextWindowOptions } from "../../src/context-window-options";
import { defaultConfig, providerConfig } from "../../src/config";
import { resolveChatGptWebContextLimits, CHATGPT_WEB_BACKEND_MODEL, CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL } from "../../src/models/chatgpt-web-models";
import { estimateChatGptWebUsage } from "../../src/adapters/chatgpt-web/usage";
import type { CodexParsedRequest } from "../../src/types";

test("old custom windows normalize to fixed budgets regardless of provenance", () => {
  for (const source of [undefined, "default", "legacy", "user"]) {
    const config = normalizeContextWindows({ contextWindows: { fast: 90000, standard: 500000 }, contextWindowSources: { fast: source, standard: source } });
    expect(config.contextWindows).toEqual({ fast: 80000, standard: 272000 });
  }
  for (const edits of [{ fast: 80000 }, { fast: "default" }, {}, null])
    expect(() => rejectContextWindowEdits(edits)).toThrow("fixed");
  expect(() => rejectContextWindowEdits(undefined)).not.toThrow();
});

test("retired CLI numeric and default edits are explicitly rejected", () => {
  expect(rejectContextWindowOptions()).toBeUndefined();
  for (const value of ["default", "80000", "", "8e4", "80000x", "0", "-1"]) {
    expect(() => rejectContextWindowOptions(value)).toThrow("fixed");
    expect(() => rejectContextWindowOptions(undefined, value)).toThrow("fixed");
  }
});

test("renderer and model contracts use fixed windows despite legacy custom values, including Pro and triples", () => {
  const config = { ...defaultConfig("native-tools"), proAvailable: true, extraHighAvailable: true,
    contextWindows: { fast: 96000, standard: 300000 }, contextWindowSources: { fast: "user", standard: "user" } as const };
  const provider = providerConfig(config);
  expect(provider.chatgptWeb?.contextWindows).toEqual({ fast: 80000, standard: 272000 });
  for (const triple of [false, true]) {
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      const capabilities = { ...config, experimentalContextTripleBudget: triple };
      const window = effort === "low" ? 80000 : 272000;
      const preview = contextBudgetValues(window, triple);
      const limits = resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, effort, capabilities);
      expect(limits).toEqual({ contextWindow: preview.contextWindow, effectiveContextWindowPercent: 95, autoCompactTokenLimit: preview.autoCompactTokenLimit });
      expect(preview.usableWindow).toBe(window * (triple ? 3 : 1) * .95);
    }
  }
  expect(resolveChatGptWebContextLimits(CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL, "low", { ...config, experimentalContextFiles: false }).contextWindow).toBe(272000);
  expect(contextBudgetValues(80000, true)).toMatchObject({ contextWindow: 240000, usableWindow: 228000, autoCompactTokenLimit: 216000 });
  expect(contextBudgetValues(272000, true)).toMatchObject({ contextWindow: 816000, usableWindow: 775200, autoCompactTokenLimit: 734400 });
});

test("changing the declared window does not rescale token usage or rewrite native task content", () => {
  const parsed: CodexParsedRequest = { modelId: CHATGPT_WEB_BACKEND_MODEL, stream: false,
    context: { messages: [{ role: "user", timestamp: 1, content: "Remember the unchanged native task context." }] }, options: { reasoning: "medium" }, _rawBody: {} };
  const original = structuredClone(parsed);
  const caps = { localToolsEnabled: false, nativeToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: false };
  expect(estimateChatGptWebUsage(parsed, { answer: "ok" }, { ...caps, contextWindows: { fast: 80000, standard: 272000 } }))
    .toEqual(estimateChatGptWebUsage(parsed, { answer: "ok" }, { ...caps, contextWindows: { fast: 96000, standard: 300000 } }));
  expect(parsed).toEqual(original);
});
