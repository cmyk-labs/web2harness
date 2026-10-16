import { expect, test } from "bun:test";
import { chatGptMarkdownFailure } from "../../../src/adapters/chatgpt-web/adapter-error";

test("Markdown failures preserve their cause and use the selected UI language without claiming prior delivery", () => {
  const cause = new Error("unanchored response block");
  for (const language of ["en", "zh-CN"] as const) {
    const error = chatGptMarkdownFailure(language, cause);
    expect(error.code).toBe("browser_stream_inconsistent");
    expect(error.retryable).toBeFalse();
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain("already streamed");
    expect(error.message).toContain(language === "zh-CN" ? "结果未能完整交付" : "delivery could not be completed");
  }
});
