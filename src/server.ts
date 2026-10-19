import { diagnosticContext, diagnosticEvent, diagnosticError } from "./diagnostics";
import { chatGptWebTraceId, createChatGptWebAdapter } from "./adapters/chatgpt-web/adapter";
import { closeChatGptBrowserWorkers } from "./adapters/chatgpt-web/browser/browser-worker";
import { closeTurnBrokers, TurnBroker } from "./adapters/chatgpt-web/tools/turn-broker";
import { timingSafeEqual } from "node:crypto";
import { chatGptTurnSessions } from "./adapters/chatgpt-web/tools/turn-execution";
import { LOADED_SOURCE_ID } from "./build-identity";
import {
  cancelAllStructuredCompactions,
  cancelStructuredCompactionNativeTurn,
  beginCancelStructuredCompactionTrace,
} from "./adapters/chatgpt-web/conversation/compaction-handoff";
import { ChatGptWebAdapterError, chatGptBrowserTabClosedError } from "./adapters/chatgpt-web/adapter-error";
import {
  CHATGPT_TURN_REVISION_CONFLICT_MESSAGE,
  extractChatGptTurnIdentity,
  extractCodexTurnIdentityFromBody,
  extractChatGptCompactionSourceRevision,
} from "./adapters/chatgpt-web/prompt/environment";
import { rememberCompactionContinuation } from "./adapters/chatgpt-web/conversation/compaction-continuation";
import { bridgeToResponsesSSE } from "./responses/stream";
import { buildResponseJSON } from "./responses/json";
import { formatErrorResponse } from "./responses/encoding";
import { requireLicense } from "./licensing/service";
import { LicenseError } from "./licensing/schema";
import type { AppConfig } from "./config";
import { providerConfig } from "./config";
import { withLauncherRuntimeParameters } from "./browser/runtime-parameters";
import { assertDevRuntimeIsolation } from "./dev/isolation";
import { readLauncherBrowserHostDescriptor } from "./browser/launcher-client";
import { AsyncEventQueue } from "./event-queue";
import { readReservedJsonRequestBody, type ReservedJsonBody } from "./http-body";
import { HttpBodyBudget, HttpBodyError, type HttpBodyReservation } from "./http-body-budget";
import { adapterErrorEvent, httpStatusFromTerminalError } from "./lib/errors";
import { createHash } from "node:crypto";
import { augmentNativeModelCatalog } from "./models/model-catalog";
import {
  readCodexModelContextOverride,
  readCodexSubagentProtocol,
  type CodexModelContextOverride,
} from "./codex/integration";
import {
  CHATGPT_WEB_LUNA_BACKEND_MODEL,
  isChatGptWebModelSlug,
  requireChatGptWebModelRoute,
  type ChatGptWebModelRoute,
} from "./models/chatgpt-web-models";
import { forwardNativeCodexRequest, type NativeFetch, type NativeImageEndpoint } from "./codex/native-passthrough";
import { fetchNativeCodex } from "./codex/native-network";
import { NativeSearchModelError } from "./codex/native-search";
import { validateChatGptWebRequestControls } from "./adapters/chatgpt-web/request-controls";
import { ModelCatalogFetches } from "./codex/model-catalog-fetches";
import {
  buildCompactV1Output,
  COMPACT_PROMPT,
  decodeCompactionSummary,
  extractCompactUserMessages,
} from "./responses/compaction";
import { parseRequest, validateRequestForPreparation } from "./responses/parser";
import { InputReferenceError, inspectInputReferences, resolveInputReferences, type InputReferenceTransport } from "./responses/input-references";
import { preflightContextCompatibility } from "./responses/context-compatibility";
import { createChatGptStructuredOutputValidator } from "./adapters/chatgpt-web/output-validation";
import { createResponsesWebSocketAdapter, type SteerTarget, type SteerValidation } from "./responses/websocket";
import { copyPreviousResponseProvenance, expandPreviousResponseInput, flushResponseState, rememberResponseState, responseStateScope } from "./responses/state";
import { toolIdentityKey, type AdapterEvent, type CodexParsedRequest } from "./types";
import type { CodexProviderConfig } from "./types";
import type { ProviderAdapter } from "./adapters/base";
import { VERSION } from "./version";
import { operationStage, subscribeOperationStages } from "./runtime/operation-stage";

type HttpTrackedEndpoint = "models" | "responses" | "compact" | "search" | "unspecified" | NativeImageEndpoint;

export interface NativeCodexTurnIdentity {
  threadId: string;
  turnId: string;
}

export interface HttpStreamFailureEvidence {
  httpTurnId: number;
  endpoint: HttpTrackedEndpoint;
  reader: "client" | "windows_lifecycle";
  platform: NodeJS.Platform;
  chunks: number;
  bytes: number;
  errorName: string;
  errorCode: string;
}

type HttpStreamFailureReporter = (evidence: HttpStreamFailureEvidence) => void;

function safeStreamErrorField(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    ? value
    : fallback;
}

function streamFailureEvidence(
  error: unknown,
  httpTurnId: number,
  endpoint: HttpTrackedEndpoint,
  reader: HttpStreamFailureEvidence["reader"],
  platform: NodeJS.Platform,
  chunks: number,
  bytes: number,
): HttpStreamFailureEvidence {
  const candidate = error !== null && typeof error === "object"
    ? error as { name?: unknown; code?: unknown }
    : {};
  return {
    httpTurnId,
    endpoint,
    reader,
    platform,
    chunks,
    bytes,
    errorName: safeStreamErrorField(candidate.name, "Error"),
    errorCode: safeStreamErrorField(candidate.code, "unknown"),
  };
}

const reportHttpStreamFailure: HttpStreamFailureReporter = evidence => {
  diagnosticEvent("warning", "http.stream_failed", { ...evidence, networkPhase: "response-read", targetRole: "local-bridge" });
};

function emitHttpStreamFailure(
  reporter: HttpStreamFailureReporter,
  evidence: HttpStreamFailureEvidence,
): void {
  try {
    reporter(evidence);
  } catch {
    // Diagnostics are a side channel: they must never replace the source stream error or retain
    // HTTP turn ownership after the client has already observed that failure.
  }
}

export class HttpTurnCounter {
  private readonly active = new Map<number, {
    abort: AbortController;
    done: Promise<void>;
    finish: () => void;
    identity?: NativeCodexTurnIdentity;
  }>();
  private readonly interrupted = new Map<string, unknown>();
  private nextId = 1;

  private identityKey(identity: NativeCodexTurnIdentity): string {
    return `${identity.threadId}\u0000${identity.turnId}`;
  }

  private rememberInterrupted(identity: NativeCodexTurnIdentity, reason: unknown): void {
    const key = this.identityKey(identity);
    this.interrupted.delete(key);
    this.interrupted.set(key, reason);
    while (this.interrupted.size > 1_024) {
      const oldest = this.interrupted.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.interrupted.delete(oldest);
    }
  }

  constructor(private readonly reportStreamFailure: HttpStreamFailureReporter = reportHttpStreamFailure) {}

  count(): number {
    return this.active.size;
  }

  async cancelAll(reason: unknown = new Error("Active HTTP turns cancelled")): Promise<number> {
    const turns = [...this.active.values()];
    for (const turn of turns) {
      if (!turn.abort.signal.aborted) turn.abort.abort(reason);
    }
    await Promise.all(turns.map(turn => turn.done));
    return turns.length;
  }

  async cancelTurn(
    identity: NativeCodexTurnIdentity,
    reason: unknown = new DOMException("Codex turn interrupted", "AbortError"),
  ): Promise<number> {
    const cancellation = this.beginCancelTurn(identity, reason);
    await cancellation.settlement;
    return cancellation.cancelled;
  }

  beginCancelTurn(
    identity: NativeCodexTurnIdentity,
    reason: unknown = new DOMException("Codex turn interrupted", "AbortError"),
  ): { cancelled: number; settlement: Promise<void> } {
    this.rememberInterrupted(identity, reason);
    const turns = [...this.active.values()].filter(turn => (
      turn.identity?.threadId === identity.threadId && turn.identity.turnId === identity.turnId
    ));
    for (const turn of turns) {
      if (!turn.abort.signal.aborted) turn.abort.abort(reason);
    }
    return {
      cancelled: turns.length,
      settlement: Promise.all(turns.map(turn => turn.done)).then(() => undefined),
    };
  }

  async track(
    run: (
      signal: AbortSignal,
      bindIdentity: (identity: NativeCodexTurnIdentity) => void,
    ) => Promise<Response>,
    clientSignal?: AbortSignal,
    platform: NodeJS.Platform = process.platform,
    endpoint: HttpTrackedEndpoint = "unspecified",
  ): Promise<Response> {
    const id = this.nextId++;
    const started = performance.now();
    const requestContext: Record<string, unknown> = { ...diagnosticContext.getStore(), requestId: crypto.randomUUID(), httpTurnId: id, endpoint };
    let responseStatus: number | undefined, failure: unknown, totalChunks = 0, totalBytes = 0;
    diagnosticEvent("info", "http.request_started", { ...requestContext, outcome: "started" });
    const abort = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const tracked: {
      abort: AbortController;
      done: Promise<void>;
      finish: () => void;
      identity?: NativeCodexTurnIdentity;
    } = { abort, done, finish };
    this.active.set(id, tracked);
    let released = false;
    let clientAbortListener: (() => void) | undefined;
    let streamAbortListener: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      diagnosticEvent(failure && !abort.signal.aborted ? "error" : "info", "http.request_closed", {
        ...requestContext, outcome: abort.signal.aborted ? "cancelled" : failure ? "failed" : "transport-closed",
        httpStatus: responseStatus, chunks: totalChunks, bytes: totalBytes, durationMs: Math.round(performance.now() - started),
        ...(failure ? { error: diagnosticError(failure) } : {}),
      });
      this.active.delete(id);
      if (clientSignal && clientAbortListener) {
        clientSignal.removeEventListener("abort", clientAbortListener);
        clientAbortListener = undefined;
      }
      if (streamAbortListener) abort.signal.removeEventListener("abort", streamAbortListener);
      finish();
    };
    clientAbortListener = () => abort.abort(clientSignal?.reason);
    if (clientSignal?.aborted) abort.abort(clientSignal.reason);
    else clientSignal?.addEventListener("abort", clientAbortListener, { once: true });

    try {
      const response = await diagnosticContext.run(requestContext, () => run(abort.signal, identity => {
        if (!identity.threadId.trim() || !identity.turnId.trim()) {
          throw new Error("Native Codex turn identity must contain a threadId and turnId");
        }
        if (tracked.identity
          && (tracked.identity.threadId !== identity.threadId || tracked.identity.turnId !== identity.turnId)) {
          throw new Error("An HTTP request cannot change its native Codex turn identity");
        }
        tracked.identity = identity;
        const interruptedReason = this.interrupted.get(this.identityKey(identity));
        if (interruptedReason !== undefined && !abort.signal.aborted) abort.abort(interruptedReason);
      }));
      responseStatus = response.status;
      diagnosticEvent("info", "http.response_headers", { ...requestContext, httpStatus: response.status, durationMs: Math.round(performance.now() - started) });
      if (!response.body) {
        release();
        return response;
      }
      if (abort.signal.aborted) {
        await response.body.cancel(abort.signal.reason).catch(() => {});
        release();
        return new Response(null, { status: 499, statusText: "Client Closed Request" });
      }

      if (platform !== "win32") {
        // Bun's async-pull teardown bug is Windows-only. On Darwin/Linux, preserve the direct
        // pull chain: it keeps HTTP backpressure native and lets a client body cancellation reach
        // the original SSE reader without an eagerly drained tee branch racing the socket writer.
        const reader = response.body.getReader();
        const reportStreamFailure = this.reportStreamFailure;
        let chunks = 0;
        let bytes = 0;
        streamAbortListener = () => {
          void reader.cancel(abort.signal.reason).catch(() => {}).finally(release);
        };
        abort.signal.addEventListener("abort", streamAbortListener, { once: true });
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                release();
                controller.close();
                return;
              }
              chunks += 1;
              bytes += chunk.value.byteLength;
              totalChunks++; totalBytes += chunk.value.byteLength;
              if (totalChunks === 1) diagnosticEvent("info", "http.first_chunk", { ...requestContext, durationMs: Math.round(performance.now() - started) });
              controller.enqueue(chunk.value);
            } catch (error) {
              failure = error;
              if (!abort.signal.aborted) {
                emitHttpStreamFailure(reportStreamFailure, streamFailureEvidence(
                  error,
                  id,
                  endpoint,
                  "client",
                  platform,
                  chunks,
                  bytes,
                ));
              }
              release();
              controller.error(error);
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              release();
            }
          },
        });
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      // Windows-safe Bun#32111 shape: the client gets a native tee branch,
      // never a JS ReadableStream with async pull(). The second branch is consumed only
      // to observe completion. The request signal releases lifecycle ownership immediately
      // when the client disconnects and cancels the observer branch.
      const [clientBody, lifecycleBody] = response.body.tee();
      const reader = lifecycleBody.getReader();
      let chunks = 0;
      let bytes = 0;
      streamAbortListener = () => {
        void Promise.allSettled([
          reader.cancel(abort.signal.reason),
          clientBody.cancel(abort.signal.reason),
        ]).finally(release);
      };
      abort.signal.addEventListener("abort", streamAbortListener, { once: true });
      void (async () => {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            chunks += 1;
            bytes += chunk.value.byteLength;
              totalChunks++; totalBytes += chunk.value.byteLength;
              if (totalChunks === 1) diagnosticEvent("info", "http.first_chunk", { ...requestContext, durationMs: Math.round(performance.now() - started) });
            // Consume eagerly so the lifecycle branch never backpressures the client branch.
          }
        } catch (error) {
          failure = error;
          if (!abort.signal.aborted) {
            emitHttpStreamFailure(this.reportStreamFailure, streamFailureEvidence(
              error,
              id,
              endpoint,
              "windows_lifecycle",
              platform,
              chunks,
              bytes,
            ));
          }
          // Stream failure is delivered to the client branch; lifecycle cleanup stays best-effort.
        } finally {
          release();
        }
      })();
      return new Response(clientBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      failure = error;
      release();
      throw error;
    }
  }
}

type ChatGptWebAdapterFactory = (provider: CodexProviderConfig) => ProviderAdapter;

export interface ResponseRequestOptions {
  /** Internal WebSocket generate:false operation: validate/cache input without generation. */
  prepareOnly?: boolean;
  /** WebSocket store:false generations must not create restart snapshots. */
  memoryOnlyState?: boolean;
  /** Internal pure validation for WebSocket steering; no generation, download or cache write. */
  validateOnly?: boolean;
  /** Trusted host/test injection; never populated from request JSON. */
  inputReferenceTransport?: InputReferenceTransport;
  /** One resource pool shared by Responses and compact for this service. */
  bodyBudget?: HttpBodyBudget;
  /** DEV and other in-process harnesses can keep continuation state in their own canonical store. */
  rememberState?: boolean;
  /** Observe the exact production adapter stream when invoking the handler in-process. */
  onAdapterEvent?: (event: AdapterEvent) => void;
  /** Bind the physical HTTP stream to the exact native Codex turn that owns it. */
  onTurnIdentity?: (identity: NativeCodexTurnIdentity) => void;
}

export function routeChatGptWebRequest(parsed: CodexParsedRequest, config: AppConfig): ChatGptWebModelRoute {
  const route = requireChatGptWebModelRoute(parsed.modelId, config, parsed.options.reasoning);
  if (route.interactionMode === "automatic" && route.modelFamily) parsed._chatgptModelFamily = route.modelFamily;
  else delete parsed._chatgptModelFamily;
  parsed.modelId = route.backendModel;
  // Zero Risk preserves a distinct backend identity. Its immutable Codex effort is only a
  // protocol/catalog value; the manual adapter must never reinterpret it as a ChatGPT selection.
  parsed.options.reasoning = route.interactionMode === "automatic"
    ? route.adapterEffort
    : route.codexEffort;
  return route;
}

interface ModelCatalogFailure {
  stage: "config" | "request" | "transport" | "upstream" | "catalog";
  code?: string;
}

function modelCatalogFailure(stage: ModelCatalogFailure["stage"], error: unknown): ModelCatalogFailure {
  if (!error || typeof error !== "object") return { stage };
  for (const source of [error, "cause" in error ? error.cause : undefined]) {
    const code = source && typeof source === "object" && "code" in source ? source.code : undefined;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) return { stage, code };
  }
  const name = "name" in error ? error.name : undefined;
  if (name === "AbortError") return { stage, code: "ABORT_ERR" };
  if (name === "TimeoutError") return { stage, code: "ETIMEDOUT" };
  return { stage };
}

export async function modelsRequest(
  req: Request,
  config: AppConfig,
  fetchUpstream?: NativeFetch,
  contextOverride?: () => CodexModelContextOverride | undefined,
  onFailure?: (failure: ModelCatalogFailure) => void,
  clientSignal: AbortSignal = req.signal,
  shared?: ModelCatalogFetches,
): Promise<Response> {
  const cancelled = () => new Response(null, { status: 499 });
  if (clientSignal.aborted) return cancelled();
  let upstream: Response;
  let sent = false;
  const forward = (request: Request, markSent: () => void) => forwardNativeCodexRequest(request, "models", input => {
    markSent();
    return (fetchUpstream ?? fetchNativeCodex)(input);
  });
  try {
    if (shared) {
      const result = await shared.fetch(req, forward);
      if (!result.ok) { sent = result.sent; throw result.error; }
      upstream = new Response([101, 204, 205, 304].includes(result.status) ? null : result.body.slice(0), {
        status: result.status, statusText: result.statusText, headers: new Headers(result.headers),
      });
    } else upstream = await forward(req, () => { sent = true; });
  } catch (error) {
    if (clientSignal.aborted) return cancelled();
    onFailure?.(modelCatalogFailure(sent ? "transport" : "request", error));
    return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
  }
  if (clientSignal.aborted) return cancelled();
  if (!upstream.ok) {
    onFailure?.({ stage: "upstream" });
    return upstream;
  }
  let catalog: Record<string, unknown>;
  try {
    catalog = augmentNativeModelCatalog(await upstream.json(), config, contextOverride?.());
  } catch (error) {
    if (clientSignal.aborted) return cancelled();
    onFailure?.(modelCatalogFailure("catalog", error));
    return formatErrorResponse(502, "invalid_response_error", error instanceof Error ? error.message : String(error));
  }
  if (clientSignal.aborted) return cancelled();
  const body = JSON.stringify(catalog);
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  headers.set("etag", `W/\"${createHash("sha256").update(body).digest("base64url")}\"`);
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

export async function nativeSearchRequest(
  req: Request,
  fetchUpstream?: NativeFetch,
): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    return formatErrorResponse(401, "authentication_error", "Native search requires incoming Codex Bearer authorization");
  }
  try {
    return await forwardNativeCodexRequest(req, "alpha/search", fetchUpstream);
  } catch (error) {
    if (error instanceof NativeSearchModelError) return formatErrorResponse(400, "invalid_request_error", error.message);
    return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
  }
}

async function nativeImagesRequest(
  req: Request,
  endpoint: NativeImageEndpoint,
  fetchUpstream?: NativeFetch,
): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    return formatErrorResponse(401, "authentication_error", "Native image requests require incoming Codex Bearer authorization");
  }
  try {
    return await forwardNativeCodexRequest(req, endpoint, fetchUpstream);
  } catch (error) {
    return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
  }
}

function toolBridgeMaps(parsed: CodexParsedRequest): {
  toolNsMap: Map<string, { namespace: string; name: string }>;
  freeformToolNames: Set<string>;
  toolSearchToolNames: Set<string>;
} {
  const toolNsMap = new Map<string, { namespace: string; name: string }>();
  const freeformToolNames = new Set<string>();
  const toolSearchToolNames = new Set<string>();
  for (const tool of parsed.context.tools ?? []) {
    toolNsMap.set(toolIdentityKey(tool.namespace, tool.name), { namespace: tool.namespace ?? "", name: tool.name });
    if (tool.freeform) freeformToolNames.add(toolIdentityKey(tool.namespace, tool.name));
    if (tool.toolSearch) toolSearchToolNames.add(toolIdentityKey(tool.namespace, tool.name));
  }
  return { toolNsMap, freeformToolNames, toolSearchToolNames };
}

const inProcessBodyBudgets = new WeakMap<AppConfig, HttpBodyBudget>();

function bodyBudgetFor(config: AppConfig): HttpBodyBudget {
  let budget = inProcessBodyBudgets.get(config);
  if (!budget) { budget = new HttpBodyBudget(); inProcessBodyBudgets.set(config, budget); }
  return budget;
}

function bodyErrorResponse(error: unknown): Response {
  const status = error instanceof HttpBodyError ? error.status : 400;
  return Response.json({ error: {
    type: status === 503 ? "server_error" : status === 499 ? "client_closed_request" : "invalid_request_error",
    code: status === 503 ? "request_body_overloaded" : status === 413 ? "request_body_too_large" : status === 499 ? "client_cancelled" : "invalid_request_body",
    message: error instanceof Error ? error.message : "Request body must be valid JSON",
    retryable: status === 503,
  } }, { status, ...(status === 503 ? { headers: { "retry-after": "1" } } : {}) });
}

/** The native TransformStream preserves backpressure and avoids async pull() on Windows.
 * Keep the body lease until delivery ends, including native passthrough, while runTurn owns
 * an independent reference until actual cleanup finishes after a disconnect. */
function retainBodyForResponse(response: Response, reservation: HttpBodyReservation, signal: AbortSignal): Response {
  if (!response.body) return response;
  const release = reservation.retain();
  const transport = new TransformStream<Uint8Array, Uint8Array>();
  void response.body.pipeTo(transport.writable, { signal }).catch(() => {}).finally(release);
  return new Response(transport.readable, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function withRequestBody(
  req: Request,
  config: AppConfig,
  options: Pick<ResponseRequestOptions, "bodyBudget">,
  run: (body: ReservedJsonBody) => Promise<Response>,
): Promise<Response> {
  let body: ReservedJsonBody;
  try {
    body = await readReservedJsonRequestBody(req, { budget: options.bodyBudget ?? bodyBudgetFor(config), retainEncoded: true });
  } catch (error) { return bodyErrorResponse(error); }
  try {
    const response = await run(body);
    return retainBodyForResponse(response, body.reservation, req.signal);
  } catch (error) {
    if (error instanceof HttpBodyError) return bodyErrorResponse(error);
    throw error;
  } finally { body.reservation.release(); }
}

function preparedResponse(input: unknown, model: string, scope: string, options: ResponseRequestOptions): Response {
  const done: AdapterEvent = { type: "done", usage: { inputTokens: 0, outputTokens: 0 }, endTurn: true };
  const prepared = buildResponseJSON([done], model);
  // State preparation retains exact input, including unresolved URLs, with no network/model work.
  if (options.rememberState === false || !rememberResponseState(input, prepared, { force: true, memoryOnly: true, scope })) {
    return Response.json({ error: {
      type: "invalid_request_error", code: "prewarm_context_unavailable", retryable: false,
      message: "The prepared context cannot be retained within the local continuation cache. No generation was started.",
    } }, { status: 400 });
  }
  async function* preparedEvents(): AsyncGenerator<AdapterEvent> { yield done; }
  return new Response(bridgeToResponsesSSE(preparedEvents(), model, undefined, undefined, undefined, undefined, 2_000, {
    responseId: prepared.id as string,
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

export function responseRequest(
  req: Request,
  config: AppConfig,
  adapterFactory: ChatGptWebAdapterFactory = createChatGptWebAdapter,
  options: ResponseRequestOptions = {},
): Promise<Response> {
  return withRequestBody(req, config, options, body => responseRequestFromBody(req, config, adapterFactory, options, body, body.value));
}

async function responseRequestFromBody(
  req: Request,
  config: AppConfig,
  adapterFactory: ChatGptWebAdapterFactory,
  options: ResponseRequestOptions,
  body: ReservedJsonBody,
  raw: unknown,
): Promise<Response> {
  if (req.signal.aborted) throw new HttpBodyError("Request cancelled", 499);
  const requestedModel = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { model?: unknown }).model
    : undefined;
  try {
    const identity = extractCodexTurnIdentityFromBody(raw);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  if (typeof requestedModel === "string" && !isChatGptWebModelSlug(requestedModel)) {
    if (options.validateOnly) return Response.json({ error: {
      type: "invalid_request_error", code: "steering_not_supported", retryable: false,
      message: "Native Responses steering requires a native WebSocket service; HTTP forwarding cannot validate it.",
    } }, { status: 400 });
    if (options.prepareOnly) return Response.json({ error: {
      type: "invalid_request_error", code: "unsupported_native_prewarm", param: "generate", retryable: false,
      message: "Native model prewarm cannot be represented by the HTTP passthrough route. No generation was started.",
    } }, { status: 400 });
    try {
      return await forwardNativeCodexRequest(body.replay(req), "responses", undefined, raw);
    } catch (error) {
      return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
    }
  }
  body.discardEncoded();
  try { await requireLicense(); }
  catch (error) {
    const state = error instanceof LicenseError ? error.state : "invalid";
    return Response.json({ error: { type: "permission_error", code: `license_${state}`, message: String(error), retryable: false } }, { status: 403 });
  }
  const requestedPreviousResponseId = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { previous_response_id?: unknown }).previous_response_id
    : undefined;
  const continuationScope = responseStateScope(req.headers);
  let expanded = expandPreviousResponseInput(raw, continuationScope);
  if (typeof requestedPreviousResponseId === "string" && expanded === raw) {
    return Response.json({ error: {
      type: "invalid_request_error", code: "previous_response_not_found", param: "previous_response_id", retryable: false,
      message: "Local continuation state for previous_response_id is unavailable. Resend the complete original history without previous_response_id; do not replay tool side effects or send only the latest message.",
    } }, { status: 400 });
  }
  const contextCompatibility = preflightContextCompatibility(
    expanded && typeof expanded === "object" ? (expanded as { input?: unknown }).input ?? [] : [],
  );
  if (contextCompatibility.status === "blocked") {
    return Response.json({ error: {
      type: "invalid_request_error", code: "incompatible_web_context", retryable: false,
      message: "ChatGPT Web cannot faithfully read this context. Preserve the original task and use the reported source-backend recovery path; retrying unchanged content cannot fix it.",
      issues: contextCompatibility.issues, issue_count: contextCompatibility.issueCount,
      issues_truncated: contextCompatibility.issuesTruncated,
    } }, { status: 400 });
  }
  let parsed: CodexParsedRequest;
  let route: ChatGptWebModelRoute;
  try {
    const references = inspectInputReferences(expanded);
    if (references.length || options.validateOnly) {
      const validated = validateRequestForPreparation(expanded);
      const validatedRoute = requireChatGptWebModelRoute(validated.modelId, config, validated.options.reasoning);
      if (!validated._compactionRequest) validateChatGptWebRequestControls(validated._rawBody);
      createChatGptStructuredOutputValidator(validated.options.outputFormat);
      if (references.some(reference => reference.kind === "provider_file")) throw new InputReferenceError(
        "unsupported_provider_file_reference", "Provider file_id requires a verified download endpoint for this provider/account; no compatible endpoint is configured.",
      );
      const identity = extractCodexTurnIdentityFromBody(expanded);
      const cancelled = chatGptTurnSessions.cancelledError("", identity);
      if (cancelled) return Response.json({ error: { type: "client_closed_request", code: "client_cancelled", message: cancelled.message } }, { status: 400 });
      if (options.validateOnly) {
        const validationBody = validated._rawBody as Record<string, unknown>;
        if (config.mode !== "native-tools" || validatedRoute.interactionMode !== "automatic" || validatedRoute.modelFamily !== "6"
          || validated._compactionRequest || validationBody.conversation != null
          || (Array.isArray(validationBody.context_management) ? validationBody.context_management.length > 0 : validationBody.context_management != null)
          || validationBody.agents != null) {
          return Response.json({ error: { type: "invalid_request_error", code: "steering_not_supported",
            message: "Steering is supported for ordinary automatic GPT-6 Native Tools responses without hosted conversations or automatic compaction.", retryable: false } }, { status: 400 });
        }
        return new Response(null, { status: 204 });
      }
      if (options.prepareOnly) {
        if (validated._compactionRequest) return Response.json({ error: { type: "invalid_request_error", code: "unsupported_compaction_prewarm",
          message: "Compaction requires its dedicated operation.", retryable: false } }, { status: 400 });
        if (req.signal.aborted) throw new HttpBodyError("Request cancelled", 499);
        return preparedResponse(expanded, validatedRoute.slug, continuationScope, options);
      }
      const scope = {
        taskId: createHash("sha256").update(JSON.stringify([identity.threadId ?? crypto.randomUUID(), identity.turnId ?? ""])).digest("hex"),
        providerId: validatedRoute.slug, accountId: continuationScope,
      };
      const resolved = await resolveInputReferences(expanded, {
        scope, authorization: { scope, urls: references.flatMap(reference => reference.kind === "url" ? [reference.url] : []) },
        signal: req.signal, reserveBytes: bytes => body.reservation.grow(bytes), transport: options.inputReferenceTransport,
      });
      copyPreviousResponseProvenance(expanded, resolved);
      expanded = resolved;
    }
    parsed = parseRequest(expanded);
    route = routeChatGptWebRequest(parsed, config);
    if (!parsed._compactionRequest) validateChatGptWebRequestControls(parsed._rawBody);
    if (options.prepareOnly) createChatGptStructuredOutputValidator(parsed.options.outputFormat);
    const identity = extractChatGptTurnIdentity(parsed);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    if (error instanceof HttpBodyError) throw error;
    if (error instanceof InputReferenceError) return Response.json({ error: {
      type: error.type, code: error.code, message: error.message, retryable: false,
    } }, { status: error.status });
    if (error instanceof ChatGptWebAdapterError) {
      return Response.json({ error: { type: error.errorType, code: error.code, message: error.message, retryable: false } }, { status: error.status });
    }
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  const compaction = parsed._compactionRequest === true;
  if (options.prepareOnly && compaction) return Response.json({ error: {
    type: "invalid_request_error", code: "unsupported_compaction_prewarm", retryable: false,
    message: "Compaction requires its dedicated operation and cannot be prepared as an empty response.",
  } }, { status: 400 });
  const compactionItem = compaction && parsed._compactionResponseFormat !== "message";
  const rememberCompletedResponse = (response: Record<string, unknown>): void => {
    if (!compaction) {
      if (options.rememberState !== false) rememberResponseState(parsed._rawBody, response, {
        force: true, memoryOnly: options.memoryOnlyState, scope: continuationScope,
      });
      return;
    }
    if (response.status !== "completed") return;
    const identity = extractChatGptTurnIdentity(parsed);
    if (!identity.threadId || !identity.turnId || !Array.isArray(response.output)) return;
    const items = response.output.filter(item => item?.type === (compactionItem ? "compaction" : "message"));
    if (items.length !== 1 || (compactionItem && response.output.length !== 1)) return;
    const item = items[0];
    const summary = compactionItem
      ? (typeof item?.encrypted_content === "string" ? decodeCompactionSummary(item.encrypted_content) : null)
      : (item?.role === "assistant" && Array.isArray(item.content)
        ? item.content.filter((part: { type?: string; text?: unknown }) => part.type === "output_text" && typeof part.text === "string")
          .map((part: { text: string }) => part.text).join("")
        : null);
    if (!summary) return;
    const source = extractChatGptCompactionSourceRevision(parsed);
    const body = parsed._rawBody as { input?: unknown[] };
    // v1 installs the bounded user-message output, whereas v2 retains the original source.
    // Authenticate both exact producer-defined representations, never arbitrary rewrites.
    const v1Source = extractChatGptCompactionSourceRevision({
      ...parsed,
      _rawBody: { ...body, input: buildCompactV1Output(extractCompactUserMessages(body.input), summary) },
    });
    rememberCompactionContinuation(parsed, identity, [source, v1Source], summary);
  };

  if (compaction) {
    // History compaction is a dedicated summarization turn. It must never bind the active Codex
    // tool bridge or continue an in-flight MCP round; the returned summary becomes the next turn's
    // replacement history through the Responses compaction contract.
    delete parsed.context.tools;
    delete parsed.options.toolChoice;
    delete parsed.options.parallelToolCalls;
    parsed.context.messages.push({ role: "user", content: COMPACT_PROMPT, timestamp: Date.now() });
  }

  // Preparing context must not require a running browser host. Keep native revision and
  // cancellation validation below, but hydrate live runtime settings only for generation.
  const provider = options.prepareOnly ? providerConfig(config) : withLauncherRuntimeParameters(providerConfig(config));
  let traceId: string | undefined;
  try {
    traceId = chatGptWebTraceId(provider, parsed);
  } catch (error) {
    // A cancelled browser session can only exist after the adapter accepted canonical native
    // turn identity and user-revision metadata. Requests without that identity have no matching
    // trace tombstone; preserve the adapter's existing strict validation/error path below.
    const message = error instanceof Error ? error.message : String(error);
    if (message === CHATGPT_TURN_REVISION_CONFLICT_MESSAGE) {
      // Codex can reopen an interrupted task with only refreshed developer/skill context under a
      // new turn_id. Its last human prompt still belongs to the stopped turn and must not be
      // replayed as new work. HTTP 400 makes that malformed recovery request terminal instead of
      // allowing Codex to retry it as an upstream 502.
      return formatErrorResponse(400, "invalid_request_error", message);
    }
    if (!message.includes("requires native Codex turn_id metadata")
      && !message.includes("requires a current-turn user message")) throw error;
  }
  const logContext = diagnosticContext.getStore();
  if (logContext && traceId) { logContext.traceId = traceId; logContext.requestedModel = parsed.modelId; logContext.mode = config.mode; }
  diagnosticEvent("info", "http.request_bound", { traceId, requestedModel: parsed.modelId, mode: config.mode, compaction });
  const cancelledError = traceId ? chatGptTurnSessions.cancelledError(traceId, extractChatGptTurnIdentity(parsed)) : undefined;
  if (cancelledError) {
    // Codex retries unknown streamed response.failed codes. A replay after the user explicitly
    // closed the only browser document is instead a terminal client state: repeating that exact
    // request is invalid and must not recreate the DOM. Codex maps HTTP 400 to its non-retryable
    // InvalidRequest category while the body preserves the real client_cancelled classification.
    return new Response(JSON.stringify({
      error: {
        type: "client_closed_request",
        code: "client_cancelled",
        message: cancelledError.message,
      },
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (options.prepareOnly) {
    if (req.signal.aborted) throw new HttpBodyError("Request cancelled", 499);
    return preparedResponse(parsed._rawBody, route.slug, continuationScope, options);
  }
  const adapter = adapterFactory(provider);
  const queue = new AsyncEventQueue<AdapterEvent>();
  const abort = new AbortController();
  const abortTurn = () => abort.abort(req.signal.reason);
  if (req.signal.aborted) abortTurn();
  else req.signal.addEventListener("abort", abortTurn, { once: true });
  const run = async () => {
    const release = body.reservation.retain();
    try {
      if (abort.signal.aborted) throw new HttpBodyError("Request cancelled", 499);
      await adapter.runTurn!(parsed, { headers: req.headers, abortSignal: abort.signal }, event => {
        options.onAdapterEvent?.(event);
        queue.push(event);
      });
    } catch (error) {
      const event = adapterErrorEvent(error);
      diagnosticEvent(event.status === 499 ? "info" : "error", "http.adapter_failed", {
        traceId, requestedModel: parsed.modelId, ...diagnosticError(error),
      });
      options.onAdapterEvent?.(event);
      queue.push(event);
    } finally {
      queue.close();
      req.signal.removeEventListener("abort", abortTurn);
      release();
    }
  };
  const maps = toolBridgeMaps(parsed);
  const responseModel = route.slug;

  if (parsed.stream) {
    void run();
    const stream = bridgeToResponsesSSE(
      queue,
      responseModel,
      maps.toolNsMap,
      maps.freeformToolNames,
      maps.toolSearchToolNames,
      () => abort.abort(),
      2_000,
      {
        hideThinkingSummary: parsed.options.hideThinkingSummary,
        ...(provider.chatgptWeb?.stallTimeoutSec !== undefined
          ? { stallTimeoutSec: provider.chatgptWeb.stallTimeoutSec }
          : {}),
        ...(compactionItem ? { compaction: true } : {}),
        onCompletedResponse: rememberCompletedResponse,
      },
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  await run();
  const events = await queue.collect();
  const json = buildResponseJSON(events, responseModel, {
    hideThinkingSummary: parsed.options.hideThinkingSummary,
    toolNsMap: maps.toolNsMap,
    freeformToolNames: maps.freeformToolNames,
    toolSearchToolNames: maps.toolSearchToolNames,
    ...(compactionItem ? { compaction: true } : {}),
  });
  rememberCompletedResponse(json);
  return Response.json(json);
}

export function compactRequest(
  req: Request,
  config: AppConfig,
  adapterFactory: ChatGptWebAdapterFactory = createChatGptWebAdapter,
  options: Pick<ResponseRequestOptions, "onTurnIdentity" | "bodyBudget"> = {},
): Promise<Response> {
  return withRequestBody(req, config, options, body => compactRequestFromBody(req, config, adapterFactory, options, body));
}

async function compactRequestFromBody(
  req: Request,
  config: AppConfig,
  adapterFactory: ChatGptWebAdapterFactory,
  options: Pick<ResponseRequestOptions, "onTurnIdentity" | "bodyBudget">,
  reservedBody: ReservedJsonBody,
): Promise<Response> {
  let raw: Record<string, unknown>;
  try {
    const parsed = reservedBody.value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    return formatErrorResponse(
      400,
      "invalid_request_error",
      error instanceof Error ? error.message : "Compaction request body must be a JSON object",
    );
  }
  const headerTurnMetadata = req.headers.get("x-codex-turn-metadata");
  if (headerTurnMetadata) {
    const existingMetadata = raw.client_metadata;
    const clientMetadata = existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? existingMetadata as Record<string, unknown>
      : {};
    raw = {
      ...raw,
      client_metadata: {
        ...clientMetadata,
        // `/responses/compact` carries native turn authority in this canonical Codex header,
        // unlike ordinary `/responses` payloads where the same value also appears in the body.
        "x-codex-turn-metadata": headerTurnMetadata,
      },
    };
  }
  try {
    const identity = extractCodexTurnIdentityFromBody(raw);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  if (typeof raw.model !== "string" || !raw.model) {
    return formatErrorResponse(400, "invalid_request_error", "Compaction request requires a model");
  }
  if (!isChatGptWebModelSlug(raw.model)) {
    try {
      return await forwardNativeCodexRequest(reservedBody.replay(req), "responses/compact", undefined, raw);
    } catch (error) {
      return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
    }
  }
  reservedBody.discardEncoded();
  let route: ChatGptWebModelRoute;
  try {
    route = requireChatGptWebModelRoute(raw.model, config);
  } catch (error) {
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }

  const input = Array.isArray(raw.input) ? raw.input : [];
  // Delegate the already decoded object with the same lease. Re-serializing/re-parsing here
  // doubled memory and incorrectly carried the original zstd/content-length headers.
  const response = await responseRequestFromBody(req, config, adapterFactory, options, reservedBody,
    { ...raw, stream: false, input: [...input, { type: "compaction_trigger" }] });
  if (!response.ok) return response;
  let body: {
    output?: unknown[];
    status?: unknown;
    error?: { message?: unknown; type?: unknown; code?: unknown } | null;
  };
  try {
    body = await response.json() as typeof body;
  } catch {
    return formatErrorResponse(502, "invalid_response_error", "Compaction turn returned invalid JSON");
  }
  if (body.error) {
    const error = {
      message: typeof body.error.message === "string" ? body.error.message : "Compaction turn failed",
      type: typeof body.error.type === "string" ? body.error.type : "upstream_error",
      code: typeof body.error.code === "string" ? body.error.code : null,
    };
    return Response.json(
      { error },
      { status: httpStatusFromTerminalError(error) },
    );
  }
  if (body.status !== "completed") {
    return formatErrorResponse(502, "upstream_error", `Compaction turn failed (status: ${String(body.status ?? "unknown")})`);
  }
  const items = (body.output ?? []).filter(
    (item): item is { type: "compaction"; encrypted_content?: string } =>
      Boolean(item && typeof item === "object" && (item as { type?: string }).type === "compaction"),
  );
  if (items.length !== 1) {
    return formatErrorResponse(502, "invalid_response_error", `Compaction turn produced ${items.length} compaction items; expected one`);
  }
  const summary = typeof items[0]!.encrypted_content === "string"
    ? decodeCompactionSummary(items[0]!.encrypted_content)
    : null;
  if (!summary?.trim()) {
    return formatErrorResponse(502, "invalid_response_error", "Compaction turn produced an empty summary");
  }
  return Response.json({ output: buildCompactV1Output(extractCompactUserMessages(input), summary) });
}

export function startServer(
  config: AppConfig,
  dependencies: { fetchUpstream?: NativeFetch; adapterFactory?: ChatGptWebAdapterFactory; bodyBudget?: HttpBodyBudget;
    modelCatalogFetches?: ModelCatalogFetches } = {},
): ReturnType<typeof Bun.serve> {
  if (config.purpose === "dev-harness") {
    assertDevRuntimeIsolation(config);
    if (readLauncherBrowserHostDescriptor(config.browserHostDescriptorPath!).profile !== "development") {
      throw new Error("DEV runtime refuses a production browser descriptor");
    }
  }
  const startedAt = Date.now();
  const turnBroker = config.mode === "mcp-bridge" ? TurnBroker.forSocket(config.brokerSocketPath) : undefined;
  if (config.mode === "mcp-bridge") {
    void turnBroker!.listen().catch(error => {
      console.error(
        `[chatgpt-web] turn broker endpoint is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  let draining = false;
  let shutdownPromise: Promise<void> | undefined;
  const shutdownCompletionObservers = new Set<(failed: boolean) => void>();
  let successfulModelCatalogRequests = 0;
  let lastSuccessfulModelCatalogRequestAt: string | null = null;
  let modelCatalogRequests = 0;
  let lastModelCatalogResult: {
    request: number; at: string; status: number; failure?: ModelCatalogFailure;
  } | null = null;
  const httpTurns = new HttpTurnCounter();
  const modelCatalogFetches = dependencies.modelCatalogFetches ?? new ModelCatalogFetches();
  const bodyBudget = dependencies.bodyBudget ?? new HttpBodyBudget();
  const dispatchResponses = (req: Request, operation?: { prepareOnly?: boolean; memoryOnlyState?: boolean }): Promise<Response> => {
    if (draining) return Promise.resolve(formatErrorResponse(503, "server_error", "web2harness is draining for a requested service operation"));
    return httpTurns.track(
      (signal, bindIdentity) => responseRequest(
        new Request(req, { signal }), config, dependencies.adapterFactory,
        { onTurnIdentity: bindIdentity, bodyBudget, prepareOnly: operation?.prepareOnly, memoryOnlyState: operation?.memoryOnlyState },
      ),
      req.signal, process.platform, "responses",
    );
  };
  const responsesWs = createResponsesWebSocketAdapter({
    dispatch: (req, operation) => dispatchResponses(req, { ...operation, memoryOnlyState: true }),
    async validateSteer(req: Request, target: SteerTarget): Promise<SteerValidation> {
      if (draining) return { ok: false, code: "response_not_active", message: "Responses server is draining." };
      const validation = await withRequestBody(req, config, { bodyBudget }, async reserved => {
        const submission = reserved.value as Record<string, unknown>;
        const original = target.requestBody;
        const full = expandPreviousResponseInput(original, responseStateScope(req.headers)) as Record<string, unknown>;
        if (typeof original.previous_response_id === "string" && full === original) {
          return Response.json({ error: { code: "previous_response_not_found", message: "The target's original history is no longer available; steering was not accepted." } }, { status: 400 });
        }
        const items = (value: unknown): unknown[] => Array.isArray(value) ? value
          : typeof value === "string" ? [{ role: "user", content: value }] : [];
        const candidate: Record<string, unknown> = { ...full, input: [...items(full.input), ...items(submission.input)] };
        delete candidate.previous_response_id;
        return responseRequestFromBody(req, config, dependencies.adapterFactory ?? createChatGptWebAdapter, { validateOnly: true, bodyBudget }, reserved, candidate);
      });
      if (validation.status === 204) return { ok: true };
      try {
        const body = await validation.json() as { error?: { code?: string; message?: string } };
        return { ok: false, code: body.error?.code ?? "invalid_input", message: body.error?.message ?? "Steering validation failed." };
      } catch { return { ok: false, code: "invalid_input", message: "Steering validation failed." }; }
    },
  });
  const activity = () => ({
    active_http_turns: httpTurns.count(),
    active_browser_turns: chatGptTurnSessions.activeCount() + (turnBroker?.externalOwnerActiveCount() ?? 0),
    active_websocket_turns: responsesWs.activeCount(),
  });
  const controlAuthorized = (req: Request): boolean => {
    const header = req.headers.get("authorization") ?? "";
    const expected = Buffer.from(`Bearer ${config.controlToken}`);
    const actual = Buffer.from(header);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 0,
    websocket: responsesWs.websocket,
    async fetch(req, bunServer) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") {
        return Response.json({
          status: "ok",
          service: "web2harness",
          version: VERSION,
          sourceId: LOADED_SOURCE_ID,
          mode: config.mode,
          pid: process.pid,
          port: config.port,
          uptime: (Date.now() - startedAt) / 1_000,
          accepting_turns: !draining,
          successful_model_catalog_requests: successfulModelCatalogRequests,
          last_successful_model_catalog_request_at: lastSuccessfulModelCatalogRequestAt,
          model_catalog_requests: modelCatalogRequests,
          last_model_catalog_result: lastModelCatalogResult,
          ...activity(),
        });
      }
      if (req.method === "POST" && (url.pathname === "/admin/drain" || url.pathname === "/admin/resume")) {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        draining = url.pathname === "/admin/drain";
        responsesWs.setDraining(draining);
        turnBroker?.setExternalOwnersAccepted(!draining);
        return Response.json({ status: "ok", accepting_turns: !draining, ...activity() });
      }
      if (req.method === "POST" && url.pathname === "/admin/cancel-turn") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        let traceId: string;
        let leaseFailure: "browser_surface_bootstrap_timeout" | "helper_heartbeat_expired" | undefined;
        try {
          const body = await req.json() as { traceId?: unknown; reason?: unknown };
          traceId = typeof body?.traceId === "string" ? body.traceId : "";
          if (!/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) throw new Error("traceId is invalid");
          if (body.reason !== undefined) {
            if (body.reason !== "browser_surface_bootstrap_timeout" && body.reason !== "helper_heartbeat_expired") {
              throw new Error("Browser turn cancellation reason is invalid");
            }
            leaseFailure = body.reason;
          }
        } catch (error) {
          return Response.json(
            { status: "error", error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
        const reason = leaseFailure
          ? new ChatGptWebAdapterError(
            leaseFailure === "browser_surface_bootstrap_timeout"
              ? "The ChatGPT browser turn did not finish browser setup before its lease expired. The turn was stopped."
              : "The ChatGPT browser helper stopped reporting progress and its lease expired. The turn was stopped.",
            { status: 504, errorType: "server_error", code: leaseFailure, retryable: false },
          )
          : chatGptBrowserTabClosedError();
        // Revoke the owner first. This prevents a compaction callback that observes its retained
        // source being cancelled below from starting a fresh fallback during operator shutdown.
        const compactionCancellation = beginCancelStructuredCompactionTrace(traceId, reason);
        const browserCancellation = chatGptTurnSessions.beginCancelTrace(traceId, reason);
        const cancelledBrokerTurns = turnBroker?.revokeTrace(traceId, reason) ?? 0;
        const settlement = Promise.all([browserCancellation.settlement, compactionCancellation.settlement]);
        // Explicit tab close acknowledges revoked authority, then destroys its document. Waiting
        // for that document's helper first can deadlock the UI behind a stalled browser operation.
        // Lease cleanup still requires physical settlement before declaring the runtime idle.
        if (leaseFailure) await settlement;
        else void settlement.catch(error => console.error(`[chatgpt-web] cancelled turn cleanup failed: ${error instanceof Error ? error.message : String(error)}`));
        return Response.json({
          status: "ok",
          trace_id: traceId,
          cancelled_browser_turns: browserCancellation.cancelled,
          cancelled_broker_turns: cancelledBrokerTurns,
          cancelled_compaction_runs: compactionCancellation.cancelled,
          ...activity(),
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/interrupt-turn") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        let identity: NativeCodexTurnIdentity;
        try {
          const body = await req.json() as { threadId?: unknown; turnId?: unknown };
          const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
          const turnId = typeof body?.turnId === "string" ? body.turnId.trim() : "";
          if (!/^[A-Za-z0-9_-]{6,128}$/.test(threadId) || !/^[A-Za-z0-9_-]{6,128}$/.test(turnId)) {
            throw new Error("native Codex threadId or turnId is invalid");
          }
          identity = { threadId, turnId };
        } catch (error) {
          return Response.json(
            { status: "error", error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
        const reason = new DOMException("Codex turn interrupted", "AbortError");
        const browserCancellation = chatGptTurnSessions.cancelNativeTurn(
          identity.threadId,
          identity.turnId,
          reason,
        );
        const compactionCancellation = cancelStructuredCompactionNativeTurn(
          identity.threadId,
          identity.turnId,
          reason,
        );
        const httpCancellation = httpTurns.beginCancelTurn(identity, reason);
        const settlement = Promise.allSettled([
          browserCancellation.settlement,
          compactionCancellation.settlement,
          httpCancellation.settlement,
        ]);
        void settlement.then(results => {
          for (const result of results) {
            if (result.status === "rejected") {
              console.error(
                `[chatgpt-web] interrupted turn cleanup failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
              );
            }
          }
        });
        return Response.json({
          status: "ok",
          cancelled_http_turns: httpCancellation.cancelled,
          cancelled_browser_turns: browserCancellation.cancelled,
          cancelled_compaction_runs: compactionCancellation.cancelled,
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/cancel-turns") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        const reason = new ChatGptWebAdapterError("Active turn cancelled by launcher", {
          status: 499, errorType: "client_closed_request", code: "client_cancelled", retryable: false,
        });
        // Abort shared compaction owners before clearing their retained source sessions. The
        // owner signal is the only cancellation boundary for a fresh fallback not in the session
        // registry.
        const compactionCancellation = cancelAllStructuredCompactions(reason);
        const cancelledBrowserTurns = chatGptTurnSessions.clear(reason) + (turnBroker?.revokeExternalOwners() ?? 0);
        const [cancelledHttpTurns, cancelledCompactionRuns] = await Promise.all([
          httpTurns.cancelAll(reason),
          compactionCancellation,
        ]);
        return Response.json({
          status: "ok",
          cancelled_http_turns: cancelledHttpTurns,
          cancelled_browser_turns: cancelledBrowserTurns,
          cancelled_compaction_runs: cancelledCompactionRuns,
          ...activity(),
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/shutdown") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        const current = activity();
        if (!draining || current.active_http_turns > 0 || current.active_browser_turns > 0 || current.active_websocket_turns > 0) {
          return Response.json(
            {
              status: "refused",
              accepting_turns: !draining,
              ...current,
            },
            { status: 409 },
          );
        }
        if (req.headers.get("accept") === "application/x-ndjson") {
          let dispose = () => {};
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              let closed = false;
              const send = (value: unknown) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
              const complete = (failed: boolean) => {
                if (closed) return;
                send({ type: "result", status: failed ? "failed" : "ok", pid: process.pid });
                dispose();
                controller.close();
              };
              send({ type: "accepted", pid: process.pid });
              const unsubscribe = subscribeOperationStages(send);
              const onAbort = () => dispose();
              dispose = () => {
                closed = true;
                unsubscribe();
                shutdownCompletionObservers.delete(complete);
                req.signal.removeEventListener("abort", onAbort);
              };
              shutdownCompletionObservers.add(complete);
              req.signal.addEventListener("abort", onAbort, { once: true });
              setTimeout(shutdown, 0);
            },
            cancel() { dispose(); },
          });
          return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
        }
        setTimeout(shutdown, 0);
        return Response.json({ status: "ok", accepting_turns: false, ...current });
      }
      if (req.method === "GET" && url.pathname === "/v1/models") {
        if (draining) {
          return formatErrorResponse(
            503,
            "server_error",
            "web2harness is draining for a requested service operation",
          );
        }
        return httpTurns.track(async signal => {
          const request = ++modelCatalogRequests;
          const started = Date.now();
          const recordResult = (response: Response, failure?: ModelCatalogFailure): Response => {
            // A client abandoning its request is not evidence of an upstream catalog failure.
            if (req.signal.aborted) return response;
            const result = { request, at: new Date().toISOString(), status: response.status, ...(failure ? { failure } : {}) };
            // An older, slower request must not replace a newer completed result.
            if (!lastModelCatalogResult || request > lastModelCatalogResult.request) lastModelCatalogResult = result;
            if (!response.ok) {
              try {
                console.warn(`[web2harness] model_catalog_failed ${JSON.stringify({ ...result, elapsedMs: Date.now() - started })}`);
              } catch { /* Logging must not replace the catalog result. */ }
            }
            return response;
          };
          let catalogConfig: AppConfig;
          try {
            catalogConfig = {
              ...config,
              subagentProtocol: readCodexSubagentProtocol(config.subagentProtocol),
            };
          } catch (error) {
            return recordResult(formatErrorResponse(
              500,
              "server_error",
              `Could not resolve the installed subagent protocol: ${error instanceof Error ? error.message : String(error)}`,
            ), modelCatalogFailure("config", error));
          }
          let failure: ModelCatalogFailure | undefined;
          const response = await modelsRequest(
            new Request(req, { signal }),
            catalogConfig,
            dependencies.fetchUpstream,
            readCodexModelContextOverride,
            value => { failure = value; },
            req.signal,
            modelCatalogFetches,
          );
          if (response.ok && !req.signal.aborted) {
            successfulModelCatalogRequests += 1;
            lastSuccessfulModelCatalogRequestAt = new Date().toISOString();
          }
          return recordResult(response, failure);
        }, req.signal, process.platform, "models");
      }
      if (req.method === "GET" && url.pathname === "/v1/responses") {
        if (draining) return formatErrorResponse(503, "server_error", "web2harness is draining for a requested service operation");
        if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return new Response("WebSocket upgrade required", { status: 426 });
        }
        if (bunServer.upgrade(req, { data: responsesWs.createData(req) })) return;
        return formatErrorResponse(400, "invalid_request_error", "WebSocket upgrade failed");
      }
      if (req.method === "POST" && url.pathname === "/v1/responses") {
        return dispatchResponses(req);
      }
      if (req.method === "POST" && url.pathname === "/v1/responses/compact") {
        if (draining) return formatErrorResponse(503, "server_error", "web2harness is draining for a requested service operation");
        return httpTurns.track(
          (signal, bindIdentity) => compactRequest(
            new Request(req, { signal }),
            config,
            dependencies.adapterFactory,
            { onTurnIdentity: bindIdentity, bodyBudget },
          ),
          req.signal,
          process.platform,
          "compact",
        );
      }
      if (req.method === "POST" && url.pathname === "/v1/alpha/search") {
        if (draining) return formatErrorResponse(503, "server_error", "web2harness is draining for a requested service operation");
        return httpTurns.track(
          signal => nativeSearchRequest(new Request(req, { signal }), dependencies.fetchUpstream),
          req.signal,
          process.platform,
          "search",
        );
      }
      if (req.method === "POST"
        && (url.pathname === "/v1/images/generations" || url.pathname === "/v1/images/edits")) {
        if (draining) return formatErrorResponse(503, "server_error", "web2harness is draining for a requested service operation");
        const endpoint: NativeImageEndpoint = url.pathname === "/v1/images/generations"
          ? "images/generations"
          : "images/edits";
        return httpTurns.track(
          signal => nativeImagesRequest(new Request(req, { signal }), endpoint, dependencies.fetchUpstream),
          req.signal,
          process.platform,
          endpoint,
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });
  function shutdown(): void {
    if (shutdownPromise) return;
    draining = true;
    // Signals may arrive during native HTTP work. Cancel those owned requests,
    // but do not let an unresponsive upstream delay the independent cleanup owners.
    void httpTurns.cancelAll(new DOMException("Server shutting down", "AbortError"));
    responsesWs.closeAll();
    modelCatalogFetches.close();
    chatGptTurnSessions.clear();
    flushResponseState();
    shutdownPromise = (async () => {
      const transportResults = await Promise.allSettled([responsesWs.settled()]);
      const results = [...transportResults, ...await Promise.allSettled([
        closeChatGptBrowserWorkers(),
        operationStage("cleanup", () => closeTurnBrokers()),
      ])];
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map(result => result.reason);
      if (failures.length > 0) {
        process.exitCode = 1;
        for (const failure of failures) {
          console.error(`[web2harness] shutdown cleanup failed: ${failure instanceof Error ? failure.message : String(failure)}`);
        }
      }
      const flushControlResponse = shutdownCompletionObservers.size > 0;
      for (const complete of [...shutdownCompletionObservers]) complete(failures.length > 0);
      // The authenticated streaming route requires an idle server. Signal shutdown
      // has no such precondition and must close remaining HTTP sockets after cleanup.
      await server.stop(!flushControlResponse);
    })().catch(async error => {
      process.exitCode = 1;
      console.error(`[web2harness] server shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      for (const complete of [...shutdownCompletionObservers]) complete(true);
      await server.stop(true);
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}
