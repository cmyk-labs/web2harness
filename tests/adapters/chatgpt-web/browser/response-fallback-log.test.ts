import { expect, test } from "bun:test";
import { ChatGptResponseFallbackLog } from "../../../../src/adapters/chatgpt-web/browser/response-fallback-log";

test("repeated source fallback preserves count and elapsed observation time in two events", () => {
  const events: Array<[string, Record<string, unknown>]> = [];
  const log = new ChatGptResponseFallbackLog((...entry) => events.push(entry));
  for (let i = 0; i < 233; i++) log.observe("awaiting_final", { reason: "no_public_final" }, 1000 + i * 500);
  expect(events).toHaveLength(1);
  log.flush(); log.flush();
  expect(events).toHaveLength(2);
  expect(events[1]).toEqual(["browser.response_source_fallback_summary", {
    reason: "no_public_final", count: 233, firstAt: 1000, lastAt: 117000, durationMs: 116000,
  }]);
});

test("changed fallback states keep independent summaries and first evidence", () => {
  const events: Array<[string, Record<string, unknown>]> = [];
  const log = new ChatGptResponseFallbackLog((...entry) => events.push(entry));
  log.observe("unavailable", { reason: "unavailable" }, 10);
  log.observe("awaiting_final", { reason: "no_public_final" }, 20);
  log.observe("awaiting_final", { reason: "no_public_final" }, 30);
  log.flush();
  expect(events.map(entry => entry[0])).toEqual([
    "browser.response_source_fallback", "browser.response_source_fallback_summary",
    "browser.response_source_fallback", "browser.response_source_fallback_summary",
  ]);
  expect(events[1][1]).toMatchObject({ count: 1, firstAt: 10, lastAt: 10 });
  expect(events[3][1]).toMatchObject({ count: 2, firstAt: 20, lastAt: 30 });
});
