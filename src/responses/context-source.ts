import type { CodexSourceContext } from "../types";

const modelControls = [
  "tool_choice", "parallel_tool_calls", "text", "reasoning", "max_output_tokens",
  "temperature", "top_p", "stop", "presence_penalty", "frequency_penalty",
] as const;

/** Copy model-visible fields only; routing, credentials and transport metadata stay private. */
export function captureSourceContext(body: unknown): CodexSourceContext {
  const request = body as Record<string, unknown>;
  const controls: Record<string, unknown> = {};
  for (const key of modelControls) {
    if (request[key] !== undefined) controls[key] = structuredClone(request[key]);
  }
  return {
    ...(request.instructions !== undefined ? { instructions: structuredClone(request.instructions as string | null) } : {}),
    input: structuredClone((request.input ?? []) as unknown[] | string),
    ...(Array.isArray(request.tools) ? { tools: structuredClone(request.tools) } : {}),
    controls,
  };
}
