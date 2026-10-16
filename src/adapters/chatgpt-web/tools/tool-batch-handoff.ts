import Ajv from "ajv";
import { createHash, randomUUID } from "node:crypto";
import { toolIdentityKey, type CodexRequestOptions, type CodexTool } from "../../../types";
import type { BrokerToolRequest } from "./turn-broker";
import { validateDeclaredToolCallBatch } from "./tool-call-policy";
import { chatGptResponseFailure } from "../adapter-error";
import { modelToolChoice } from "../../../responses/tool-choice";

export const TOOL_BATCH_HANDOFF_PROTOCOL = "web2harness-handoff-v1" as const;
export type HandoffToolPolicy = Pick<CodexRequestOptions, "toolChoice" | "parallelToolCalls">;
export interface HandoffCall {
  name: string;
  namespace?: string;
  arguments?: Record<string, unknown>;
  input?: string;
}
export interface HandoffReceipt {
  protocol: typeof TOOL_BATCH_HANDOFF_PROTOCOL;
  round_id: string;
  batch_id: string;
  call_ids: string[];
  execution_state: "not_executed";
  next_action: "yield_web_turn" | "end_web_response";
  sealed?: true;
}
export interface HandoffRoundState {
  round_id: string;
  round_state: "open" | "submitted" | "finished";
  sealed: boolean;
  next_action: "continue_current_round" | "end_web_response";
}
export type HandoffTerminal = { kind: "tools"; batchId: string } | { kind: "final"; answer: string };
/** Persist before exposing calls to Codex. Contains no tool input, result, token or private path. */
export interface HandoffDeliveryReceipt {
  protocol: typeof TOOL_BATCH_HANDOFF_PROTOCOL;
  roundId: string;
  batchId: string;
  callIds: string[];
  digest: string;
  state: "delivery_prepared";
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

/** One Web inference round, not a task/session and not an executor. */
export class ToolBatchHandoff {
  readonly roundId = `round_${randomUUID()}`;
  private readonly tools: CodexTool[];
  private readonly policy: HandoffToolPolicy;
  private batch?: { submissionId: string; digest: string; requests: BrokerToolRequest[]; receipt: HandoffReceipt };
  private terminal?: HandoffTerminal;
  private physicallySettled = false;
  private deliveryRecorded = false;
  private cancelled = false;

  constructor(tools: readonly CodexTool[], policy: HandoffToolPolicy = {}, private readonly allowBrowserReply = false) {
    this.tools = structuredClone([...tools]);
    this.policy = structuredClone(policy);
  }

  get canFinishWebRound(): boolean { return !this.cancelled && this.terminal !== undefined; }
  /** Automatic browser owner may commit observed prose; never bypass an unsealed batch. */
  get canAcceptBrowserReply(): boolean {
    return this.allowBrowserReply && !this.cancelled && !this.batch && !this.terminal;
  }
  get terminalIntent(): HandoffTerminal | undefined { return this.terminal && structuredClone(this.terminal); }
  get roundState(): HandoffRoundState {
    this.assertActive();
    return {
      round_id: this.roundId,
      round_state: this.terminal?.kind === "final" ? "finished" : this.batch ? "submitted" : "open",
      sealed: this.terminal !== undefined,
      // A legacy two-step submission still needs its yield before the Web response can end.
      next_action: this.canFinishWebRound ? "end_web_response" : "continue_current_round",
    };
  }
  get callControls() {
    return { tool_choice: modelToolChoice(this.policy.toolChoice, this.tools),
      parallel_tool_calls: this.policy.parallelToolCalls ?? true,
      max_calls_per_batch: this.policy.parallelToolCalls === false ? 1 : 32 };
  }

  submit(submissionId: string, calls: HandoffCall[]): HandoffReceipt {
    this.assertActive();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(submissionId)) throw new Error("Invalid handoff submission_id");
    if (!Array.isArray(calls) || calls.length < 1 || calls.length > 32) throw new Error("Handoff requires 1 to 32 calls");
    const json = JSON.stringify(calls);
    if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new Error("Handoff batch exceeds 8 MiB");
    // Detach JSON wire data rather than retaining references supplied by the caller.
    const copy = JSON.parse(json) as HandoffCall[];
    const digest = createHash("sha256").update(canonical(copy)).digest("hex");
    if (this.batch) {
      if (this.batch.submissionId !== submissionId || this.batch.digest !== digest) {
        throw new Error("This Web round already has a different batch; do not submit another batch");
      }
      return structuredClone(this.batch.receipt);
    }
    if (this.terminal) throw new Error("Web round is already sealed");
    const available = new Map(this.tools.map(tool => [toolIdentityKey(tool.namespace, tool.name), tool]));
    const ajv = new Ajv({ strict: false, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false, validateFormats: false });
    const requests = copy.map(call => {
      if (!call || typeof call !== "object" || Array.isArray(call)
        || typeof call.name !== "string" || !call.name
        || (call.namespace !== undefined && (typeof call.namespace !== "string" || !call.namespace))
        || Object.keys(call).some(key => !["name", "namespace", "arguments", "input"].includes(key))) {
        throw new Error("Invalid handoff tool call");
      }
      const wireName = toolIdentityKey(call.namespace, call.name);
      const tool = available.get(wireName);
      if (!tool) throw new Error("Tool identity is not available in the active Codex request");
      const freeform = tool.freeform === true;
      if (freeform) {
        if (typeof call.input !== "string" || call.arguments !== undefined) throw new Error("Freeform tool requires input only");
      } else {
        if (call.input !== undefined || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
          throw new Error("Function tool requires arguments only");
        }
        // Codex remains authoritative (including custom formats). As in native tools, a
        // schema unsupported by this validator is forwarded unchanged, never repaired.
        let validate;
        try { validate = ajv.compile(tool.parameters); } catch { /* authoritative Codex validation */ }
        if (validate && !validate(call.arguments)) throw new Error("Tool arguments do not match the declared schema");
      }
      return { callId: `call_${randomUUID()}`, wireName, freeform,
        ...(freeform ? { input: call.input! } : { arguments: call.arguments! }) };
    });
    validateDeclaredToolCallBatch(this.tools, this.policy, requests);
    const receipt: HandoffReceipt = {
      protocol: TOOL_BATCH_HANDOFF_PROTOCOL, round_id: this.roundId,
      batch_id: `batch_${randomUUID()}`, call_ids: requests.map(call => call.callId),
      execution_state: "not_executed", next_action: "yield_web_turn",
    };
    this.batch = { submissionId, digest, requests, receipt };
    return structuredClone(receipt);
  }

  seal(batchId: string): HandoffTerminal {
    this.assertActive();
    if (!this.batch || this.batch.receipt.batch_id !== batchId) throw new Error("Unknown handoff batch_id");
    if (this.terminal?.kind === "final") throw new Error("Web round already has a final answer");
    this.terminal = { kind: "tools", batchId };
    return structuredClone(this.terminal);
  }

  finish(answer: string): HandoffTerminal {
    this.assertActive();
    if (this.batch) throw new Error("Cannot finish the task with a pending handoff batch");
    if (typeof answer !== "string" || !answer.trim()) throw chatGptResponseFailure("chatgpt_empty_response");
    if (answer.length > 5_000_000) throw chatGptResponseFailure("chatgpt_response_too_large");
    validateDeclaredToolCallBatch(this.tools, this.policy, []);
    if (this.terminal && (this.terminal.kind !== "final" || this.terminal.answer !== answer)) throw new Error("Conflicting final answer");
    this.terminal = { kind: "final", answer };
    return structuredClone(this.terminal);
  }

  /** Owner only, AFTER completion fence and actual browser/helper cleanup have succeeded. */
  confirmPhysicalSettlement(): void {
    this.assertActive();
    if (!this.terminal) throw new Error("Web round has not yielded or finished");
    this.physicallySettled = true;
  }

  /** The owner must supply a durable, idempotent write; failure prevents any delivery. */
  takeForDelivery(persist: (receipt: HandoffDeliveryReceipt) => void): BrokerToolRequest[] {
    this.assertActive();
    if (!this.physicallySettled || this.terminal?.kind !== "tools" || !this.batch) throw new Error("Handoff is not physically settled");
    if (!this.deliveryRecorded) {
      const recorded: unknown = persist({ protocol: TOOL_BATCH_HANDOFF_PROTOCOL, roundId: this.roundId,
        batchId: this.batch.receipt.batch_id, callIds: [...this.batch.receipt.call_ids], digest: this.batch.digest, state: "delivery_prepared" });
      if (recorded && typeof (recorded as { then?: unknown }).then === "function") throw new Error("Handoff receipt persistence must finish synchronously");
      this.deliveryRecorded = true;
    }
    return structuredClone(this.batch.requests);
  }

  cancel(): void { this.cancelled = true; }
  private assertActive(): void { if (this.cancelled) throw new Error("Handoff round is cancelled"); }
}
