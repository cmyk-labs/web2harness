export interface ChatGptWebAdapterErrorOptions {
  status: number;
  errorType: string;
  code: string;
  retryable: boolean;
  cause?: unknown;
}

export class ChatGptWebAdapterError extends Error {
  readonly status: number;
  readonly errorType: string;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: ChatGptWebAdapterErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ChatGptWebAdapterError";
    this.status = options.status;
    this.errorType = options.errorType;
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

export function chatGptMarkdownFailure(language: "en" | "zh-CN" = "en", cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(language === "zh-CN"
    ? "网页回答的最终内容无法与已读取内容可靠对齐，结果未能完整交付。若浏览器中仍有失败页面，可使用“复制回答”保存未经验证的可见文本。"
    : "The final Web answer could not be reliably aligned with the observed content, so delivery could not be completed. If the failed page is still available, use Copy answer to save its unverified visible text.",
  { status: 502, errorType: "server_error", code: "browser_stream_inconsistent", retryable: false, cause });
}

// Fixed, payload-free causes survive the broker/helper boundaries. An accepted Web request is
// never safe to resend merely because its response could not be observed or validated.
const responseFailureMessages = {
  chatgpt_empty_response: "ChatGPT ended this Web round without a usable reply or an accepted tool call.",
  chatgpt_response_too_large: "The ChatGPT reply exceeds the supported response size.",
  chatgpt_assistant_turn_missing: "ChatGPT accepted the message but did not expose its assistant turn in the DOM.",
  chatgpt_dom_unresponsive: "ChatGPT accepted the message, but its DOM remained unresponsive after the allowed same-page rebinds.",
  chatgpt_response_timeout: "The ChatGPT Web round exceeded its configured response deadline.",
} as const;
export type ChatGptResponseFailureCode = keyof typeof responseFailureMessages;

export function isChatGptResponseFailureCode(code: unknown): code is ChatGptResponseFailureCode {
  return typeof code === "string" && Object.hasOwn(responseFailureMessages, code);
}

export function chatGptResponseFailure(code: ChatGptResponseFailureCode, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(responseFailureMessages[code], {
    status: 502, errorType: "server_error", code, retryable: false, ...(cause === undefined ? {} : { cause }),
  });
}

// Only the compaction owner may signal this after the broker accepts its one-shot handoff.
// It cancels browser observation, while the accepted summary remains the native result.
export class ChatGptCompactionHandoffAccepted extends DOMException {
  constructor() {
    super("Structured compaction handoff accepted", "AbortError");
  }
}

export function chatGptBrowserTabClosedError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The ChatGPT browser tab was closed, so the Codex turn was cancelled.",
    {
      status: 499,
      errorType: "client_closed_request",
      code: "client_cancelled",
      retryable: false,
    },
  );
}

export function chatGptTurnSupersededError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "A newer Codex instruction superseded this ChatGPT response.",
    { status: 499, errorType: "client_closed_request", code: "client_cancelled", retryable: false },
  );
}

export function chatGptStoppedThinkingError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "ChatGPT displayed 'Stopped thinking' and could not continue this response. "
    + "A ChatGPT Web usage limit may have been reached. Check the ChatGPT tab for the exact reason before retrying.",
    {
      status: 502,
      errorType: "server_error",
      code: "chatgpt_stopped_thinking",
      retryable: false,
    },
  );
}

export function chatGptRetainedConversationUnavailableError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The retained ChatGPT conversation is no longer available.",
    {
      status: 409,
      errorType: "invalid_request_error",
      code: "compaction_source_unavailable",
      retryable: false,
    },
  );
}
