import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { adapterErrorEvent, httpStatusFromTerminalError } from "../src/lib/errors";
import { diagnosticContext, diagnosticError } from "../src/diagnostics";
import { parseDiagnosticLine, PREFIX, createDiagnosticRecord, safeDetail, type DiagnosticRecord } from "../launcher/shared/diagnostic-event.cjs";
import { chatGptTurnSupersededError, ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { browserHelperError } from "../src/adapters/chatgpt-web/browser/browser-helper-error";
import { LauncherBrowserHelperClient } from "../src/adapters/chatgpt-web/browser/launcher-helper-client";
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL, notifyLauncherTurn } from "../src/browser/launcher-client";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser/browser-worker";
import { responseRequest } from "../src/server";
import { defaultConfig } from "../src/config";
import * as licensing from "../src/licensing/service";
import type { AdapterEvent } from "../src/types";

const fixtureParent = realpathSync(tmpdir());
const fixturePrefix = "web2harness-errors-boundary-";
const fixtureRoot = mkdtempSync(join(fixtureParent, fixturePrefix));
const fixtureOwner = JSON.stringify({ test: "errors-boundary", pid: process.pid, nonce: randomUUID() });
writeFileSync(join(fixtureRoot, "owner.json"), fixtureOwner);
function assertFixtureOwnership() {
  const absolute = resolve(fixtureRoot);
  if (dirname(absolute) !== fixtureParent || !basename(absolute).startsWith(fixturePrefix)
    || lstatSync(absolute).isSymbolicLink() || realpathSync(absolute) !== absolute
    || readFileSync(join(absolute, "owner.json"), "utf8") !== fixtureOwner) {
    throw new Error("Errors boundary fixture ownership could not be verified");
  }
}
assertFixtureOwnership();
afterAll(() => {
  assertFixtureOwnership();
  rmSync(fixtureRoot, { recursive: true, force: true });
});
const previousHome = process.env.WEB2HARNESS_HOME;
const records: DiagnosticRecord[] = [];
const restorers: Array<() => void> = [];

function captureDiagnostics() {
  records.length = 0;
  const logger = spyOn(console, "error").mockImplementation((value: unknown) => {
    const record = parseDiagnosticLine(String(value));
    if (record) records.push(record);
  });
  restorers.push(() => logger.mockRestore());
}

afterEach(() => {
  for (const restore of restorers.splice(0).reverse()) restore();
  if (previousHome === undefined) delete process.env.WEB2HARNESS_HOME;
  else process.env.WEB2HARNESS_HOME = previousHome;
});

function networkError() {
  return Object.assign(new Error("connect ECONNREFUSED https://user:PRIVATE_PASS@example.test/path?token=PRIVATE_TOKEN"), {
    code: "ECONNREFUSED", errno: -4078, syscall: "connect", authorization: "PRIVATE_AUTH",
  });
}

test("Responses outer catch preserves superseded 499 semantics for JSON and SSE without exposing cause or stack", async () => {
  process.env.WEB2HARNESS_HOME = fixtureRoot;
  const license = spyOn(licensing, "requireLicense").mockResolvedValue({
    state: "active", deviceCode: "fixture", licenseId: "fixture", issuedAt: "2026-01-01T00:00:00Z", expiresAt: null,
  });
  restorers.push(() => license.mockRestore());
  const noNetwork = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected fixture network access"));
  restorers.push(() => noNetwork.mockRestore());
  captureDiagnostics();
  for (const stream of [false, true]) {
    const original = chatGptTurnSupersededError();
    original.cause = networkError();
    original.stack = "Error: superseded\n    at INTERNAL_STACK_FIXTURE (C:\\Users\\PRIVATE_USER\\server.ts:42:3)";
    const events: AdapterEvent[] = [];
    const response = await diagnosticContext.run({ requestId: `request-${stream}` }, () => responseRequest(new Request("http://fixture/responses", {
      method: "POST", body: JSON.stringify({ model: "chatgpt-web/high", stream,
        input: [{ type: "message", id: "fixture-message", role: "user", content: [{ type: "input_text", text: "fixture" }] }],
      }),
    }), defaultConfig("browser-only"), () => ({ name: "error-fixture", async runTurn() { throw original; } }), {
      rememberState: false, onAdapterEvent: event => events.push(event),
    }));
    const body = await response.text();
    expect(events).toEqual([{ type: "error", message: original.message, status: 499,
      errorType: "client_closed_request", code: "client_cancelled", retryable: false }]);
    expect(body).toContain('"code":"client_cancelled"');
    expect(body).not.toMatch(/PRIVATE_|INTERNAL_STACK_FIXTURE|ECONNREFUSED|diagnosticRef|"stack"|"cause"/);
    const terminal = stream ? JSON.parse(body.split("\n").find(line => line.startsWith("data: ") && line.includes('"response.failed"'))!.slice(6)).response : JSON.parse(body);
    expect(terminal.status).toBe("failed");
    expect(httpStatusFromTerminalError(terminal.error)).toBe(499);
    const evidence = records.find(record => record.event === "http.adapter_failed" && record.detail.requestId === `request-${stream}`)!;
    expect(evidence.level).toBe("info");
    expect(evidence.detail.stack).toContain("INTERNAL_STACK_FIXTURE");
    expect(evidence.detail.cause).toMatchObject({ code: "ECONNREFUSED", errno: -4078, syscall: "connect" });
    expect(JSON.stringify(evidence)).not.toContain("PRIVATE_");
  }
  expect(noNetwork).not.toHaveBeenCalled();
});

test("public conversion retains explicit fields and removes embedded stacks and credentials", () => {
  const error = Object.assign(new Error("Connection failed token=PRIVATE_TOKEN\n    at PRIVATE_STACK (fixture:1:2)"), {
    status: 503, code: "control_unavailable", errorType: "server_error", retryable: false, cause: networkError(),
  });
  expect(adapterErrorEvent(error)).toEqual({ type: "error", message: "Connection failed [credential removed]", status: 503,
    code: "control_unavailable", errorType: "server_error", retryable: false });
  expect(adapterErrorEvent(new DOMException("cancelled", "AbortError"))).toMatchObject({
    status: 499, code: "client_cancelled", errorType: "client_closed_request", retryable: false,
  });
  expect(adapterErrorEvent(Object.assign(new Error("cancelled"), { status: 499 }))).toMatchObject({ status: 499, retryable: false });
});

function descriptor() {
  const script = join(fixtureRoot, "unused-helper.cjs");
  writeFileSync(script, "throw new Error('Fixture must not start a helper');\n");
  const path = join(fixtureRoot, "launcher.json");
  writeFileSync(path, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND, profile: "development", pid: process.pid,
    endpoint: "http://127.0.0.1:39001", control: { endpoint: "http://127.0.0.1:39002", token: "fixture-control-" + "x".repeat(40) },
    helper: { executable: process.execPath, script }, partition: "persist:web2harness-dev-chatgpt", idleUrl: LAUNCHER_BROWSER_IDLE_URL,
    surfaceId: "a".repeat(32), surfaceTargets: { ["a".repeat(32)]: "fixture-target" }, createdAt: new Date().toISOString(),
  }), { mode: 0o600 });
  return path;
}

test("launcher control wraps network failures with their original cause and redacted diagnostic metadata", async () => {
  captureDiagnostics();
  const original = new TypeError("fetch failed", { cause: networkError() });
  const fetch = spyOn(globalThis, "fetch").mockRejectedValue(original);
  restorers.push(() => fetch.mockRestore());
  const error = await notifyLauncherTurn(descriptor(), { phase: "start", traceId: "fixture-control", helperPid: process.pid })
    .then(() => { throw new Error("Expected control failure"); }, error => error);
  expect(error.cause).toBe(original);
  expect(error.cause.cause.code).toBe("ECONNREFUSED");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ event: "browser.control_failed", detail: { traceId: "fixture-control", phase: "start",
    cause: { cause: { code: "ECONNREFUSED", errno: -4078, syscall: "connect" } } } });
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE_/);
});

test("control cancellation and timeout keep the fetch cause while remaining distinct", async () => {
  captureDiagnostics();
  for (const cancelled of [true, false]) {
    const original = networkError();
    const controller = new AbortController();
    const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (...[_input, init]: Parameters<typeof globalThis.fetch>) => {
      if (cancelled) { controller.abort(); throw original; }
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(original), { once: true }));
    }, { preconnect() {} }));
    try {
      const failure = await notifyLauncherTurn(descriptor(), { phase: "start", traceId: "fixture-abort", helperPid: process.pid }, 5, controller.signal)
        .then(() => { throw new Error("Expected failure"); }, error => error);
      expect(failure.cause).toBe(original);
      if (cancelled) expect(adapterErrorEvent(failure)).toMatchObject({ status: 499, retryable: false });
      else { expect(failure.message).toContain("timed out"); expect(failure.name).not.toBe("AbortError"); }
    } finally { fetch.mockRestore(); }
  }
});

function receiveHelperError(frame: ReturnType<typeof browserHelperError>, traceId = frame.id): Error {
  const client = new LauncherBrowserHelperClient({ appName: "Fixture", browserHost: "launcher", browserHostDescriptorPath: "unused",
    storageStatePath: "unused", chromeExecutablePath: "unused", headed: false, autoApproveToolCalls: false, useSavedChats: false });
  const internal = client as unknown as { child: unknown; pending: Map<string, unknown>; handleLine(child: unknown, line: string): void };
  const child = {};
  internal.child = child;
  let failure: Error | undefined;
  internal.pending.set(frame.id, { turn: { traceId } as BrowserTurn,
    resolve() { throw new Error("Expected helper error"); }, reject(error: Error) { failure = error; } });
  internal.handleLine(child, JSON.stringify(frame));
  expect(internal.pending.size).toBe(0);
  expect(failure).toBeInstanceOf(Error);
  return failure!;
}

test("helper envelopes correlate aggregate roots across JSON IPC without transporting internal stacks", () => {
  captureDiagnostics();
  const operation = new Error("Operation timed out", { cause: networkError() });
  const cleanup = Object.assign(new Error("Closing page failed password=PRIVATE_PASS"), { code: "CLOSE_FAILED" });
  const original = new AggregateError([operation, cleanup], "Browser cleanup could not settle");
  const frame = browserHelperError("fixture-aggregate", original);
  expect(frame.diagnosticRef).toMatch(/^diag-[a-f0-9]{24}$/);
  expect(JSON.stringify(frame)).not.toMatch(/stack|cause|errors|PRIVATE_|CLOSE_FAILED/);
  const received = receiveHelperError(frame);
  const later = diagnosticError(new Error("Adapter failed", { cause: received }));
  expect(later.cause).toMatchObject({ diagnosticRef: frame.diagnosticRef });
  const sentEvidence = records.find(record => record.event === "browser.helper_failed")!;
  expect(sentEvidence.detail.errorRef).toBe(frame.diagnosticRef);
  expect(sentEvidence.detail.errors).toMatchObject([
    { message: "Operation timed out", cause: { code: "ECONNREFUSED", syscall: "connect" } },
    { code: "CLOSE_FAILED" },
  ]);
  expect(records.find(record => record.event === "browser.helper_error_received")!.detail).toMatchObject({
    traceId: frame.id, diagnosticRef: frame.diagnosticRef,
  });
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE_/);
});

test("helper preserves structured cancellation and ordinary AbortError, and accepts legacy errors", () => {
  captureDiagnostics();
  for (const source of [chatGptTurnSupersededError(), new DOMException("cancelled", "AbortError")]) {
    const error = receiveHelperError(browserHelperError("fixture-cancel", source));
    expect(adapterErrorEvent(error)).toMatchObject({ status: 499, code: "client_cancelled", retryable: false });
    if (source.name === "AbortError") expect(error.name).toBe("AbortError");
  }
  expect(receiveHelperError({ type: "error", id: "fixture-legacy", message: "legacy failure" }).message).toBe("legacy failure");
});

test("helper diagnostics distinguish request identity from a supplied turn trace and omit unknown traces", () => {
  captureDiagnostics();
  const frame = browserHelperError("fixture-request", new Error("turn failed"), "fixture-turn-trace");
  receiveHelperError(frame, "fixture-turn-trace");
  expect(records.find(record => record.event === "browser.helper_failed")!.detail).toMatchObject({
    requestId: "fixture-request", traceId: "fixture-turn-trace", errorRef: frame.diagnosticRef,
  });
  expect(records.find(record => record.event === "browser.helper_error_received")!.detail).toMatchObject({
    requestId: "fixture-request", traceId: "fixture-turn-trace", diagnosticRef: frame.diagnosticRef,
  });
  const unknown = diagnosticContext.run({ traceId: "unrelated-context-trace" }, () =>
    browserHelperError("fixture-maintenance-request", new Error("maintenance failed")));
  const evidence = records.find(record => record.detail.requestId === unknown.id)!.detail;
  expect(evidence).toMatchObject({ requestId: unknown.id, errorRef: unknown.diagnosticRef });
  expect(evidence).not.toHaveProperty("traceId");
});

test("shared diagnostic filtering preserves cause, aggregate children and remote references on repeated passes", () => {
  const error = Object.assign(new AggregateError([networkError(), new Error("cleanup failed")], "combined", {
    cause: Object.assign(new Error("cancelled"), { status: 499, errorType: "client_closed_request", code: "client_cancelled", retryable: false }),
  }), { diagnosticRef: "diag-" + "a".repeat(24) });
  const first = diagnosticError(error);
  const second = safeDetail(safeDetail(first));
  expect(second).toEqual(first);
  expect(second).toMatchObject({ errorRef: first.errorRef, diagnosticRef: "diag-" + "a".repeat(24),
    cause: { status: 499, errorType: "client_closed_request", code: "client_cancelled", retryable: false },
    errors: [{ code: "ECONNREFUSED", errno: -4078, syscall: "connect" }, { message: "cleanup failed" }],
  });
  const persisted = parseDiagnosticLine(PREFIX + JSON.stringify(createDiagnosticRecord("error", "browser.fixture_failed", second)))!;
  expect(persisted.detail).toMatchObject(second);
  expect(JSON.stringify(persisted)).not.toMatch(/PRIVATE_/);
});

test("aggregate diagnostics have finite depth, width, size and cycle handling", () => {
  const root = new AggregateError([], "root");
  root.cause = root;
  root.errors = Array.from({ length: 100 }, () => new AggregateError(
    Array.from({ length: 100 }, () => new Error("x".repeat(20_000))), "branch"));
  const evidence = diagnosticError(root);
  expect(evidence.cause).toMatchObject({ message: "[circular or repeated error]" });
  expect(evidence.errors!.length).toBeLessThanOrEqual(8);
  expect(evidence.errorsOmitted).toBeGreaterThan(0);
  const encoded = PREFIX + JSON.stringify(createDiagnosticRecord("error", "browser.test_failed", evidence));
  expect(encoded.length).toBeLessThan(200_000);
  expect(parseDiagnosticLine(encoded)).not.toBeNull();
  expect(diagnosticError(root).errorRef).toBe(evidence.errorRef);
  const escaped = new AggregateError(Array.from({ length: 30 }, () => {
    const error = Object.assign(new Error("\u0001".repeat(20_000)), { code: "\u0001".repeat(20_000) });
    error.stack = "\u0001".repeat(20_000);
    return error;
  }), "escaped");
  expect(parseDiagnosticLine(PREFIX + JSON.stringify(createDiagnosticRecord("error", "browser.test_failed", diagnosticError(escaped))))).not.toBeNull();
  let chain: Error = new Error("deep");
  for (let i = 0; i < 20; i++) chain = new Error("wrapper", { cause: chain });
  expect(JSON.stringify(diagnosticError(chain))).toContain('"causeOmitted":true');
});

test("helper carries only classified remote MCP metadata across JSON IPC", () => {
  captureDiagnostics();
  const remote = { kind: "rate_limit", source: "probe", status: 429, retryAfterMs: 45000 } as const;
  const original = new ChatGptWebAdapterError("Remote MCP rate limited", { status: 502, errorType: "server_error", code: "mcp_remote_rate_limited", retryable: false, mcpRemote: remote });
  const received = receiveHelperError(browserHelperError("remote-fixture", original));
  expect(received).toMatchObject({ code: "mcp_remote_rate_limited", retryable: false, mcpRemote: remote });
});
