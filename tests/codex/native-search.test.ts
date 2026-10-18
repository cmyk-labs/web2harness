import { expect, test } from "bun:test";
import { resolveNativeSearchModel } from "../../src/codex/native-search";
import { forwardNativeCodexRequest } from "../../src/codex/native-passthrough";
import { nativeSearchRequest } from "../../src/server";

test.each([
  ["chatgpt-web/gpt-6-sol", "gpt-6-sol"],
  ["chatgpt-web/gpt-6-sol-instant", "gpt-6-sol"],
  ["chatgpt-web/gpt-6-pro", "gpt-6-pro"],
  ["chatgpt-web/gpt-5.6-sol", "gpt-5.6-sol"],
  ["chatgpt-web/pro", "gpt-5.6-pro"],
  ["chatgpt-web/gpt-5.6-luna", "gpt-5.6-luna"],
  ["native-explicit-model", "native-explicit-model"],
])("search resolves only the selected model alias %s", (input, expected) => {
  expect(resolveNativeSearchModel(input)).toBe(expected);
});

test.each([false, true, "indexed"])("native search preserves settings, results and command scope (%s)", async external => {
  const body = {
    id: "fixture-thread", model: "chatgpt-web/gpt-6-sol", reasoning: null,
    input: [{ role: "user", content: [{ type: "input_text", text: "fixture" }] }],
    commands: { search_query: [{ q: "fixture query", domains: ["example.com"] }], response_length: "short" },
    settings: { external_web_access: external, filters: { allowed_domains: ["example.com"] }, allowed_callers: ["direct"] },
    max_output_tokens: 1024,
  };
  const responseBody = { output: [{ type: "input_text", text: "[source](https://example.com/)" }], results: [{ url: "https://example.com/" }] };
  const reply = await forwardNativeCodexRequest(new Request("http://127.0.0.1/v1/alpha/search", {
    method: "POST", headers: { authorization: "Bearer fixture", "content-encoding": "zstd" },
    body: new Uint8Array(Bun.zstdCompressSync(Buffer.from(JSON.stringify(body)))).buffer,
  }), "alpha/search", async request => {
    expect(request.url).toBe("https://chatgpt.com/backend-api/codex/alpha/search");
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("content-encoding")).toBeNull();
    expect(await request.json()).toEqual({ ...body, model: "gpt-6-sol" });
    return Response.json(responseBody);
  });
  expect(await reply.json()).toEqual(responseBody);
});

test("search rejects unknown or unverified model identities before contacting upstream", async () => {
  for (const model of ["chatgpt-web/unknown", "chatgpt-web/zero-risk"]) {
    let fetched = false;
    const reply = await nativeSearchRequest(new Request("http://127.0.0.1/v1/alpha/search", {
      method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ model }),
    }), async () => { fetched = true; return Response.json({}); });
    expect(reply.status).toBe(400);
    expect(fetched).toBe(false);
  }
});

test("search requires caller authentication and preserves upstream denial", async () => {
  const unauthenticated = await nativeSearchRequest(new Request("http://127.0.0.1/v1/alpha/search", { method: "POST", body: "{}" }), async () => { throw new Error("must not fetch"); });
  expect(unauthenticated.status).toBe(401);
  const denied = await nativeSearchRequest(new Request("http://127.0.0.1/v1/alpha/search", {
    method: "POST", headers: { authorization: "Bearer fixture" }, body: "{}",
  }), async () => Response.json({ error: { code: "quota_exhausted" } }, { status: 429 }));
  expect(denied.status).toBe(429);
  expect(await denied.json()).toEqual({ error: { code: "quota_exhausted" } });
});

test("search relays already-decompressed JSON without its former gzip header", async () => {
  const upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(Bun.gzipSync('{"output":[]}'), { headers: { "content-encoding": "gzip", "content-type": "application/json" } }) });
  try {
    const reply = await nativeSearchRequest(new Request("http://127.0.0.1/v1/alpha/search", {
      method: "POST", headers: { authorization: "Bearer fixture" }, body: "{}",
    }), () => fetch(`http://127.0.0.1:${upstream.port}`));
    expect(reply.headers.get("content-encoding")).toBeNull();
    expect(await reply.json()).toEqual({ output: [] });
  } finally { await upstream.stop(true); }
});
