/** Incremental WHATWG event-stream framing. No transport chunks are treated as messages. */
export class ServerSentEventDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private line = "";
  private data: string[] = [];
  private event = "";
  private skipLf = false;
  private eventChars = 0;
  private bytes = 0;
  constructor(private readonly consume: (data: string, event: string) => void,
    private readonly maxBytes = 16 * 1024 * 1024, private readonly maxEventChars = 2 * 1024 * 1024) {}

  push(bytes: Uint8Array): void {
    if ((this.bytes += bytes.byteLength) > this.maxBytes) throw new Error("response_stream_size_limit");
    this.text(this.decoder.decode(bytes, { stream: true }));
  }
  finish(): { discardedData: boolean } {
    this.text(this.decoder.decode());
    // EOF does not dispatch an unterminated event. The caller still needs its protocol terminator.
    const discardedData = this.data.length > 0 || this.line === "data" || this.line.startsWith("data:");
    this.line = ""; this.data = []; this.eventChars = 0;
    return { discardedData };
  }
  private text(text: string): void {
    for (const char of text) {
      if (this.skipLf) { this.skipLf = false; if (char === "\n") continue; }
      if (char === "\r" || char === "\n") {
        const line = this.line; this.line = ""; this.skipLf = char === "\r"; this.readLine(line);
      } else {
        this.line += char;
        if (this.line.length + this.eventChars > this.maxEventChars) throw new Error("response_event_size_limit");
      }
    }
  }
  private readLine(line: string): void {
    if (!line) {
      const data = this.data, event = this.event;
      this.data = []; this.event = ""; this.eventChars = 0;
      if (data.length) this.consume(data.join("\n"), event || "message");
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":"), field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") { this.data.push(value); this.eventChars += value.length + 1; }
    else if (field === "event") this.event = value;
    // id/retry control EventSource reconnection; they never modify response content.
  }
}
