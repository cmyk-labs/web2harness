import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { CodexJsonSchemaOutputFormat } from "../../types";
import { ChatGptWebAdapterError } from "./adapter-error";

export type ChatGptStructuredOutputValidator = (answer: string) => void;

function validationError(message: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 502,
    errorType: "server_error",
    code: "structured_output_validation_failed",
    retryable: false,
  });
}

export function createChatGptStructuredOutputValidator(
  format: CodexJsonSchemaOutputFormat | { type: "json_object" } | undefined,
): ChatGptStructuredOutputValidator | undefined {
  // Validate the complete final answer, never repair it or extract a fenced fragment.
  // This is a delivery guarantee, not Web-side constrained decoding.
  if (format?.type === "json_object") {
    return (answer: string): void => {
      let value: unknown;
      try {
        value = JSON.parse(answer);
      } catch {
        throw validationError("ChatGPT Web returned malformed JSON for Codex json_object output");
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw validationError("ChatGPT Web did not return a JSON object for Codex json_object output");
      }
    };
  }
  if (!format?.strict) return undefined;

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    validateFormats: true,
  });
  addFormats(ajv);

  let validate: ValidateFunction;
  try {
    validate = ajv.compile(format.schema as object | boolean);
  } catch (cause) {
    throw new ChatGptWebAdapterError(
      `Codex supplied an invalid strict JSON schema ${JSON.stringify(format.name)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        status: 400,
        errorType: "invalid_request_error",
        code: "invalid_output_schema",
        retryable: false,
      },
    );
  }

  return (answer: string): void => {
    let value: unknown;
    try {
      value = JSON.parse(answer);
    } catch {
      throw validationError(
        `ChatGPT Web returned malformed JSON for strict Codex output schema ${JSON.stringify(format.name)}`,
      );
    }
    if (validate(value)) return;
    const detail = ajv.errorsText(validate.errors, { separator: "; " });
    throw validationError(
      `ChatGPT Web returned JSON that does not satisfy strict Codex output schema ${JSON.stringify(format.name)}${detail ? `: ${detail}` : ""}`,
    );
  };
}
