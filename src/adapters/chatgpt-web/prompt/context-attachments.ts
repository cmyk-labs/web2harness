import { createHash } from "node:crypto";

export interface ChatGptContextFile { name: string; text: string }

/** The digest binds this single context attachment to the exact serialized envelope. */
export function createContextFile(text: string): ChatGptContextFile {
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const file = { name: `codex-context--${digest}.txt`, text };
  validateContextFile(file);
  return file;
}

export function validateContextFile(value: unknown): asserts value is ChatGptContextFile | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object") throw new Error("Invalid context attachment");
  const file = value as ChatGptContextFile;
  if (typeof file.name !== "string" || !/^codex-context--[a-f0-9]{16}\.txt$/.test(file.name)
    || typeof file.text !== "string" || !file.text.length || Buffer.byteLength(file.text, "utf8") > 20_000_000) {
    throw new Error("Invalid context attachment or context exceeds the 20 MB file limit");
  }
  const digest = createHash("sha256").update(file.text).digest("hex").slice(0, 16);
  if (file.name !== `codex-context--${digest}.txt`) throw new Error("Context attachment content does not match its name");
  const context = JSON.parse(file.text);
  if (!context || ![3, 4].includes(context.version) || !Array.isArray(context.system) || !Array.isArray(context.messages)) {
    throw new Error("Invalid context attachment envelope");
  }
}
