import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MANAGED_INTERRUPT_HOOK_END,
  codexInterruptHookCommand,
  codexInterruptHookHash,
  installCodexInterruptHook,
  installCodexInterruptHookCommand,
  restoreCodexInterruptHook,
  verifyCodexInterruptHook,
  verifyCodexInterruptHookRestored,
} from "../../src/codex/interrupt-hook";

test("preserves hook ownership across native TOML command quoting and inline array serialization", () => {
  const original = 'model = "example"\n\n[mcp_servers.notes]\ncommand = "user-mcp"\n';
  const command = '"C:\\Program Files\\Bridge\\runtime.exe" "hook" "interrupt"';
  const { text, installed } = installCodexInterruptHookCommand(original, "/fixture/config.toml", command);
  const literal = text.replace(JSON.stringify(command), `'${command}'`);
  // Native config/value/write rebuilds an edited Interrupt array inline and drops its old comment.
  const inline = original + `\n[hooks]\nInterrupt = [{ hooks = [{ type = 'command', command = '${command}', timeout = 3 }] }]\n`
    + `[hooks.state.'${installed.stateKey}']\ntrusted_hash = '${installed.trustedHash}'\n${MANAGED_INTERRUPT_HOOK_END}\n`;
  for (const value of [literal, inline, literal.replace(/^#.*interrupt.*\n/gm, "")]) {
    expect(Bun.TOML.parse(value)).toEqual(Bun.TOML.parse(text));
    verifyCodexInterruptHook(value, installed);
    const restored = restoreCodexInterruptHook(value, installed);
    expect(restored).toContain(original);
    expect((Bun.TOML.parse(restored) as any).mcp_servers.notes.command).toBe("user-mcp");
    verifyCodexInterruptHookRestored(restored);
    for (const changed of [value.replace(command, command + " --changed"), value.replace("timeout = 3", "timeout = 9"),
      value.replace(installed.trustedHash, "sha256:changed")]) {
      expect(changed).not.toBe(value);
      expect(() => restoreCodexInterruptHook(changed, installed)).toThrow("changed after setup");
    }
  }
});

test("removes only the owned element of a native inline hook array", () => {
  const original = "[[hooks.Interrupt]]\n[[hooks.Interrupt.hooks]]\ntype = 'command'\ncommand = 'user-hook'\n";
  const { installed } = installCodexInterruptHookCommand(original, "/fixture/config.toml", "bridge-hook");
  const text = `[hooks]\nInterrupt = [\n { hooks = [{ type = 'command', command = 'user-hook' }] },\n { hooks = [{ type = 'command', command = 'bridge-hook', timeout = 3 }] },\n]\n`
    + `[hooks.state.'${installed.stateKey}']\ntrusted_hash = '${installed.trustedHash}'\n`
    + "\n[other]\ntext = '''\n[[hooks.Interrupt]]\ncommand = 'example, not a hook'\n'''\n";
  const restored = restoreCodexInterruptHook(text, installed);
  expect((Bun.TOML.parse(restored) as any).hooks.Interrupt).toEqual([{ hooks: [{ type: "command", command: "user-hook" }] }]);
  expect(restored).toContain("text = '''\n[[hooks.Interrupt]]\ncommand = 'example, not a hook'\n'''");
  // A reinstall must append to the existing inline array, not create an invalid array-table.
  const next = installCodexInterruptHookCommand(restored, "/fixture/config.toml", "new-bridge-hook");
  expect(next.installed.groupIndex).toBe(1);
  verifyCodexInterruptHook(next.text, next.installed);
  const again = restoreCodexInterruptHook(next.text, next.installed);
  expect(Bun.TOML.parse(again)).toEqual(Bun.TOML.parse(restored));
});

test("installs one narrowly trusted Interrupt hook and restores the exact Codex config", () => {
  const original = [
    'model = "gpt-5.6-sol"',
    "",
    "[[hooks.Interrupt]]",
    "[[hooks.Interrupt.hooks]]",
    'type = "command"',
    'command = "existing-hook"',
    "",
  ].join("\n");
  const config = { runtimeCommand: ["/opt/Codex Web/runtime/bun", "/opt/Codex Web/app/cli.js"] };
  const installed = installCodexInterruptHook(original, "/Users/test/.codex/config.toml", config);

  expect(installed.installed.groupIndex).toBe(1);
  expect(installed.installed.stateKey).toBe(`${resolve("/Users/test/.codex/config.toml")}:interrupt:1:0`);
  expect(installed.text).toContain('[[hooks.Interrupt]]');
  expect(installed.text).toContain(`[hooks.state.${JSON.stringify(installed.installed.stateKey)}]`);
  expect(installed.text).toContain(`trusted_hash = ${JSON.stringify(installed.installed.trustedHash)}`);
  verifyCodexInterruptHook(installed.text, installed.installed);
  expect(restoreCodexInterruptHook(installed.text, installed.installed)).toBe(original);
  verifyCodexInterruptHookRestored(original);
});

test("trusts the canonical Codex config path before a new config file exists", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-interrupt-hook-"));
  try {
    const configPath = join(directory, "config.toml");
    const installed = installCodexInterruptHook("", configPath, { runtimeCommand: ["/opt/runtime"] });
    expect(installed.installed.stateKey).toBe(
      `${join(realpathSync.native(directory), "config.toml")}:interrupt:0:0`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Interrupt hook command is absolute, quoted, and bound to the exact application home", () => {
  expect(codexInterruptHookCommand(
    { runtimeCommand: ["/Applications/Web2Harness.app/runtime/bun", "/Applications/Web2Harness.app/app/cli.js"] },
    "/Users/test/Application Support/Web2Harness",
    "darwin",
  )).toBe(
    "'/Applications/Web2Harness.app/runtime/bun' '/Applications/Web2Harness.app/app/cli.js'"
      + " '--home' '/Users/test/Application Support/Web2Harness' 'hook' 'interrupt'",
  );
  const windows = codexInterruptHookCommand(
    { runtimeCommand: ["C:\\Program Files\\Web2Harness\\bun.exe", "C:\\Program Files\\Web2Harness\\cli.js"] },
    "C:\\Users\\test\\Web2Harness",
    "win32",
  );
  expect(windows).toBe(
    'cmd.exe /d /s /c ^""C:\\Program Files\\Web2Harness\\bun.exe" "C:\\Program Files\\Web2Harness\\cli.js"'
      + ' "--home" "C:\\Users\\test\\Web2Harness" "hook" "interrupt"^"',
  );
});

test.skipIf(process.platform !== "win32")("Windows cmd executes the installed hook with quoted paths and intact stdin", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-interrupt-command-"));
  const script = join(directory, "hook args & capture.ts");
  const home = join(directory, "profile with spaces & 100% user's symbols");
  writeFileSync(script, 'console.log(JSON.stringify({args:Bun.argv.slice(2),input:await Bun.stdin.text()}));');
  try {
    const command = codexInterruptHookCommand({ runtimeCommand: [process.execPath, script] }, home, "win32");
    const input = JSON.stringify({ hook_event_name: "Interrupt", session_id: "owned-thread", turn_id: "owned-turn", text: "中文内容" });
    // Match native Codex's outer command quoting, not Node's argument escaping.
    const child = spawnSync("cmd.exe", ["/e:ON", "/v:OFF", "/d", "/c", `"${command}"`], {
      windowsVerbatimArguments: true, windowsHide: true, encoding: "utf8", input, timeout: 10_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ args: ["--home", home, "hook", "interrupt"], input });
  } finally {
    // Individually remove only this fixture's known file and now-empty owned directory.
    rmSync(script);
    rmdirSync(directory);
  }
}, 15_000);

test("Interrupt hook trust hash is deterministic and changes with its exact command", () => {
  const first = codexInterruptHookHash("'runtime' 'hook' 'interrupt'");
  expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(codexInterruptHookHash("'runtime' 'hook' 'interrupt'")).toBe(first);
  expect(codexInterruptHookHash("'other-runtime' 'hook' 'interrupt'")).not.toBe(first);
});

test("restores legacy quoted hooks before installing the explicit Windows shell without changing the deadline", () => {
  const original = 'model = "example"\n';
  const old = installCodexInterruptHookCommand(original, "/fixture/config.toml", '"C:\\Bridge\\bun.exe" "hook" "interrupt"');
  expect(old.text).toContain("timeout = 3");
  verifyCodexInterruptHook(old.text, old.installed);
  const baseline = restoreCodexInterruptHook(old.text, old.installed);
  expect(baseline).toBe(original);
  const command = codexInterruptHookCommand({ runtimeCommand: ["C:\\Bridge\\bun.exe"] }, "C:\\Bridge data", "win32");
  const current = installCodexInterruptHookCommand(baseline, "/fixture/config.toml", command);
  expect(current.text).toContain("timeout = 3");
  expect(current.installed.trustedHash).not.toBe(old.installed.trustedHash);
  verifyCodexInterruptHook(current.text, current.installed);
  expect(restoreCodexInterruptHook(current.text, current.installed)).toBe(original);
  expect(() => verifyCodexInterruptHook(current.text.replace("timeout = 3", "timeout = 5"), current.installed))
    .toThrow("changed after setup");
});

test("refuses to remove a modified or duplicated managed hook", () => {
  const original = 'model = "gpt-5.6-sol"\n';
  const installed = installCodexInterruptHook(
    original,
    "/Users/test/.codex/config.toml",
    { runtimeCommand: ["/opt/runtime"] },
  );
  const modified = installed.text.replace("timeout = 3", "timeout = 2");
  expect(() => restoreCodexInterruptHook(modified, installed.installed)).toThrow("changed after setup");
  expect(() => restoreCodexInterruptHook(
    installed.text.replace(MANAGED_INTERRUPT_HOOK_END, `approved = false\n${MANAGED_INTERRUPT_HOOK_END}`),
    installed.installed,
  )).toThrow("changed after setup");
  for (const extension of [
    '\n[[hooks.Interrupt.hooks]]\ntype = "command"\ncommand = "unexpected-command"\n',
    `\n[hooks.state.${JSON.stringify(installed.installed.stateKey)}.unexpected]\nvalue = true\n`,
  ]) {
    expect(() => restoreCodexInterruptHook(
      installed.text.replace(MANAGED_INTERRUPT_HOOK_END, extension + MANAGED_INTERRUPT_HOOK_END),
      installed.installed,
    )).toThrow("changed after setup");
  }
  const reordered = [
    "[[hooks.Interrupt]]",
    "[[hooks.Interrupt.hooks]]",
    'type = "command"',
    'command = "new-earlier-hook"',
    "",
    installed.text,
  ].join("\n");
  expect(() => restoreCodexInterruptHook(reordered, installed.installed)).toThrow("order changed after setup");
  expect(() => installCodexInterruptHook(installed.text, "/Users/test/.codex/config.toml", { runtimeCommand: ["/opt/runtime"] }))
    .toThrow("already contains");
});

test("preserves native TOML editor tables inserted before the trailing hook comment", () => {
  for (const ending of ["\n", "\r\n"]) {
    const original = 'model = "gpt-5.6-sol"\n';
    const installed = installCodexInterruptHook(original.replaceAll("\n", ending), "/Users/test/.codex/config.toml", {
      runtimeCommand: ["/opt/runtime"],
    });
    // Native config writes normalize line endings and insert tables before the trailing comment.
    const appended = "\n[features]\ngoals = true\n";
    const edited = installed.text.replaceAll("\r\n", "\n")
      .replace(MANAGED_INTERRUPT_HOOK_END, appended + MANAGED_INTERRUPT_HOOK_END);
    verifyCodexInterruptHook(edited, installed.installed);
    const restored = restoreCodexInterruptHook(edited, installed.installed);
    expect(restored).toBe(original + appended);
    verifyCodexInterruptHookRestored(restored);
    expect(() => restoreCodexInterruptHook(
      edited.replace("timeout = 3", "timeout = 2"), installed.installed,
    )).toThrow("changed after setup");
  }
});

test("restores a hook whose end comment moved before unchanged definitions without losing MCP settings", () => {
  for (const ending of ["\n", "\r\n"]) {
    const original = 'model = "gpt-5.6-sol"\n';
    const installed = installCodexInterruptHook(original.replaceAll("\n", ending), "/Users/test/.codex/config.toml", {
      runtimeCommand: ["/opt/runtime"],
    });
    const mcp = '\n[mcp_servers.node_repl]\ncommand = "my-mcp"\n\n[mcp_servers.node_repl.env]\nMODE = "user-setting"\n';
    const definitions = installed.installed.fragment.replaceAll("\r\n", "\n")
      .replace(`${MANAGED_INTERRUPT_HOOK_END}\n`, "");
    for (const beforeModel of [false, true]) {
      const movedComment = `${MANAGED_INTERRUPT_HOOK_END}\n`;
      const edited = (beforeModel ? movedComment + original : original + movedComment) + mcp + definitions;
      expect(Bun.TOML.parse(edited)).toMatchObject(Bun.TOML.parse(installed.text));
      verifyCodexInterruptHook(edited, installed.installed);
      const restored = restoreCodexInterruptHook(edited, installed.installed);
      expect(restored).toBe(original + mcp);
      verifyCodexInterruptHookRestored(restored);

      for (const changed of [
        edited.replace("timeout = 3", "timeout = 2"),
        edited + "approved = false\n",
        edited + '\n[[hooks.Interrupt.hooks]]\ntype = "command"\ncommand = "unexpected-command"\n',
        edited + `\n[hooks.state.${JSON.stringify(installed.installed.stateKey)}.unexpected]\nvalue = true\n`,
        edited + movedComment,
      ]) {
        expect(() => restoreCodexInterruptHook(changed, installed.installed)).toThrow("changed after setup");
      }
      const markerInsideValue = original + 'description = """\n' + movedComment + '"""\n' + mcp + definitions;
      expect(() => restoreCodexInterruptHook(markerInsideValue, installed.installed)).toThrow("markers changed after setup");
    }
  }
});

test("keeps foreign TOML tables inserted between the managed hook and its trust state", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    const original = 'model = "example"\n\n[[hooks.Interrupt]]\n[[hooks.Interrupt.hooks]]\ntype = "command"\ncommand = "prior-hook"\n'.replaceAll("\n", ending);
    const installed = installCodexInterruptHook(original, "/Users/test/.codex/config.toml", { runtimeCommand: ["/opt/runtime"] });
    const foreign = '\n[marketplaces.claude-plugins-official]\nsource = "unchanged-user-setting"\n\n[mcp_servers.notes]\ncommand = "notes-server"\n\n'.replaceAll("\n", ending);
    const stateHeader = `[hooks.state.${JSON.stringify(installed.installed.stateKey)}]`;
    const edited = installed.text.replace(stateHeader, foreign + stateHeader);
    const outside = installed.text + foreign;
    expect(Bun.TOML.parse(edited.replace(/\r\n?/g, "\n"))).toEqual(Bun.TOML.parse(outside.replace(/\r\n?/g, "\n")));
    verifyCodexInterruptHook(edited, installed.installed);
    const restored = restoreCodexInterruptHook(edited, installed.installed);
    expect(restored).toBe(original + foreign);
    const next = installCodexInterruptHook(restored, "/Users/test/.codex/config.toml", { runtimeCommand: ["/opt/new-runtime"] });
    verifyCodexInterruptHook(next.text, next.installed);
    expect(restoreCodexInterruptHook(next.text, next.installed)).toBe(restored);
    for (const changed of [
      edited.replace("timeout = 3", "timeout = 2"),
      edited.replace(installed.installed.trustedHash, "sha256:changed"),
      edited + `\n[hooks.state.${JSON.stringify(installed.installed.stateKey)}.extra]\nchanged = true\n`,
      edited + '\n[[hooks.Interrupt.hooks]]\ntype = "command"\ncommand = "unexpected-hook"\n',
    ]) {
      expect(() => restoreCodexInterruptHook(changed, installed.installed)).toThrow("changed after setup");
    }
  }
});

test("preserves ownership when Codex moves trust state before the hook and normalizes boundary newlines", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    const original = 'model = "example"\n'.replaceAll("\n", ending);
    const { text, installed } = installCodexInterruptHook(original, "/Users/test/.codex/config.toml", {
      runtimeCommand: ["/opt/runtime"],
    });
    const state = `[hooks.state.${JSON.stringify(installed.stateKey)}]${ending}trusted_hash = ${JSON.stringify(installed.trustedHash)}${ending}`;
    const rewritten = text.replace(state, "").replace("# Managed by web2harness:", state + "# Managed by web2harness:")
      .replace(`timeout = 3${ending}${ending}`, `timeout = 3${ending}`);
    const parse = (value: string) => Bun.TOML.parse(value.replace(/\r\n?/g, "\n"));
    expect(parse(rewritten)).toEqual(parse(text));
    verifyCodexInterruptHook(rewritten, installed);
    const restored = restoreCodexInterruptHook(rewritten, installed);
    expect(parse(restored)).toEqual(parse(original));
    verifyCodexInterruptHookRestored(restored);
    for (const modified of [
      rewritten.replace("timeout = 3", "timeout = 2"),
      rewritten.replace(JSON.stringify(installed.command), JSON.stringify("other-command")),
      rewritten.replace(installed.trustedHash, "sha256:changed"),
      rewritten + state,
      rewritten + `${ending}[hooks.state.${JSON.stringify(installed.stateKey)}.extra]${ending}enabled = true`,
    ]) {
      expect(modified).not.toBe(rewritten);
      expect(() => verifyCodexInterruptHook(modified, installed)).toThrow("changed after setup");
    }
  }
});

test("accepts a literal-quoted trust-state key while preserving another config path's trust entry", () => {
  const original = 'model = "example"\n';
  const installed = installCodexInterruptHook(original, "/Users/test/.codex/config.toml", { runtimeCommand: ["/opt/runtime"] });
  // Use the Windows key from #443 without depending on this test host's path resolver.
  const stateKey = String.raw`D:\AppData\Codex\UserData\config.toml:interrupt:0:0`;
  const beforeHeader = `[hooks.state.${JSON.stringify(installed.installed.stateKey)}]`;
  const journalHeader = `[hooks.state.${JSON.stringify(stateKey)}]`;
  const journal = {
    ...installed.installed,
    stateKey,
    fragment: installed.installed.fragment.replace(beforeHeader, journalHeader),
  };
  const alias = `[hooks.state.'C:\\Users\\test\\.codex\\config.toml:interrupt:0:0']\ntrusted_hash = ${JSON.stringify(journal.trustedHash)}\n`;
  for (const ending of ["\n", "\r\n"]) {
    const edited = installed.text.replace(beforeHeader, `[hooks.state.'${stateKey}']`)
      .replace(MANAGED_INTERRUPT_HOOK_END, alias + MANAGED_INTERRUPT_HOOK_END)
      .replaceAll("\n", ending);
    verifyCodexInterruptHook(edited, journal);
    expect(restoreCodexInterruptHook(edited, journal)).toBe((original + alias).replaceAll("\n", ending));
    for (const changed of [
      edited.replace("timeout = 3", "timeout = 2"),
      edited.replace(journal.trustedHash, "sha256:changed"),
      edited.replace(`[hooks.state.'${stateKey}']`, "[hooks.state.'different-key']"),
      edited + `\n[hooks.state.'${stateKey}'.extra]\nchanged = true\n`,
    ]) {
      expect(() => verifyCodexInterruptHook(changed, journal)).toThrow("changed after setup");
    }
  }
});
