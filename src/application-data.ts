import { readdirSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve, parse } from "node:path";

/** Integration data and installed executable versions have independent lifetimes. */
export function removeApplicationData(home: string, preserveRuntime = false): void {
  const root = resolve(home);
  if (!isAbsolute(home) || root === parse(root).root) {
    throw new Error("Application data cleanup requires an explicit non-root directory");
  }
  if (!preserveRuntime) {
    rmSync(root, { recursive: true, force: true });
    return;
  }
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === "versions" || entry.name === ".web2harness-owner.json" || entry.name === "licensing") continue;
    // Names come from this directory, never from configuration or user input.
    rmSync(join(root, entry.name), { recursive: true, force: true });
  }
}
