import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

test("prepared context is bounded, usable in memory and excluded from every disk flush", async () => {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "web2harness-prepared-state-")));
  const moduleUrl = new URL("../../src/responses/state.ts", import.meta.url).href;
  const source = `
    import assert from "node:assert/strict";
    import { existsSync, readFileSync } from "node:fs";
    import { join } from "node:path";
    const { rememberResponseState: remember, expandPreviousResponseInput: expand, flushResponseState: flush,
      responseStateScope: scope, copyPreviousResponseProvenance: copyProvenance, previousResponseReplayPrefixLength: prefixLength } = await import(${JSON.stringify(moduleUrl)});
    const snapshot = join(process.env.WEB2HARNESS_HOME, "responses-state.json");
    const prefill = { input: [{ role: "developer", content: "prepared-private-marker" }], store: false };
    assert.equal(remember(prefill, { id: "resp_prepared", status: "completed", output: [] }, { force: true, memoryOnly: true }), true);
    flush(); assert.equal(existsSync(snapshot), false);
    const next = { previous_response_id: "resp_prepared", input: [{ role: "user", content: "new-user" }], model: "current-model", tools: [] };
    assert.deepEqual(expand(next), { ...next, input: [...prefill.input, ...next.input] });
    assert.equal(remember({ input: "ordinary" }, { id: "resp_normal", output: [] }), true);
    flush(); const disk = readFileSync(snapshot, "utf8");
    assert.equal(disk.includes("resp_normal"), true);
    assert.equal(disk.includes("resp_prepared"), false);
    assert.equal(disk.includes("prepared-private-marker"), false);
    assert.notEqual(expand(next), next);
    const caller = scope(new Headers({ authorization: "Bearer test-first", "chatgpt-account-id": "account-a" }));
    const otherCaller = scope(new Headers({ authorization: "Bearer test-second", "chatgpt-account-id": "account-a" }));
    const otherAccount = scope(new Headers({ authorization: "Bearer test-first", "chatgpt-account-id": "account-b" }));
    assert.notEqual(caller, otherCaller); assert.notEqual(caller, otherAccount);
    assert.equal(remember(prefill, { id: "resp_scoped", output: [] }, { force: true, memoryOnly: true, scope: caller }), true);
    const scopedRequest = { previous_response_id: "resp_scoped", input: [{ role: "user", content: "resolve-reference" }] };
    assert.equal(expand(scopedRequest), scopedRequest);
    assert.equal(expand(scopedRequest, otherCaller), scopedRequest);
    assert.equal(expand(scopedRequest, otherAccount), scopedRequest);
    const scoped = expand(scopedRequest, caller);
    assert.equal(prefixLength(scoped), prefill.input.length);
    const resolved = { ...scoped, input: [...scoped.input] };
    copyProvenance(scoped, resolved);
    assert.equal(prefixLength(resolved), prefill.input.length);
    assert.equal(remember(resolved, { id: "resp_scoped_child", output: [] }, { force: true, scope: caller }), true);
    remember({ input: "ordinary-two" }, { id: "resp_normal_two", output: [] }, { scope: caller });
    flush(); const scopedDisk = readFileSync(snapshot, "utf8");
    assert.equal(scopedDisk.includes("resp_scoped_child"), false); // private ancestry cannot leak through an HTTP continuation
    assert.equal(scopedDisk.includes("prepared-private-marker"), false);
    assert.equal(scopedDisk.includes("test-first"), false);
    assert.equal(scopedDisk.includes("account-a"), false);
    assert.equal(scopedDisk.includes(caller), true);
    // UTF-8 bytes, not JS string units, determine the cache cap.
    assert.equal(remember({ input: "界".repeat(23 * 1024 * 1024) }, { id: "resp_multibyte_too_large", output: [] }, { force: true }), false);
    assert.equal(remember({ input: "x".repeat(64 * 1024 * 1024) }, { id: "resp_too_large", output: [] }, { force: true, memoryOnly: true }), false);
    const oversized = { previous_response_id: "resp_too_large", input: [] }; assert.equal(expand(oversized), oversized);
    assert.notEqual(expand(next), next); // rejected preparation did not evict valid contexts
    for (let i = 0; i < 1001; i++) remember({ input: [i] }, { id: "resp_fill_" + i, output: [] }, { force: true, memoryOnly: true });
    assert.equal(expand(next), next); // ordinary cache eviction/recovery semantics still apply
    console.log("PREPARED_STATE_OK");
  `;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const spawned = Bun.spawn([process.execPath, "-e", source], {
      cwd: root, env: { ...process.env, WEB2HARNESS_HOME: root }, stdout: "pipe", stderr: "pipe",
    });
    child = spawned;
    const [stdout, stderr, exit] = await Promise.all([
      new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited,
    ]);
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
    expect(stdout).toContain("PREPARED_STATE_OK");
    expect(existsSync(join(root, "responses-state.json"))).toBe(true);
  } finally {
    if (child?.exitCode === null) { child.kill(); await child.exited; }
    if (dirname(root) !== parent || !basename(root).startsWith("web2harness-prepared-state-")) throw new Error("Fixture ownership mismatch");
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
