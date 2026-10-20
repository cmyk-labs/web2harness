import { BRIDGE_COMPACTION_PREFIX } from "./compaction";
import { BRIDGE_REASONING_PREFIX, decodeReasoningEnvelope } from "./reasoning-envelope";

export type ContextCompatibilityCode =
  | "encrypted_agent_message"
  | "encrypted_reasoning"
  | "encrypted_compaction"
  | "encrypted_tool_output"
  | "encrypted_function_arguments"
  | "unsupported_encrypted_context"
  | "invalid_encrypted_payload"
  | "invalid_bridge_envelope"
  | "invalid_context_input";

export type ContextCompatibilityItemType =
  | "agent_message" | "reasoning" | "compaction" | "compaction_summary" | "context_compaction"
  | "message" | "function_call" | "custom_tool_call"
  | "function_call_output" | "custom_tool_call_output" | "other";

export interface ContextCompatibilityIssue {
  code: ContextCompatibilityCode;
  /** Index in the expanded input, not a thread ID, response ID or tool call ID. */
  itemIndex: number | null;
  itemType: ContextCompatibilityItemType;
  /** JSON Pointer built only from protocol field names and array indices. */
  path: string;
  /** Retrying the identical payload on the selected Web route cannot resolve this. */
  retryable: false;
  limitation: "source_backend" | "request_encoding" | "bridge_protocol";
  nextAction: {
    code: "require_complete_plaintext_delivery" | "require_supported_context_export" | "restore_original_encoding" | "verify_protocol_support";
    message: string;
  };
}

export type ContextCompatibilityResult = {
  /** Only checks encrypted context forms. This is not a full capability/schema verdict. */
  status: "compatible";
  issueCount: 0;
  issuesTruncated: false;
  issues: [];
} | {
  status: "blocked";
  retryable: false;
  issueCount: number;
  issuesTruncated: boolean;
  issues: ContextCompatibilityIssue[];
};

/** Keep diagnostics bounded without stopping inspection of the remaining input. */
const MAX_REPORTED_ISSUES = 64;
const itemTypes = new Set<ContextCompatibilityItemType>([
  "agent_message", "reasoning", "compaction", "compaction_summary", "context_compaction", "message",
  "function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output",
]);
const compactionTypes = new Set(["compaction", "compaction_summary", "context_compaction"]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeItemType(item: Record<string, unknown>): ContextCompatibilityItemType {
  const type = item.type ?? (typeof item.role === "string" ? "message" : undefined);
  return itemTypes.has(type as ContextCompatibilityItemType) ? type as ContextCompatibilityItemType : "other";
}

function actionFor(code: ContextCompatibilityCode): ContextCompatibilityIssue["nextAction"] {
  if (code === "encrypted_reasoning") {
    return {
      code: "require_supported_context_export",
      message: "Preserve the original context for lossless recovery. Alternatively, explicitly set "
        + "X-Web2Harness-Reasoning-Migration: visible-history to restart reasoning from the visible history. "
        + "This does not restore encrypted reasoning; other encrypted context still requires its original source.",
    };
  }
  if (code === "unsupported_encrypted_context") {
    return {
      code: "verify_protocol_support",
      message: "Preserve the complete item and verify its encrypted-content protocol with its producer before adding bridge support. "
        + "This unknown container does not establish a readable fallback or an account problem.",
    };
  }
  if (code === "encrypted_agent_message" || code === "encrypted_function_arguments") {
    return {
      code: "require_complete_plaintext_delivery",
      message: "The originating Codex/backend must provide a supported complete plaintext delivery, if it retains the complete original. "
        + "The V2 plaintext marker applies to original plaintext collaboration calls; it cannot decrypt existing ciphertext. "
        + "Preserve this request and do not re-execute tools to reconstruct it.",
    };
  }
  if (code === "invalid_bridge_envelope" || code === "invalid_encrypted_payload" || code === "invalid_context_input") {
    return {
      code: "restore_original_encoding",
      message: "Restore the original complete item from its producer using the supported wire encoding, then validate again. "
        + "A new envelope format requires bridge support before replay. "
        + "Do not repair it by dropping fields, substituting a summary, or replaying tool side effects.",
    };
  }
  return {
    code: "require_supported_context_export",
    message: "Keep the original context intact. The selected Web route cannot decode this source-backend state. "
      + "An authorized source backend would need to provide a supported complete context export; this bridge has no verified conversion. "
      + "Visible summaries and adjacent plaintext do not prove completeness.",
  };
}

/**
 * Our transparent envelopes are reversible encodings, not native encryption. Be stricter than
 * Buffer's permissive base64 decoder: corrupt bytes must not become invented replacement text.
 * A future/unknown reasoning envelope field must not silently disappear in the existing decoder.
 */
function validBridgeEnvelope(value: string, type: ContextCompatibilityItemType): boolean {
  const prefix = type === "reasoning" ? BRIDGE_REASONING_PREFIX : BRIDGE_COMPACTION_PREFIX;
  if (!value.startsWith(prefix)) return false;
  const payload = value.slice(prefix.length);
  const bytes = Buffer.from(payload, "base64");
  if (bytes.toString("base64") !== payload) return false;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return false;
  if (type !== "reasoning") return true;
  try {
    const envelope: unknown = JSON.parse(text);
    if (!record(envelope)) return false;
    for (const [key, field] of Object.entries(envelope)) {
      if (key === "sig" || key === "txt") {
        if (typeof field !== "string") return false;
      } else if (key === "red") {
        if (!Array.isArray(field) || !field.every(part => typeof part === "string")) return false;
      } else return false;
    }
    return decodeReasoningEnvelope(value) !== null;
  } catch {
    return false;
  }
}

function opaqueCode(type: ContextCompatibilityItemType): ContextCompatibilityCode {
  if (type === "agent_message") return "encrypted_agent_message";
  if (type === "reasoning") return "encrypted_reasoning";
  if (compactionTypes.has(type)) return "encrypted_compaction";
  if (type === "function_call_output" || type === "custom_tool_call_output") return "encrypted_tool_output";
  return "unsupported_encrypted_context";
}

/**
 * Read-only preflight for the fully expanded Responses `input` on a Web route. Call before
 * browser/queue admission (including compact requests), after resolving previous_response_id.
 * Native passthrough must not use this Web-only gate. This never rewrites or returns content.
 *
 * Codex a8964cb1bad67bc26a826fb07d1bef99c6a3f008: tools/router.rs only recognizes [] as a
 * plaintext delivery marker for collaboration spawn_agent/send_message/followup_task. Its
 * protocol/models.rs plaintext_agent_message_content rejects ANY encrypted block, even when
 * plaintext is adjacent. The marker is not an inbound decryption/completeness certificate.
 *
 * No supported conversion of native reasoning/compaction ciphertext was established. Summary
 * text, a preceding transcript, or ocx prefixes in an agent/tool result are not substitutes.
 * Missing encryption metadata is not inferred from arbitrary argument/text contents (Codex
 * can strip encrypted_function_args on non-OpenAI requests). Schema/tool validation remains
 * the caller's responsibility; a compatible result proves neither account access nor parity.
 */
export function preflightContextCompatibility(input: unknown): ContextCompatibilityResult {
  const issues: ContextCompatibilityIssue[] = [];
  let issueCount = 0;
  const add = (code: ContextCompatibilityCode, itemIndex: number | null,
    itemType: ContextCompatibilityItemType, path: string): void => {
    issueCount += 1;
    if (issues.length >= MAX_REPORTED_ISSUES) return;
    issues.push({
      code, itemIndex, itemType, path, retryable: false,
      limitation: code.startsWith("invalid_") ? "request_encoding"
        : code === "unsupported_encrypted_context" ? "bridge_protocol" : "source_backend",
      nextAction: actionFor(code),
    });
  };

  if (typeof input !== "string" && !Array.isArray(input)) {
    add("invalid_context_input", null, "other", "/input");
  }
  if (Array.isArray(input)) {
    input.forEach((item: unknown, index) => {
      const path = `/input/${index}`;
      if (!record(item)) {
        add("invalid_context_input", index, "other", path);
        return;
      }
      const type = safeItemType(item);
      const inspectEncrypted = (value: unknown, location: string, allowEnvelope: boolean): void => {
        if (typeof value !== "string" || value.length === 0) {
          add("invalid_encrypted_payload", index, type, location);
          return;
        }
        if (allowEnvelope && (value.startsWith(BRIDGE_REASONING_PREFIX) || value.startsWith(BRIDGE_COMPACTION_PREFIX))) {
          if (!validBridgeEnvelope(value, type)) add("invalid_bridge_envelope", index, type, location);
          return;
        }
        add(opaqueCode(type), index, type, location);
      };

      // Reasoning and local context_compaction may legitimately omit/null this optional field.
      // A compaction checkpoint, in contrast, must carry its complete encoded payload.
      if (item.encrypted_content !== undefined && item.encrypted_content !== null) {
        inspectEncrypted(item.encrypted_content, `${path}/encrypted_content`, type === "reasoning" || compactionTypes.has(type));
      } else if (type === "compaction" || type === "compaction_summary" || item.type === "encrypted_content") {
        add("invalid_encrypted_payload", index, type, `${path}/encrypted_content`);
      }

      // Inspect protocol content containers only, never tool schemas, user text or JSON strings.
      for (const field of ["content", "summary", "output"] as const) {
        const blocks = item[field];
        if (!Array.isArray(blocks)) continue;
        blocks.forEach((block: unknown, blockIndex) => {
          if (!record(block)) return;
          if (block.type === "encrypted_content" || (block.encrypted_content !== undefined && block.encrypted_content !== null)) {
            // No transparent agent_message/tool-output envelope is defined by our protocol.
            inspectEncrypted(block.encrypted_content, `${path}/${field}/${blockIndex}/encrypted_content`, false);
          }
        });
      }

      // This list names encrypted arguments, not their values. Do not echo its entries or
      // derive diagnostic paths from them. An empty list grants no exemption to other items.
      if (type === "function_call" && item.encrypted_function_args !== undefined && item.encrypted_function_args !== null) {
        const args = item.encrypted_function_args;
        if (!Array.isArray(args) || !args.every(name => typeof name === "string")) {
          add("invalid_encrypted_payload", index, type, `${path}/encrypted_function_args`);
        } else if (args.length > 0) {
          add("encrypted_function_arguments", index, type, `${path}/encrypted_function_args`);
        }
      }
    });
  }
  return issueCount === 0
    ? { status: "compatible", issueCount: 0, issuesTruncated: false, issues: [] }
    : { status: "blocked", retryable: false, issueCount, issuesTruncated: issueCount > issues.length, issues };
}

/** An explicit request-level choice, never inferred from a model answer or plaintext neighbor.
 * Only top-level native reasoning state may be reset. Every visible field and original input
 * remains intact; unique compaction/agent/tool content and malformed encodings stay blocked.
 */
export function migrateVisibleReasoning(input: unknown): { input: unknown; resetItemCount: number } {
  if (!Array.isArray(input)) return { input, resetItemCount: 0 };
  let resetItemCount = 0;
  const migrated = input.map(item => {
    if (!record(item) || item.type !== "reasoning" || typeof item.encrypted_content !== "string"
      || !item.encrypted_content || item.encrypted_content.startsWith(BRIDGE_REASONING_PREFIX)
      || item.encrypted_content.startsWith(BRIDGE_COMPACTION_PREFIX)) return item;
    const { encrypted_content: _opaque, ...visible } = item;
    resetItemCount++;
    return visible;
  });
  if (!resetItemCount || preflightContextCompatibility(migrated).status === "blocked") return { input, resetItemCount: 0 };
  return { input: migrated, resetItemCount };
}
