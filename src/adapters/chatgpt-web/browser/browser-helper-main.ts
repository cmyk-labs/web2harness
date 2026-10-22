import { PREFIX, createDiagnosticRecord, type DiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";
import { diagnosticContext, diagnosticError, diagnosticEvent } from "../../../diagnostics";
import { abortWithDiagnostic, correlationContext, parseInterruption, readInterruption, type InterruptionEvidence } from "../../../interruption-diagnostics";
import { isCompletionFenceState, isCompletionFenceCommit, type CompletionFenceState, type CompletionFenceCommit } from "../tools/completion-fence";
import { validateContextFile } from "../prompt/context-attachments";
import { validateInputFiles } from "../prompt/file-attachments";
import { validateSkillFiles } from "../prompt/skill-attachments";
import { createInterface } from "node:readline";
import { stdin, stderr, stdout } from "node:process";
import type { CodexProviderConfig } from "../../../types";
import { ChatGptBrowserWorker, closeChatGptBrowserWorkers, type BrowserTurn } from "./browser-worker";
import { ChatGptCompactionHandoffAccepted } from "../adapter-error";
import { browserHelperError } from "./browser-helper-error";
import type { ChatGptWebCapabilities } from "../model";
import { createProcessLineWriter } from "../process-line-writer";
import { createBrowserHelperPromptSelection } from "./browser-helper-prompt-selection";
import { type CompiledChatGptWebPrompt } from "../prompt/compile";
import { ChatGptMirroredTurnProgress } from "../tools/turn-progress";
import { validSavedChatTask, type SavedChatTask } from "../../../../launcher/shared/saved-chat.cjs";
import type { ChatGptExternalTurnProgressSnapshot } from "../tools/turn-progress";

interface RunMessage {
  diagnostics?: Record<string, unknown>;
  type: "run";
  id: string;
  config: {
    appName: string;
    browserHostDescriptorPath: string;
    browserDiagnosticsPath?: string;
    turnTimeoutMs: number;
    autoApproveToolCalls: boolean;
    useSavedChats?: boolean;
  };
  turn: {
    textDelivery?: BrowserTurn["textDelivery"];
    uiLanguage?: BrowserTurn["uiLanguage"];
    traceId: string;
    attachmentTimeoutMs?: number;
    queueTicket?: import("../../../browser/request-queue-client").QueueTicket;
    modelId: string;
    reasoning?: string;
    usagePurpose?: "task" | "tool-result" | "compaction";
    modelFamily?: "5.6" | "6";
    capabilities: ChatGptWebCapabilities;
    nativeToolDefinitions?: import("../../../types").CodexTool[];
    nativeConnector?: boolean;
    resumeAvailable?: boolean;
    retainConversation?: boolean;
    requireRetainedConversation?: boolean;
    conversationKey?: string;
    savedChat?: SavedChatTask;
    compaction?: boolean;
    captureLunaCheckpoint?: boolean;
    externalProgress?: boolean;
  };
}

interface VerifyMessage {
  type: "verify";
  id: string;
  config: {
    appName: string;
    browserHostDescriptorPath: string;
    useSavedChats?: boolean;
  };
}

interface InspectMessage {
  type: "inspect";
  id: string;
  config: VerifyMessage["config"];
  detectCapabilities: boolean;
}

interface SmokeMessage {
  type: "smoke";
  id: string;
  config: VerifyMessage["config"];
  skipSend?: boolean;
}

interface LimitsMessage {
  type: "limits";
  id: string;
  config: VerifyMessage["config"];
}

type MaintenanceMessage = VerifyMessage | InspectMessage | SmokeMessage | LimitsMessage;
type InputMessage = RunMessage
  | MaintenanceMessage
  | { type: "prepared_selected_ack"; id: string; prepared: CompiledChatGptWebPrompt }
  | { type: "send_activation_ack"; id: string }
  | { type: "completion_fence_begin_ack"; id: string; requestId: number; result: CompletionFenceState }
  | { type: "completion_fence_commit_ack"; id: string; requestId: number; result: CompletionFenceCommit }
  | { type: "progress"; id: string; snapshot: ChatGptExternalTurnProgressSnapshot }
  | { type: "abort"; id: string; reason?: "compaction_handoff_accepted"; interruption?: InterruptionEvidence }
  | { type: "shutdown" };

let outputFailure: Error | undefined;
let outputFailureChannel: "protocol" | "diagnostic" | undefined;
const handleOutputFailure = (error: Error, channel: "protocol" | "diagnostic"): void => {
  if (outputFailure) return;
  outputFailure = error;
  outputFailureChannel = channel;
  void requestShutdown("helper_output_failure");
};
const protocolOutput = createProcessLineWriter(stdout, error => handleOutputFailure(error, "protocol"));
const diagnosticOutput = createProcessLineWriter(stderr, error => handleOutputFailure(error, "diagnostic"));

const writeProtocol = (message: unknown): boolean => protocolOutput.write(JSON.stringify(message));

const diagnosticAt = (level: DiagnosticRecord["level"], ...values: unknown[]): void => {
  const line = values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
  diagnosticOutput.write(line.startsWith(PREFIX) ? line : PREFIX + JSON.stringify(createDiagnosticRecord(level, "browser.output", { ...diagnosticContext.getStore(), line })));
};
const diagnostic = (...values: unknown[]): void => diagnosticAt("info", ...values);
console.info = diagnostic;
console.warn = (...values) => diagnosticAt("warning", ...values);
console.error = (...values) => diagnosticAt("error", ...values);

const abortControllers = new Map<string, AbortController>();
const turnContexts = new Map<string, Record<string, unknown>>();
function abortTurn(id: string, origin: string, reason?: unknown, parent?: InterruptionEvidence): void {
  const controller = abortControllers.get(id);
  if (controller) abortWithDiagnostic(controller, origin, reason, turnContexts.get(id) ?? { traceId: id }, parent);
}
const turnProgress = new Map<string, ChatGptMirroredTurnProgress>();
const preparedSelections = new Map<string, ReturnType<typeof createBrowserHelperPromptSelection>>();
const sendActivationWaiters = new Map<string, {
  resolve: () => void;
  reject: (error: Error) => void;
}>();
const completionFenceBeginWaiters = new Map<string, {
  requestId: number;
  resolve: (result: CompletionFenceState) => void;
  reject: (error: Error) => void;
}>();
const completionFenceCommitWaiters = new Map<string, {
  requestId: number;
  resolve: (result: CompletionFenceCommit) => void;
  reject: (error: Error) => void;
}>();
let completionFenceRequestId = 0;
let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;

function requestShutdown(origin: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  let completeShutdown!: () => void;
  shutdownPromise = new Promise<void>(resolveShutdown => {
    completeShutdown = resolveShutdown;
  });
  shuttingDown = true;
  diagnosticEvent("info", "browser.helper_shutdown", { origin, pendingCount: abortControllers.size, outputFailed: !!outputFailure,
    channel: outputFailureChannel, ...(outputFailure ? { error: diagnosticError(outputFailure) } : {}) });
  for (const id of abortControllers.keys()) abortTurn(id, origin);
  protocolOutput.close();
  diagnosticOutput.close();
  for (const selection of preparedSelections.values()) selection.cancel();
  preparedSelections.clear();
  for (const waiter of sendActivationWaiters.values()) {
    waiter.reject(new DOMException("Browser helper is shutting down", "AbortError"));
  }
  sendActivationWaiters.clear();
  for (const waiter of completionFenceBeginWaiters.values()) {
    waiter.reject(new DOMException("Browser helper is shutting down", "AbortError"));
  }
  completionFenceBeginWaiters.clear();
  for (const waiter of completionFenceCommitWaiters.values()) {
    waiter.reject(new DOMException("Browser helper is shutting down", "AbortError"));
  }
  completionFenceCommitWaiters.clear();
  input.close();
  void closeChatGptBrowserWorkers().then(
    () => {
      completeShutdown();
      process.exit(0);
    },
    error => {
      diagnostic(`Browser helper shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      completeShutdown();
      process.exit(1);
    },
  );
  return shutdownPromise;
}

async function run(message: RunMessage): Promise<void> {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(message.id) || message.id !== message.turn.traceId) {
    throw new Error("Browser helper turn identity is invalid");
  }
  if (abortControllers.has(message.id)) throw new Error(`Browser helper turn already exists: ${message.id}`);
  if (message.turn.resumeAvailable !== undefined && typeof message.turn.resumeAvailable !== "boolean") {
    throw new Error("Browser helper resume availability is invalid");
  }
  if (message.turn.nativeConnector !== undefined && typeof message.turn.nativeConnector !== "boolean") {
    throw new Error("Browser helper native connector flag is invalid");
  }
  if (message.turn.attachmentTimeoutMs !== undefined && ![120_000, 180_000, 300_000, 600_000].includes(message.turn.attachmentTimeoutMs)) {
    throw new Error("Browser helper attachment timeout is invalid");
  }
  if (message.turn.retainConversation !== undefined && typeof message.turn.retainConversation !== "boolean") {
    throw new Error("Browser helper conversation retention flag is invalid");
  }
  if (message.turn.requireRetainedConversation !== undefined
    && typeof message.turn.requireRetainedConversation !== "boolean") {
    throw new Error("Browser helper retained-conversation requirement is invalid");
  }
  if (message.turn.conversationKey !== undefined && !/^[a-f0-9]{64}$/.test(message.turn.conversationKey)) {
    throw new Error("Browser helper conversation key is invalid");
  }
  if (message.turn.savedChat !== undefined && !validSavedChatTask(message.turn.savedChat)) {
    throw new Error("Browser helper saved chat metadata is invalid");
  }
  if (message.turn.usagePurpose !== undefined && !["task", "tool-result", "compaction"].includes(message.turn.usagePurpose)) throw new Error("Invalid usage purpose");
  if (message.turn.compaction !== undefined && typeof message.turn.compaction !== "boolean") {
    throw new Error("Browser helper compaction flag is invalid");
  }
  if (message.turn.captureLunaCheckpoint !== undefined && typeof message.turn.captureLunaCheckpoint !== "boolean") {
    throw new Error("Browser helper Luna checkpoint flag is invalid");
  }
  if (message.turn.textDelivery !== undefined && !["append", "buffered"].includes(message.turn.textDelivery)) {
    throw new Error("Browser helper text delivery strategy is invalid");
  }
  if (message.turn.uiLanguage !== undefined && !["en", "zh-CN"].includes(message.turn.uiLanguage)) {
    throw new Error("Browser helper UI language is invalid");
  }
  if (message.turn.externalProgress !== undefined && typeof message.turn.externalProgress !== "boolean") {
    throw new Error("Browser helper external progress flag is invalid");
  }
  const provider: CodexProviderConfig = {
    adapter: "chatgpt-web",
    baseUrl: "https://chatgpt.com",
    chatgptWeb: {
      appName: message.config.appName,
      browserHost: "launcher",
      browserHostDescriptorPath: message.config.browserHostDescriptorPath,
      browserDiagnosticsPath: message.config.browserDiagnosticsPath,
      turnTimeoutMs: message.config.turnTimeoutMs,
      autoApproveToolCalls: message.config.autoApproveToolCalls,
      useSavedChats: message.config.useSavedChats === true,
    },
  };
  const abortController = new AbortController();
  abortControllers.set(message.id, abortController);
  const context = { ...correlationContext(message.diagnostics), traceId: message.turn.traceId };
  turnContexts.set(message.id, context);
  diagnosticEvent("info", "browser.helper_turn_bound", context);
  // The Codex MCP broker runs in the daemon process, so this mirror is the only way the worker can
  // observe that a turn is still executing while its ChatGPT DOM is unavailable. Trace ids are
  // derived deterministically and can repeat, so each run starts a fresh mirror rather than
  // inheriting revisions recorded for an earlier turn that happened to share the id.
  const progress = message.turn.externalProgress
    ? new ChatGptMirroredTurnProgress(revision => {
      if (!writeProtocol({ type: "event", id: message.id, event: "tool_batch_observed", revision })) {
        throw new Error("Browser helper could not acknowledge the observed Codex tool boundary");
      }
    })
    : undefined;
  if (progress) turnProgress.set(message.id, progress);
  const promptSelection = createBrowserHelperPromptSelection();
  preparedSelections.set(message.id, promptSelection);
  const prepareSelected = async () => ({ ...await promptSelection.wait(), release: () => {} });
  const turn: BrowserTurn = {
    traceId: message.turn.traceId,
    ...(message.turn.attachmentTimeoutMs !== undefined ? { attachmentTimeoutMs: message.turn.attachmentTimeoutMs } : {}),
    ...(message.turn.queueTicket ? { queueTicket: message.turn.queueTicket } : {}),
    modelId: message.turn.modelId,
    textDelivery: message.turn.textDelivery,
    uiLanguage: message.turn.uiLanguage,
    reasoning: message.turn.reasoning,
    usagePurpose: message.turn.usagePurpose,
    ...(message.turn.modelFamily ? { modelFamily: message.turn.modelFamily } : {}),
    capabilities: message.turn.capabilities,
    ...(message.turn.nativeToolDefinitions ? { nativeToolDefinitions: message.turn.nativeToolDefinitions } : {}),
    ...(message.turn.nativeConnector ? { nativeConnector: true } : {}),
    prepare: prepareSelected,
    ...(message.turn.resumeAvailable ? { prepareResume: prepareSelected } : {}),
    ...(message.turn.retainConversation ? { retainConversation: true } : {}),
    ...(message.turn.requireRetainedConversation ? { requireRetainedConversation: true } : {}),
    ...(message.turn.conversationKey ? { conversationKey: message.turn.conversationKey } : {}),
    ...(message.turn.savedChat ? { savedChat: message.turn.savedChat } : {}),
    abortSignal: abortController.signal,
    ...(message.turn.compaction ? { compaction: true } : {}),
    ...(progress ? {
      externalProgress: progress,
      completionFence: {
        begin: () => new Promise<CompletionFenceState>((resolve, reject) => {
          if (completionFenceBeginWaiters.has(message.id)) {
            reject(new Error("Browser helper completion fence already awaits a begin result"));
            return;
          }
          completionFenceRequestId += 1;
          const requestId = completionFenceRequestId;
          completionFenceBeginWaiters.set(message.id, { requestId, resolve, reject });
          if (!writeProtocol({ type: "event", id: message.id, event: "completion_fence_begin", requestId })) {
            completionFenceBeginWaiters.delete(message.id);
            reject(new Error("Browser helper could not begin the broker completion fence"));
          }
        }),
        commit: (revision, browserReply) => new Promise<CompletionFenceCommit>((resolve, reject) => {
          if (completionFenceCommitWaiters.has(message.id)) {
            reject(new Error("Browser helper completion fence already awaits a commit result"));
            return;
          }
          completionFenceRequestId += 1;
          const requestId = completionFenceRequestId;
          completionFenceCommitWaiters.set(message.id, { requestId, resolve, reject });
          if (!writeProtocol({ type: "event", id: message.id, event: "completion_fence_commit", requestId, revision, browserReply })) {
            completionFenceCommitWaiters.delete(message.id);
            reject(new Error("Browser helper could not commit the broker completion fence"));
          }
        }),
      },
    } : {}),
    onHeartbeat: () => writeProtocol({ type: "event", id: message.id, event: "heartbeat" }),
    onPreparedSelected: reused => {
      if (!writeProtocol({ type: "event", id: message.id, event: "prepared_selected", reused })) {
        throw new Error("Browser helper could not request prompt selection");
      }
      return promptSelection.wait().then(() => undefined);
    },
    onSendActivated: () => new Promise<void>((resolve, reject) => {
      if (sendActivationWaiters.has(message.id)) {
        reject(new Error("Browser helper Send activation already awaits acknowledgement"));
        return;
      }
      sendActivationWaiters.set(message.id, { resolve, reject });
      if (!writeProtocol({ type: "event", id: message.id, event: "send_activated" })) {
        sendActivationWaiters.delete(message.id);
        reject(new Error("Browser helper could not request the Send activation boundary"));
      }
    }),
    onResponseCompleted: () => {
      if (!writeProtocol({ type: "event", id: message.id, event: "response_completed" })) {
        throw new Error("Browser helper could not report response completion");
      }
    },
    onSubmitted: () => {
      if (!writeProtocol({ type: "event", id: message.id, event: "submitted" })) {
        throw new Error("Browser helper could not persist ChatGPT submission evidence");
      }
    },
    onReasoningSummary: (text, continuation) => writeProtocol({
      type: "event",
      id: message.id,
      event: "reasoning",
      text,
      ...(continuation ? { continuation: true } : {}),
    }),
    onCommentary: (text, continuation) => writeProtocol({ type: "event", id: message.id, event: "commentary", text, ...(continuation ? { continuation: true } : {}) }),
    onTextDelta: text => writeProtocol({ type: "event", id: message.id, event: "text", text }),
    ...(message.turn.captureLunaCheckpoint ? {
      captureLunaCheckpoint: true,
      onLunaCheckpoint: captured => writeProtocol({
        type: "event",
        id: message.id,
        event: "luna_checkpoint",
        ...captured,
      }),
    } : {}),
  };
  try {
    const text = await diagnosticContext.run(context, () => ChatGptBrowserWorker.forProvider(provider).run(turn));
    writeProtocol({ type: "result", id: message.id, text });
  } catch (error) {
    const causedByAbort = abortController.signal.aborted && (error === abortController.signal.reason || error instanceof Error && error.name === "AbortError");
    diagnosticContext.run(context, () => writeProtocol(browserHelperError(message.id, error, turn.traceId,
      causedByAbort ? readInterruption(abortController.signal) : readInterruption(error))));
  } finally {
    preparedSelections.get(message.id)?.cancel();
    preparedSelections.delete(message.id);
    const sendWaiter = sendActivationWaiters.get(message.id);
    sendActivationWaiters.delete(message.id);
    sendWaiter?.reject(new DOMException("Browser helper turn ended before Send acknowledgement", "AbortError"));
    const beginWaiter = completionFenceBeginWaiters.get(message.id);
    completionFenceBeginWaiters.delete(message.id);
    beginWaiter?.reject(new DOMException("Browser helper turn ended before completion-fence begin", "AbortError"));
    const commitWaiter = completionFenceCommitWaiters.get(message.id);
    completionFenceCommitWaiters.delete(message.id);
    commitWaiter?.reject(new DOMException("Browser helper turn ended before completion-fence commit", "AbortError"));
    abortControllers.delete(message.id);
    turnProgress.delete(message.id);
    turnContexts.delete(message.id);
  }
}

async function verify(message: VerifyMessage): Promise<void> {
  if (abortControllers.has(message.id)) throw new Error(`Browser helper maintenance operation already exists: ${message.id}`);
  const abortController = new AbortController();
  abortControllers.set(message.id, abortController);
  try {
    const worker = maintenanceWorker(message);
    writeProtocol({ type: "stage", id: message.id, sequence: 1, stage: "running" });
    const selected = await worker.verifyConnector(message.id, abortController.signal);
    writeProtocol({ type: "result", id: message.id, text: selected });
  } catch (error) {
    writeProtocol(browserHelperError(message.id, error));
  } finally {
    abortControllers.delete(message.id);
  }
}

function maintenanceWorker(message: MaintenanceMessage): ChatGptBrowserWorker {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(message.id)) {
    throw new Error("Browser helper maintenance identity is invalid");
  }
  const appName = message.config.appName?.trim();
  const browserHostDescriptorPath = message.config.browserHostDescriptorPath?.trim();
  if (!appName || appName.length > 80 || !browserHostDescriptorPath) {
    throw new Error("Browser helper maintenance config is invalid");
  }
  if (message.config.useSavedChats !== undefined && typeof message.config.useSavedChats !== "boolean") {
    throw new Error("Browser helper chat-saving selection is invalid");
  }
  const provider: CodexProviderConfig = {
    adapter: "chatgpt-web",
    baseUrl: "https://chatgpt.com",
    chatgptWeb: { appName, browserHost: "launcher", browserHostDescriptorPath,
      useSavedChats: message.type === "verify" && message.config.useSavedChats === true },
  };
  return ChatGptBrowserWorker.forProvider(provider);
}

async function maintain(message: InspectMessage | SmokeMessage | LimitsMessage): Promise<void> {
  if (abortControllers.has(message.id)) throw new Error(`Browser helper maintenance operation already exists: ${message.id}`);
  const abortController = new AbortController();
  abortControllers.set(message.id, abortController);
  try {
    const worker = maintenanceWorker(message);
    writeProtocol({ type: "stage", id: message.id, sequence: 1, stage: "running" });
    const value = message.type === "inspect"
      ? await worker.inspectSession(message.detectCapabilities, abortController.signal)
      : message.type === "limits" ? await worker.inspectLimitsPlan(abortController.signal)
      : await worker.smokeTest(abortController.signal, message.id, {
        skipSend: message.skipSend === true,
        onCheck: phase => writeProtocol({ type: "check", id: message.id, phase }),
      });
    writeProtocol({ type: "result", id: message.id, value });
  } catch (error) {
    writeProtocol(browserHelperError(message.id, error));
  } finally {
    abortControllers.delete(message.id);
  }
}

const input = createInterface({ input: stdin, crlfDelay: Infinity });
input.on("line", line => {
  if (shuttingDown) return;
  let message: InputMessage;
  try { message = JSON.parse(line) as InputMessage; }
  catch {
    writeProtocol({ type: "error", id: "protocol", message: "Browser helper received invalid JSON" });
    return;
  }
  if (message.type === "prepared_selected_ack") {
    const prepared = message.prepared;
    if (!prepared || typeof prepared.text !== "string" || !Array.isArray(prepared.images)
      || (prepared.handoffBinding !== undefined && (typeof prepared.handoffBinding !== "string" || !/^[a-f0-9]{64}$/.test(prepared.handoffBinding)))) {
      writeProtocol({ type: "error", id: message.id, message: "Browser helper prompt selection is invalid" });
      abortTurn(message.id, "helper_protocol");
      return;
    }
    try { validateSkillFiles(prepared.skillFiles); validateContextFile(prepared.contextFile); validateInputFiles(prepared.files); }
    catch (error) {
      writeProtocol(browserHelperError(message.id, error));
      abortTurn(message.id, "helper_protocol");
      return;
    }
    if ("multipart" in prepared) {
      writeProtocol({ type: "error", id: message.id, message: "Multipart context transport was removed; restart the updated runtime" });
      abortTurn(message.id, "helper_protocol");
      return;
    }
    const selection = preparedSelections.get(message.id);
    if (!selection) {
      writeProtocol({ type: "error", id: message.id, message: "Browser helper has no pending prompt selection" });
      return;
    }
    selection.select(prepared);
  } else if (message.type === "send_activation_ack") {
    const waiter = sendActivationWaiters.get(message.id);
    if (!waiter) {
      writeProtocol({ type: "error", id: message.id, message: "Browser helper has no pending Send activation" });
      return;
    }
    sendActivationWaiters.delete(message.id);
    waiter.resolve();
  } else if (message.type === "completion_fence_begin_ack") {
    if (!Number.isSafeInteger(message.requestId) || message.requestId <= 0
      || !isCompletionFenceState(message.result)) {
      writeProtocol({ type: "error", id: message.id, message: "Browser helper completion fence revision is invalid" });
      abortTurn(message.id, "helper_protocol");
      return;
    }
    const waiter = completionFenceBeginWaiters.get(message.id);
    if (!waiter || waiter.requestId !== message.requestId) return;
    completionFenceBeginWaiters.delete(message.id);
    waiter.resolve(message.result);
  } else if (message.type === "completion_fence_commit_ack") {
    if (!Number.isSafeInteger(message.requestId) || message.requestId <= 0
      || !isCompletionFenceCommit(message.result)) {
      writeProtocol({ type: "error", id: message.id, message: "Browser helper completion fence result is invalid" });
      abortTurn(message.id, "helper_protocol");
      return;
    }
    const waiter = completionFenceCommitWaiters.get(message.id);
    if (!waiter || waiter.requestId !== message.requestId) return;
    completionFenceCommitWaiters.delete(message.id);
    waiter.resolve(message.result);
  } else if (message.type === "progress") {
    // Progress is meaningful only for a turn this helper is currently running. Ignore every other
    // id so the mirror map remains owned by active turn lifecycles.
    if (!abortControllers.has(message.id)) return;
    const progress = turnProgress.get(message.id) ?? new ChatGptMirroredTurnProgress();
    turnProgress.set(message.id, progress);
    try {
      progress.apply(message.snapshot);
    } catch (error) {
      // Progress carries liveness and tool-boundary state, never response content. Invalid progress
      // cannot determine the outcome of the active ChatGPT turn, so it is logged and ignored.
      diagnostic(
        `[chatgpt-web] discarded an invalid MCP progress frame for ${message.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  } else if (message.type === "abort") {
    abortTurn(message.id, "helper_local_abort", message.reason === "compaction_handoff_accepted"
      ? new ChatGptCompactionHandoffAccepted()
      : undefined, parseInterruption(message.interruption));
    preparedSelections.get(message.id)?.cancel();
    const waiter = sendActivationWaiters.get(message.id);
    sendActivationWaiters.delete(message.id);
    waiter?.reject(new DOMException("Browser helper turn aborted before Send acknowledgement", "AbortError"));
    const beginWaiter = completionFenceBeginWaiters.get(message.id);
    completionFenceBeginWaiters.delete(message.id);
    beginWaiter?.reject(new DOMException("Browser helper turn aborted before completion-fence begin", "AbortError"));
    const commitWaiter = completionFenceCommitWaiters.get(message.id);
    completionFenceCommitWaiters.delete(message.id);
    commitWaiter?.reject(new DOMException("Browser helper turn aborted before completion-fence commit", "AbortError"));
  }
  else if (message.type === "shutdown") {
    void requestShutdown("helper_shutdown_requested");
  } else if (message.type === "verify") {
    void verify(message).catch(error => writeProtocol(browserHelperError(message.id, error)));
  } else if (message.type === "inspect" || message.type === "smoke" || message.type === "limits") {
    void maintain(message).catch(error => writeProtocol(browserHelperError(message.id, error)));
  } else if (message.type === "run") {
    void run(message).catch(error => writeProtocol(browserHelperError(message.id, error)));
  } else {
    // Never treat an unrecognised frame as a run; unsupported protocol data fails explicitly.
    writeProtocol({
      type: "error",
      id: (message as { id?: string }).id ?? "unknown",
      message: `Browser helper received an unsupported message type: ${String((message as { type?: unknown }).type)}`,
    });
  }
});
input.on("close", () => {
  void requestShutdown("helper_input_closed");
});
process.once("SIGINT", () => {
  void requestShutdown("helper_sigint");
});
process.once("SIGTERM", () => {
  void requestShutdown("helper_sigterm");
});

// Advertise the optional frames this helper understands so the daemon can negotiate them explicitly.
writeProtocol({ type: "ready", features: ["progress", "tool-boundary-ack", "completion-fence", "browser-reply-fence", "mcp-delivery-observation", "context-file", "skill-attachments", "input-files", "attachment-timeout"] });
