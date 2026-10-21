import { expect, spyOn, test } from "bun:test";
import { assertChatGptModelFamily, chatGptModelFamilyMatches, selectChatGptModelFamily } from "../../../../src/adapters/chatgpt-web/browser/model-selection";
import { parseDiagnosticLine, type DiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";

test("model history distinguishes stale aria/header observations, remounts, deduplication and bounded loss", async () => {
  const records: DiagnosticRecord[] = [];
  const log = spyOn(console, "error").mockImplementation(line => { const row = parseDiagnosticLine(String(line)); if (row) records.push(row); });
  let observations = 0;
  const firstControl = crypto.randomUUID(), nextControl = crypto.randomUUID();
  const menu = {
    menu: { getByRole: () => ({ evaluateAll: async () => ({ count: 1, checked: true }) }) },
    slider: { evaluateAll: async () => {
      observations++;
      return { min: "0", max: "4", value: "3", controlId: observations < 4 ? firstControl : nextControl,
        descriptions: [`6 Sol ${observations < 4 || observations % 2 ? "High" : "Medium"}, PRIVATE_ARIA`, "6 Sol Extra High, PRIVATE_HEADER"],
        descriptionSources: ["aria", "header"] };
    } },
  } as unknown as Parameters<typeof assertChatGptModelFamily>[0];
  try {
    await expect(assertChatGptModelFamily(menu, "6", "xhigh", 3, 2050)).rejects.toMatchObject({ code: "model_version_unavailable" });
    const failed = records.find(row => row.event === "browser.model_verification_failed")!;
    const history = failed.detail.history as any[];
    expect(history.length).toBe(32);
    expect(failed.detail.droppedStates).toBeGreaterThan(0);
    expect(history[0].checks.controlId).toBe(firstControl);
    expect(history.at(-1).checks.controlId).toBe(nextControl);
    expect(history[0].checks.descriptions).toMatchObject([
      { source: "aria", effort: "high", effortMatches: false }, { source: "header", effort: "extra high", effortMatches: true },
    ]);
    expect(records.filter(row => row.event === "browser.model_verification_state").length).toBe(observations - 2);
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
  } finally { log.mockRestore(); }
}, 10_000);

test.each(["valid", "radio", "slider", "stale", "unknown", "read-error"])("model verification diagnoses %s without relaxing selection or exposing picker text", async scenario => {
  const records: DiagnosticRecord[] = [];
  const log = spyOn(console, "error").mockImplementation((line: unknown) => {
    const record = parseDiagnosticLine(String(line)); if (record) records.push(record);
  });
  const readError = new Error("PRIVATE page data");
  const menu = {
    menu: { getByRole: () => ({ evaluateAll: async () => ({ count: 1, checked: scenario !== "radio" }) }) },
    slider: { evaluateAll: async () => {
      if (scenario === "read-error") throw readError;
      return { min: "0", max: "4", value: scenario === "slider" ? "2" : "3",
        descriptions: [scenario === "unknown" ? "PRIVATE account label" : `6 ${scenario === "stale" ? "High" : "Extra High"}, PRIVATE account label`] };
    } },
  } as unknown as Parameters<typeof assertChatGptModelFamily>[0];
  try {
    const result = assertChatGptModelFamily(menu, "6", "xhigh", 3);
    if (scenario === "valid") { await result; expect(records).toHaveLength(1); expect(records[0]?.event).toBe("browser.model_verification_state"); return; }
    if (scenario === "read-error") await expect(result).rejects.toBe(readError);
    else await expect(result).rejects.toMatchObject({ code: "model_version_unavailable", retryable: false });
    expect(records).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
    expect(records[1]).toMatchObject({ event: "browser.model_verification_failed", detail: {
      modelFamily: "6", requestedEffort: "xhigh", attempts: 1, submission: "not-sent",
      reason: scenario === "read-error" ? "observation_failed" : "selection_mismatch",
    } });
    if (scenario === "read-error") expect(records[1]?.detail.stage).toBe("model_snapshot");
    else expect(records[1]?.detail.checks).toMatchObject({
      radio: { count: 1, checked: scenario !== "radio" },
      slider: { min: 0, max: 4, value: scenario === "slider" ? 2 : 3, target: 3 },
      sliderMatches: scenario !== "slider", descriptionsMatch: !["stale", "unknown"].includes(scenario),
    });
  } finally { log.mockRestore(); }
});

test("model selection recognizes Latest in the launcher languages without accepting other model names", async () => {
  for (const [label, accepted] of [
    ["Latest", true], ["最新", true], ["최신", true], ["GPT-6 Pro", true], ["GPT-6", true], ["6", true],
    ["GPT-5.6 Sol", false], ["GPT-7 Pro", false], ["6.1", false], ["GPT-6 preview", false], ["Latest preview", false],
  ] as const) {
    const menu = { menu: {
      getByRole: (_role: string, options: { name: RegExp }) => ({
        count: async () => options.name.test(label) ? 1 : 0,
        getAttribute: async () => "true",
        waitFor: async () => { throw new Error("Requested family is absent"); },
      }),
      locator: () => ({ count: async () => 1, getAttribute: async () => "true" }),
    } } as unknown as Parameters<typeof selectChatGptModelFamily>[0];
    const selection = selectChatGptModelFamily(menu, "6", async () => menu);
    if (accepted) expect(await selection).toBe(menu);
    else await expect(selection).rejects.toThrow("could not be selected and verified");
  }
});

test("family confirmation requires the requested version for every effort", () => {
  expect(chatGptModelFamilyMatches(["5.6 High, 3 of 5."], "5.6", "high")).toBe(true);
  expect(chatGptModelFamilyMatches(["5.6 Extra High, 4 of 5."], "6", "xhigh")).toBe(false);
  for (const [label, effort] of [["Instant", "low"], ["Medium", "medium"], ["High", "high"], ["Extra High", "xhigh"]] as const) {
    for (const prefix of ["6", "GPT-6", "GPT-6 Sol"]) {
      expect(chatGptModelFamilyMatches([`${prefix} ${label}, 3 of 5.`], "6", effort)).toBe(true);
      expect(chatGptModelFamilyMatches([`${prefix} ${label}, 3 of 5.`], "5.6", effort)).toBe(false);
    }
    expect(chatGptModelFamilyMatches([`6 Astra ${label}`], "6", effort)).toBe(false);
    expect(chatGptModelFamilyMatches([`6 ${label}`, `5.6 ${label}`], "6", effort)).toBe(false);
  }
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "6", "max")).toBe(true);
  expect(chatGptModelFamilyMatches(["GPT-5.6 Sol Pro, 5 of 5."], "5.6", "max")).toBe(true);
  for (const descriptions of [[], ["Try Pro for more reasoning"], ["5.6 High, 3 of 5."], ["5.6 Pro, 5 of 5."],
    ["7 Pro, 5 of 5."], ["6 Sol Pro, 5 of 5."], ["6 Pro, 5 of 5.", "5.6 Pro, 5 of 5."], ["6 Pro for better answers"]]) {
    expect(chatGptModelFamilyMatches(descriptions, "6", "max")).toBe(false);
  }
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "5.6", "max")).toBe(false);
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "6", "xhigh")).toBe(false);
});

test("family confirmation rejects a stale effort and accepts identical split-header versions only", () => {
  for (const mode of ["Instant", "Medium", "Extra High", "Unknown"]) {
    expect(chatGptModelFamilyMatches([`6 Sol ${mode}`], "6", "high")).toBe(false);
  }
  expect(chatGptModelFamilyMatches(["6 Sol High", "6 Sol Medium"], "6", "high")).toBe(false);
  expect(chatGptModelFamilyMatches(["5.6 Sol 5.6 Pro"], "5.6", "max")).toBe(true);
  expect(chatGptModelFamilyMatches(["6 Astra 6 Pro"], "6", "max")).toBe(true);
  expect(chatGptModelFamilyMatches(["5.6 Sol 6 Pro"], "5.6", "max")).toBe(false);
  expect(chatGptModelFamilyMatches(["6 Astra 5.6 Pro"], "6", "max")).toBe(false);
  expect(chatGptModelFamilyMatches(["６ Sol\u200b High，3 of 5."], "6", "high")).toBe(true);
});
