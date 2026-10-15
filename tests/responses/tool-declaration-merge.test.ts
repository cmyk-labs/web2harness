import { expect, test } from "bun:test";
import { parseRequest } from "../../src/responses/parser";
import { toolIdentityKey } from "../../src/types";

const namespace = "mcp__codex_native2_dev";
const provenance = ' This tool is part of plugin `Codex Native2 DEV`.';

function functionSpec() {
  return {
    type: "function",
    namespace,
    name: "exec_command",
    description: "Run a command in the active task. Respect its permissions.",
    parameters: {
      type: "object",
      description: "Command arguments",
      properties: {
        command: { type: "string", description: "Command to execute" },
        mode: { type: "string", enum: ["read", "write"] },
      },
      required: ["command", "mode"],
      additionalProperties: false,
    },
    strict: true,
    defer_loading: true,
  };
}

function searchOutput(spec: Record<string, unknown>, callId = "search", status = "completed") {
  return { type: "tool_search_output", call_id: callId, status, tools: [spec] };
}

function searchHistory(...specs: Record<string, unknown>[]) {
  return specs.flatMap((spec, index) => [
    { type: "tool_search_call", call_id: `search_${index}`, arguments: { query: "native command" } },
    searchOutput(spec, `search_${index}`),
  ]);
}

test("repeated tool_search accepts the exact plugin provenance suffix and selects the latest description", () => {
  const original = functionSpec();
  const annotated = { ...original, description: original.description + provenance };
  for (const specs of [[original, annotated, annotated], [annotated, original, original]]) {
    const parsed = parseRequest({ model: "test", input: searchHistory(...specs) });
    expect(parsed.context.tools).toHaveLength(1);
    expect(parsed.context.tools![0]!.description).toBe(specs.at(-1)!.description);
    expect(parsed.context.tools![0]!.specification).toEqual(specs.at(-1)!);
    expect(parsed.context.messages.filter(message => message.role === "toolResult")).toHaveLength(3);
  }
});

test.each(["Current declaration safety guidance.", "", undefined])(
  "body.tools description takes precedence over all loaded history (%j)",
  description => {
    const original = functionSpec();
    const current: Record<string, unknown> = { ...original };
    if (description === undefined) delete current.description;
    else current.description = description;
    const parsed = parseRequest({
      model: "test", tools: [current],
      input: searchHistory(original, { ...original, description: original.description + provenance }),
    });
    expect(parsed.context.tools).toHaveLength(1);
    expect(parsed.context.tools![0]!.description).toBe(description ?? "");
    expect(parsed.context.tools![0]!.specification).toEqual(current);
  },
);

test("namespace declarations use the same compatibility and body precedence rules", () => {
  const { namespace: ns, ...original } = functionSpec();
  const current = { ...original, description: "Current namespace tool guidance." };
  const declaration = (tool: Record<string, unknown>) => ({
    type: "namespace", name: ns, description: "Native tools", tools: [tool],
  });
  const loaded = { ...original, description: original.description + provenance };
  const parsed = parseRequest({
    model: "test", tools: [declaration(current)],
    input: searchHistory(declaration(original), declaration(loaded)),
  });
  expect(parsed.context.tools).toHaveLength(1);
  expect(parsed.context.tools![0]).toMatchObject({ namespace: ns, description: current.description, specification: current });
});

test("object key insertion order is immaterial at every depth without reordering source", () => {
  const original = functionSpec();
  const reordered = {
    defer_loading: true, strict: true,
    parameters: {
      additionalProperties: false,
      required: ["command", "mode"],
      properties: {
        mode: { enum: ["read", "write"], type: "string" },
        command: { description: "Command to execute", type: "string" },
      },
      description: "Command arguments", type: "object",
    },
    description: original.description, name: original.name, namespace, type: "function",
  };
  const parsed = parseRequest({ model: "test", tools: [original], input: searchHistory(reordered) });
  expect(parsed.context.tools).toHaveLength(1);
  expect(JSON.stringify(parsed.context.tools![0]!.specification)).toBe(JSON.stringify(original));
  expect(JSON.stringify(parsed.context.source!.input)).toBe(JSON.stringify(searchHistory(reordered)));
});

const conflictingChanges: Array<[string, (spec: ReturnType<typeof functionSpec>) => Record<string, unknown>]> = [
  ["parameter type", spec => ({ ...spec, parameters: { ...spec.parameters, properties: { ...spec.parameters.properties, command: { type: "number" } } } })],
  ["schema description", spec => ({ ...spec, parameters: { ...spec.parameters, description: "Changed schema guidance" } })],
  ["nested parameter description", spec => ({ ...spec, parameters: { ...spec.parameters, properties: { ...spec.parameters.properties, command: { ...spec.parameters.properties.command, description: "Changed parameter guidance" } } } })],
  ["required array order", spec => ({ ...spec, parameters: { ...spec.parameters, required: ["mode", "command"] } })],
  ["enum array order", spec => ({ ...spec, parameters: { ...spec.parameters, properties: { ...spec.parameters.properties, mode: { type: "string", enum: ["write", "read"] } } } })],
  ["additional properties", spec => ({ ...spec, parameters: { ...spec.parameters, additionalProperties: true } })],
  ["strict", spec => ({ ...spec, strict: false })],
  ["defer_loading", spec => ({ ...spec, defer_loading: false })],
  ["tool type", spec => ({ ...spec, type: "custom" })],
  ["unknown execution metadata", spec => ({ ...spec, execution: { approval: "required" } })],
  ["omitted strict", spec => { const { strict, ...rest } = spec; return rest; }],
];

test.each(conflictingChanges)("rejects %s changes in both body and history merges", (_label, change) => {
  const original = functionSpec();
  const changed = { ...change(original), description: original.description + provenance };
  const conflict = `Conflicting Codex tool identity: ${toolIdentityKey(namespace, original.name)}`;
  for (const body of [
    { tools: [original], input: searchHistory(changed) },
    { input: searchHistory(original, changed) },
    { tools: [original, changed] },
  ]) expect(() => parseRequest({ model: "test", ...body })).toThrow(conflict);
});

test("unknown metadata is compared structurally, including nested descriptions and arrays", () => {
  const original = { ...functionSpec(), execution: { description: "Approval contract", steps: ["approve", "run"] } };
  const reordered = { ...original, execution: { steps: ["approve", "run"], description: "Approval contract" } };
  expect(parseRequest({ model: "test", input: searchHistory(original, reordered) }).context.tools).toHaveLength(1);
  for (const execution of [
    { ...original.execution, description: "Different approval contract" },
    { ...original.execution, steps: ["run", "approve"] },
  ]) {
    expect(() => parseRequest({ model: "test", input: searchHistory(original, { ...original, execution }) }))
      .toThrow("Conflicting Codex tool identity");
  }
});

test("custom tools allow description changes but reject format changes", () => {
  const original = {
    type: "custom", namespace, name: "run_script", description: "Run a script",
    format: { type: "grammar", syntax: "lark", definition: 'start: "run"' },
  };
  const annotated = { ...original, description: original.description + provenance };
  const parsed = parseRequest({ model: "test", input: searchHistory(original, annotated) });
  expect(parsed.context.tools).toHaveLength(1);
  expect(parsed.context.tools![0]).toMatchObject({ freeform: true, format: original.format, description: annotated.description });
  for (const format of [
    { type: "text" },
    { ...original.format, syntax: "regex" },
    { ...original.format, definition: 'start: "different"' },
    { ...original.format, description: "Nested format metadata" },
  ]) {
    const changed = { ...annotated, format };
    expect(() => parseRequest({ model: "test", tools: [original], input: searchHistory(changed) }))
      .toThrow("Conflicting Codex tool identity");
    expect(() => parseRequest({ model: "test", input: searchHistory(original, changed) }))
      .toThrow("Conflicting Codex tool identity");
  }
});

test("failed searches neither register tools nor replace a successful declaration", () => {
  const original = functionSpec();
  const failed = searchOutput({ ...original, description: "Failed discovery", strict: false }, "failed_search", "failed");
  expect(parseRequest({ model: "test", input: [failed] }).context.tools).toBeUndefined();
  const parsed = parseRequest({ model: "test", input: [...searchHistory(original), failed] });
  expect(parsed.context.tools).toHaveLength(1);
  expect(parsed.context.tools![0]!.specification).toEqual(original);
  expect(parsed.context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true, content: JSON.stringify(failed) });
  expect(parsed.context.source!.input).toEqual([...searchHistory(original), failed]);
});

test("merging preserves verbatim source snapshots and caller declarations", () => {
  const original = functionSpec();
  const current = { ...original, description: "Current safety guidance.\nKeep this text intact." };
  const annotated = { ...original, description: original.description + provenance };
  const body = { model: "test", tools: [current], input: searchHistory(original, annotated) };
  const before = JSON.stringify(body);
  const parsed = parseRequest(body);
  const sourceTools = JSON.stringify(body.tools);
  const sourceInput = JSON.stringify(body.input);
  expect(JSON.stringify(body)).toBe(before);
  expect(JSON.stringify(parsed.context.source!.tools)).toBe(sourceTools);
  expect(JSON.stringify(parsed.context.source!.input)).toBe(sourceInput);
  for (const [index, message] of parsed.context.messages.filter(message => message.role === "toolResult").entries()) {
    expect(message.content).toBe(JSON.stringify(body.input[index * 2 + 1]));
  }
  current.description = "Caller changed";
  annotated.description = "Caller changed history";
  parsed.context.tools![0]!.description = "Runtime changed";
  parsed.context.tools![0]!.specification!.description = "Runtime specification changed";
  expect(JSON.stringify(parsed.context.source!.tools)).toBe(sourceTools);
  expect(JSON.stringify(parsed.context.source!.input)).toBe(sourceInput);
});
