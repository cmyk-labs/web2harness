import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { constants, createZstdDecompress } from "node:zlib";
import { HttpBodyBudget, HttpBodyError, type HttpBodyReservation } from "./http-body-budget";
import { ZstdWindowGuard } from "./http-body-zstd";

export const MAX_ENCODED_REQUEST_BYTES = 64 * 1024 * 1024;
export const MAX_DECODED_REQUEST_BYTES = 128 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
export const HTTP_BODY_READER_BYTES = 512 * 1024;
const standaloneBudget = new HttpBodyBudget();

export interface HttpBodyReadOptions {
  budget?: HttpBodyBudget;
  retainEncoded?: boolean;
  /** Smaller limits support deterministic local overload fixtures. */
  maxEncodedBytes?: number;
  maxDecodedBytes?: number;
}

export interface ReservedJsonBody {
  value: unknown;
  reservation: HttpBodyReservation;
  /** Native passthrough replay without an unconsumed request.clone() tee. */
  replay(request: Request): Request;
  discardEncoded(): void;
}

function withinLimit(bytes: number, limit: number, label: string): void {
  if (bytes > limit) throw new HttpBodyError(`${label} exceeds ${limit} bytes`, 413);
}

/** Pre-parse estimate: UTF-16 fragments, joined text, parsed strings and downstream copies
 * (8x bytes), plus 96 bytes per structural token outside strings. Dense JSON must not evade
 * the budget. JSON.parse remains authoritative for syntax, numbers, escapes and prototypes. */
class JsonAllocationEstimate {
  private quoted = false;
  private escaped = false;
  private depth = 0;

  scan(bytes: Uint8Array): number {
    let allocation = bytes.length * 8 + 64;
    for (const byte of bytes) {
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (byte === 92) this.escaped = true;
        else if (byte === 34) this.quoted = false;
      } else if (byte === 34) {
        this.quoted = true;
        allocation += 96;
      } else if (byte === 91 || byte === 123) {
        if (++this.depth > 512) throw new HttpBodyError("Request JSON nesting exceeds 512 levels", 413);
        allocation += 96;
      } else if (byte === 93 || byte === 125) this.depth--;
      else if (byte === 44 || byte === 58) allocation += 96;
    }
    return allocation;
  }
}

export async function readReservedJsonRequestBody(request: Request, options: HttpBodyReadOptions = {}): Promise<ReservedJsonBody> {
  const maxEncoded = options.maxEncodedBytes ?? MAX_ENCODED_REQUEST_BYTES;
  const maxDecoded = options.maxDecodedBytes ?? MAX_DECODED_REQUEST_BYTES;
  let reservation: HttpBodyReservation | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let source: Readable | undefined;
  let decoder: ReturnType<typeof createZstdDecompress> | undefined;
  let failed: unknown;
  let unsuccessful = false;
  let encodedBytes = 0, decodedBytes = 0, encodedCharge = 0, windowCharge = 0;
  let encodedChunks: Uint8Array[] = [];
  const abortError = () => new HttpBodyError("Request body reading cancelled", 499);
  const abort = () => {
    failed = abortError();
    void reader?.cancel(failed).catch(() => {});
    source?.destroy(failed as Error);
    decoder?.destroy(failed as Error);
  };
  try {
    if (request.signal.aborted) throw abortError();
    const declared = request.headers.get("content-length");
    if (declared !== null) {
      if (!/^\d+$/.test(declared)) throw new HttpBodyError("Invalid Content-Length");
      withinLimit(Number(declared), maxEncoded, "Encoded request body");
    }
    const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
    if (encoding && encoding !== "identity" && encoding !== "zstd") throw new HttpBodyError(`Unsupported Content-Encoding: ${encoding}`);
    // Reserve before acquiring/pulling the body or constructing the decoder.
    reservation = (options.budget ?? standaloneBudget).reserve(HTTP_BODY_READER_BYTES);
    const lease = reservation;
    reader = request.body?.getReader();
    request.signal.addEventListener("abort", abort, { once: true });
    const guard = new ZstdWindowGuard(bytes => {
      if (bytes <= windowCharge) return;
      lease.grow(bytes - windowCharge);
      windowCharge = bytes;
    }, maxDecoded);
    async function* input(): AsyncGenerator<Uint8Array> {
      while (reader) {
        if (failed) throw failed;
        const chunk = await reader.read();
        if (failed) throw failed;
        if (chunk.done) break;
        encodedBytes += chunk.value.byteLength;
        withinLimit(encodedBytes, maxEncoded, "Encoded request body");
        for (let offset = 0; offset < chunk.value.length; offset += CHUNK_BYTES) {
          const bytes = chunk.value.subarray(offset, offset + CHUNK_BYTES);
          if (encoding === "zstd") guard.inspect(bytes);
          if (options.retainEncoded) {
            const charge = bytes.length * 3 + 64; // retained input + replay assembly + fetch copy
            lease.grow(charge);
            encodedCharge += charge;
            encodedChunks.push(bytes.slice());
          }
          yield bytes;
        }
      }
      if (declared !== null && encodedBytes !== Number(declared)) throw new HttpBodyError("Content-Length does not match request body");
    }
    let decoded: AsyncIterable<Uint8Array> = input();
    if (encoding === "zstd") {
      decoder = createZstdDecompress({ chunkSize: CHUNK_BYTES, params: { [constants.ZSTD_d_windowLogMax]: 27 } });
      source = Readable.from(input(), { objectMode: false, highWaterMark: CHUNK_BYTES });
      source.on("error", error => decoder!.destroy(error));
      source.pipe(decoder);
      decoded = decoder;
    }
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    const estimate = new JsonAllocationEstimate();
    const fragments: string[] = [];
    for await (const chunk of decoded) {
      if (failed) throw failed;
      for (let offset = 0; offset < chunk.length; offset += CHUNK_BYTES) {
        const bytes = chunk.subarray(offset, offset + CHUNK_BYTES);
        decodedBytes += bytes.length;
        withinLimit(decodedBytes, maxDecoded, "Decoded request body");
        lease.grow(estimate.scan(bytes));
        fragments.push(utf8.decode(bytes, { stream: true }));
      }
    }
    if (failed) throw failed;
    fragments.push(utf8.decode());
    const value: unknown = JSON.parse(fragments.join(""));
    const discardEncoded = () => {
      encodedChunks = [];
      lease.shrink(encodedCharge);
      encodedCharge = 0;
    };
    return {
      value, reservation: lease, discardEncoded,
      replay(original) {
        if (!options.retainEncoded || encodedCharge === 0) throw new Error("Encoded request body was not retained");
        const bytes = new Uint8Array(encodedBytes);
        let offset = 0;
        for (const chunk of encodedChunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return new Request(original.url, { method: original.method, headers: original.headers, body: bytes, signal: original.signal });
      },
    };
  } catch (error) {
    failed = error;
    unsuccessful = true;
    throw error;
  } finally {
    request.signal.removeEventListener("abort", abort);
    source?.destroy();
    decoder?.destroy();
    if (unsuccessful) {
      // An arbitrary producer's cancellation promise must not stall error/cancel settlement.
      void (reader ? reader.cancel(failed) : request.body?.cancel(failed))?.catch(() => {});
    }
    reader?.releaseLock();
    // Do not admit another decoder against this window until native teardown has settled.
    if (decoder) await finished(decoder).catch(() => {});
    if (unsuccessful) reservation?.release();
    else reservation?.shrink(windowCharge);
  }
}

/** Parsing-only compatibility helper. HTTP handlers retain the explicit reservation instead. */
export async function readJsonRequestBody(request: Request, options: HttpBodyReadOptions = {}): Promise<unknown> {
  const body = await readReservedJsonRequestBody(request, options);
  try { return body.value; }
  finally { body.reservation.release(); }
}
