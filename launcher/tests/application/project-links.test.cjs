const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { projectLinks } = require("../../electron/project-links.cjs");
const { repositoryUrl } = require("../../electron/installation/release-config.cjs");
const source = fs.readFileSync(path.join(__dirname, "../../electron/main.cjs"), "utf8");

function handler(channel, context) {
  const start = source.indexOf(`handle("${channel}",`);
  assert.ok(start >= 0, `Missing handler: ${channel}`);
  let result;
  vm.runInNewContext(source.slice(start, source.indexOf('\n  handle(', start + 8)), {
    ...context,
    handle: (_channel, callback) => { result = callback; },
  });
  return result;
}

test("project links derive from the configured release repository", () => {
  const github = repositoryUrl({ env: {} });
  assert.equal(github, "https://github.com/cmyk-labs/web2harness");
  const links = projectLinks(github + "/");
  assert.equal(links.github, github);
  assert.equal(links.documentation, `${github}/blob/main/README.md#documentation`);
  assert.equal(links.documentationZhCN, `${github}/blob/main/README.zh-CN.md#documentation`);
  assert.equal(links.license, `${github}/blob/main/LICENSE`);
  assert.ok(Object.values(projectLinks("")).every(value => value === ""));
});

test("native external-link policy permits exact project destinations and rejects other destinations", async () => {
  const GITHUB_URL = repositoryUrl({ env: {} });
  const opened = [];
  const context = {
    GITHUB_URL, projectLinks,
    CONNECTORS_URL: "https://chatgpt.com/#settings/Plugins",
    TUNNELS_URL: "https://platform.openai.com/settings/organization/tunnels",
    KEYS_URL: "https://platform.openai.com/settings/organization/api-keys",
    LIMITS_SOURCE_URL: "https://example.invalid/limits",
  };
  const start = source.indexOf("const ALLOWED_EXTERNAL_URLS =");
  const allowed = vm.runInNewContext(
    source.slice(start, source.indexOf("const PACKAGED_RENDERER_URL", start)) + "ALLOWED_EXTERNAL_URLS;",
    context,
  );
  const open = handler("launcher:open-external", {
    ALLOWED_EXTERNAL_URLS: allowed,
    openWebUrl: async url => { opened.push(url); },
  });
  for (const url of Object.values(projectLinks(GITHUB_URL))) await open(null, url);
  assert.equal(opened.length, 4);
  for (const url of ["https://x.com/example", "https://github.com/another/project", `${GITHUB_URL}/issues`, ""]) {
    await assert.rejects(open(null, url), /not allowlisted/);
  }
  assert.equal(opened.length, 4);
});

test("repository invitation records only successful opening and never completes onboarding", async () => {
  const state = { githubOpened: false, onboardingComplete: false };
  const opened = [];
  let fail = true;
  const open = handler("launcher:open-repository", {
    GITHUB_URL: "https://github.com/cmyk-labs/web2harness",
    openWebUrl: async url => { if (fail) throw new Error("Cannot open browser"); opened.push(url); },
    stateStore: { update: patch => Object.assign(state, patch) },
  });
  await assert.rejects(open(), /Cannot open browser/);
  assert.equal(state.githubOpened, false);
  fail = false;
  await open();
  assert.deepEqual(opened, ["https://github.com/cmyk-labs/web2harness"]);
  assert.deepEqual(state, { githubOpened: true, onboardingComplete: false });
  const unavailable = handler("launcher:open-repository", {
    GITHUB_URL: "", openWebUrl: () => assert.fail("No fallback URL is allowed"),
  });
  await assert.rejects(unavailable(), /not configured/);
});
