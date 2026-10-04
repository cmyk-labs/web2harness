import { expect, test } from "bun:test";
import {
  chatGptUsageModelFromAnnouncements,
  chatGptUsagePlan,
  detectChatGptLimitsPlan,
  readChatGptUsageAccount,
  supportsChatGptUsageTracking,
} from "../../../src/adapters/chatgpt-web/limits";

test("ordinary Web model families are attributed from selected UI evidence and unknown plans still have receipts", () => {
  for (const level of ["Instant", "Medium", "High", "Extra High"]) {
    expect(chatGptUsageModelFromAnnouncements([`5.6 ${level}, 3 of 5.`], false)).toBe("gpt-5.6-sol");
  }
  expect(chatGptUsageModelFromAnnouncements(["GPT-5.6 Sol High, 3 of 5."], false)).toBe("gpt-5.6-sol");
  for (const level of ["即时", "中", "高", "极高"]) {
    expect(chatGptUsageModelFromAnnouncements([`5.6 ${level}，第 3 项，共 5 项。`], false)).toBe("gpt-5.6-sol");
  }
  expect(chatGptUsageModelFromAnnouncements(["GPT-5.6 Luna Think"], false)).toBe("gpt-5.6-luna");
  for (const labels of [[], ["Latest"], ["5.6 Sol High", "5.6 Luna Think"], ["6 Pro"]]) {
    expect(chatGptUsageModelFromAnnouncements(labels, false)).toBe("other");
  }
  expect(chatGptUsagePlan({ personal: true, planType: "plus" })).toBe("unsupported");
  expect(chatGptUsagePlan({ personal: false, planType: "pro" })).toBe("unsupported");
  expect(chatGptUsagePlan({ personal: true, planType: "pro" })).toBe("pro_200");
});

test("Limits reads exact personal account tiers without inspecting billing UI", async () => {
  for (const [planType, expected] of [["pro", "pro_200"], ["prolite", "pro_100"], ["promax", "unsupported"], ["free", "unsupported"]] as const) {
    const page = {
      url: () => "https://chatgpt.com/",
      evaluate: async () => ({ userId: "u", accountId: "a", planType, structure: "personal", needsAttention: false }),
      getByRole: () => { throw new Error("Plan detection must not inspect or change the UI"); },
    };
    expect((await detectChatGptLimitsPlan(page as never)).plan).toBe(expected);
  }
});

test("Limits identifies actual selected Pro family and keeps missing or conflicting evidence unknown", () => {
  expect(chatGptUsageModelFromAnnouncements(["6 Pro, 5 of 5.", "Use Left and Right arrow keys to adjust power."])).toBe("gpt-6-pro");
  expect(chatGptUsageModelFromAnnouncements(["5.6 Pro, 5 of 5."])).toBe("gpt-5.6-pro");
  expect(chatGptUsageModelFromAnnouncements(["6 Pro，第 5 项，共 5 项。"])).toBe("gpt-6-pro");
  expect(chatGptUsageModelFromAnnouncements(["5.6 Pro，第 5 项，共 5 项。"])).toBe("gpt-5.6-pro");
  expect(chatGptUsageModelFromAnnouncements(["GPT-5.6 Sol Pro, 5 of 5."])).toBe("gpt-5.6-pro");
  for (const descriptions of [[], ["Latest"], ["Pro"], ["5.6 Extra High, 4 of 5."],
    ["5.5 Pro"], ["6 Pro", "5.6 Pro"], ["Use 6 Pro"]]) {
    expect(chatGptUsageModelFromAnnouncements(descriptions)).toBe("pro-unknown");
  }
});

test("Limits exposes only hashed account identity and distinguishes personal and workspace accounts", async () => {
  let accountId = "account-personal";
  let structure = "personal";
  const page = {
    url: () => "https://chatgpt.com/?temporary-chat=true",
    evaluate: async () => ({ userId: "user-id", accountId, structure, planType: "pro", needsAttention: false }),
  };
  const personal = await readChatGptUsageAccount(page as never);
  expect(personal.accountKey).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(personal)).not.toContain("user-id");
  expect(JSON.stringify(personal)).not.toContain(accountId);
  accountId = "account-business";
  structure = "workspace";
  const workspace = await readChatGptUsageAccount(page as never);
  expect(workspace.personal).toBe(false);
  expect(workspace.accountKey).not.toBe(personal.accountKey);
});

test("unsupported plans and payment problems never activate browser plan inspection", async () => {
  let planType = "plus";
  let needsAttention = false;
  const page = {
    url: () => "https://chatgpt.com/",
    evaluate: async () => ({ userId: "u", accountId: "a", planType, structure: "personal", needsAttention }),
    getByRole: () => { throw new Error("Must not touch the browser for this account"); },
  };
  expect((await detectChatGptLimitsPlan(page as never)).plan).toBe("unsupported");
  for (const supported of ["pro", "prolite"]) {
    planType = supported;
    needsAttention = true;
    await expect(detectChatGptLimitsPlan(page as never)).rejects.toThrow("subscription payment problem");
  }
  for (const personal of [false, true]) for (const planType of ["free", "plus", "pro", "prolite", "business", "unknown"]) {
    expect(supportsChatGptUsageTracking({ personal, planType })).toBe(personal && ["pro", "prolite"].includes(planType));
  }
});
