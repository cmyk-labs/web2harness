import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ChatGptBrowserDiagnostics, persistChatGptResponseEvidence, pruneBrowserDiagnostics } from "../../../../src/adapters/chatgpt-web/browser/browser-diagnostics";

function fixture(run: (root: string) => void): void {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, "web2harness-evidence-retention-"));
  try { run(root); } finally {
    if (dirname(resolve(root)) !== parent || !basename(root).startsWith("web2harness-evidence-retention-")) throw Error("Unexpected fixture owner");
    rmSync(root, { recursive: true, force: true });
  }
}

test("failed UI checkpoints survive ordinary rotation with sanitized state", async () => {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, "web2harness-evidence-retention-"));
  try {
    const diagnostics = new ChatGptBrowserDiagnostics("fixture-failure", root, "fixture-app");
    const page = { evaluate: async () => ({ composer: { visibleCount: 1, textChars: [20] }, privateText: "must not persist" }),
      screenshot: async () => undefined };
    await diagnostics.capture(page as never, "turn-failed", new DOMException("cancelled", "AbortError"));
    await diagnostics.capture(page as never, "turn-failed", Object.assign(new Error("cancelled"), { code: "client_cancelled" }));
    expect(readdirSync(root).filter(name => name.startsWith("response-source-"))).toEqual([]);
    await diagnostics.capture(page as never, "turn-failed", new Error("send preflight timed out"));
    const archived = join(root, "response-source-00", "browser-failure.private.json");
    expect(JSON.parse(readFileSync(archived, "utf8"))).toMatchObject({ checkpoint: "turn-failed",
      error: "send preflight timed out", state: { composer: { visibleCount: 1, textChars: [20] } } });
    expect(readFileSync(archived, "utf8")).not.toContain("must not persist");
    for (let i = 0; i < 20; i++) mkdirSync(join(root, `later-${i}-abcdef12`));
    pruneBrowserDiagnostics(root);
    expect(existsSync(archived)).toBeTrue();
  } finally {
    if (dirname(resolve(root)) !== parent || !basename(root).startsWith("web2harness-evidence-retention-")) throw Error("Unexpected fixture owner");
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary trace rotation preserves current and legacy source failures and unrelated directories", () => fixture(root => {
  const first = persistChatGptResponseEvidence(root, { version: 1, publicAnswer: "first exact failure" });
  const dom = persistChatGptResponseEvidence(root, { publicAnswer: "DOM buffer failure" }, "response-dom.private.json");
  const legacy = join(root, "response-source-123456789abcdef0-abcdef12"), unrelated = join(root, "user-evidence");
  for (const directory of [legacy, unrelated]) { mkdirSync(directory); writeFileSync(join(directory, "keep.txt"), "keep"); }
  for (let i = 0; i < 25; i++) {
    const directory = join(root, `normal-${String(i).padStart(3, "0")}-abcdef12`);
    mkdirSync(directory); utimesSync(directory, i + 1, i + 1);
  }
  pruneBrowserDiagnostics(root);
  expect(JSON.parse(readFileSync(join(root, first), "utf8")).publicAnswer).toBe("first exact failure");
  expect(JSON.parse(readFileSync(join(root, dom), "utf8")).publicAnswer).toBe("DOM buffer failure");
  expect(readFileSync(join(legacy, "keep.txt"), "utf8")).toBe("keep");
  expect(readFileSync(join(unrelated, "keep.txt"), "utf8")).toBe("keep");
  expect(readdirSync(root).filter(name => name.startsWith("normal-"))).toHaveLength(10);
}));

test("failure archive stops at its bounded capacity without overwriting the earliest evidence", () => fixture(root => {
  const paths = Array.from({ length: 64 }, (_, sequence) => persistChatGptResponseEvidence(root, { sequence }));
  expect(new Set(paths).size).toBe(64);
  expect(() => persistChatGptResponseEvidence(root, { sequence: 64 })).toThrow("archive is full");
  expect(JSON.parse(readFileSync(join(root, paths[0]!), "utf8"))).toEqual({ sequence: 0 });
  expect(() => persistChatGptResponseEvidence(root, { large: "x".repeat(4 * 1024 * 1024) })).toThrow("archive budget");
  expect(readdirSync(root)).toHaveLength(64);
}));

test("opt-in delivery evidence has independent bounded slots and survives ordinary trace cleanup", () => fixture(root => {
  const success = persistChatGptResponseEvidence(root, { delivered: "exact public answer" }, "response-delivery.private.json");
  expect(success).toBe("response-delivery-00/response-delivery.private.json");
  for (let i = 1; i < 64; i++) persistChatGptResponseEvidence(root, { index: i }, "response-delivery.private.json");
  expect(() => persistChatGptResponseEvidence(root, {}, "response-delivery.private.json")).toThrow("archive is full");
  expect(persistChatGptResponseEvidence(root, { failure: true })).toBe("response-source-00/response-source.private.json");
  pruneBrowserDiagnostics(root);
  expect(JSON.parse(readFileSync(join(root, success), "utf8"))).toEqual({ delivered: "exact public answer" });
}));

test("rotation and archive reservation do not follow existing directory links", () => fixture(root => {
  const diagnostics = join(root, "diagnostics"), protectedDirectory = join(root, "protected");
  mkdirSync(diagnostics); mkdirSync(protectedDirectory);
  writeFileSync(join(protectedDirectory, "keep.txt"), "keep");
  symlinkSync(protectedDirectory, join(diagnostics, "normal-linked-abcdef12"), process.platform === "win32" ? "junction" : "dir");
  symlinkSync(protectedDirectory, join(diagnostics, "response-source-00"), process.platform === "win32" ? "junction" : "dir");
  for (let i = 0; i < 12; i++) mkdirSync(join(diagnostics, `normal-${i}-abcdef12`));
  pruneBrowserDiagnostics(diagnostics);
  const reference = persistChatGptResponseEvidence(diagnostics, { owned: true });
  expect(reference).toBe("response-source-01/response-source.private.json");
  expect(readFileSync(join(protectedDirectory, "keep.txt"), "utf8")).toBe("keep");
  expect(existsSync(join(protectedDirectory, "response-source.private.json"))).toBe(false);
}));
