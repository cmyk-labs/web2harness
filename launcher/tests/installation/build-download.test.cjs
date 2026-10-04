const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { createHash, randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");

test("packaging downloads remain compatible after removing the vulnerable HTTP cache", async t => {
  const tempParent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempParent, "web2harness-download-test-"));
  const envKeys = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
    "ELECTRON_GET_USE_PROXY", "ELECTRON_MIRROR", "ELECTRON_CUSTOM_DIR", "ELECTRON_CUSTOM_FILENAME",
    "ELECTRON_CUSTOM_VERSION", "ELECTRON_DOWNLOAD_CACHE_MODE"];
  const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  const { getGlobalDispatcher, setGlobalDispatcher } = require("undici");
  const originalDispatcher = getGlobalDispatcher();
  const sockets = new Set();
  const requests = new Map();
  const payload = Buffer.from("isolated packaging download fixture\n");
  const checksum = createHash("sha256").update(payload).digest("hex");
  let proxyConnections = 0;
  const remember = socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };
  const origin = http.createServer((req, res) => {
    const kind = req.url.slice(1);
    const count = (requests.get(kind) ?? 0) + 1;
    requests.set(kind, count);
    if (kind === "retry" && count === 1) return res.writeHead(503).end();
    if (kind === "missing") return res.writeHead(404).end();
    if (kind === "slow") {
      res.writeHead(200, { "content-length": 100 });
      res.write("pending");
      return;
    }
    const body = kind === "corrupt" ? Buffer.from("tampered fixture") : payload;
    res.writeHead(200, { "content-length": body.length }).end(body);
  });
  const proxy = http.createServer((req, res) => res.writeHead(405).end());
  for (const server of [origin, proxy]) server.on("connection", remember);
  t.after(async () => {
    const dispatcher = getGlobalDispatcher();
    setGlobalDispatcher(originalDispatcher);
    if (dispatcher !== originalDispatcher) await dispatcher.destroy();
    for (const socket of sockets) socket.destroy();
    await Promise.all([origin, proxy].map(server => new Promise(resolve => server.close(resolve))));
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(path.dirname(root), tempParent);
    assert.ok(path.basename(root).startsWith("web2harness-download-test-"));
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise(resolve => origin.listen(0, "127.0.0.1", resolve));
  const originPort = origin.address().port;
  proxy.on("connect", (req, client, head) => {
    // This fixture cannot forward to any destination except its own loopback origin.
    if (req.url !== `127.0.0.1:${originPort}`) return client.destroy();
    proxyConnections++;
    const upstream = net.connect(originPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    remember(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  for (const key of envKeys) delete process.env[key];
  process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  process.env.HTTPS_PROXY = process.env.HTTP_PROXY;
  process.env.NO_PROXY = "*";

  const builderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
  const { downloadElectronArtifactZip } = builderRequire("./out/util/electronGet.js");
  function download(kind) {
    const artifactName = `fixture-${randomUUID()}`;
    const version = "41.10.7";
    const fileName = `${artifactName}-v${version}-${process.platform}-${process.arch}.zip`;
    return downloadElectronArtifactZip({
      artifactName, version, platformName: process.platform, arch: process.arch,
      cacheDir: path.join(root, "cache"),
      electronDownload: {
        tempDirectory: path.join(root, "temporary"),
        checksums: { [fileName]: checksum },
        mirrorOptions: { resolveAssetURL: async () => `http://127.0.0.1:${originPort}/${kind}` },
      },
    });
  }
  fs.mkdirSync(path.join(root, "temporary"));

  await t.test("builder and Electron resolve the same released downloader without got", () => {
    const electronRequire = createRequire(require.resolve("electron/package.json"));
    assert.equal(builderRequire.resolve("@electron/get"), electronRequire.resolve("@electron/get"));
    const getPackage = JSON.parse(fs.readFileSync(path.resolve(builderRequire.resolve("@electron/get"), "../../package.json"), "utf8"));
    assert.equal(getPackage.version, "5.1.0");
    assert.equal(getPackage.dependencies.got, undefined);
    const lock = fs.readFileSync(path.join(__dirname, "../../bun.lock"), "utf8");
    assert.doesNotMatch(lock, /"(?:http-cache-semantics|cacheable-request|got)":/);
  });
  await t.test("downloads and verifies an artifact while NO_PROXY bypasses the proxy", async () => {
    const result = await download("success");
    assert.deepEqual(fs.readFileSync(result), payload);
    assert.ok(result.startsWith(root + path.sep));
    assert.equal(proxyConnections, 0);
  });
  await t.test("rejects corrupted downloads without returning a usable artifact", async () => {
    await assert.rejects(download("corrupt"), /checksum/i);
    assert.equal(requests.get("corrupt"), 1);
  });
  await t.test("retries a transient Fetch HTTP error", async () => {
    assert.deepEqual(fs.readFileSync(await download("retry")), payload);
    assert.equal(requests.get("retry"), 2);
  });
  await t.test("fails an HTTP 404 without retrying", async () => {
    await assert.rejects(download("missing"), /404/);
    assert.equal(requests.get("missing"), 1);
  });
  await t.test("the builder timeout aborts a stalled response body", async () => {
    const originalTimeout = AbortSignal.timeout;
    const deadlines = [];
    AbortSignal.timeout = milliseconds => {
      deadlines.push(milliseconds);
      return originalTimeout(150);
    };
    try {
      await assert.rejects(download("slow"), error => /abort|timeout/i.test(`${error.name} ${error.message}`));
      assert.ok(deadlines.includes(10 * 60 * 1000));
      assert.equal(requests.get("slow"), 1);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });
  await t.test("HTTP_PROXY routes through the isolated proxy when NO_PROXY is empty", async () => {
    process.env.NO_PROXY = "";
    assert.deepEqual(fs.readFileSync(await download("proxy")), payload);
    assert.ok(proxyConnections > 0);
  });
});
