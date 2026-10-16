const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeContextPreferences: normalize } = require("../../shared/context-preferences.cjs");

test("only sourced user choices survive a default change, independently for each preference", () => {
  for (const source of [undefined, "default", "legacy"]) {
    const value = normalize({ experimentalContextFiles: false, experimentalContextTripleBudget: true,
      contextPreferenceSources: source ? { files: source, budget: source } : undefined });
    assert.equal(value.experimentalContextFiles, true);
    assert.equal(value.experimentalContextTripleBudget, false);
    assert.deepEqual(value.contextPreferenceSources, { files: "default", budget: "default" });
  }
  const disabled = normalize({ experimentalContextFiles: false, contextPreferenceSources: { files: "user" } });
  assert.equal(disabled.experimentalContextFiles, false);
  assert.deepEqual(normalize(disabled), disabled, "repeated reads preserve an explicit opt-out");
  const triple = normalize({ experimentalContextFiles: false, experimentalContextTripleBudget: true,
    contextPreferenceSources: { budget: "user" } });
  assert.equal(triple.experimentalContextFiles, true, "an unsourced file value uses the new default");
  assert.equal(triple.experimentalContextTripleBudget, true);
  assert.deepEqual(triple.contextPreferenceSources, { files: "default", budget: "user" });
  const standard = normalize({ experimentalContextTripleBudget: false, contextPreferenceSources: { budget: "user" } });
  assert.equal(standard.contextPreferenceSources.budget, "user", "choosing the default is still a user choice");
});

test("defaults obey mode support and do not silently accept invalid explicit choices", () => {
  for (const boundary of [{ browserInteractionMode: "manual" }, { solAvailable: false }]) {
    assert.equal(normalize({ ...boundary, experimentalContextFiles: true }).experimentalContextFiles, false);
    assert.throws(() => normalize({ ...boundary, experimentalContextFiles: true,
      contextPreferenceSources: { files: "user" } }), /does not support/);
  }
  assert.throws(() => normalize({ contextPreferenceSources: { files: "user" } }), /Missing user/);
  assert.throws(() => normalize({ experimentalContextFiles: "false" }), /Invalid/);
  const cleared = normalize({ experimentalContextFiles: false, experimentalContextTripleBudget: true,
    contextPreferenceSources: { files: "user", budget: "user" } });
  assert.equal(cleared.experimentalContextTripleBudget, false);
  assert.equal(cleared.contextPreferenceSources.budget, "default");
});
