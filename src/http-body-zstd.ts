import { HttpBodyError } from "./http-body-budget";

/** Inspect frame/block boundaries before libzstd can allocate its native window, including
 * concatenated/skippable frames. Payload/checksum validation remains libzstd's job. */
export class ZstdWindowGuard {
  private header: number[] = [];
  private need = 5;
  private phase: "frame" | "header" | "block" | "skip" = "frame";
  private remaining = 0;
  private afterSkip: "frame" | "block" = "frame";
  private checksum = false;

  constructor(private readonly reserveWindow: (bytes: number) => void, private readonly maxWindow: number) {}

  inspect(bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.length) {
      if (this.phase === "skip") {
        const n = Math.min(this.remaining, bytes.length - offset);
        offset += n;
        this.remaining -= n;
        if (this.remaining === 0) this.reset(this.afterSkip);
        continue;
      }
      this.header.push(bytes[offset++]!);
      if (this.header.length < this.need) continue;
      const h = this.header;
      const u32 = (i: number) => h[i]! + h[i + 1]! * 256 + h[i + 2]! * 65536 + h[i + 3]! * 16777216;
      if (this.phase === "frame") {
        const magic = u32(0);
        if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
          this.phase = "header";
          this.need = 8;
        } else {
          if (magic !== 0xfd2fb528 || (h[4]! & 8)) throw new HttpBodyError("Invalid zstd frame header");
          const descriptor = h[4]!;
          const single = Boolean(descriptor & 32);
          const sizeFlag = descriptor >>> 6;
          const sizeBytes = sizeFlag === 0 ? (single ? 1 : 0) : 2 ** sizeFlag;
          const dictBytes = [0, 1, 2, 4][descriptor & 3]!;
          this.checksum = Boolean(descriptor & 4);
          this.phase = "header";
          this.need = 5 + (single ? 0 : 1) + dictBytes + sizeBytes;
        }
        if (h.length < this.need) continue;
      }
      if (this.phase === "header") {
        if (u32(0) !== 0xfd2fb528) { this.skip(u32(4), "frame"); continue; }
        const descriptor = h[4]!;
        const single = Boolean(descriptor & 32);
        const sizeFlag = descriptor >>> 6;
        const dictBytes = [0, 1, 2, 4][descriptor & 3]!;
        let size = 0;
        const sizeStart = 5 + (single ? 0 : 1) + dictBytes;
        for (let i = h.length - 1; i >= sizeStart; i--) size = size * 256 + h[i]!;
        if (sizeFlag === 1) size += 256;
        const base = single ? 0 : 2 ** (10 + (h[5]! >>> 3));
        const window = single ? size : base + base / 8 * (h[5]! & 7);
        if (window > this.maxWindow || size > this.maxWindow) {
          throw new HttpBodyError("Decoded request body or zstd window exceeds limit", 413);
        }
        this.reserveWindow(window);
        this.reset("block");
      } else if (this.phase === "block") {
        const block = h[0]! + h[1]! * 256 + h[2]! * 65536;
        const last = Boolean(block & 1);
        const type = (block >>> 1) & 3;
        if (type === 3) throw new HttpBodyError("Invalid zstd block type");
        this.skip((type === 1 ? 1 : block >>> 3) + (last && this.checksum ? 4 : 0), last ? "frame" : "block");
      }
    }
  }

  private skip(bytes: number, next: "frame" | "block"): void {
    this.header = [];
    this.phase = "skip";
    this.remaining = bytes;
    this.afterSkip = next;
    if (bytes === 0) this.reset(next);
  }

  private reset(phase: "frame" | "block"): void {
    this.header = [];
    this.phase = phase;
    this.need = phase === "frame" ? 5 : 3;
  }
}
