import { createHash } from "node:crypto";
import { MAX_INPUT_FILE_BYTES, parseInputFile, validateInputFilename } from "./file-input";
import {
  attachmentUrl, InputReferenceError, publicHttpsAttachmentTransport,
  referenceTimeout, throwIfReferenceAborted, withReferenceSignal, type InputReferenceTransport,
} from "./input-reference-network";

export { InputReferenceError } from "./input-reference-network";
export type { InputReferenceTransport } from "./input-reference-network";

export interface InputReferenceScope {
  taskId: string;
  providerId: string;
  accountId: string;
}

export interface InputReferenceAuthorization {
  scope: InputReferenceScope;
  /** Trusted task grant, not a body field. Exact URLs; redirects need their own grant. */
  urls: readonly string[];
}

export interface ResolveInputReferencesOptions {
  scope: InputReferenceScope;
  authorization?: InputReferenceAuthorization;
  signal: AbortSignal;
  mode?: "generate" | "prepare";
  /** Grow the caller's request-owned HttpBodyReservation. Caller retains/releases it. */
  reserveBytes?: (additionalBytes: number) => void;
  /** Trusted injection only. Production defaults to direct, public-address-pinned HTTPS. */
  transport?: InputReferenceTransport;
  /** May lower, never raise, local budgets. timeoutMs caps EACH phase, not the request. */
  limits?: { fileBytes?: number; totalBytes?: number; references?: number; timeoutMs?: number };
}

type JsonObject = Record<string, unknown>;
export type InputReference = {
  itemIndex: number;
  field: "content" | "output";
  blockIndex: number;
  block: JsonObject;
} & ({ kind: "url"; url: string } | { kind: "provider_file"; fileId: string });

function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validates exactly one source; does not resolve, decode, omit or fabricate attachment data. */
export function inputReferenceOf(block: JsonObject): { kind: "url"; url: string } | { kind: "provider_file"; fileId: string } | null {
  if (["input_audio", "input_video", "audio", "video"].includes(String(block.type))) {
    throw new InputReferenceError("unsupported_input_modality", "Unsupported Codex content type: raw audio/video input is not supported by this ChatGPT Web attachment path; transcripts or extracted frames are not equivalent");
  }
  if (block.type !== "input_image" && block.type !== "input_file") return null;
  const keys = block.type === "input_image" ? ["image_url", "file_id"] : ["file_data", "file_url", "file_id"];
  const present = keys.filter(key => block[key] !== undefined);
  if (present.length !== 1 || typeof block[present[0]!] !== "string" || !(block[present[0]!] as string).length) {
    throw new InputReferenceError("invalid_attachment_reference", "Attachment requires exactly one nonempty inline, URL or provider file reference");
  }
  if (block.type === "input_image" && block.detail !== undefined
    && !["auto", "low", "high", "original"].includes(String(block.detail))) {
    throw new InputReferenceError("invalid_attachment_reference", "Invalid image detail");
  }
  if (block.type === "input_file" && block.filename !== undefined) validateInputFilename(block.filename);
  if (present[0] === "file_id") {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(block.file_id as string)) {
      throw new InputReferenceError("invalid_attachment_reference", "Invalid provider file ID");
    }
    return { kind: "provider_file", fileId: block.file_id as string };
  }
  if (present[0] === "file_data" || (block.type === "input_image" && (block.image_url as string).startsWith("data:"))) return null;
  const value = (block.type === "input_image" ? block.image_url : block.file_url) as string;
  attachmentUrl(value);
  return { kind: "url", url: value };
}

/** Only protocol attachment positions are inspected; tool arguments and arbitrary metadata are inert. */
export function inspectInputReferences(body: unknown): InputReference[] {
  return inspectInputAttachments(body).references;
}

function inspectInputAttachments(body: unknown): { references: InputReference[]; inlineBytes: number } {
  if (!record(body) || !Array.isArray(body.input)) return { references: [], inlineBytes: 0 };
  const references: InputReference[] = [];
  const inlineFiles = new Set<string>();
  let attachmentCount = 0;
  let inlineBytes = 0;
  let oversizedInline = false;
  for (let itemIndex = 0; itemIndex < body.input.length; itemIndex++) {
    const item: unknown = body.input[itemIndex];
    if (!record(item)) continue;
    if (["input_audio", "input_video", "audio", "video"].includes(String(item.type))) inputReferenceOf(item);
    const type: unknown = item.type ?? ("role" in item ? "message" : undefined);
    const field: "content" | "output" | null = type === "function_call_output" || type === "custom_tool_call_output" ? "output"
      : type === "message" || type === "agent_message" ? "content" : null;
    if (!field || !Array.isArray(item[field])) continue;
    for (let blockIndex = 0; blockIndex < item[field].length; blockIndex++) {
      const block = item[field][blockIndex];
      if (!record(block)) continue;
      const reference = inputReferenceOf(block);
      if (reference) {
        references.push({ itemIndex, field, blockIndex, block, ...reference });
        attachmentCount++;
      } else if (block.type === "input_image" || block.type === "input_file") {
        const value = block.type === "input_image" ? block.image_url : block.file_data;
        if (typeof value !== "string") continue;
        // Estimate canonical base64 size without decoding. Normal parsing still validates data.
        const data = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
        if (block.type === "input_file") {
          // The existing prompt path deduplicates identical filename + bytes. Preserve that
          // behavior rather than rejecting repeated inline files in replayed tool history.
          const identity = createHash("sha256").update(String(block.filename)).update("\0").update(data).digest("hex");
          if (inlineFiles.has(identity)) continue;
          inlineFiles.add(identity);
        }
        attachmentCount++;
        const bytes = Math.max(0, Math.ceil(data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0));
        inlineBytes += bytes;
        oversizedInline ||= bytes > MAX_INPUT_FILE_BYTES;
      }
    }
  }
  if (references.length > 10) throw new InputReferenceError("attachment_limit_exceeded", "At most 10 attachment references are supported per request", 413);
  if (references.length && (attachmentCount > 10 || inlineBytes >= 50_000_000 || oversizedInline)) {
    throw new InputReferenceError("attachment_limit_exceeded", "Mixed inline and remote attachments exceed the 10 attachment /20 MB file /50 MB total budget", 413);
  }
  return { references, inlineBytes };
}

/** Known unsupported capabilities must fail preparation too, before returning a usable state ID. */
export function assertSupportedInputReferences(body: unknown): InputReference[] {
  const references = inspectInputReferences(body);
  if (references.some(reference => reference.kind === "provider_file")) {
    throw new InputReferenceError("unsupported_provider_file_reference", "Provider file_id resolution requires a verified download endpoint for the incoming provider/account; no compatible ChatGPT/Codex download endpoint is configured");
  }
  return references;
}

export function assertNoUnresolvedInputReferences(body: unknown): void {
  const references = assertSupportedInputReferences(body);
  if (!references.length) return;
  throw new InputReferenceError("unresolved_attachment_reference", "Remote attachment references require task-authorized resolution before Web parsing");
}

function scopeMatches(a: InputReferenceScope, b: InputReferenceScope | undefined): boolean {
  return ["taskId", "providerId", "accountId"].every(key => {
    const value = a?.[key as keyof InputReferenceScope];
    return typeof value === "string" && value.length > 0 && value.length <= 512
      && value === b?.[key as keyof InputReferenceScope];
  });
}

function limit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new InputReferenceError("invalid_attachment_limit", "Attachment limits may only lower the built-in positive bounds");
  }
  return value;
}

const fileExtensionsByMime = new Map([
  ["application/pdf", ".pdf"], ["text/plain", ".txt"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
]);
const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function mediaType(headers: Headers, image: boolean): string {
  const header = headers.get("content-type") ?? "";
  const mime = header.split(";")[0]!.trim().toLowerCase();
  // Preserve the declared media type, rather than guessing an Office file from generic ZIP data.
  if (!(image ? imageMimes.has(mime) : fileExtensionsByMime.has(mime))) {
    throw new InputReferenceError("unsupported_attachment_media_type", "Remote attachment must declare a supported, specific media type");
  }
  const parameters = header.split(";").slice(1);
  let hasSourceQuality = false;
  for (const parameter of parameters) {
    if (/^\s*charset\s*=\s*"?utf-8"?\s*$/i.test(parameter)) continue;
    // Observed on W3C's PDF response: qs=0.001 is a source negotiation weight,
    // not a charset, encoding or MIME override. Accept one bounded numeric weight only.
    if (!hasSourceQuality && /^\s*qs\s*=\s*(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)\s*$/i.test(parameter)) {
      hasSourceQuality = true;
      continue;
    }
    throw new InputReferenceError("unsupported_attachment_media_type", "Attachment media type parameters are unsupported");
  }
  const encoding = headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw new InputReferenceError("unsupported_attachment_encoding", "Compressed HTTP attachment bodies are unsupported; send identity encoding");
  }
  return mime;
}

function validateImageBytes(bytes: Buffer, mime: string): void {
  const valid = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
    : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!valid) throw new InputReferenceError("invalid_attachment_content", "Remote image bytes do not match the declared media type");
}

function filenameFor(reference: InputReference, url: URL, mime: string): string {
  if (typeof reference.block.filename === "string") return validateInputFilename(reference.block.filename);
  let candidate: string;
  try { candidate = decodeURIComponent(url.pathname.split("/").at(-1) ?? ""); }
  catch { throw new InputReferenceError("invalid_attachment_filename", "Invalid attachment URL filename"); }
  // No Content-Disposition path interpretation or filesystem access.
  return validateInputFilename(candidate.includes(".") ? candidate : "attachment" + fileExtensionsByMime.get(mime));
}

/**
 * Integration order: select raw Native passthrough first; reject missing continuation/context,
 * validateRequestForPreparation + model/tool/control checks; then call for Web generation only.
 * Scope/grants derive from the authenticated incoming task, never URL content, browser state or
 * global credentials. Every URL (including redirects) needs a scoped grant. No persistent cache.
 * Main retains original raw body for Native; copyPreviousResponseProvenance onto any returned clone.
 * For prepare, return the original unresolved body after pure shape validation (zero network).
 */
export async function resolveInputReferences<T>(body: T, options: ResolveInputReferencesOptions): Promise<T> {
  const references = assertSupportedInputReferences(body);
  if (!references.length || options.mode === "prepare") return body;
  if (record(body) && body.generate === false) {
    throw new InputReferenceError("attachment_prewarm_requires_validation", "generate:false must use preparation validation; attachment downloads are not preparation");
  }
  if (!scopeMatches(options.scope, options.authorization?.scope)) {
    throw new InputReferenceError("attachment_authorization_required", "Attachment resolution requires matching task/provider/account authorization");
  }
  if (!options.reserveBytes) throw new InputReferenceError("attachment_budget_required", "Attachment resolution requires a request-owned memory reservation");
  const authorized = new Set(options.authorization!.urls.map(value => attachmentUrl(value).href));
  for (const reference of references) {
    if (reference.kind === "url" && !authorized.has(attachmentUrl(reference.url).href)) {
      throw new InputReferenceError("attachment_not_authorized", "Attachment URL is not authorized by the active task");
    }
  }
  const maxFile = limit(options.limits?.fileBytes, MAX_INPUT_FILE_BYTES);
  const maxTotal = limit(options.limits?.totalBytes, 50_000_000);
  const maxReferences = limit(options.limits?.references, 10);
  const timeoutMs = limit(options.limits?.timeoutMs, 120_000);
  if (references.length > maxReferences) throw new InputReferenceError("attachment_limit_exceeded", "Too many attachment references", 413);
  const inlineBytes = inspectInputAttachments(body).inlineBytes;
  if (inlineBytes >= maxTotal) throw new InputReferenceError("attachment_limit_exceeded", "Inline attachments leave no byte budget for remote attachments", 413);
  const signal = options.signal;
  const transport = options.transport ?? publicHttpsAttachmentTransport;
  let total = inlineBytes;
  const replacements = new Map<InputReference, JsonObject>();
  try {
    for (const reference of references) {
      if (reference.kind !== "url") continue;
      let url = attachmentUrl(reference.url);
      let finished = false;
      for (let hop = 0; hop <= 3; hop++) {
        throwIfReferenceAborted(signal);
        if (!authorized.has(url.href)) throw new InputReferenceError("attachment_not_authorized", "Attachment redirect is not authorized by the active task");
        const download = await withReferenceSignal(transport(url, signal, {
          dnsMs: Math.min(timeoutMs, 30_000), headersMs: Math.min(timeoutMs, 60_000),
        }).then(result => {
          if (signal.aborted) { result.cancel(); throwIfReferenceAborted(signal); }
          return result;
        }), signal);
        let bodyTimeout: ReturnType<typeof referenceTimeout> | undefined;
        try {
          if ([301, 302, 303, 307, 308].includes(download.status)) {
            if (hop === 3) throw new InputReferenceError("attachment_redirect_limit", "Attachment redirect limit exceeded");
            const location = download.headers.get("location");
            if (!location) throw new InputReferenceError("invalid_attachment_redirect", "Attachment redirect has no destination");
            // URL construction alone normalizes whitespace/backslashes; reject before construction.
            if (/[\s\\\x00-\x1f\x7f]/.test(location)) throw new InputReferenceError("invalid_attachment_redirect", "Invalid attachment redirect");
            try { url = attachmentUrl(new URL(location, url).href); }
            catch (error) {
              if (error instanceof InputReferenceError) throw error;
              throw new InputReferenceError("invalid_attachment_redirect", "Invalid attachment redirect");
            }
            continue;
          }
          if (download.status !== 200) throw new InputReferenceError("attachment_download_failed", "Attachment download returned HTTP " + download.status, 502);
          const mime = mediaType(download.headers, reference.block.type === "input_image");
          const length = download.headers.get("content-length");
          if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))
            || Number(length) > maxFile || Number(length) > maxTotal - total)) {
            throw new InputReferenceError("attachment_limit_exceeded", "Attachment Content-Length exceeds the byte budget or is invalid", 413);
          }
          const chunks: Buffer[] = [];
          bodyTimeout = referenceTimeout(signal, timeoutMs);
          let size = 0;
          let chunkCount = 0;
          const iterator = download.body[Symbol.asyncIterator]();
          while (true) {
            const part = await withReferenceSignal(iterator.next(), bodyTimeout.signal);
            if (part.done) break;
            if (++chunkCount > 65_536) throw new InputReferenceError("attachment_limit_exceeded", "Attachment body exceeds the streaming fragment budget", 413);
            if (!(part.value instanceof Uint8Array)) throw new InputReferenceError("invalid_attachment_content", "Invalid attachment body chunk");
            size += part.value.byteLength;
            total += part.value.byteLength;
            if (size > maxFile || total > maxTotal) throw new InputReferenceError("attachment_limit_exceeded", "Attachment exceeds the byte budget", 413);
            // Conservative request allocation estimate: chunks, contiguous/validation bytes and
            // UTF-16 base64 copies. Reserve BEFORE retaining/copying bytes. Caller releases on all exits.
            if (!part.value.byteLength) continue;
            options.reserveBytes(part.value.byteLength * 10 + 128 + (chunks.length === 0 ? 4096 : 0));
            chunks.push(Buffer.from(part.value));
          }
          if (!size || (length !== null && Number(length) !== size)) throw new InputReferenceError("invalid_attachment_content", "Attachment body is empty or does not match Content-Length");
          throwIfReferenceAborted(bodyTimeout.signal);
          const bytes = Buffer.concat(chunks, size);
          const data = bytes.toString("base64");
          if (reference.block.type === "input_image") {
            validateImageBytes(bytes, mime);
            replacements.set(reference, { ...reference.block, image_url: "data:" + mime + ";base64," + data });
          } else {
            const filename = filenameFor(reference, url, mime);
            // Preserve Office ZIP validation and all existing inline file controls.
            let file;
            try {
              file = parseInputFile({ filename, file_data: "data:" + mime + ";base64," + data }, { reserveValidationBytes: options.reserveBytes });
            } catch (error) {
              if (error instanceof Error && error.name === "HttpBodyError") throw error;
              throw new InputReferenceError("invalid_attachment_content", "Remote file failed the existing inline file structure/type validation");
            }
            if (file.mimeType !== mime) throw new InputReferenceError("unsupported_attachment_media_type", "Attachment media type cannot be preserved by the current upload path");
            const { file_url: _url, ...metadata } = reference.block;
            replacements.set(reference, { ...metadata, filename, file_data: "data:" + mime + ";base64," + data });
          }
          finished = true;
          break;
        } finally { bodyTimeout?.dispose(); download.cancel(); }
      }
      if (!finished) throw new InputReferenceError("attachment_redirect_limit", "Attachment redirect limit exceeded");
    }
  } catch (error) {
    throwIfReferenceAborted(signal);
    // Never echo signed URLs, credentials, hostname, response bodies or TLS error internals.
    if (error instanceof InputReferenceError || (error instanceof Error && error.name === "HttpBodyError")) throw error;
    throw new InputReferenceError("attachment_download_failed", "Attachment resolution failed; verify network access and the supported file format", 502);
  }
  if (!record(body) || !Array.isArray(body.input)) return body;
  const input = body.input.slice();
  const clonedItems = new Set<number>();
  const clonedFields = new Set<string>();
  for (const [reference, replacement] of replacements) {
    if (!clonedItems.has(reference.itemIndex)) {
      input[reference.itemIndex] = { ...input[reference.itemIndex] };
      clonedItems.add(reference.itemIndex);
    }
    const item = input[reference.itemIndex];
    const key = reference.itemIndex + "/" + reference.field;
    if (!clonedFields.has(key)) {
      item[reference.field] = item[reference.field].slice();
      clonedFields.add(key);
    }
    item[reference.field][reference.blockIndex] = replacement;
  }
  return { ...body, input };
}
