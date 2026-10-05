import { extname } from "node:path";
import type { CodexFileContent } from "../types";

export const MAX_INPUT_FILE_BYTES = 20_000_000;
const textExtensions = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".h", ".cpp", ".cs", ".sh", ".sql", ".yaml", ".yml", ".toml", ".log"]);

/** Decode caller-supplied inline data. File references grant no filesystem or network access. */
export function parseInputFile(input: { filename?: string; file_data?: string; file_id?: string }): CodexFileContent {
  const filename = input.filename;
  if (!filename || filename.length > 180 || /[\\/:\x00-\x1f\x7f]/.test(filename) || filename === "." || filename === "..") {
    throw new Error("input_file requires a plain filename without directory components (maximum 180 characters)");
  }
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
  const mimeType = extension === ".pdf" ? "application/pdf" : textExtensions.has(extension) ? "text/plain" : undefined;
  if (!mimeType) throw new Error("input_file supports PDF and UTF-8 text/source files; this file type is unsupported");
  if (match && match[1] !== "application/octet-stream" && match[1] !== mimeType
    && !(mimeType === "text/plain" && (match[1]!.startsWith("text/") || ["application/json", "application/xml"].includes(match[1]!)))) {
    throw new Error("input_file media type does not match its filename");
  }
  if (mimeType === "application/pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("input_file is not a PDF document");
  } else {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("input_file text must use UTF-8 encoding"); }
    if (bytes.includes(0)) throw new Error("input_file text contains binary data");
  }
  return { type: "file", filename, mimeType, data };
}
