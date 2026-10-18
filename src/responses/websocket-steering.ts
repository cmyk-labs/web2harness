/** Pure Responses steering shapes. No model runner, authentication or history cache. */
export type WebSocketJson = Record<string, unknown>;
export type SteerValidation = { ok: true } | { ok: false; code: string; message: string };
export type SteerTarget = { responseId: string; requestBody: Readonly<WebSocketJson> };

export const isObject = (value: unknown): value is WebSocketJson => value !== null && typeof value === "object" && !Array.isArray(value);

export function validSteeringInput(input: unknown): boolean {
  if (typeof input === "string") return true;
  return Array.isArray(input) && input.length > 0 && input.every(item => {
    if (!isObject(item) || item.role !== "user" || (item.type !== undefined && item.type !== "message")
      || Object.keys(item).some(key => !["type", "role", "content"].includes(key))) return false;
    if (typeof item.content === "string") return true;
    return Array.isArray(item.content) && item.content.length > 0 && item.content.every(part => {
      if (!isObject(part)) return false;
      if (part.type === "input_text") return typeof part.text === "string";
      if (part.type === "input_image") return typeof part.image_url === "string" || typeof part.file_id === "string";
      if (part.type === "input_file") return [part.file_id, part.file_data, part.file_url].some(value => typeof value === "string");
      return false;
    });
  });
}

export function inputItems(input: unknown): unknown[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  return Array.isArray(input) ? input : [];
}

const clientCalls: Record<string, string> = {
  function_call: "function_call_output", custom_tool_call: "custom_tool_call_output",
  computer_call: "computer_call_output", local_shell_call: "local_shell_call_output",
  shell_call: "shell_call_output", apply_patch_call: "apply_patch_call_output",
};
const completedServerItems = new Set([
  "message", "reasoning", "web_search_call", "file_search_call", "code_interpreter_call",
  "image_generation_call", "mcp_call", "mcp_list_tools",
]);

/** Unknown output kinds fail closed instead of incorrectly generating past an external tool. */
export function requiredSteeringInput(output: unknown): WebSocketJson[] | undefined {
  if (!Array.isArray(output)) return undefined;
  const required: WebSocketJson[] = [];
  for (const item of output) {
    if (!isObject(item) || typeof item.type !== "string") return undefined;
    if (item.type === "mcp_approval_request") {
      if (typeof item.id !== "string") return undefined;
      required.push({ type: "mcp_approval_response", approval_request_id: item.id });
    } else if (Object.hasOwn(clientCalls, item.type)) {
      if (typeof item.call_id !== "string") return undefined;
      const type = clientCalls[item.type];
      // Hosted shell work may include its completed result in this same response.
      if (output.some(result => isObject(result) && result.type === type && result.call_id === item.call_id)) continue;
      required.push({ type, call_id: item.call_id,
        ...(item.type === "function_call" && typeof item.name === "string" ? { name: item.name } : {}) });
    } else if (!completedServerItems.has(item.type) && !Object.values(clientCalls).includes(item.type)) return undefined;
  }
  return required;
}

export function hasRequiredInput(input: unknown, required: WebSocketJson[]): boolean {
  if (!Array.isArray(input)) return false;
  return required.every(stub => input.some(item => {
    if (!isObject(item) || item.type !== stub.type) return false;
    if (stub.type === "mcp_approval_response") return item.approval_request_id === stub.approval_request_id && typeof item.approve === "boolean";
    if (stub.type === "apply_patch_call_output") return item.call_id === stub.call_id && ["completed", "failed"].includes(String(item.status));
    return item.call_id === stub.call_id && Object.hasOwn(item, "output");
  }));
}

type Submission = { id?: string; parent: string; input: unknown; items?: WebSocketJson[]; bytes: number; controller: AbortController; accepted: boolean };
type Target = {
  id: string; streamId?: string; body: WebSocketJson; phase: "active" | "finishing" | "waiting";
  prepareOnly: boolean;
  submissions: Submission[]; validation: Promise<void>; required: WebSocketJson[];
};
export type SteeringJob = {
  body: WebSocketJson; prepareOnly: boolean; claimed?: Submission[]; target?: Target;
};
export interface SteeringOptions {
  validate?: (request: Request, target: SteerTarget) => Promise<SteerValidation>;
  request(body: WebSocketJson, signal: AbortSignal): Request;
  send(event: WebSocketJson, streamId?: string): Promise<void>;
  enqueue(job: SteeringJob, streamId?: string): boolean;
  accepting(): boolean;
  maxSubmissions: number;
  maxBytes: number;
  validationTimeoutMs: number;
}

/** Connection-local ownership of steering submissions, never a response/history cache.
 * Only natural completion boundaries are supported. No abort is presented as a safe stop.
 */
export class WebSocketSteering {
  private targets = new Map<string, Target>();
  private completed = new Set<string>();
  private submissions = new Set<Submission>();
  private bytes = 0;
  private closed = false;
  constructor(private options: SteeringOptions) {}

  private release(submission: Submission): void {
    if (this.submissions.delete(submission)) this.bytes -= submission.bytes;
  }

  private forget(target: Target): void {
    if (this.targets.get(target.id) === target) this.targets.delete(target.id);
    this.completed.add(target.id);
    if (this.completed.size > 64) this.completed.delete(this.completed.values().next().value!);
  }

  private failed(input: unknown, parent: unknown, code: string, message: string, streamId?: string, id?: string): Promise<void> {
    return this.options.send({ type: "response.steer.failed", steer: {
      ...(id ? { id } : {}), previous_response_id: parent ?? null, input: input ?? null,
    }, error: { code, message } }, streamId);
  }

  private async returnSubmissions(submissions: Submission[], streamId: string | undefined, code: string, message: string): Promise<void> {
    for (const submission of submissions) {
      this.release(submission);
      if (!this.closed) await this.failed(submission.input, submission.parent, code, message, streamId, submission.id);
    }
  }

  async accept(event: WebSocketJson): Promise<void> {
    const parent = event.previous_response_id;
    const target = typeof parent === "string" ? this.targets.get(parent) : undefined;
    const fail = (code: string, message: string) => this.failed(event.input, parent, code, message, target?.streamId);
    if (Object.keys(event).some(key => !["type", "previous_response_id", "input"].includes(key))
      || typeof parent !== "string" || !parent || !validSteeringInput(event.input)) {
      await fail("invalid_input", "Steering accepts only previous_response_id and string or user-message input."); return;
    }
    if (!target) {
      await fail(this.completed.has(parent) ? "response_already_completed" : "response_not_found", "The target response is not active on this connection."); return;
    }
    if (target.phase !== "active" || !this.options.accepting()) {
      await fail("response_not_active", "The response is no longer accepting steering input."); return;
    }
    if (!this.options.validate || target.prepareOnly) {
      await fail("steering_not_supported", "This execution route or preparation operation does not support steering."); return;
    }
    const bytes = Buffer.byteLength(JSON.stringify(event.input));
    if (this.submissions.size >= this.options.maxSubmissions || this.bytes + bytes > this.options.maxBytes) {
      await fail("too_many_pending_steers", "The connection's bounded steering input limit has been reached."); return;
    }
    const submission: Submission = { parent, input: event.input, bytes, controller: new AbortController(), accepted: false };
    this.submissions.add(submission); this.bytes += bytes;
    target.submissions.push(submission);
    // Reserve synchronously before awaiting validation. Completion waits for this tail,
    // and acknowledgements retain submission order even if validation finishes out of order.
    const validation = this.validate(submission, target);
    target.validation = target.validation.then(async () => {
      const result = await validation;
      if (this.closed) { this.release(submission); return; }
      if (!result.ok || !this.options.accepting()) {
        target.submissions = target.submissions.filter(item => item !== submission);
        this.release(submission);
        await fail(result.ok ? "response_not_active" : result.code, result.ok ? "Responses server is draining." : result.message);
        return;
      }
      submission.id = `steer_${crypto.randomUUID().replaceAll("-", "")}`;
      // A stable Responses user-item identity advances the shared user revision. Never
      // change task/turn metadata, accept a caller-supplied ID, or rewrite failure echoes.
      submission.items = inputItems(submission.input).map((item, index) => ({
        ...(item as WebSocketJson), type: "message", id: `msg_${submission.id}_${index}`,
      }));
      submission.accepted = true;
      await this.options.send({ type: "response.steer.accepted", steer: { id: submission.id, previous_response_id: parent } }, target.streamId);
    });
    await target.validation;
  }

  private async validate(submission: Submission, target: Target): Promise<SteerValidation> {
    const aborted: SteerValidation = { ok: false, code: "steering_not_supported", message: "Shared steering validation did not complete; input was not accepted." };
    const controller = submission.controller;
    const timer = setTimeout(() => controller.abort(), this.options.validationTimeoutMs);
    let onAbort!: () => void;
    const cancelled = new Promise<SteerValidation>(resolve => {
      onAbort = () => resolve(aborted);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const body = { ...target.body, previous_response_id: target.id, input: submission.input };
      const validation = Promise.resolve().then(() => controller.signal.aborted ? aborted : this.options.validate!(this.options.request(body, controller.signal), {
        responseId: target.id, requestBody: structuredClone(target.body),
      })).catch(() => aborted);
      return await Promise.race([validation, cancelled]);
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort);
    }
  }

  /** Called only when a FIFO job actually acquires its lane, never when merely enqueued. */
  prepare(job: SteeringJob, streamId?: string): WebSocketJson | undefined {
    const parent = typeof job.body.previous_response_id === "string" ? this.targets.get(job.body.previous_response_id) : undefined;
    if (!parent || parent.phase !== "waiting" || parent.streamId !== streamId) return;
    if (job.prepareOnly || !hasRequiredInput(job.body.input, parent.required)) {
      return { type: "error", status: 400, error: { type: "invalid_request_error", code: "steering_required_input_missing",
        message: "Return all required saved tool results or approval decisions on this lane. Queued steering remains pending; no request was generated." } };
    }
    job.claimed = parent.submissions;
    job.body = { ...job.body, input: [...job.claimed.flatMap(item => item.items!), ...inputItems(job.body.input)] };
    this.forget(parent);
  }

  created(job: SteeringJob, event: WebSocketJson, streamId?: string): void {
    if (!isObject(event.response) || typeof event.response.id !== "string" || !event.response.id) return;
    if (job.target || this.targets.has(event.response.id)) throw new Error("Duplicate response.created identity");
    // The successor's response.created is the sole commit point for claimed input.
    for (const submission of job.claimed ?? []) this.release(submission);
    job.claimed = undefined;
    const target: Target = { id: event.response.id, streamId, body: job.body, prepareOnly: job.prepareOnly, phase: "active", submissions: [], validation: Promise.resolve(), required: [] };
    job.target = target;
    this.targets.set(target.id, target);
  }

  stopAccepting(job: SteeringJob): void { if (job.target) job.target.phase = "finishing"; }
  async beforeTerminal(job: SteeringJob): Promise<void> { await job.target?.validation; }

  async afterTerminal(job: SteeringJob, event: WebSocketJson | undefined, streamId?: string): Promise<void> {
    if (job.claimed?.length) {
      await this.returnSubmissions(job.claimed, streamId, "successor_creation_failed", "The successor did not reach response.created. Input was not committed; no request was replayed.");
      job.claimed = undefined;
    }
    const target = job.target;
    if (!target) return;
    const submissions = target.submissions.filter(item => item.accepted);
    if (this.closed || !submissions.length) { this.forget(target); return; }
    const required = event?.type === "response.completed" && isObject(event.response) && event.response.id === target.id
      ? requiredSteeringInput(event.response.output) : undefined;
    if (!required) {
      this.forget(target);
      await this.returnSubmissions(submissions, streamId, "response_not_active", "The response did not finish at a supported continuation boundary. Input was not committed.");
      return;
    }
    if (required.length) {
      target.phase = "waiting"; target.required = required; target.body = {};
      for (const submission of submissions) await this.options.send({ type: "response.steer.pending",
        steer: { id: submission.id, previous_response_id: target.id }, reason: "waiting_for_required_input", required_input: required }, streamId);
      return;
    }
    this.forget(target);
    const successor: SteeringJob = { body: { ...target.body, previous_response_id: target.id, input: submissions.flatMap(item => item.items!) }, prepareOnly: false, claimed: submissions };
    if (!this.options.enqueue(successor, streamId)) await this.returnSubmissions(submissions, streamId, "successor_creation_failed", "The successor could not enter the bounded response queue. Input was not committed.");
  }

  close(): void {
    this.closed = true;
    for (const submission of this.submissions) { submission.controller.abort(); this.release(submission); }
    this.targets.clear(); this.completed.clear();
  }
}
