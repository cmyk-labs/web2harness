import { expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { observeChatGptAttachmentUploads, ChatGptAttachmentUploadError } from "../../../../src/adapters/chatgpt-web/browser/attachment-upload";
import { browserHelperError } from "../../../../src/adapters/chatgpt-web/browser/browser-helper-error";
import { diagnosticContext } from "../../../../src/diagnostics";
import { parseDiagnosticLine, type DiagnosticRecord } from "../../../../launcher/shared/diagnostic-event.cjs";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const fileName = "PRIVATE_FILENAME.txt";

function fixture(options: { streaming?: () => Promise<unknown>; body?: () => Promise<unknown> } = {}) {
  const session = new EventEmitter() as EventEmitter & { send: (method: string) => Promise<any>; detach: () => Promise<void> };
  const commands: string[] = [];
  session.send = async method => {
    commands.push(method);
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "owned-frame" } } };
    if (method === "Network.streamResourceContent") return options.streaming?.() ?? { bufferedData: "" };
    if (method === "Network.getResponseBody") return options.body?.() ?? { body: '{"event":"file.processing.completed"}\n' };
    return {};
  };
  session.detach = async () => {};
  const page = { url: () => "https://chatgpt.com/", context: () => ({ newCDPSession: async () => session }) };
  const emit = (method: string, params: object) => session.emit("event", { method, params });
  const request = (requestId = "owned-request", name = fileName, endpoint = "process_upload_stream") => {
    emit("Network.requestWillBeSent", { requestId, frameId: "owned-frame",
      request: { method: "POST", url: `https://chatgpt.com/backend-api/files/${endpoint}`, postData: JSON.stringify({ file_name: name }) } });
    emit("Network.responseReceived", { requestId, response: { status: 200 } });
  };
  return { page, session, commands, emit, request };
}

async function capture(run: () => Promise<void>) {
  const records: DiagnosticRecord[] = [];
  const log = spyOn(console, "error").mockImplementation((value: unknown) => {
    const record = parseDiagnosticLine(String(value));
    if (record) records.push(record);
  });
  try { await diagnosticContext.run({ traceId: "owned-trace" }, run); return records; }
  finally { log.mockRestore(); }
}

test("a failed CDP body read is not an explicit upload failure and preserves its classification across IPC", async () => {
  const mock = fixture({
    streaming: async () => { throw new Error("PRIVATE_STREAM_ERROR"); },
    body: async () => { throw new Error("PRIVATE_BODY_ERROR"); },
  });
  const records = await capture(async () => {
    const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
    try {
      mock.request();
      await flush();
      mock.emit("Network.loadingFinished", { requestId: "owned-request" });
      const error = await uploads.wait(undefined, 1_000).catch(error => error);
      expect(error).not.toBeInstanceOf(ChatGptAttachmentUploadError);
      expect(browserHelperError("owned-call", error)).toMatchObject({
        code: "chatgpt_attachment_observation_failed", retryable: false, status: 502,
      });
    } finally { await uploads.dispose(); }
  });
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  expect(records.find(record => record.event === "browser.attachment_observation")?.detail).toMatchObject({
    traceId: "owned-trace", fileIndex: 0, attempt: 1, processingObserved: true,
    streamingFailed: true, bodyReadFailed: true, code: "chatgpt_attachment_observation_failed",
  });
});

test("an unobserved attachment has a typed nonretryable timeout without exposing file content or names", async () => {
  const mock = fixture();
  const records = await capture(async () => {
    const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
    try {
      const error = await uploads.wait(undefined, 10).catch(error => error);
      expect(error).not.toBeInstanceOf(ChatGptAttachmentUploadError);
      expect(browserHelperError("owned-call", error)).toMatchObject({
        code: "chatgpt_attachment_processing_timeout", retryable: false, status: 502,
      });
    } finally { await uploads.dispose(); }
  });
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  expect(records.find(record => record.event === "browser.attachment_observation")?.detail).toMatchObject({
    traceId: "owned-trace", fileIndex: 0, attempt: 1, creationObserved: false, processingObserved: false,
    outcome: "timed-out", timeoutMs: 10, code: "chatgpt_attachment_processing_timeout",
  });
});

test("stream completion without a processing confirmation does not authorize reupload", async () => {
  const mock = fixture({ body: async () => ({ body: '{"event":"file.processing.file_ready"}\n' }) });
  const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
  try {
    mock.request();
    await flush();
    mock.emit("Network.loadingFinished", { requestId: "owned-request" });
    const error = await uploads.wait(undefined, 1_000).catch(error => error);
    expect(error).not.toBeInstanceOf(ChatGptAttachmentUploadError);
    expect(error).toMatchObject({ code: "chatgpt_attachment_observation_failed", retryable: false });
    expect(error.message).toContain("without a completion event");
  } finally { await uploads.dispose(); }
});

test("a stuck streaming command yields to the completed response body within the observation budget", async () => {
  const originalTimeout = globalThis.setTimeout;
  const clock = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms: number) =>
    originalTimeout(callback, ms === 30_000 ? 20 : ms)) as typeof setTimeout);
  const mock = fixture({ streaming: () => new Promise(() => {}) });
  try {
    const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
    try {
      mock.request();
      mock.emit("Network.loadingFinished", { requestId: "owned-request" });
      await uploads.wait(undefined, 1_000);
      expect(mock.commands).toContain("Network.getResponseBody");
      uploads.throwIfFailed();
    } finally { await uploads.dispose(); }
  } finally { clock.mockRestore(); }
});

test("completion evidence is scoped to the current attempt and overrides later connection cancellation", async () => {
  let oldStreaming!: (value: unknown) => void;
  const old = new Promise(resolve => { oldStreaming = resolve; });
  let count = 0;
  const mock = fixture({ streaming: async () => ++count === 1 ? old : { bufferedData: "" },
    body: async () => { throw new Error("Still processing"); } });
  const records = await capture(async () => {
    const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
    try {
      mock.request("old-request");
      uploads.fail(fileName, "explicit card failure");
      uploads.reset(fileName);
      mock.request("new-request");
      let finished = false;
      const pending = uploads.wait(undefined, 1_000).then(() => { finished = true; });
      await flush();
      oldStreaming({ bufferedData: Buffer.from('{"event":"file.processing.completed"}\n').toString("base64") });
      await flush();
      expect(finished).toBeFalse();
      mock.emit("Network.dataReceived", { requestId: "new-request",
        data: Buffer.from('{"event":"file.processing.completed"}\n').toString("base64") });
      await pending;
      mock.emit("Network.loadingFailed", { requestId: "new-request" });
      await flush();
      uploads.throwIfFailed();
    } finally { await uploads.dispose(); }
  });
  const events = records.filter(record => record.event === "browser.attachment_observation").map(record => record.detail);
  expect(events.map(event => [event.attempt, event.outcome])).toEqual([[1, "failed"], [2, "succeeded"]]);
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
});

test("malformed and unrelated processing events cannot establish success or leak their contents into diagnostics", async () => {
  const mock = fixture({ body: async () => { throw new Error("Still processing"); } });
  const records = await capture(async () => {
    const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
    try {
      mock.emit("Network.requestWillBeSent", { requestId: "owned-request", frameId: "owned-frame",
        request: { method: "POST", url: "https://chatgpt.com/backend-api/files/process_upload_stream",
          postData: JSON.stringify({ file_name: fileName, file_id: "owned-file" }) } });
      mock.emit("Network.responseReceived", { requestId: "owned-request", response: { status: 200 } });
      await flush();
      mock.emit("Network.dataReceived", { requestId: "owned-request", data: Buffer.from(
        'null\nPRIVATE_INVALID_JSON\n{"event":"PRIVATE_EVENT"}\n{"event":"file.processing.completed","file_id":"other-file"}\n',
      ).toString("base64") });
      expect(await uploads.wait(undefined, 10).catch(error => error)).toMatchObject({ code: "chatgpt_attachment_processing_timeout" });
    } finally { await uploads.dispose(); }
  });
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  expect(records.find(record => record.event === "browser.attachment_observation")?.detail).toMatchObject({
    malformedEvents: 2, unrecognizedEvents: 1, ignoredFileEvents: 1, completed: false,
    reason: "processing_completion_unconfirmed",
  });
});

test("a dropped terminal event is recovered from the same request inside the original deadline", async () => {
  const mock = fixture();
  const records = await capture(async () => {
    const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
    try {
      uploads.started(fileName);
      mock.request();
      await uploads.wait(undefined, 100);
      expect(mock.commands.filter(command => command === "Network.getResponseBody")).toHaveLength(1);
      expect(mock.commands.filter(command => /POST|replay|loadNetworkResource/.test(command))).toHaveLength(0);
    } finally { await uploads.dispose(); }
  });
  const stages = records.filter(record => record.event === "browser.attachment_stage").map(record => record.detail);
  expect(stages.some(detail => (detail.lastEvent as any)?.type === "upload_started")).toBeTrue();
  expect(stages.some(detail => (detail.lastEvent as any)?.type === "reconciliation_started")).toBeTrue();
  expect(JSON.stringify(records)).not.toContain(fileName);
});

test("a transient response-body read failure recovers without replaying the upload", async () => {
  let reads = 0;
  const mock = fixture({ body: async () => {
    if (++reads === 1) throw new Error("PRIVATE_CDP_ERROR");
    return { body: '{"event":"file.processing.completed"}\n' };
  } });
  const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
  try {
    mock.request();
    mock.emit("Network.loadingFinished", { requestId: "owned-request" });
    await uploads.wait(undefined, 1_000);
    expect(reads).toBe(2);
    expect(mock.commands.filter(command => command === "Network.streamResourceContent")).toHaveLength(1);
  } finally { await uploads.dispose(); }
});

for (const terminal of ["timeout", "cancel"] as const) test(`late completion cannot reverse a delivered ${terminal}`, async () => {
  let finishBody!: (body: unknown) => void;
  const body = new Promise(resolve => { finishBody = resolve; });
  const mock = fixture({ body: () => body });
  const controller = new AbortController();
  const records = await capture(async () => {
    const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
    try {
      mock.request();
      mock.emit("Network.loadingFinished", { requestId: "owned-request" });
      const pending = uploads.wait(controller.signal, terminal === "timeout" ? 20 : 1_000).catch(error => error);
      if (terminal === "cancel") controller.abort(new DOMException("Owned cancellation", "AbortError"));
      const firstError = await pending;
      expect(firstError).toBeInstanceOf(Error);
      finishBody({ body: '{"event":"file.processing.completed"}\n' });
      mock.emit("Network.dataReceived", { requestId: "owned-request",
        data: Buffer.from('{"event":"file.processing.completed"}\n').toString("base64") });
      await flush();
      expect(await uploads.wait(undefined, 100).catch(error => error)).toBe(firstError);
    } finally { await uploads.dispose(); }
  });
  const terminalRecords = records.filter(record => record.event === "browser.attachment_observation");
  expect(terminalRecords).toHaveLength(1);
  expect(terminalRecords[0]?.detail.outcome).toBe(terminal === "timeout" ? "timed-out" : "cancelled");
});

test("a cancelled connection can still confirm completion from its original response", async () => {
  const mock = fixture();
  const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
  try {
    mock.request();
    mock.emit("Network.loadingFailed", { requestId: "owned-request" });
    await uploads.wait(undefined, 1_000);
    expect(mock.commands.filter(command => command === "Network.getResponseBody")).toHaveLength(1);
  } finally { await uploads.dispose(); }
});

test("conflicting file identities cannot confirm an attachment with the same filename", async () => {
  const mock = fixture();
  const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
  try {
    for (const fileId of ["first-file", "different-file"]) mock.emit("Network.requestWillBeSent", {
      requestId: fileId, frameId: "owned-frame", request: { method: "POST",
        url: "https://chatgpt.com/backend-api/files/process_upload_stream",
        postData: JSON.stringify({ file_name: fileName, file_id: fileId }) },
    });
    expect(await uploads.wait(undefined, 100).catch(error => error))
      .toMatchObject({ code: "chatgpt_attachment_observation_failed", retryable: false });
    expect(mock.commands).not.toContain("Network.getResponseBody");
  } finally { await uploads.dispose(); }
});

test("loss of a creation connection does not prove a failed upload or authorize reupload", async () => {
  const mock = fixture();
  const uploads = await observeChatGptAttachmentUploads(mock.page as never, [fileName]);
  try {
    mock.emit("Network.requestWillBeSent", { requestId: "creation", frameId: "owned-frame",
      request: { method: "POST", url: "https://chatgpt.com/backend-api/files",
        postData: JSON.stringify({ file_name: fileName }) } });
    mock.emit("Network.loadingFailed", { requestId: "creation" });
    const error = await uploads.wait(undefined, 100).catch(error => error);
    expect(error).not.toBeInstanceOf(ChatGptAttachmentUploadError);
    expect(error).toMatchObject({ code: "chatgpt_attachment_observation_failed", retryable: false });
    expect(mock.commands).not.toContain("Network.getResponseBody");
  } finally { await uploads.dispose(); }
});
