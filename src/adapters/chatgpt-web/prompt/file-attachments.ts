import { createHash } from "node:crypto";
import type { CodexFileContent } from "../../../types";
import { parseInputFile } from "../../../responses/file-input";
import { estimateTokens } from "../../../lib/token-estimate";

export interface ChatGptInputFile {
  name: string;
  filename: string;
  mimeType: string;
  data: string;
}

export function createInputFile(file: CodexFileContent): ChatGptInputFile {
  const digest = createHash("sha256").update(file.filename).update("\0").update(file.data).digest("hex").slice(0, 16);
  return { name: `codex-file-${digest}-${file.filename}`, filename: file.filename, mimeType: file.mimeType, data: file.data };
}

export function validateInputFiles(files: unknown): asserts files is ChatGptInputFile[] | undefined {
  if (files === undefined) return;
  if (!Array.isArray(files) || files.length > 10) throw new Error("Invalid input file attachments");
  const names = new Set<string>();
  for (const file of files) {
    if (!file || typeof file.filename !== "string" || typeof file.data !== "string") throw new Error("Invalid input file attachment");
    const parsed = parseInputFile({ filename: file.filename, file_data: file.data });
    if (file.mimeType !== parsed.mimeType || file.name !== createInputFile(parsed).name || names.has(file.name)) {
      throw new Error("Input file attachment identity mismatch");
    }
    names.add(file.name);
  }
}

export function inputFileTokens(files: ChatGptInputFile[] | undefined, modelId: string): number {
  return (files ?? []).reduce((sum, file) => {
    const bytes = Buffer.from(file.data, "base64");
    // PDFs are opaque here: reserve one token per byte instead of claiming an extracted count.
    return sum + (file.mimeType === "application/pdf" ? bytes.length : estimateTokens(bytes.toString("utf8"), modelId));
  }, 0);
}
