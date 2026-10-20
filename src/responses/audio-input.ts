import type { CodexFileContent } from "../types";
import { MAX_INPUT_FILE_BYTES } from "./file-input";
import { InputReferenceError } from "./input-reference-network";
import { assertM4aAudio, assertWebmAudio } from "./audio-containers";

const formats = new Map([
  ["audio/wav", "wav"], ["audio/x-wav", "wav"], ["audio/wave", "wav"],
  ["audio/mpeg", "mp3"], ["audio/mp3", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/flac", "flac"], ["audio/x-flac", "flac"],
  ["audio/mp4", "m4a"], ["audio/x-m4a", "m4a"], ["audio/m4a", "m4a"],
  ["audio/webm", "webm"],
]);

export function isSupportedAudioMime(mime: string): boolean {
  return formats.has(mime);
}

function invalid(detail: string): never {
  throw new InputReferenceError("invalid_input_audio", `input_audio ${detail}`);
}

/** No implicit network reads, transcript substitution or guesses about raw PCM parameters. */
export function assertInlineAudioReference(input: { audio_url?: unknown }): string {
  if (typeof input.audio_url !== "string" || !input.audio_url) invalid("requires a nonempty audio_url");
  if (!input.audio_url.startsWith("data:")) {
    throw new InputReferenceError("unsupported_audio_reference", "input_audio requires an inline base64 audio_url; remote URLs and provider file IDs are not resolved");
  }
  return input.audio_url;
}

/**
 * Identify Ogg audio streams without decoding or rewriting their packets. Inspect every BOS
 * page so multiplexed video is not mislabeled as audio. Actual decodability is checked by Web.
 */
function oggAudio(bytes: Buffer): boolean {
  let offset = 0;
  let streams = 0;
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || bytes.toString("ascii", offset, offset + 4) !== "OggS"
      || bytes[offset + 4] !== 0) return false;
    const count = bytes[offset + 26]!;
    const start = offset + 27 + count;
    if (start > bytes.length) return false;
    let length = 0;
    for (let i = offset + 27; i < start; i++) length += bytes[i]!;
    if (start + length > bytes.length) return false;
    if (bytes[offset + 5]! & 2) {
      const packet = bytes.subarray(start, start + length);
      if (!packet.subarray(0, 8).equals(Buffer.from("OpusHead"))
        && !(packet[0] === 1 && packet.toString("ascii", 1, 7) === "vorbis")) return false;
      streams++;
    }
    offset = start + length;
  }
  return streams > 0;
}

function mpegAudio(bytes: Buffer): boolean {
  let offset = 0;
  if (bytes.toString("ascii", 0, 3) === "ID3") {
    if (bytes.length < 10 || bytes.subarray(6, 10).some(value => value > 127)) return false;
    offset = 10 + (bytes[6]! << 21 | bytes[7]! << 14 | bytes[8]! << 7 | bytes[9]!);
    // ID3v2.4's optional footer is outside its declared tag payload.
    if (bytes[3] === 4 && (bytes[5]! & 16)) offset += 10;
  }
  if (offset + 4 > bytes.length) return false;
  const b = bytes[offset + 1]!;
  const c = bytes[offset + 2]!;
  return bytes[offset] === 255 && (b & 224) === 224 && (b & 24) !== 8
    && (b & 6) !== 0 && (c & 240) !== 240 && (c & 12) !== 12;
}

/**
 * Codex ContentItem/FunctionCallOutputContentItem::InputAudio carries audio_url, including
 * MCP Audio content converted by Codex. Reuse the binary-file transport without altering bytes.
 * These checks establish format identity, not a local codec/decode guarantee.
 */
export function parseInputAudio(input: { audio_url?: unknown }): CodexFileContent {
  const url = assertInlineAudioReference(input);
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (!match) invalid("requires a base64 data URL with an explicit supported audio MIME type");
  const mimeType = match[1]!.toLowerCase();
  const extension = formats.get(mimeType);
  if (!extension) {
    throw new InputReferenceError("unsupported_input_audio_format", "input_audio currently supports WAV, MP3/MPEG, OGG Opus/Vorbis, FLAC, audio-only M4A/MP4 and WebM; other containers and raw PCM require a verified format path");
  }
  const data = match[2]!;
  if (!data.length || data.length > Math.ceil(MAX_INPUT_FILE_BYTES / 3) * 4
    || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    invalid("requires canonical base64 within the existing 20 MB file limit");
  }
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_INPUT_FILE_BYTES || bytes.toString("base64") !== data) {
    invalid("requires nonempty canonical base64 within the existing 20 MB file limit");
  }
  if (extension === "m4a") assertM4aAudio(bytes);
  if (extension === "webm") assertWebmAudio(bytes);
  const valid = extension === "m4a" || extension === "webm" || (extension === "wav"
    ? bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE"
    : extension === "mp3" ? mpegAudio(bytes)
    : extension === "ogg" ? oggAudio(bytes)
    : bytes.length >= 42 && bytes.toString("ascii", 0, 4) === "fLaC"
      && (bytes[4]! & 127) === 0 && bytes.readUIntBE(5, 3) === 34);
  if (!valid) invalid("bytes do not identify the declared supported audio format");
  return { type: "file", filename: `audio.${extension}`, mimeType, data };
}
