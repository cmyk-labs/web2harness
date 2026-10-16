import { expect, test } from "bun:test";
import { parseRequest } from "../../src/responses/parser";
import { toolChoiceSchema } from "../../src/responses/schema";
import { toolIdentityKey } from "../../src/types";

test("required allowed_tools with an empty list is rejected at the request boundary", () => {
  const choice = { type: "allowed_tools", mode: "required", tools: [] };
  expect(toolChoiceSchema.safeParse(choice).success).toBe(false);
  expect(() => parseRequest({ model: "fixture", tool_choice: choice })).toThrow(/required.*at least one tool/);
});

test("auto allowed_tools with an empty list still forbids calls and preserves original source", () => {
  const body = { model: "fixture", tool_choice: { type: "allowed_tools", mode: "auto", tools: [] } };
  const original = structuredClone(body);
  const parsed = parseRequest(body);
  expect(parsed.options.toolChoice).toBe("none");
  expect(parsed.context.source?.controls.tool_choice).toEqual(original.tool_choice);
  expect(parsed._rawBody).toBe(body);
  expect(body).toEqual(original);
});

for (const type of ["function", "custom"] as const) {
  test(`explicit ${type} choice cannot silently select the opposite declared kind`, () => {
    const tools = [{ type: "namespace", name: "fixture", tools: [{ type, name: "run", parameters: {} }] }];
    const opposite = { type: type === "function" ? "custom" : "function", namespace: "fixture", name: "run" };
    for (const choice of [opposite, { type: "allowed_tools", mode: "required", tools: [opposite] }]) {
      expect(() => parseRequest({ model: "fixture", tools, tool_choice: choice })).toThrow(/kind/);
    }
    const choice = { type, namespace: "fixture", name: "run" };
    const body = { model: "fixture", tools, tool_choice: choice };
    const original = structuredClone(body);
    const parsed = parseRequest(body);
    expect(parsed.options.toolChoice).toEqual({ name: toolIdentityKey("fixture", "run") });
    expect(parsed.context.source?.tools).toEqual(tools);
    expect(parsed.context.source?.controls.tool_choice).toEqual(choice);
    expect(body).toEqual(original);
  });
}
