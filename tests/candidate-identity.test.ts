import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { candidateIdentity } from "../launcher/shared/candidate-identity.cjs";

test("candidate includes untracked source and is stable across line endings and historical evidence", () => {
  const temporaryRoot = resolve(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, "w2h-candidate-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
    git("init");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), '{"version":"1.0.0"}\n');
    writeFileSync(join(root, "src/cli.ts"), "export const answer = 1;\n");
    mkdirSync(join(root, "launcher"));
    const packagingText = {
      "installer.nsh": "Section\nSectionEnd\n",
      "runtime.patch": "--- original\n+++ updated\n@@ -1 +1 @@\n-old\n+new\n",
    };
    for (const [name, content] of Object.entries(packagingText)) writeFileSync(join(root, "launcher", name), content);
    git("add", "package.json", "src/cli.ts", "launcher");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
    const initial = candidateIdentity(root);
    writeFileSync(join(root, "src/cli.ts"), "export const answer = 1;\r\n");
    expect(candidateIdentity(root).sourceId).toBe(initial.sourceId);
    for (const [name, content] of Object.entries(packagingText)) {
      writeFileSync(join(root, "launcher", name), content.replaceAll("\n", "\r\n"));
      expect(candidateIdentity(root).sourceId).toBe(initial.sourceId);
      writeFileSync(join(root, "launcher", name), `${content}; changed content\n`);
      expect(candidateIdentity(root).sourceId).not.toBe(initial.sourceId);
      writeFileSync(join(root, "launcher", name), content);
    }
    mkdirSync(join(root, ".github/acceptance"), { recursive: true });
    writeFileSync(join(root, ".github/acceptance/current.json"), "{}");
    expect(candidateIdentity(root).sourceId).toBe(initial.sourceId);
    writeFileSync(join(root, "src/new.ts"), "export const added = true;");
    const changed = candidateIdentity(root);
    expect(changed.sourceId).not.toBe(initial.sourceId);
    expect(changed.files.some(file => file.path === "src/new.ts")).toBeTrue();
  } finally {
    if (dirname(resolve(root)) !== temporaryRoot || !resolve(root).startsWith(join(temporaryRoot, "w2h-candidate-"))) {
      throw new Error("Fixture ownership lost");
    }
    rmSync(root, { recursive: true });
  }
// This integration fixture starts Git repeatedly; hosted Windows runners can exceed
// Bun's five-second default without violating any candidate-identity invariant.
}, 30_000);
