import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { zipSync } from "fflate";
import { HttpBodyBudget } from "../../src/http-body-budget";
import {
  inspectInputReferences, resolveInputReferences, InputReferenceError,
  type ResolveInputReferencesOptions, type InputReferenceTransport,
} from "../../src/responses/input-references";
import { parseRequest, validateRequestForPreparation } from "../../src/responses/parser";
import { parseInputFile } from "../../src/responses/file-input";
import { compileChatGptWebPrompt } from "../../src/adapters/chatgpt-web/prompt/compile";
import { chatGptPromptFilePayloads } from "../../src/adapters/chatgpt-web/browser/composer";
import { copyPreviousResponseProvenance, expandPreviousResponseInput, previousResponseReplayPrefixLength, rememberResponseState } from "../../src/responses/state";

const url = "https://cdn.attachments.org/image.png";
const scope = { taskId: "task-fixture", providerId: "chatgpt-web", accountId: "incoming-fixture-account" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=", "base64");
const image = (image_url = url) => ({ type: "input_image", image_url, detail: "original" });
const body = (...content: unknown[]) => ({ model: "gpt-5.6-sol", input: [{ role: "user", content }] });
const code = (value: string) => (error: unknown) => error instanceof InputReferenceError && error.code === value;

function fixture(chunks: Uint8Array[] = [png], mime = "image/png") {
  const calls: string[] = [];
  let cancellations = 0;
  const transport: InputReferenceTransport = async destination => {
    calls.push(destination.href);
    return {
      status: 200, headers: new Headers({ "content-type": mime }),
      body: (async function* () { yield* chunks; })(),
      cancel() { cancellations++; },
    };
  };
  const reserved: number[] = [];
  const options: ResolveInputReferencesOptions = {
    scope, authorization: { scope, urls: [url] }, signal: new AbortController().signal,
    transport, reserveBytes: bytes => { reserved.push(bytes); },
  };
  return { calls, options, reserved, get cancellations() { return cancellations; } };
}

test("no references preserve object identity and never create download/budget work", async () => {
  const source = body({ type: "input_text", text: "unchanged" });
  const f = fixture();
  expect(await resolveInputReferences(source, f.options)).toBe(source);
  expect(f.calls).toEqual([]);
  expect(f.reserved).toEqual([]);
  // Arbitrary strings, tool arguments and metadata are not implicit download requests.
  expect(inspectInputReferences({ input: [{ type: "function_call", arguments: JSON.stringify(image()) }], metadata: image() })).toEqual([]);
});

test("remote image clones only changed paths; exact bytes, detail and source remain structured", async () => {
  const text = { type: "input_text", text: "look at this" };
  const source = { ...body(text, image()), metadata: { preserved: true } };
  const untouched = { role: "user", content: [{ type: "input_text", text: "unchanged history" }] };
  source.input.push(untouched);
  const f = fixture([png.subarray(0, 10), png.subarray(10)]);
  const result = await resolveInputReferences(source, f.options);
  expect(result).not.toBe(source);
  expect(result.metadata).toBe(source.metadata);
  expect(result.input[1]).toBe(untouched);
  expect(result.input[0]!.content[0]).toBe(text);
  expect(source.input[0]!.content[1]).toEqual(image());
  expect(result.input[0]!.content[1]).toEqual(image("data:image/png;base64," + png.toString("base64")));
  expect(f.cancellations).toBe(1);
  expect(f.reserved.reduce((a, b) => a + b, 0)).toBe(png.length * 10 + 4096 + 2 * 128);
  const parsed = parseRequest(result);
  expect(parsed.context.source!.input).toEqual(result.input);
});

test("provider IDs fail before any URL download, without guessing or accepting inline ambiguity", async () => {
  const f = fixture();
  const source = body(image(), { type: "input_file", file_id: "file-provider-owned" });
  await rejects(resolveInputReferences(source, f.options), code("unsupported_provider_file_reference"));
  expect(f.calls).toEqual([]);
  expect(() => parseRequest(source)).toThrow("verified download endpoint");
  expect(() => validateRequestForPreparation(source)).toThrow("verified download endpoint");
  await rejects(resolveInputReferences(source, { ...f.options, mode: "prepare" }), code("unsupported_provider_file_reference"));
  for (const item of [
    { ...image(), file_id: "file-owned" },
    { type: "input_file", file_data: "eA==", filename: "x.txt", file_url: url },
    { type: "input_file", file_url: url, file_id: "file-owned" },
    { type: "input_file", file_url: "" },
    { type: "input_image", file_id: "../private" },
  ]) expect(() => validateRequestForPreparation(body(item))).toThrow();
});

test("preparation retains original URL references with no network, allocation or fake context", async () => {
  const source = { ...body(image(), { type: "input_file", file_url: "https://files.attachments.org/document.pdf" }),
    generate: false, text: { format: { type: "json_object" } } };
  const f = fixture();
  const validated = validateRequestForPreparation(source);
  expect(validated.validationOnly).toBe(true);
  expect(validated._rawBody).toBe(source);
  expect("context" in validated).toBe(false);
  expect(validated.options.outputFormat).toEqual({ type: "json_object" });
  expect(await resolveInputReferences(source, { ...f.options, mode: "prepare", authorization: undefined, reserveBytes: undefined })).toBe(source);
  expect(f.calls).toEqual([]);
  expect(f.reserved).toEqual([]);
  await rejects(resolveInputReferences({ ...body(image()), generate: false }, f.options), code("attachment_prewarm_requires_validation"));
});

test("preparation validates tool/control syntax and inline bytes before network", () => {
  expect(() => validateRequestForPreparation({ ...body(image()), tools: [{ type: "unsupported-fixture-tool" }] })).toThrow();
  expect(() => validateRequestForPreparation({ ...body(image()), temperature: "invalid" })).toThrow();
  expect(() => validateRequestForPreparation(body({ type: "input_file", filename: "../private.txt", file_url: url }))).toThrow();
  expect(() => validateRequestForPreparation(body({ type: "input_file", filename: "bad.pdf", file_data: "eA==" }))).toThrow();
  expect(() => parseRequest(body(image()))).toThrow("task-authorized resolution");
  expect(() => parseInputFile({ filename: "x.txt", file_url: url, file_data: "eA==" })).toThrow("without file_url");
});

test("native tool output and agent references resolve; replay provenance can be transferred explicitly", async () => {
  const source = { model: "gpt-5.6-sol", input: [
    { type: "agent_message", author: "agent_fixture", content: [image()] },
    { type: "function_call_output", call_id: "function_fixture", output: [image()] },
    { type: "custom_tool_call_output", call_id: "custom_fixture", output: [image()] },
  ] };
  const f = fixture();
  const result = await resolveInputReferences(source, f.options);
  expect(inspectInputReferences(result)).toHaveLength(0);
  expect(f.calls).toHaveLength(3);
  expect(parseRequest(result).context.messages).toHaveLength(3);
  const id = "resp_attachment_provenance_" + crypto.randomUUID();
  expect(rememberResponseState(body(image()), { id, output: [], status: "completed" }, { memoryOnly: true, scope: "attachment-fixture" })).toBe(true);
  const expanded = expandPreviousResponseInput({ model: "gpt-5.6-sol", previous_response_id: id, input: "next" }, "attachment-fixture");
  const resolved = await resolveInputReferences(expanded, f.options);
  expect(previousResponseReplayPrefixLength(expanded)).toBeGreaterThan(0);
  expect(previousResponseReplayPrefixLength(resolved)).toBe(0);
  copyPreviousResponseProvenance(expanded, resolved);
  expect(previousResponseReplayPrefixLength(resolved)).toBe(previousResponseReplayPrefixLength(expanded));
});

test("task/provider/account scope and each exact URL are mandatory, checked before any network", async () => {
  for (const key of ["taskId", "providerId", "accountId"]) {
    const f = fixture();
    await rejects(resolveInputReferences(body(image()), {
      ...f.options, authorization: { scope: { ...scope, [key]: "other" }, urls: [url] },
    }), code("attachment_authorization_required"));
    expect(f.calls).toEqual([]);
  }
  const f = fixture();
  await rejects(resolveInputReferences(body(image()), { ...f.options, authorization: undefined }), code("attachment_authorization_required"));
  await rejects(resolveInputReferences(body(image()), { ...f.options, reserveBytes: undefined }), code("attachment_budget_required"));
  await rejects(resolveInputReferences(body(image(), image("https://other.attachments.org/secret")), f.options), code("attachment_not_authorized"));
  expect(f.calls).toEqual([]);
});

test("redirects are bounded, reauthorized and revalidated; all response bodies close", async () => {
  const f = fixture();
  const next = "https://files.attachments.org/redirect.png";
  const calls: string[] = [];
  let closed = 0;
  const transport: InputReferenceTransport = async destination => {
    calls.push(destination.href);
    return { status: 302, headers: new Headers({ location: next }), body: (async function* () {})(), cancel() { closed++; } };
  };
  await rejects(resolveInputReferences(body(image()), { ...f.options, transport }), code("attachment_not_authorized"));
  expect(calls).toEqual([url]);
  expect(closed).toBe(1);
  await rejects(resolveInputReferences(body(image()), {
    ...f.options, transport, authorization: { scope, urls: [url, next] },
  }), code("attachment_redirect_limit"));
  expect(closed).toBe(5);
  const privateRedirect: InputReferenceTransport = async () => ({
    status: 307, headers: new Headers({ location: "https://127.0.0.1/private" }),
    body: (async function* () {})(), cancel() { closed++; },
  });
  await rejects(resolveInputReferences(body(image()), { ...f.options, transport: privateRedirect }), code("unsafe_attachment_host"));
});

test("authorized redirect preserves final content without forwarding any header credentials", async () => {
  const next = "https://files.attachments.org/actual.png";
  const f = fixture();
  const ordinary = f.options.transport!;
  const transport: InputReferenceTransport = async (destination, signal) => destination.href === url ? {
    status: 302, headers: new Headers({ location: next, "set-cookie": "not-replayed=1" }),
    body: (async function* () {})(), cancel() {},
  } : ordinary(destination, signal);
  const result = await resolveInputReferences(body(image()), { ...f.options, transport, authorization: { scope, urls: [url, next] } });
  expect(f.calls).toEqual([next]);
  expect((result.input[0]!.content[0] as { image_url: string }).image_url).toBe("data:image/png;base64," + png.toString("base64"));
});

test("per-file and total streamed budgets and declared lengths fail closed", async () => {
  const f = fixture([png.subarray(0, 8), png.subarray(8)]);
  await rejects(resolveInputReferences(body(image()), { ...f.options, limits: { fileBytes: 8 } }), code("attachment_limit_exceeded"));
  expect(f.cancellations).toBe(1);
  const g = fixture();
  await rejects(resolveInputReferences(body(image(), image()), { ...g.options, limits: { totalBytes: png.length } }), code("attachment_limit_exceeded"));
  expect(g.cancellations).toBe(2);
  const inline = image("data:image/png;base64," + png.toString("base64"));
  const mixed = fixture();
  await rejects(resolveInputReferences(body(...Array.from({ length: 10 }, () => inline), image()), mixed.options), code("attachment_limit_exceeded"));
  expect(() => validateRequestForPreparation(body(...Array.from({ length: 10 }, () => inline), image()))).toThrow("Mixed inline and remote");
  await rejects(resolveInputReferences(body(inline, image()), { ...mixed.options, limits: { totalBytes: png.length } }), code("attachment_limit_exceeded"));
  expect(mixed.calls).toEqual([]);
  await rejects(resolveInputReferences(body(inline, image()), { ...mixed.options, limits: { totalBytes: png.length * 2 - 1 } }), code("attachment_limit_exceeded"));
  expect(mixed.cancellations).toBe(1);
  const duplicateFile = { type: "input_file", filename: "same.txt", file_data: "eA==" };
  expect(inspectInputReferences(await resolveInputReferences(body(...Array.from({ length: 10 }, () => duplicateFile), image()), fixture().options))).toEqual([]);
  for (const declared of ["-1", "NaN", "20000001", String(png.length + 1)]) {
    const f = fixture();
    const transport: InputReferenceTransport = async (u, s) => {
      const result = await f.options.transport!(u, s);
      result.headers.set("content-length", declared);
      return result;
    };
    await rejects(resolveInputReferences(body(image()), { ...f.options, transport }), (e: unknown) => e instanceof InputReferenceError);
    expect(f.cancellations).toBe(1);
  }
});

test("downloaded allocation is charged to HttpBodyBudget and budget failure closes the stream", async () => {
  const budget = new HttpBodyBudget(4500);
  const reservation = budget.reserve(100);
  const f = fixture();
  await rejects(resolveInputReferences(body(image()), { ...f.options, reserveBytes: bytes => reservation.grow(bytes) }),
    (error: unknown) => error instanceof Error && error.name === "HttpBodyError");
  expect(f.cancellations).toBe(1);
  expect(budget.snapshot().reservedBytes).toBe(100);
  reservation.release();
  expect(budget.snapshot().reservedBytes).toBe(0);
});

test("excess reference counts and pathological empty fragments cannot grow work without a bound", async () => {
  const f = fixture();
  await rejects(resolveInputReferences(body(...Array.from({ length: 11 }, () => image())), f.options), code("attachment_limit_exceeded"));
  expect(() => validateRequestForPreparation(body(...Array.from({ length: 11 }, () => image())))).toThrow("10");
  await rejects(resolveInputReferences(body(image(), image()), { ...f.options, limits: { references: 1 } }), code("attachment_limit_exceeded"));
  expect(f.calls).toEqual([]);
  let closed = false;
  const fragments: InputReferenceTransport = async () => ({
    status: 200, headers: new Headers({ "content-type": "image/png" }),
    body: (async function* () { for (let i = 0; i < 65_537; i++) yield new Uint8Array(); })(),
    cancel() { closed = true; },
  });
  await rejects(resolveInputReferences(body(image()), { ...f.options, transport: fragments }), code("attachment_limit_exceeded"));
  expect(closed).toBe(true);
  expect(f.reserved).toEqual([]);
});

test("abort before downloading, abort stalled chunks, timeout and late transport completion are bounded", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort(new Error("private cancellation reason"));
  await rejects(resolveInputReferences(body(image()), { ...f.options, signal: controller.signal }), code("attachment_cancelled"));
  expect(f.calls).toEqual([]);
  let closed = 0;
  const stalled: InputReferenceTransport = async () => ({
    status: 200, headers: new Headers({ "content-type": "image/png" }),
    body: { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } },
    cancel() { closed++; },
  });
  await rejects(resolveInputReferences(body(image()), { ...f.options, transport: stalled, limits: { timeoutMs: 15 } }), code("attachment_timeout"));
  expect(closed).toBe(1);
  const abort = new AbortController();
  const pending = resolveInputReferences(body(image()), { ...f.options, transport: stalled, signal: abort.signal });
  setTimeout(() => abort.abort(), 5);
  await rejects(pending, code("attachment_cancelled"));
  expect(closed).toBe(2);
  const late: InputReferenceTransport = async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
    return { status: 200, headers: new Headers(), body: (async function* () {})(), cancel() { closed++; } };
  };
  // A trusted injected transport owns its DNS/headers timers; the resolver still
  // releases late results after caller cancellation. Real phase timeout coverage uses HTTPS IO injection.
  const lateAbort = new AbortController();
  const latePending = resolveInputReferences(body(image()), { ...f.options, transport: late, signal: lateAbort.signal });
  lateAbort.abort();
  await rejects(latePending, code("attachment_cancelled"));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(closed).toBe(3);
});

test("MIME, byte signature, compression, raw audio/video and transport errors never produce lossy substitutes", async () => {
  for (const mime of ["image/svg+xml", "audio/wav", "video/mp4", "application/octet-stream", "image/png; charset=iso-8859-1"]) {
    const f = fixture([png], mime);
    await rejects(resolveInputReferences(body(image()), f.options), code("unsupported_attachment_media_type"));
  }
  const mismatch = fixture([Buffer.from("HTML, not PNG")]);
  await rejects(resolveInputReferences(body(image()), mismatch.options), code("invalid_attachment_content"));
  const f = fixture();
  const compressed: InputReferenceTransport = async (u, s) => {
    const result = await f.options.transport!(u, s);
    result.headers.set("content-encoding", "gzip");
    return result;
  };
  await rejects(resolveInputReferences(body(image()), { ...f.options, transport: compressed }), code("unsupported_attachment_encoding"));
  for (const type of ["input_video", "audio", "video"]) {
    expect(() => validateRequestForPreparation(body({ type, data: "opaque", transcript: "not a substitute" }))).toThrow("not equivalent");
  }
  await rejects(resolveInputReferences(body(image()), { ...f.options, transport: async () => { throw new Error("https://private/token?secret"); } }),
    (error: unknown) => error instanceof InputReferenceError && !error.message.includes("private"));
});

const formats = [
  ["docx", "word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["pptx", "ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
] as const;
for (const [extension, part, mime] of formats) test(extension + " file_url preserves raw bytes/MIME through real shared upload payload validation", async () => {
  const bytes = Buffer.from(zipSync({
    "[Content_Types].xml": Buffer.from('<Types><Override PartName="/' + part + '" ContentType="' + mime + '.main+xml"/></Types>'),
    "_rels/.rels": Buffer.from('<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="' + part + '"/></Relationships>'),
    [part]: Buffer.from("<document>attachment-only marker, formatting unchanged</document>"),
    "media/raw.bin": new Uint8Array([0, 255, 128, 64]),
  }));
  const f = fixture([bytes], mime);
  const source = body({ type: "input_file", filename: "document." + extension, file_url: url });
  const resolved = await resolveInputReferences(source, f.options);
  const prompt = compileChatGptWebPrompt(parseRequest(resolved), {
    nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false,
  });
  const [payload] = chatGptPromptFilePayloads(prompt);
  expect(payload!.buffer).toEqual(bytes);
  expect(payload!.mimeType).toBe(mime);
  expect(prompt.text).not.toContain("attachment-only marker");
  expect(source.input[0]!.content[0]).toEqual({ type: "input_file", filename: "document." + extension, file_url: url });
  const invalid = fixture([Buffer.from("not ZIP")], mime);
  await rejects(resolveInputReferences(source, invalid.options), code("invalid_attachment_content"));
  expect(f.reserved.at(-1)).toBeGreaterThan(bytes.length);
});

test("Office decompression reservation happens before inflate and retains the shared budget error", async () => {
  const [extension, part, mime] = formats[0];
  const bytes = Buffer.from(zipSync({
    "[Content_Types].xml": Buffer.from('<Types><Override PartName="/' + part + '" ContentType="' + mime + '.main+xml"/></Types>'),
    "_rels/.rels": Buffer.from('<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="' + part + '"/></Relationships>'),
    [part]: Buffer.from("<document>" + "x".repeat(1_000_000) + "</document>"),
  }));
  const budget = new HttpBodyBudget(100_000);
  const reservation = budget.reserve(0);
  const f = fixture([bytes], mime);
  await rejects(resolveInputReferences(body({ type: "input_file", filename: "file." + extension, file_url: url }), {
    ...f.options, reserveBytes: count => reservation.grow(count),
  }), (error: unknown) => error instanceof Error && error.name === "HttpBodyError");
  expect(f.cancellations).toBe(1);
  expect(budget.snapshot().reservedBytes).toBeLessThan(100_000);
  reservation.release();
  expect(budget.snapshot().reservedBytes).toBe(0);
});

test("PDF/text filenames can come from URL; generic binary MIME and mismatched filename are rejected", async () => {
  const pdfUrl = "https://cdn.attachments.org/document.pdf";
  const f = fixture([Buffer.from("%PDF-1.7\nraw")], "application/pdf");
  const resolved = await resolveInputReferences(body({ type: "input_file", file_url: pdfUrl }), {
    ...f.options, authorization: { scope, urls: [pdfUrl] },
  });
  expect(resolved.input[0]!.content[0]).toEqual({
    type: "input_file", filename: "document.pdf", file_data: "data:application/pdf;base64," + Buffer.from("%PDF-1.7\nraw").toString("base64"),
  });
  await rejects(resolveInputReferences(body({ type: "input_file", file_url: url, filename: "text.txt" }), f.options), code("invalid_attachment_content"));
  const text = fixture([Buffer.from("UTF-8 中文")], "text/plain; charset=utf-8");
  expect(inspectInputReferences(await resolveInputReferences(body({ type: "input_file", filename: "script.ts", file_url: url }), text.options))).toEqual([]);
  const generic = fixture([Buffer.from("%PDF-1.7")], "application/octet-stream");
  await rejects(resolveInputReferences(body({ type: "input_file", filename: "document.pdf", file_url: url }), generic.options), code("unsupported_attachment_media_type"));
});

test("observed PDF qs negotiation weight retains declared MIME and every binary byte", async () => {
  // Reproduce the observed public response headers with fixture bytes, without a network request.
  const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(13_255, 255)]);
  const source = body({ type: "input_file", filename: "dummy.pdf", file_url: url });
  const f = fixture([bytes.subarray(0, 100), bytes.subarray(100)], "application/pdf; qs=0.001");
  const transport: InputReferenceTransport = async (destination, signal) => {
    const result = await f.options.transport!(destination, signal);
    result.headers.set("content-length", "13264");
    return result;
  };
  const resolved = await resolveInputReferences(source, { ...f.options, transport });
  const prompt = compileChatGptWebPrompt(parseRequest(resolved), {
    nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false,
  });
  const [payload] = chatGptPromptFilePayloads(prompt);
  expect(payload!.mimeType).toBe("application/pdf");
  expect(payload!.buffer.length).toBe(13_264);
  expect(payload!.buffer).toEqual(bytes);
  expect(source.input[0]!.content[0]).toEqual({ type: "input_file", filename: "dummy.pdf", file_url: url });
  expect(f.cancellations).toBe(1);
});

test("qs allows only a numeric source quality and never bypasses MIME or charset validation", async () => {
  const bytes = Buffer.from("%PDF-1.7\nfixture");
  const source = body({ type: "input_file", filename: "dummy.pdf", file_url: url });
  for (const parameter of ["qs=0", "qs=0.0", "QS = 0.001", "qs=0.999", "qs=1", "qs=1.000", "charset=utf-8; qs=0.001"]) {
    const f = fixture([bytes], "application/pdf; " + parameter);
    const resolved = await resolveInputReferences(source, f.options);
    expect((resolved.input[0]!.content[0] as { file_data: string }).file_data).toBe("data:application/pdf;base64," + bytes.toString("base64"));
  }
  for (const mime of [
    "application/pdf; qs=-0.1", "application/pdf; qs=1.001", "application/pdf; qs=0.0001",
    "application/pdf; qs=NaN", "application/pdf; qs=1e-3", "application/pdf; qs=",
    "application/pdf; qs=0.1; qs=0.2", "application/pdf; q=0.001",
    "application/pdf; qs=0.001; charset=iso-8859-1",
    "application/pdf; charset=utf-16; qs=0.001",
    "application/pdf; qs=0.001; unknown=allowed",
    "application/octet-stream; qs=0.001",
  ]) {
    const f = fixture([bytes], mime);
    await rejects(resolveInputReferences(source, f.options), code("unsupported_attachment_media_type"));
    expect(f.reserved).toEqual([]);
  }
});
