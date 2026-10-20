import { createHash } from "node:crypto";
import type { CodexFileContent } from "../../../types";
import { parseInputFile } from "../../../responses/file-input";
import { parseInputAudio } from "../../../responses/audio-input";
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
    const parsed = typeof file.mimeType === "string" && file.mimeType.startsWith("audio/")
      ? parseInputAudio({ audio_url: `data:${file.mimeType};base64,${file.data}` })
      : parseInputFile({ filename: file.filename, file_data: file.data });
    if (file.filename !== parsed.filename) throw new Error("Input file attachment identity mismatch");
    if (file.mimeType !== parsed.mimeType || file.name !== createInputFile(parsed).name || names.has(file.name)) {
      throw new Error("Input file attachment identity mismatch");
    }
    names.add(file.name);
  }
}

export function inputFileTokens(files: ChatGptInputFile[] | undefined, modelId: string): number {
  return (files ?? []).reduce((sum, file) => {
    // Encoded audio bytes are not text tokens: the same recording has very different
    // WAV/MP3 sizes. Its duration-dependent model cost is not exposed by this Web
    // transport. Count the textual reference elsewhere and let Web enforce its actual
    // audio/context limits; the independent upload and request-memory bounds still apply.
    if (file.mimeType.startsWith("audio/")) return sum;
    const bytes = Buffer.from(file.data, "base64");
    // Binary documents stay opaque. This byte-based reservation is an estimate, not the
    // upstream extracted token count; never decode Office ZIP bytes as replacement text.
    return sum + (file.mimeType !== "text/plain" ? bytes.length : estimateTokens(bytes.toString("utf8"), modelId));
  }, 0);
}
