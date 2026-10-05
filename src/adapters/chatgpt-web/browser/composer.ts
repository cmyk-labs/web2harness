/** Composer text integrity and attachment payload preparation, independent of turn ownership. */

import { validateSkillFiles } from "../prompt/skill-attachments";
import { validateContextFile } from "../prompt/context-attachments";
import { validateInputFiles } from "../prompt/file-attachments";
import { parseDataUrl } from "../../image";
import { ChatGptWebAdapterError } from "../adapter-error";
import { CHATGPT_MAX_INPUT_IMAGES, type CompiledChatGptWebPrompt, type ChatGptWebPromptImage } from "../prompt/compile";

export const CHATGPT_COMPOSER_DOCUMENT_END_KEY = process.platform === "darwin"
  ? "Meta+ArrowDown"
  : "Control+End";

export const CHATGPT_COMPOSER_SELECT_ALL_KEY = process.platform === "darwin"
  ? "Meta+A"
  : "Control+A";

export class ChatGptPromptAttachmentIntegrityError extends ChatGptWebAdapterError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      status: 502,
      errorType: "server_error",
      code: "prompt_attachment_integrity",
      retryable: false,
      cause,
    });
    this.name = "ChatGptPromptAttachmentIntegrityError";
  }
}

const imageExtensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

export function chatGptImageFilePayloads(images: ChatGptWebPromptImage[]): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  if (images.length > CHATGPT_MAX_INPUT_IMAGES) {
    throw new Error(`ChatGPT web accepts at most ${CHATGPT_MAX_INPUT_IMAGES} input images per Codex turn`);
  }
  let totalBytes = 0;
  return images.map(image => {
    const parsed = parseDataUrl(image.imageUrl);
    if (!parsed) throw new Error(`ChatGPT web input image ${image.ref} must be an inline base64 data URL`);
    const extension = imageExtensions.get(parsed.mediaType.toLowerCase());
    if (!extension) throw new Error(`ChatGPT web input image ${image.ref} has unsupported media type: ${parsed.mediaType}`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.base64) || parsed.base64.length % 4 !== 0) {
      throw new Error(`ChatGPT web input image ${image.ref} contains invalid base64 data`);
    }
    const buffer = Buffer.from(parsed.base64, "base64");
    if (buffer.length === 0) throw new Error(`ChatGPT web input image ${image.ref} is empty`);
    if (buffer.length > 20_000_000) throw new Error(`ChatGPT web input image ${image.ref} exceeds 20 MB`);
    totalBytes += buffer.length;
    if (totalBytes > 50_000_000) throw new Error("ChatGPT web input images exceed the 50 MB per-turn limit");
    return { name: `${image.ref}.${extension}`, mimeType: parsed.mediaType.toLowerCase(), buffer };
  });
}

export function assertChatGptPromptAttachments(prompt: CompiledChatGptWebPrompt): void {
  if (prompt.images.length + (prompt.files?.length ?? 0) + (prompt.skillFiles?.length ?? 0) + (prompt.contextFile ? 1 : 0) > CHATGPT_MAX_INPUT_IMAGES) {
    throw new ChatGptWebAdapterError(
      "Context, skills, files and images exceed ChatGPT's 10 attachments per message; reduce attachments before retrying.",
      { status: 400, errorType: "invalid_request_error", code: "too_many_attachments", retryable: false },
    );
  }
  validateSkillFiles(prompt.skillFiles);
  validateContextFile(prompt.contextFile);
  validateInputFiles(prompt.files);
}

export function chatGptPromptFilePayloads(
  prompt: CompiledChatGptWebPrompt,
): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  assertChatGptPromptAttachments(prompt);
  const files = [...chatGptImageFilePayloads(prompt.images), ...(prompt.files ?? []).map(file => ({
    name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.data, "base64"),
  })), ...[...(prompt.skillFiles ?? []), ...(prompt.contextFile ? [prompt.contextFile] : [])].map(file => ({
    name: file.name, mimeType: "text/plain", buffer: Buffer.from(file.text, "utf8"),
  }))];
  if (files.reduce((sum, file) => sum + file.buffer.length, 0) > 50_000_000) {
    throw new Error("ChatGPT web attachments exceed the 50 MB per-turn limit");
  }
  return files;
}

/**
 * Insert `value` at the caret of an already-resolved ChatGPT composer, returning whether the edit
 * was applied. Runs inside the page, so it may reference only globals and its two arguments.
 *
 * Effort selection closes a menu immediately before a prompt is attached, and focus is still
 * settling when this runs: the composer can be the active element while the caret has not yet been
 * placed inside it, or focus can still be on the menu that just closed. Reading that as a rejected
 * edit failed whole turns roughly a tenth of a second after the effort menu closed, so the caret is
 * placed explicitly instead of assumed. An existing collapsed caret inside the composer is left
 * exactly where the user put it; only a missing or foreign one is replaced, and always with a
 * position inside this composer, so an insert can never land in another element.
 */
export function insertPlainTextIntoComposer(element: HTMLElement, value: string): boolean {
  if (document.activeElement !== element) element.focus();
  if (document.activeElement !== element) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  const alreadyPlaced = selection.isCollapsed
    && selection.anchorNode !== null
    && element.contains(selection.anchorNode);
  if (!alreadyPlaced) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (
    !selection.isCollapsed
    || !selection.anchorNode
    || !element.contains(selection.anchorNode)
  ) {
    return false;
  }
  return document.execCommand("insertText", false, value);
}

/**
 * Lexical/contenteditable may preserve runs of ASCII spaces by exposing some of them as NBSP
 * through DOM textContent. Treat that DOM-only representation as equivalent only when the
 * expected U+0020 belongs to a multi-space run. Single spaces, tabs, newlines, intentional
 * expected NBSP characters, and every other mutation remain exact and fail closed.
 */
function promptCodeUnitEquivalent(
  expected: string,
  observed: string,
  index: number,
): boolean {
  const expectedUnit = expected[index];
  const observedUnit = observed[index];

  if (expectedUnit === observedUnit) return true;
  if (expectedUnit !== " " || observedUnit !== "\u00A0") return false;

  return expected[index - 1] === " " || expected[index + 1] === " ";
}

export function chatGptPromptTextEquivalent(
  expected: string,
  observed: string,
): boolean {
  if (expected.length !== observed.length) return false;

  for (let index = 0; index < expected.length; index += 1) {
    if (!promptCodeUnitEquivalent(expected, observed, index)) {
      return false;
    }
  }

  return true;
}

export function chatGptPromptEquivalentPrefixLength(
  expected: string,
  observed: string,
): number {
  const length = Math.min(expected.length, observed.length);

  let index = 0;
  while (
    index < length
    && promptCodeUnitEquivalent(expected, observed, index)
  ) {
    index += 1;
  }

  return index;
}
