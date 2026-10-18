import { ChatGptWebAdapterError } from "./adapter-error";

type ControlPolicy = {
  name: string;
  allowsUnspecifiedValue?: (value: unknown) => boolean;
  explanation: string;
};

const controlPolicies: readonly ControlPolicy[] = [
  {
    name: "max_output_tokens",
    explanation: "Web cannot enforce a model generation token limit, including hidden reasoning tokens.",
  },
  ...["temperature", "top_p"].map(name => ({
    name,
    explanation: "Web does not expose sampling controls; an explicit API value is not a verified Web default.",
  })),
  {
    name: "stop",
    allowsUnspecifiedValue: value => Array.isArray(value) && value.length === 0,
    explanation: "Web cannot enforce model stop sequences; trimming the delivered answer would not stop generation.",
  },
  ...["presence_penalty", "frequency_penalty"].map(name => ({
    name,
    allowsUnspecifiedValue: (value: unknown) => value === 0,
    explanation: "Web does not expose model sampling penalties.",
  })),
  {
    name: "service_tier",
    allowsUnspecifiedValue: value => value === "auto",
    explanation: "Web cannot select a Codex API service tier.",
  },
  {
    name: "background",
    allowsUnspecifiedValue: value => value === false,
    explanation: "The Web route does not implement background Responses jobs.",
  },
  {
    name: "truncation",
    allowsUnspecifiedValue: value => value === "disabled",
    explanation: "The Web route cannot silently truncate Codex input history.",
  },
];

/**
 * Check a schema-validated raw Responses body after selecting the Web route and before
 * acquiring a browser/queue slot. This is a capability check, not a request schema.
 * Native passthrough must not call it. Only top-level controls are inspected: tool
 * schemas, command max_output_tokens, historical calls and metadata remain untouched.
 * Missing/null means no override. A numeric sampling default is still an override:
 * the API's default temperature/top_p does not establish ChatGPT Web's settings.
 */
export function validateChatGptWebRequestControls(rawRequest: unknown): void {
  if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) return;
  const request = rawRequest as Record<string, unknown>;
  for (const policy of controlPolicies) {
    if (!Object.hasOwn(request, policy.name)) continue;
    const value = request[policy.name];
    if (value === undefined || value === null || policy.allowsUnspecifiedValue?.(value)) continue;
    // Never echo caller values: stop sequences and malformed fields may contain secrets.
    throw new ChatGptWebAdapterError(
      `ChatGPT Web does not support request control ${JSON.stringify(policy.name)}. ${policy.explanation}`,
      {
        status: 400,
        errorType: "invalid_request_error",
        code: "unsupported_web_request_control",
        retryable: false,
      },
    );
  }
}
