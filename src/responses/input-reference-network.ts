import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";

export class InputReferenceError extends Error {
  readonly type = "invalid_request_error";
  readonly retryable = false;
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "InputReferenceError";
  }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
// Accept only ordinary global IPv6 unicast; exclude transition and special-use ranges.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAttachmentAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && !address.includes("%") && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** Pure validation, also used during preparation. No DNS or ambient credentials. */
export function attachmentUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 8192 || /[\s\\\x00-\x1f\x7f]/.test(value)) {
    throw new InputReferenceError("invalid_attachment_url", "Attachment URL must be a bounded absolute HTTPS URL");
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new InputReferenceError("invalid_attachment_url", "Attachment URL must be an absolute HTTPS URL"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) {
    throw new InputReferenceError("invalid_attachment_url", "Attachment URLs require HTTPS port 443 without userinfo or fragments");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAttachmentAddress(host)) throw new InputReferenceError("unsafe_attachment_host", "Attachment host is not public");
  } else if (host.length > 253 || !host.includes(".") || host.endsWith(".") || !/^[a-z0-9.-]+$/i.test(host)
    || host.split(".").some(label => !label || label.startsWith("-") || label.endsWith("-") || label.length > 63)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)
    || /(?:^|\.)home\.arpa$/.test(host)) {
    throw new InputReferenceError("unsafe_attachment_host", "Attachment host must be a public DNS name or address");
  }
  return url;
}

export function throwIfReferenceAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new InputReferenceError(
    signal.reason?.name === "TimeoutError" ? "attachment_timeout" : "attachment_cancelled",
    signal.reason?.name === "TimeoutError" ? "Attachment resolution timed out" : "Attachment resolution was cancelled",
    signal.reason?.name === "TimeoutError" ? 408 : 499,
  );
}

/** DNS cannot be interrupted on every runtime; stop awaiting it and never start a socket afterwards. */
export async function withReferenceSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfReferenceAborted(signal);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      try { throwIfReferenceAborted(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** A phase owns its timer; finishing it never shortens the next phase's allowance. */
export function referenceTimeout(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Attachment phase timed out", "TimeoutError")), timeoutMs);
  return { signal: AbortSignal.any([parent, controller.signal]), dispose: () => clearTimeout(timer) };
}

export interface AttachmentDownload {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
}

/** Trusted transports own independent DNS/headers timers and must retain the security contract. */
export type InputReferenceTransport = (url: URL, signal: AbortSignal, timeouts?: {
  dnsMs: number; headersMs: number;
}) => Promise<AttachmentDownload>;

/** Exported factory lets fixtures verify the actual pinned HTTPS options without a live socket. */
export function createPublicHttpsTransport(io: {
  lookup?: typeof lookup;
  request?: typeof request;
} = {}): InputReferenceTransport {
  return async (url, signal, timeouts = { dnsMs: 30_000, headersMs: 60_000 }) => {
    attachmentUrl(url.href);
    throwIfReferenceAborted(signal);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const dns = referenceTimeout(signal, timeouts.dnsMs);
    let addresses;
    try {
      addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
        : await withReferenceSignal((io.lookup ?? lookup)(host, { all: true, verbatim: true }), dns.signal);
    } finally { dns.dispose(); }
    if (!addresses.length || addresses.length > 64 || addresses.some(value =>
      !isPublicAttachmentAddress(value.address) || isIP(value.address) !== value.family)) {
      throw new InputReferenceError("unsafe_attachment_host", "Attachment DNS returned a nonpublic or invalid address");
    }
    throwIfReferenceAborted(signal);
    const pinned = addresses[0]!;
    // Connect directly to the checked address. Host and TLS verification keep the original
    // hostname; there is no second DNS lookup, connection pool, proxy discovery or cookie jar.
    const options: RequestOptions = {
      protocol: "https:", hostname: host, port: 443, path: url.pathname + url.search,
      method: "GET", agent: false, signal, family: pinned.family,
      servername: isIP(host) ? undefined : host, rejectUnauthorized: true,
      maxHeaderSize: 16_384,
      headers: { accept: "*/*", "accept-encoding": "identity", host: url.host },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
    };
    const headersTimeout = referenceTimeout(signal, timeouts.headersMs);
    let req: ReturnType<typeof request> | undefined;
    try {
      return await withReferenceSignal(new Promise<AttachmentDownload>((resolve, reject) => {
        req = (io.request ?? request)(options, response => {
          if (headersTimeout.signal.aborted) { response.destroy(); req?.destroy(); return; }
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve({
            status: response.statusCode ?? 0, headers, body: response,
            cancel: () => { response.destroy(); req?.destroy(); },
          });
        });
        req.once("error", reject);
        req.end();
      }), headersTimeout.signal);
    } catch (error) {
      req?.destroy();
      throwIfReferenceAborted(headersTimeout.signal);
      throw error;
    } finally { headersTimeout.dispose(); }
  };
}

export const publicHttpsAttachmentTransport = createPublicHttpsTransport();
