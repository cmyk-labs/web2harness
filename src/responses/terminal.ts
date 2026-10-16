import type { AdapterEvent } from "../types";

export type AdapterTerminalEvent = Extract<AdapterEvent, { type: "done" | "incomplete" | "error" }>;
type IncompleteDetails = { reason: string; message?: string; retryable?: boolean };
export type ResponseTerminal =
  | { status: "completed"; compactionAllowed: true }
  | { status: "incomplete"; compactionAllowed: false; incompleteDetails: IncompleteDetails }
  | { status: "failed"; compactionAllowed: false };

/** Only authoritative, untruncated completion may produce replacement history. */
export function responseTerminal(event: AdapterTerminalEvent | undefined): ResponseTerminal {
  if (event?.type === "error") return { status: "failed", compactionAllowed: false };
  if (event?.type === "incomplete") return {
    status: "incomplete", compactionAllowed: false,
    incompleteDetails: {
      reason: event.reason,
      ...(event.message ? { message: event.message } : {}),
      ...(event.retryable !== undefined ? { retryable: event.retryable } : {}),
    },
  };
  if (!event || event.stopReason === "max_tokens" || event.stopReason === "content_filter") return {
    status: "incomplete", compactionAllowed: false,
    incompleteDetails: {
      reason: !event ? "adapter_eof" : event.stopReason === "max_tokens" ? "max_output_tokens" : "content_filter",
    },
  };
  return { status: "completed", compactionAllowed: true };
}
