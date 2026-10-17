import { expect, test } from "bun:test";
import { normalizeContextWindows, applyContextWindowEdits } from "../../launcher/shared/context-budgets.cjs";
import { contextBudgetValues } from "../../launcher/shared/context-budget-values";
import { contextWindowOptions } from "../../src/context-window-options";
import { defaultConfig, providerConfig } from "../../src/config";
import { resolveChatGptWebContextLimits, CHATGPT_WEB_BACKEND_MODEL, CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL } from "../../src/models/chatgpt-web-models";
import { estimateChatGptWebUsage } from "../../src/adapters/chatgpt-web/usage";
import type { CodexParsedRequest } from "../../src/types";

test("only explicit user windows survive upgrades; restoring one field preserves the other", () => {
  for (const source of [undefined, "default", "legacy"]) {
    const config = normalizeContextWindows({ contextWindows: { fast: 90000, standard: 500000 }, contextWindowSources: { fast: source, standard: source } });
    expect(config.contextWindows).toEqual({ fast: 80000, standard: 272000 });
  }
  const chosen = applyContextWindowEdits({}, { fast: 80000, standard: 300000 });
  expect(chosen.contextWindowSources).toEqual({ fast: "user", standard: "user" });
  expect(normalizeContextWindows(chosen)).toEqual(chosen);
  const reset = applyContextWindowEdits(chosen, { fast: "default" });
  expect(reset).toEqual({ contextWindows: { fast: 80000, standard: 300000 }, contextWindowSources: { fast: "default", standard: "user" } });
  expect(() => normalizeContextWindows({ contextWindowSources: { fast: "user" } })).toThrow("Invalid context window");
  for (const value of [0, -1, 1.5, NaN, Infinity, 1000001]) expect(() => applyContextWindowEdits({}, { fast: value })).toThrow();
  expect(() => applyContextWindowEdits({}, { pro: 300000 })).toThrow();
});

test("CLI edits use the same validation and explicit default provenance", () => {
  expect(contextWindowOptions()).toBeUndefined();
  expect(contextWindowOptions("default", "272000")).toEqual({ fast: "default", standard: 272000 });
  for (const value of ["", "8e4", "80000x", "0", "-1"]) expect(() => contextWindowOptions(value)).toThrow();
});

test("renderer preview and model contracts agree for custom windows, Pro and triples", () => {
  const config = { ...defaultConfig("native-tools"), proAvailable: true, extraHighAvailable: true,
    ...applyContextWindowEdits({}, { fast: 96000, standard: 300000 }) };
  const provider = providerConfig(config);
  expect(provider.chatgptWeb?.contextWindows).toEqual({ fast: 96000, standard: 300000 });
  for (const triple of [false, true]) {
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      const capabilities = { ...config, experimentalContextTripleBudget: triple };
      const window = effort === "low" ? 96000 : 300000;
      const preview = contextBudgetValues(window, triple);
      const limits = resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, effort, capabilities);
      expect(limits).toEqual({ contextWindow: preview.contextWindow, effectiveContextWindowPercent: 95, autoCompactTokenLimit: preview.autoCompactTokenLimit });
      expect(preview.usableWindow).toBe(window * (triple ? 3 : 1) * .95);
    }
  }
  expect(resolveChatGptWebContextLimits(CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL, "low", { ...config, experimentalContextFiles: false }).contextWindow).toBe(300000);
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
