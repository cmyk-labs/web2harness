/** Coalesce repeated observations, without changing observation timing or recovery. */
export class ChatGptResponseFallbackLog {
  private pending?: { key: string; count: number; firstAt: number; lastAt: number; detail: Record<string, unknown> };
  constructor(private readonly emit: (event: string, detail: Record<string, unknown>) => void) {}

  observe(key: string, detail: Record<string, unknown>, now = Date.now()): void {
    if (this.pending?.key === key) {
      this.pending.count++;
      this.pending.lastAt = now;
      return;
    }
    this.flush();
    this.pending = { key, count: 1, firstAt: now, lastAt: now, detail };
    this.emit("browser.response_source_fallback", detail);
  }

  flush(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    this.emit("browser.response_source_fallback_summary", {
      ...pending.detail, count: pending.count, firstAt: pending.firstAt, lastAt: pending.lastAt,
      durationMs: Math.max(0, pending.lastAt - pending.firstAt),
    });
  }
}
