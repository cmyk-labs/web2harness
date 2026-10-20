import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseInputAudio } from "../../src/responses/audio-input";
import { MAX_INPUT_FILE_BYTES } from "../../src/responses/file-input";
import { parseRequest, validateRequestForPreparation } from "../../src/responses/parser";
import { inputReferenceOf, inspectInputReferences, resolveInputReferences } from "../../src/responses/input-references";
import { responsesRequestSchema } from "../../src/responses/schema";
import { compileChatGptWebPrompt } from "../../src/adapters/chatgpt-web/prompt/compile";
import { chatGptPromptFilePayloads } from "../../src/adapters/chatgpt-web/browser/composer";
import { validateInputFiles, inputFileTokens } from "../../src/adapters/chatgpt-web/prompt/file-attachments";
import { CHATGPT_WEB_MODEL_ID } from "../../src/adapters/chatgpt-web/model";

// A complete, decodable 16-bit mono PCM WAV: 10 ms of silence, 8 kHz.
function wav(): Buffer {
  const bytes = Buffer.alloc(204);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(160, 40);
  return bytes;
}

// Container/header identification fixtures only; they do not establish codec decodability.
function ogg(codec: "opus" | "vorbis" | "video" = "opus"): Buffer {
  const packet = codec === "opus" ? Buffer.concat([Buffer.from("OpusHead"), Buffer.alloc(11)])
    : codec === "vorbis" ? Buffer.concat([Buffer.from([1]), Buffer.from("vorbis"), Buffer.alloc(23)])
    : Buffer.from("\x80theora");
  const header = Buffer.alloc(28);
  header.write("OggS"); header[5] = 2; header[26] = 1; header[27] = packet.length;
  return Buffer.concat([header, packet]);
}
const mp3 = Buffer.concat([Buffer.from([255, 251, 144, 0]), Buffer.alloc(413)]);
const flac = Buffer.alloc(42);
flac.write("fLaC"); flac[4] = 128; flac.writeUIntBE(34, 5, 3);

// Minimal container fixtures: classification and boundary tests, not encoded AAC/Opus samples.
function box(type: string, data: Buffer, size: "normal" | "extended" | "end" = "normal"): Buffer {
  const header = Buffer.alloc(size === "extended" ? 16 : 8);
  header.writeUInt32BE(size === "extended" ? 1 : size === "end" ? 0 : data.length + header.length);
  header.write(type, 4);
  if (size === "extended") header.writeBigUInt64BE(BigInt(data.length + header.length), 8);
  return Buffer.concat([header, data]);
}
const ftyp = box("ftyp", Buffer.concat([Buffer.from("M4A "), Buffer.alloc(4), Buffer.from("isommp42")]));
function mp4Track(handler: string): Buffer {
  const hdlr = Buffer.alloc(24);
  hdlr.write(handler, 8);
  return box("trak", box("mdia", box("hdlr", hdlr)));
}
function m4a(handlers = ["soun"]): Buffer {
  return Buffer.concat([ftyp, box("mdat", Buffer.from("opaque fixture media")), box("moov", Buffer.concat(handlers.map(mp4Track)))]);
}
function ebml(id: string, data: Buffer, size: number | "unknown" = 1): Buffer {
  const header = size === "unknown" ? Buffer.from("01ffffffffffffff", "hex") : Buffer.alloc(size);
  if (size !== "unknown") {
    let value = BigInt(data.length) | (1n << BigInt(7 * size));
    for (let i = size - 1; i >= 0; i--) { header[i] = Number(value & 255n); value >>= 8n; }
  }
  return Buffer.concat([Buffer.from(id, "hex"), header, data]);
}
const ebmlHeader = ebml("1a45dfa3", ebml("4282", Buffer.from("webm")));
function webmTrack(type = 2, codec = "A_OPUS"): Buffer {
  return ebml("ae", Buffer.concat([ebml("83", Buffer.from([type])), ebml("86", Buffer.from(codec))]));
}
function webm(tracks = [webmTrack()], unknown = false): Buffer {
  const cluster = ebml("1f43b675", ebml("a3", Buffer.from([129, 0, 0, 128, 0])), unknown ? "unknown" : 1);
  return Buffer.concat([ebmlHeader, ebml("18538067", Buffer.concat([
    ebml("1654ae6b", Buffer.concat(tracks)), cluster,
  ]), unknown ? "unknown" : 2)]);
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const audio = (bytes = wav(), mime = "audio/wav") => ({ type: "input_audio", audio_url: `data:${mime};base64,${bytes.toString("base64")}` });
const body = (content: unknown[]) => ({ model: CHATGPT_WEB_MODEL_ID, reasoning: { effort: "xhigh" }, input: [{ role: "user", content }] });
const capabilities = { nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false };
const compile = (request: unknown) => compileChatGptWebPrompt(parseRequest(request), capabilities);

test("audio binary size is bounded as an attachment rather than counted byte-for-byte as text context", () => {
  // A 30-second 8 kHz PCM recording is only 480 KB; interpreting each byte as one
  // text token would falsely exceed the model window before Web could process it.
  const bytes = Buffer.alloc(480044);
  wav().copy(bytes, 0, 0, 44);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  const prompt = compile(body([audio(bytes)]));
  expect(chatGptPromptFilePayloads(prompt)[0]!.buffer).toEqual(bytes);
  expect(inputFileTokens(prompt.files, CHATGPT_WEB_MODEL_ID)).toBe(0);
  expect(prompt.text).toContain("attachment_ref");
});

for (const [mime, bytes, extension] of [
  ["audio/wav", wav(), "wav"], ["audio/x-wav", wav(), "wav"], ["audio/wave", wav(), "wav"],
  ["audio/mpeg", mp3, "mp3"], ["audio/mp3", mp3, "mp3"],
  ["audio/ogg", ogg(), "ogg"], ["audio/ogg", ogg("vorbis"), "ogg"],
  ["audio/flac", flac, "flac"], ["audio/x-flac", flac, "flac"],
  ["audio/mp4", m4a(), "m4a"], ["audio/x-m4a", m4a(), "m4a"], ["audio/m4a", m4a(), "m4a"],
  ["audio/webm", webm(), "webm"], ["audio/webm", webm([webmTrack(2, "A_VORBIS")], true), "webm"],
] as const) {
  test(`${mime} ${extension} preserves byte hash through schema, parser, prompt and shared upload payload`, () => {
    const block = audio(bytes, mime);
    const request = body([{ type: "input_text", text: "Listen to the original." }, block]);
    expect(responsesRequestSchema.safeParse(request).success).toBe(true);
    const parsed = parseRequest(request);
    expect(parsed.context.source!.input).toEqual(request.input);
    expect(parsed.modelId).toBe(CHATGPT_WEB_MODEL_ID);
    expect(parsed.options.reasoning).toBe("xhigh");
    expect(validateRequestForPreparation(request).validationOnly).toBe(true);
    const prompt = compile(request);
    const [payload] = chatGptPromptFilePayloads(prompt);
    expect(payload!.mimeType).toBe(mime);
    expect(payload!.name.endsWith("." + extension)).toBe(true);
    expect(hash(payload!.buffer)).toBe(hash(bytes));
    expect(payload!.buffer).toEqual(bytes);
    expect(prompt.text).toContain('"type":"input_audio"');
    expect(prompt.text).toContain('"attachment_ref"');
    expect(prompt.text).not.toContain(block.audio_url);
    expect(prompt.text).not.toContain(bytes.toString("base64"));
  });
}

for (const type of ["function_call_output", "custom_tool_call_output"]) for (const [mime, bytes] of [
  ["audio/wav", wav()], ["audio/mp4", m4a()], ["audio/webm", webm()],
] as const) {
  test(`${type} ${mime}: Codex-normalized MCP Audio preserves original result position, bytes and call_id`, () => {
    // protocol/src/models.rs converts MCP {type:"audio",data,mimeType} to this shape.
    const block = audio(bytes, mime);
    const request = {
      model: CHATGPT_WEB_MODEL_ID, reasoning: { effort: "xhigh" },
      input: [{ type, call_id: "mcp-audio-17", output: [
        { type: "input_text", text: "BEFORE_AUDIO" }, { ...block, annotation: "preserved" },
        { type: "input_text", text: "AFTER_AUDIO" },
      ] }],
    };
    expect(responsesRequestSchema.safeParse(request).success).toBe(true);
    const parsed = parseRequest(request);
    expect(parsed.context.source!.input).toEqual(request.input);
    const prompt = compile(request);
    const [payload] = chatGptPromptFilePayloads(prompt);
    expect(hash(payload!.buffer)).toBe(hash(bytes));
    expect(payload!.mimeType).toBe(mime);
    expect(prompt.text).toContain('"call_id":"mcp-audio-17"');
    expect(prompt.text).toContain('"annotation":"preserved"');
    expect(prompt.text.indexOf("BEFORE_AUDIO")).toBeLessThan(prompt.text.indexOf('"type":"input_audio"'));
    expect(prompt.text.indexOf('"type":"input_audio"')).toBeLessThan(prompt.text.indexOf("AFTER_AUDIO"));
    expect(prompt.text).not.toContain(block.audio_url);
  });
}

test("source-less compatibility projection retains binary attachments too", () => {
  const parsed = parseRequest(body([audio()]));
  delete parsed.context.source;
  const prompt = compileChatGptWebPrompt(parsed, capabilities);
  expect(chatGptPromptFilePayloads(prompt)[0]!.buffer).toEqual(wav());
});

test("replayed identical audio deduplicates uploads while preserving every source occurrence", () => {
  const block = audio();
  const request = body([block, block]);
  const prompt = compile(request);
  expect(prompt.files).toHaveLength(1);
  expect(prompt.text.match(/"type":"input_audio"/g)).toHaveLength(2);
  expect(inspectInputReferences(request)).toEqual([]);
  expect(chatGptPromptFilePayloads(prompt)).toHaveLength(1);
  expect(() => validateInputFiles([{ ...prompt.files![0], filename: "../audio.wav" }])).toThrow("identity mismatch");
  expect(() => validateInputFiles([{ ...prompt.files![0], mimeType: "audio/mpeg" }])).toThrow("declared");
});

test("ID3-tagged MPEG retains the complete tag and audio bytes", () => {
  const tag = Buffer.alloc(10); tag.write("ID3"); tag[3] = 4;
  const bytes = Buffer.concat([tag, mp3]);
  expect(parseInputAudio(audio(bytes, "audio/mpeg")).data).toBe(bytes.toString("base64"));
  expect(() => parseInputAudio(audio(tag, "audio/mpeg"))).toThrow("declared");
});

test("unsupported containers, missing MIME, raw PCM and MIME mismatches return explicit errors", () => {
  for (const mime of ["audio/aac", "audio/pcm", "application/octet-stream", "video/mp4", "video/webm"]) {
    expect(() => parseInputAudio(audio(wav(), mime))).toThrow("currently supports");
  }
  for (const block of [
    audio(Buffer.from("not audio")), audio(mp3, "audio/wav"), audio(wav(), "audio/ogg"),
    audio(ogg("video"), "audio/ogg"), audio(Buffer.concat([ogg(), ogg("video")]), "audio/ogg"),
    audio(ogg().subarray(0, 30), "audio/ogg"), { audio_url: "data:;base64,AAAA" },
    { audio_url: "data:audio/wav,RIFF" }, { audio_url: "data:audio/wav;base64,Zh==" },
    { audio_url: "data:audio/wav;base64," }, { audio_url: "data:audio/wav;base64,%%==" },
  ]) expect(() => parseInputAudio(block)).toThrow();
});

test("M4A inspects every media handler, never accepts a video track or brand alone", () => {
  for (const bytes of [m4a(["vide"]), m4a(["soun", "vide"]), m4a(["vide", "soun"])]) {
    expect(() => parseInputAudio(audio(bytes, "audio/mp4"))).toThrow("video track");
  }
  expect(() => parseInputAudio(audio(ftyp, "audio/mp4"))).toThrow("audio track");
  expect(() => parseInputAudio(audio(m4a(["meta"]), "audio/mp4"))).toThrow("audio track");
  expect(() => parseInputAudio(audio(Buffer.concat([ftyp, box("moov", box("trak", Buffer.alloc(0)))]), "audio/mp4"))).toThrow("without a media handler");
  // Cover art/opaque payload may contain "vide": only actual track handler metadata is relevant.
  const bytes = Buffer.concat([box("free", Buffer.from("vide")), m4a(["soun", "meta"])]);
  expect(parseInputAudio(audio(bytes, "audio/mp4")).data).toBe(bytes.toString("base64"));
});

test("M4A extended/end-sized boxes and fragmented opaque media preserve all bytes", () => {
  const bytes = Buffer.concat([
    ftyp, box("moov", mp4Track("soun"), "extended"),
    box("moof", Buffer.from("fragment metadata")), box("mdat", Buffer.from("unchanged bytes"), "end"),
  ]);
  const [payload] = chatGptPromptFilePayloads(compile(body([audio(bytes, "audio/mp4")])));
  expect(hash(payload!.buffer)).toBe(hash(bytes));
  for (const malformed of [
    bytes.subarray(0, 7),
    Buffer.concat([ftyp, Buffer.from("000000016d6f6f76ffffffffffffffff", "hex")]),
    Buffer.concat([ftyp, Buffer.from("000000046d6f6f76", "hex")]),
    m4a().subarray(0, m4a().length - 1),
    Buffer.concat([ftyp, box("moov", box("trak", box("mdia", box("hdlr", Buffer.alloc(8)))))]),
  ]) expect(() => parseInputAudio(audio(malformed, "audio/mp4"))).toThrow();
});

test("WebM checks all TrackEntries and rejects video, missing type, absent audio and non-WebM DocType", () => {
  for (const bytes of [
    webm([webmTrack(1, "V_VP9")]), webm([webmTrack(), webmTrack(1, "V_VP8")]),
    webm([webmTrack(1, "V_AV1"), webmTrack()]), webm([webmTrack(2, "V_VP9")]),
  ]) expect(() => parseInputAudio(audio(bytes, "audio/webm"))).toThrow("video track");
  for (const bytes of [
    webm([]), webm([ebml("ae", ebml("86", Buffer.from("A_OPUS")))]),
    Buffer.concat([ebml("1a45dfa3", ebml("4282", Buffer.from("matroska"))), webm().subarray(ebmlHeader.length)]),
    webm([webmTrack(2, "unknown")]),
  ]) expect(() => parseInputAudio(audio(bytes, "audio/webm"))).toThrow();
});

test("WebM unknown-size clusters terminate at sibling metadata without skipping later video tracks", () => {
  const bytes = Buffer.concat([ebmlHeader, ebml("18538067", Buffer.concat([
    ebml("1654ae6b", webmTrack()),
    ebml("1f43b675", ebml("a3", Buffer.from("opaque block containing V_VP9 and Tracks bytes")), "unknown"),
    ebml("1f43b675", ebml("a3", Buffer.from([129, 0, 0, 128])), "unknown"),
    ebml("1254c367", Buffer.alloc(0)), // Tags ends the unknown Cluster.
    ebml("1654ae6b", webmTrack(2, "A_VORBIS")),
  ]), "unknown")]);
  expect(parseInputAudio(audio(bytes, "audio/webm")).data).toBe(bytes.toString("base64"));
  const withVideo = Buffer.concat([bytes, ebml("1654ae6b", webmTrack(1, "V_VP9"))]);
  expect(() => parseInputAudio(audio(withVideo, "audio/webm"))).toThrow("video track");
});

test("WebM bounds variable integers and metadata sizes; malformed sizes never loop or consume a sibling", () => {
  const known = webm();
  for (const bytes of [
    Buffer.from([0]), Buffer.from("1a45dfa3", "hex"), known.subarray(0, known.length - 1),
    Buffer.concat([ebmlHeader, Buffer.from("1853806701fffffffffffffe", "hex")]),
    Buffer.concat([ebmlHeader, ebml("18538067", ebml("1654ae6b", webmTrack(), "unknown"), "unknown")]),
    webm([ebml("ae", Buffer.concat([ebml("83", Buffer.alloc(0)), ebml("86", Buffer.from("A_OPUS"))]))]),
    webm([ebml("ae", Buffer.concat([ebml("83", Buffer.from([2])), ebml("83", Buffer.from([1]))]))]),
  ]) expect(() => parseInputAudio(audio(bytes, "audio/webm"))).toThrow();
  // A non-minimal eight-byte finite size is legal and does not imply an unknown length.
  const finite = Buffer.concat([ebmlHeader, ebml("18538067", ebml("1654ae6b", webmTrack()), 8)]);
  expect(parseInputAudio(audio(finite, "audio/webm")).data).toBe(finite.toString("base64"));
});

test("remote audio requires task authorization and preparation never downloads or substitutes a transcript", async () => {
  let calls = 0;
  const request = body([{ type: "input_audio", audio_url: "https://example.com/audio.wav", transcript: "not a substitute" }]);
  await expect(resolveInputReferences(request, {
    scope: { taskId: "audio", providerId: "web", accountId: "fixture" },
    signal: new AbortController().signal,
    transport: async () => { calls++; throw new Error("must not fetch"); },
  })).rejects.toThrow("authorization");
  expect(calls).toBe(0);
  expect(validateRequestForPreparation(request).validationOnly).toBe(true);
  expect(() => inputReferenceOf({ type: "input_audio", data: "raw MCP data" })).toThrow("audio_url");
  expect(() => parseRequest(body([{ type: "audio", data: wav().toString("base64"), mimeType: "audio/wav" }]))).toThrow();
});

test("authorized remote audio preserves tool-result positions, MIME and bytes through the shared downloader", async () => {
  const url = "https://example.com/audio.wav", bytes = wav();
  const request = { model: CHATGPT_WEB_MODEL_ID, input: [{
    type: "function_call_output", call_id: "audio-result",
    output: [{ type: "input_text", text: "before" }, { type: "input_audio", audio_url: url, annotation: "retained" }],
  }] };
  const scope = { taskId: "audio-task", providerId: "web", accountId: "fixture" };
  let requests = 0, cancellations = 0, reserved = 0;
  const options = {
    scope, authorization: { scope, urls: [url] }, signal: new AbortController().signal,
    reserveBytes: (n: number) => { reserved += n; },
    transport: async (destination: URL) => {
      expect(destination.href).toBe(url); requests++;
      return { status: 200, headers: new Headers({ "content-type": "audio/wav" }),
        body: (async function* () { yield bytes.subarray(0, 17); yield bytes.subarray(17); })(),
        cancel: () => { cancellations++; } };
    },
  };
  expect(await resolveInputReferences(request, { ...options, mode: "prepare" })).toBe(request);
  expect(requests).toBe(0);
  const resolved = await resolveInputReferences(request, options);
  const [payload] = chatGptPromptFilePayloads(compile(resolved));
  expect(payload!.buffer).toEqual(bytes);
  expect(payload!.mimeType).toBe("audio/wav");
  expect(resolved.input[0]!.output[1]).toEqual({ type: "input_audio", audio_url: audio(bytes).audio_url, annotation: "retained" });
  expect(request.input[0]!.output[1]!.audio_url).toBe(url);
  expect(compile(resolved).text).toContain('"call_id":"audio-result"');
  expect([requests, cancellations]).toEqual([1, 1]);
  expect(reserved).toBeGreaterThan(bytes.length);
  await expect(resolveInputReferences(request, { ...options, authorization: { scope, urls: [] } })).rejects.toThrow("not authorized");
  expect(requests).toBe(1);
  await expect(resolveInputReferences(request, { ...options, transport: async () => ({
    status: 200, headers: new Headers({ "content-type": "video/mp4" }),
    body: (async function* () { yield bytes; })(), cancel() {},
  }) })).rejects.toThrow("specific media type");
});

test("existing file-size, combined-count and mixed-remote budgets include audio", () => {
  const oversized = Buffer.alloc(MAX_INPUT_FILE_BYTES + 1); wav().copy(oversized);
  expect(() => parseInputAudio(audio(oversized))).toThrow("20 MB");
  const blocks = Array.from({ length: 11 }, (_, i) => {
    const bytes = wav(); bytes[44] = i; return audio(bytes);
  });
  expect(() => chatGptPromptFilePayloads(compile(body(blocks)))).toThrow();
  expect(() => inspectInputReferences(body([
    ...blocks.slice(0, 10), { type: "input_image", image_url: "https://example.org/image.png" },
  ]))).toThrow("10 attachment");
  const distinct = Array.from({ length: 3 }, (_, i) => {
    const bytes = Buffer.alloc(17_000_000); wav().copy(bytes); bytes[44] = i; return audio(bytes);
  });
  expect(() => chatGptPromptFilePayloads(compile(body(distinct)))).toThrow("50 MB");
});
