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
    LIMITS_SOURCES: require("../../electron/limits/limits-policy.json").sources,
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
  for (const url of Object.values(context.LIMITS_SOURCES)) await open(null, url);
  assert.equal(opened.length, 4 + Object.keys(context.LIMITS_SOURCES).length);
  for (const url of ["https://x.com/example", "https://github.com/another/project", `${GITHUB_URL}/issues`, ""]) {
    await assert.rejects(open(null, url), /not allowlisted/);
  }
  assert.equal(opened.length, 4 + Object.keys(context.LIMITS_SOURCES).length);
});

test("continuing onboarding saves setup without a repository visit", () => {
  const state = { onboardingComplete: false, autoStart: false };
  const complete = handler("launcher:complete-onboarding", {
    stateStore: { read: () => state, update: patch => Object.assign(state, patch) },
    validateLanguage: value => value, validateBrowserInteractionMode: value => value,
    updateTrayMenu() {}, logger: { info() {} },
  });
  complete(null, "zh-CN", "automatic");
  assert.equal(state.onboardingComplete, true);
});
