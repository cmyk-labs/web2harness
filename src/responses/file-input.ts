import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { CodexFileContent } from "../types";

export const MAX_INPUT_FILE_BYTES = 20_000_000;
const textExtensions = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".h", ".cpp", ".cs", ".sh", ".sql", ".yaml", ".yml", ".toml", ".log"]);

const officeFormats = new Map([
  [".docx", { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", part: "word/document.xml" }],
  [".xlsx", { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", part: "xl/workbook.xml" }],
  [".pptx", { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", part: "ppt/presentation.xml" }],
]);
// Local validation budgets, independent of account-specific ChatGPT upload limits.
const MAX_OFFICE_ENTRIES = 4096;
const MAX_OFFICE_ENTRY_BYTES = 50_000_000;
const MAX_OFFICE_EXPANDED_BYTES = 100_000_000;
const MAX_OFFICE_MANIFEST_BYTES = 1_000_000;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function officeError(detail: string): never {
  throw new Error(`input_file Office package: ${detail}`);
}

/** Only inspect attributes needed to identify the package. Never resolve XML entities or links. */
function manifestAttributes(xml: string, tag: string): Array<Record<string, string>> {
  return [...xml.replace(/<!--[\s\S]*?-->/g, "").matchAll(new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${tag}\\b([^<>]*)/?>`, "g"))].map(match => {
    const attributes: Record<string, string> = Object.create(null);
    for (const attribute of match[1]!.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g)) {
      if (Object.hasOwn(attributes, attribute[1]!)) officeError("duplicate manifest attribute");
      attributes[attribute[1]!] = attribute[2] ?? attribute[3]!;
    }
    return attributes;
  });
}

/**
 * Validate a bounded, single-disk OOXML ZIP without extracting files or rewriting bytes.
 * This is container/identity validation, not a full OOXML schema validator or malware scan.
 * ZIP64, encryption, nonstandard main-part locations and macro-enabled formats are unsupported.
 */
function validateOfficePackage(bytes: Buffer, format: { mime: string; part: string }, reserveValidationBytes?: (bytes: number) => void): void {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) officeError("missing ZIP directory");
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryStart = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
    || bytes.readUInt16LE(end + 8) !== count || !count || count > MAX_OFFICE_ENTRIES
    || directoryStart + directorySize !== end) officeError("unsupported ZIP directory or entry count");

  const entries: Array<{ name: string; start: number; finish: number; dataStart: number; compressed: number; expanded: number; method: number; crc: number }> = [];
  const names = new Set<string>();
  let expandedTotal = 0;
  let cursor = directoryStart;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) officeError("invalid ZIP directory entry");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const next = cursor + 46 + nameLength + extraLength + bytes.readUInt16LE(cursor + 32);
    const start = bytes.readUInt32LE(cursor + 42);
    // Bits 1/2 are DEFLATE tuning, bit 3 is a data descriptor, bit 11 is UTF-8.
    if (next > end || !nameLength || bytes.readUInt16LE(cursor + 6) > 20 || (flags & ~0x080e)
      || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34)
      || ((bytes.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000) {
      officeError("encrypted, linked or unsupported ZIP entry");
    }
    let name: string;
    try { name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { officeError("ZIP entry names must be UTF-8"); }
    const key = name.toLowerCase();
    if (/[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith("/")
      || name.split("/").some((part, i, parts) => part === "." || part === ".." || (!part && i < parts.length - 1))
      || names.has(key)) officeError("unsafe or duplicate ZIP entry name");
    if (/(?:^|\/)vbaproject\.bin$/i.test(name)) officeError("macro-enabled Office files are unsupported");
    names.add(key);
    expandedTotal += expanded;
    if (expanded > MAX_OFFICE_ENTRY_BYTES || expandedTotal > MAX_OFFICE_EXPANDED_BYTES
      || ((name === "[Content_Types].xml" || name === "_rels/.rels") && expanded > MAX_OFFICE_MANIFEST_BYTES)) {
      officeError("expanded data exceeds the validation budget");
    }
    if (start + 30 > directoryStart || bytes.readUInt32LE(start) !== 0x04034b50
      || bytes.readUInt16LE(start + 4) > 20 || bytes.readUInt16LE(start + 6) !== flags
      || bytes.readUInt16LE(start + 8) !== method || bytes.readUInt16LE(start + 26) !== nameLength) {
      officeError("ZIP local header mismatch");
    }
    const localExtraLength = bytes.readUInt16LE(start + 28);
    const dataStart = start + 30 + nameLength + localExtraLength;
    let finish = dataStart + compressed;
    if (finish > directoryStart || !bytes.subarray(start + 30, start + 30 + nameLength).equals(bytes.subarray(cursor + 46, cursor + 46 + nameLength))) {
      officeError("ZIP local entry bounds or name mismatch");
    }
    // Reject alternate ZIP64/encryption metadata, even if a producer omitted the version flag.
    for (const [extraStart, extraEnd] of [[cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength], [start + 30 + nameLength, dataStart]]) {
      for (let extra = extraStart!; extra < extraEnd!;) {
        if (extra + 4 > extraEnd!) officeError("invalid ZIP extra field");
        const kind = bytes.readUInt16LE(extra);
        const size = bytes.readUInt16LE(extra + 2);
        extra += 4 + size;
        if (extra > extraEnd! || [0x0001, 0x0017, 0x9901].includes(kind)) officeError("unsupported ZIP extra field");
      }
    }
    for (const [offset, expected] of [[14, crc], [18, compressed], [22, expanded]]) {
      const local = bytes.readUInt32LE(start + offset!);
      if (local !== expected && (!(flags & 8) || local !== 0)) officeError("ZIP local size or checksum mismatch");
    }
    if (flags & 8) {
      if (finish + 12 > directoryStart) officeError("missing ZIP data descriptor");
      const descriptor = finish + (bytes.readUInt32LE(finish) === 0x08074b50 ? 4 : 0);
      finish = descriptor + 12;
      if (finish > directoryStart || bytes.readUInt32LE(descriptor) !== crc
        || bytes.readUInt32LE(descriptor + 4) !== compressed || bytes.readUInt32LE(descriptor + 8) !== expanded) {
        officeError("ZIP data descriptor mismatch");
      }
    }
    if (name.endsWith("/") && expanded !== 0) officeError("ZIP directory entry contains data");
    entries.push({ name, start, finish, dataStart, compressed, expanded, method, crc });
    cursor = next;
  }
  if (cursor !== end) officeError("ZIP directory size mismatch");
  let boundary = 0;
  for (const entry of entries.toSorted((a, b) => a.start - b.start)) {
    if (entry.start !== boundary) officeError("overlapping or unlisted ZIP data");
    boundary = entry.finish;
  }
  if (boundary !== directoryStart) officeError("unlisted ZIP data before directory");
  for (const required of ["[Content_Types].xml", "_rels/.rels", format.part]) {
    if (!entries.some(entry => entry.name === required && entry.expanded > 0)) officeError(`missing required part ${required}`);
  }

  // An async reference resolver can charge decompression/manifest copies to its request owner
  // before allocation. Inline callers retain their existing validation and budgets.
  reserveValidationBytes?.(expandedTotal + 2 * entries
    .filter(entry => entry.name === "[Content_Types].xml" || entry.name === "_rels/.rels")
    .reduce((sum, entry) => sum + entry.expanded, 0));
  const manifests = new Map<string, string>();
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
    let expanded: Buffer;
    try {
      expanded = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.expanded) });
    } catch { officeError("invalid or oversized compressed entry"); }
    if (expanded.length !== entry.expanded || crc32(expanded) !== entry.crc) officeError("ZIP entry size or checksum mismatch");
    if (entry.name === "[Content_Types].xml" || entry.name === "_rels/.rels") {
      let xml: string;
      try { xml = utf8.decode(expanded); }
      catch { officeError("Office manifests must use UTF-8"); }
      if (/<!DOCTYPE|<!ENTITY|\x00/i.test(xml)) officeError("Office manifest entities are unsupported");
      manifests.set(entry.name, xml);
    }
  }
  const types = manifests.get("[Content_Types].xml")!;
  if (/macroEnabled|vbaProject/i.test(types)) officeError("macro-enabled Office files are unsupported");
  const mainTypes = manifestAttributes(types, "Override").filter(attributes => attributes.PartName === `/${format.part}`);
  if (mainTypes.length !== 1 || mainTypes[0]!.ContentType !== `${format.mime}.main+xml`) officeError("Office content type does not match its filename");
  const relationships = manifestAttributes(manifests.get("_rels/.rels")!, "Relationship").filter(attributes =>
    ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"].includes(attributes.Type!));
  if (relationships.length !== 1 || (relationships[0]!.TargetMode !== undefined && relationships[0]!.TargetMode !== "Internal")
    || ![format.part, `/${format.part}`].includes(relationships[0]!.Target!)) officeError("Office main relationship does not match its filename");
}

export function validateInputFilename(filename: unknown): string {
  if (typeof filename !== "string" || !filename || filename.length > 180 || /[\\/:\x00-\x1f\x7f]/.test(filename) || filename === "." || filename === "..") {
    throw new Error("input_file requires a plain filename without directory components (maximum 180 characters)");
  }
  return filename;
}

/** Decode caller-supplied inline data. File references grant no filesystem or network access. */
export function parseInputFile(
  input: { filename?: string; file_data?: string; file_id?: string; file_url?: string },
  options?: { reserveValidationBytes?: (bytes: number) => void },
): CodexFileContent {
  if (input.file_id !== undefined) {
    throw new Error("input_file provider file_id references require a task-authorized resolver; supply inline file_data without file_id");
  }
  if (input.file_url !== undefined) {
    throw new Error("input_file file_url references require a task-authorized resolver; supply inline file_data without file_url");
  }
  const filename = validateInputFilename(input.filename);
  if (!input.file_data) throw new Error("input_file requires inline file_data; provider file_id references cannot be read by ChatGPT Web");
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(input.file_data);
  const data = match ? match[2]! : input.file_data;
  if (data.length > Math.ceil(MAX_INPUT_FILE_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error("input_file contains invalid base64 or exceeds the 20 MB file limit");
  }
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_INPUT_FILE_BYTES || bytes.toString("base64") !== data) {
    throw new Error("input_file must contain nonempty, canonical base64 within the 20 MB file limit");
  }
  const extension = extname(filename).toLowerCase();
  const office = officeFormats.get(extension);
  const mimeType = office?.mime ?? (extension === ".pdf" ? "application/pdf" : textExtensions.has(extension) ? "text/plain" : undefined);
  if (!mimeType) throw new Error("input_file supports PDF, DOCX, XLSX, PPTX and UTF-8 text/source files; this file type is unsupported");
  if (match && match[1] !== "application/octet-stream" && match[1] !== mimeType
    && !(mimeType === "text/plain" && (match[1]!.startsWith("text/") || ["application/json", "application/xml"].includes(match[1]!)))) {
    throw new Error("input_file media type does not match its filename");
  }
  if (mimeType === "application/pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("input_file is not a PDF document");
  } else if (office) {
    validateOfficePackage(bytes, office, options?.reserveValidationBytes);
  } else {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("input_file text must use UTF-8 encoding"); }
    if (bytes.includes(0)) throw new Error("input_file text contains binary data");
  }
  return { type: "file", filename, mimeType, data };
}
