import { InputReferenceError } from "./input-reference-network";

function invalid(detail: string): never {
  throw new InputReferenceError("invalid_input_audio", `input_audio ${detail}`);
}

interface Box { type: string; start: number; end: number }

/** ISO BMFF box boundaries only. Media payload and codec metadata remain opaque. */
function* boxes(bytes: Buffer, start = 0, end = bytes.length): Generator<Box> {
  while (start < end) {
    if (start + 8 > end) invalid("has a truncated MP4 box");
    let size = bytes.readUInt32BE(start);
    const type = bytes.toString("ascii", start + 4, start + 8);
    let header = 8;
    if (size === 1) {
      if (start + 16 > end) invalid("has a truncated extended MP4 box");
      const extended = bytes.readBigUInt64BE(start + 8);
      if (extended > BigInt(end - start)) invalid("MP4 box exceeds its container");
      size = Number(extended);
      header = 16;
    } else if (size === 0) {
      size = end - start;
    }
    if (size < header || size > end - start) invalid("MP4 box exceeds its container");
    yield { type, start: start + header, end: start + size };
    start += size;
  }
}

/** Inspect every track, including disabled tracks; do not guess audio from an M4A brand. */
export function assertM4aAudio(bytes: Buffer): void {
  let fileType = false;
  let audio = false;
  for (const box of boxes(bytes)) {
    if (box.type === "ftyp") {
      if (box.end - box.start < 8 || (box.end - box.start) % 4) invalid("has an invalid MP4 file type box");
      fileType = true;
    }
    if (box.type !== "moov") continue;
    for (const track of boxes(bytes, box.start, box.end)) {
      if (track.type !== "trak") continue;
      let handler: string | undefined;
      for (const media of boxes(bytes, track.start, track.end)) {
        if (media.type !== "mdia") continue;
        for (const child of boxes(bytes, media.start, media.end)) {
          if (child.type !== "hdlr") continue;
          if (handler !== undefined || child.end - child.start < 12) invalid("has an ambiguous or truncated MP4 track handler");
          // FullBox version/flags + pre_defined precede handler_type.
          handler = bytes.toString("ascii", child.start + 8, child.start + 12);
          if (handler === "vide") invalid("contains a video track; audio-only MP4 is required");
        }
      }
      if (!handler) invalid("has an MP4 track without a media handler");
      if (handler === "soun") audio = true;
    }
  }
  if (!fileType || !audio) invalid("does not identify an MP4 container with an audio track");
}

interface Element { id: number; start: number; end: number | null }

/** EBML IDs retain their marker; sizes remove it. null is the standard unknown-size value. */
function element(bytes: Buffer, offset: number, end: number): Element {
  const vint = (id: boolean): { value: bigint; width: number; unknown: boolean } => {
    if (offset >= end || bytes[offset] === 0) invalid("has an invalid EBML variable integer");
    let width = 1;
    let marker = 128;
    while (!(bytes[offset]! & marker)) { marker >>= 1; width++; }
    if (width > (id ? 4 : 8) || offset + width > end) invalid("has a truncated or oversized EBML variable integer");
    let value = BigInt(id ? bytes[offset]! : bytes[offset]! & (marker - 1));
    for (let i = 1; i < width; i++) value = (value << 8n) | BigInt(bytes[offset + i]!);
    offset += width;
    return { value, width, unknown: !id && value === (1n << BigInt(7 * width)) - 1n };
  };
  const id = Number(vint(true).value);
  const size = vint(false);
  if (size.unknown) return { id, start: offset, end: null };
  if (size.value > BigInt(end - offset)) invalid("EBML element exceeds its container");
  return { id, start: offset, end: offset + Number(size.value) };
}

function* elements(bytes: Buffer, start: number, end: number): Generator<Element & { end: number }> {
  while (start < end) {
    const child = element(bytes, start, end);
    if (child.end === null) invalid("has an unknown-size EBML element outside Segment/Cluster");
    yield { ...child, end: child.end };
    start = child.end;
  }
}

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const TRACKS = 0x1654ae6b;
// These siblings terminate an unknown-size Cluster. Never scan raw encoded block bytes.
const segmentChildren = new Set([0x114d9b74, 0x1549a966, CLUSTER, TRACKS, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);

function clusterEnd(bytes: Buffer, start: number, end: number): number {
  while (start < end) {
    const child = element(bytes, start, end);
    if (segmentChildren.has(child.id) || child.id === SEGMENT || child.id === EBML) return start;
    if (child.end === null) invalid("has an unknown-size WebM Cluster child");
    start = child.end;
  }
  return end;
}

function audioTracks(bytes: Buffer, start: number, end: number): boolean {
  let audio = false;
  for (const entry of elements(bytes, start, end)) {
    if (entry.id !== 0xae) continue; // TrackEntry
    let type: bigint | undefined;
    let codec: string | undefined;
    for (const field of elements(bytes, entry.start, entry.end)) {
      if (field.id === 0x83) {
        if (type !== undefined || field.end - field.start < 1 || field.end - field.start > 8) invalid("has an ambiguous WebM TrackType");
        type = 0n;
        for (let i = field.start; i < field.end; i++) type = (type << 8n) | BigInt(bytes[i]!);
      } else if (field.id === 0x86) {
        if (codec !== undefined) invalid("has an ambiguous WebM CodecID");
        codec = bytes.toString("utf8", field.start, field.end).replace(/\0+$/, "");
      }
    }
    if (type === 1n || codec?.startsWith("V_")) invalid("contains a video track; audio-only WebM is required");
    if (type === undefined) invalid("has a WebM track without TrackType");
    if (type === 2n) {
      if (codec !== "A_OPUS" && codec !== "A_VORBIS") invalid("WebM audio track must identify Opus or Vorbis");
      audio = true;
    }
  }
  return audio;
}

/** WebM track classification, including streaming Segment/Cluster sizes; no frame decoding. */
export function assertWebmAudio(bytes: Buffer): void {
  const header = element(bytes, 0, bytes.length);
  if (header.id !== EBML || header.end === null) invalid("does not identify a WebM EBML header");
  let docType: string | undefined;
  for (const field of elements(bytes, header.start, header.end)) {
    if (field.id === 0x4282) {
      if (docType !== undefined) invalid("has an ambiguous EBML DocType");
      docType = bytes.toString("ascii", field.start, field.end).replace(/\0+$/, "");
    }
  }
  if (docType !== "webm") invalid("requires WebM DocType");
  let audio = false;
  for (let offset = header.end; offset < bytes.length;) {
    const segment = element(bytes, offset, bytes.length);
    if (segment.id === 0xec || segment.id === 0xbf) { // global Void / CRC-32
      if (segment.end === null) invalid("has an unknown-size EBML global element");
      offset = segment.end;
      continue;
    }
    if (segment.id !== SEGMENT) invalid("requires a WebM Segment");
    const end = segment.end ?? bytes.length;
    offset = segment.start;
    while (offset < end) {
      const child = element(bytes, offset, end);
      if (segment.end === null && child.id === SEGMENT) break;
      if (child.id === TRACKS) {
        if (child.end === null) invalid("has unknown-size WebM Tracks");
        audio = audioTracks(bytes, child.start, child.end) || audio;
      }
      if (child.end === null && child.id !== CLUSTER) invalid("has an unsupported unknown-size WebM element");
      offset = child.end ?? clusterEnd(bytes, child.start, end);
    }
  }
  if (!audio) invalid("does not identify a WebM audio track");
}
