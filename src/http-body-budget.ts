/** Request-owned allocation estimates, not a process RSS limit. One instance per service;
 * the browser scheduler's logical waiting-byte limit is a separate resource. */
export const DEFAULT_HTTP_BODY_BUDGET_BYTES = 256 * 1024 * 1024;

export class HttpBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 499 | 503 = 400) {
    super(message);
    this.name = "HttpBodyError";
  }
}

export class HttpBodyBudget {
  private used = 0;
  private peak = 0;
  private owners = 0;

  constructor(readonly limit = DEFAULT_HTTP_BODY_BUDGET_BYTES) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("Invalid HTTP body budget");
  }

  snapshot() {
    return { reservedBytes: this.used, peakReservedBytes: this.peak, reservations: this.owners, limitBytes: this.limit };
  }

  reserve(bytes: number): HttpBodyReservation {
    this.resize(bytes);
    this.owners++;
    return new HttpBodyReservation(bytes, delta => this.resize(delta), () => { this.owners--; });
  }

  private resize(delta: number): void {
    if (!Number.isSafeInteger(delta) || this.used + delta < 0) throw new RangeError("Invalid HTTP body reservation");
    if (this.used + delta > this.limit) {
      throw new HttpBodyError("HTTP request body memory budget exhausted; retry after pending requests finish", 503);
    }
    this.used += delta;
    this.peak = Math.max(this.peak, this.used);
  }
}

export class HttpBodyReservation {
  private references = 1;
  private rootReleased = false;

  constructor(private bytes: number, private readonly resize: (delta: number) => void, private readonly closed: () => void) {}

  grow(bytes: number): void {
    if (this.references === 0 || bytes < 0) throw new Error("Invalid HTTP body reservation growth");
    this.resize(bytes);
    this.bytes += bytes;
  }

  shrink(bytes: number): void {
    if (this.references === 0 || bytes < 0 || bytes > this.bytes) throw new Error("Invalid HTTP body reservation shrink");
    this.resize(-bytes);
    this.bytes -= bytes;
  }

  /** Execution and response delivery may settle in either order after cancellation. */
  retain(): () => void {
    if (this.references === 0) throw new Error("HTTP body reservation already released");
    this.references++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.drop();
    };
  }

  release(): void {
    if (this.rootReleased) return;
    this.rootReleased = true;
    this.drop();
  }

  private drop(): void {
    if (--this.references !== 0) return;
    this.resize(-this.bytes);
    this.bytes = 0;
    this.closed();
  }
}
