import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { RequestOptions, request } from "node:https";
import type { lookup } from "node:dns/promises";
import { Readable } from "node:stream";
import {
  attachmentUrl, createPublicHttpsTransport, InputReferenceError, isPublicAttachmentAddress,
} from "../../src/responses/input-reference-network";

test("nonpublic IPv4, IPv6 and transition addresses are rejected, ordinary global unicast retained", () => {
  for (const ip of ["0.1.2.3", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.31.255.255",
    "192.168.1.1", "192.0.0.1", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1",
    "fe80::1%eth0", "ff02::1", "2001::1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1", "3fff::1", "invalid"]) {
    expect(isPublicAttachmentAddress(ip)).toBe(false);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    expect(isPublicAttachmentAddress(ip)).toBe(true);
  }
});

test("URL parser rejects local schemes, credentials, private encoded IPs, ports, fragments and special DNS names", () => {
  for (const value of [
    "http://public.example.org/a", "file:///C:/private", "data:image/png;base64,AAAA", "ftp://example.org/a",
    "https://user:password@example.org/a", "https://example.org:8443/a", "https://example.org/a#fragment",
    "https://localhost/a", "https://local/a", "https://metadata.internal/a", "https://foo.local/a", "https://foo.home.arpa/a",
    "https://127.1/a", "https://0x7f000001/a", "https://2130706433/a", "https://[::1]/a",
    "https://[::ffff:127.0.0.1]/a", "https://example.org./a", "https://example.org/a b",
    "https://example.org\\@localhost/a", "https://example.org/\r\nprivate",
    "https://example.org/" + "a".repeat(8192),
  ]) expect(() => attachmentUrl(value)).toThrow();
  expect(attachmentUrl("https://example.org:443/signed?token=opaque").href).toBe("https://example.org/signed?token=opaque");
  expect(attachmentUrl("https://8.8.8.8/data").hostname).toBe("8.8.8.8");
});

function wire(addresses: Array<{ address: string; family: number }>) {
  const dns: string[] = [];
  const requests: RequestOptions[] = [];
  let destroyed = 0;
  const resolve = (async (hostname: string) => { dns.push(hostname); return addresses; }) as unknown as typeof lookup;
  const send = ((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    requests.push(options);
    const req = Object.assign(new EventEmitter(), {
      destroy() { destroyed++; },
      end() {
        const stream = Object.assign(Readable.from([Buffer.from("fixture")]), {
          statusCode: 200, headers: { "content-type": "text/plain" },
        });
        queueMicrotask(() => callback(stream as unknown as IncomingMessage));
      },
    });
    return req;
  }) as typeof request;
  return { dns, requests, get destroyed() { return destroyed; }, transport: createPublicHttpsTransport({ lookup: resolve, request: send }) };
}

test("every DNS address is checked; mixed public/private or spoofed family never reaches HTTPS", async () => {
  for (const addresses of [
    [], [{ address: "127.0.0.1", family: 4 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }],
    [{ address: "2606:4700::1", family: 6 }, { address: "::1", family: 6 }],
    [{ address: "8.8.8.8", family: 6 }],
    Array.from({ length: 65 }, () => ({ address: "8.8.8.8", family: 4 })),
  ]) {
    const f = wire(addresses);
    await rejects(f.transport(attachmentUrl("https://cdn.attachments.org/file"), new AbortController().signal),
      (error: unknown) => error instanceof InputReferenceError && error.code === "unsafe_attachment_host");
    expect(f.requests).toEqual([]);
  }
});

test("actual HTTPS options pin validated DNS, retain TLS/Host, disable pooling and carry no ambient credentials", async () => {
  const f = wire([{ address: "93.184.216.34", family: 4 }, { address: "8.8.8.8", family: 4 }]);
  const signal = new AbortController().signal;
  const response = await f.transport(attachmentUrl("https://cdn.attachments.org/file?signature=fixture"), signal);
  expect(f.dns).toEqual(["cdn.attachments.org"]);
  const options = f.requests[0]!;
  expect(options.hostname).toBe("cdn.attachments.org");
  expect(options.servername).toBe("cdn.attachments.org");
  expect(options.rejectUnauthorized).toBe(true);
  expect(options.agent).toBe(false);
  expect(options.signal).toBe(signal);
  expect(options.path).toBe("/file?signature=fixture");
  expect(options.method).toBe("GET");
  expect(options.headers).toEqual({ accept: "*/*", "accept-encoding": "identity", host: "cdn.attachments.org" });
  // Repeated connect callbacks cannot trigger a second DNS lookup or consume a rebinding answer.
  const lookup = options.lookup as Function;
  let all: unknown;
  lookup("cdn.attachments.org", { all: true }, (error: unknown, addresses: unknown) => { expect(error).toBeNull(); all = addresses; });
  expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
  let single: unknown;
  lookup("cdn.attachments.org", {}, (error: unknown, address: unknown, family: unknown) => { expect(error).toBeNull(); single = [address, family]; });
  expect(single).toEqual(["93.184.216.34", 4]);
  expect(f.dns).toHaveLength(1);
  const chunks: Buffer[] = [];
  for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("fixture");
  response.cancel();
  expect(f.destroyed).toBe(1);
});

test("literal public IP uses no DNS and still validates HTTPS, with no IPv6 mapped/private bypass", async () => {
  const f = wire([]);
  const response = await f.transport(attachmentUrl("https://8.8.8.8/file"), new AbortController().signal);
  expect(f.dns).toEqual([]);
  expect(f.requests[0]!.hostname).toBe("8.8.8.8");
  expect(f.requests[0]!.servername).toBeUndefined();
  expect(f.requests[0]!.rejectUnauthorized).toBe(true);
  response.cancel();
});

test("DNS cancellation stops waiting and late resolver completion cannot open a connection", async () => {
  let finish!: (addresses: Array<{ address: string; family: number }>) => void;
  let requests = 0;
  const transport = createPublicHttpsTransport({
    lookup: (() => new Promise(resolve => { finish = resolve; })) as typeof lookup,
    request: (() => { requests++; throw new Error("must not execute"); }) as typeof request,
  });
  const controller = new AbortController();
  const pending = transport(attachmentUrl("https://cdn.attachments.org/file"), controller.signal);
  controller.abort();
  await rejects(pending, (error: unknown) => error instanceof InputReferenceError && error.code === "attachment_cancelled");
  finish([{ address: "8.8.8.8", family: 4 }]);
  await Promise.resolve();
  expect(requests).toBe(0);
});
