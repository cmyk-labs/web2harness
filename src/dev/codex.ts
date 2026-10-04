import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { assertDevRuntimeIsolation, devPathContains } from "./isolation";
import type { DevProfilePaths } from "./profile";

/** Resolve npm shims without shell interpolation (particularly .cmd on Windows). */
export function devCodexCommand(environment: NodeJS.ProcessEnv = process.env): string[] {
  const executable = environment.WEB2HARNESS_CODEX_EXECUTABLE?.trim()
    || Bun.which("codex", { PATH: environment.PATH || environment.Path });
  if (!executable) throw new Error("Codex CLI was not found; set WEB2HARNESS_CODEX_EXECUTABLE to its executable");
  const extension = extname(executable).toLowerCase();
  if ([".cmd", ".bat", ".ps1"].includes(extension)) {
    const entry = join(dirname(executable), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (!existsSync(entry)) throw new Error("Unsupported Codex shell shim; set WEB2HARNESS_CODEX_EXECUTABLE to the native Codex executable");
    const node = Bun.which("node");
    if (!node) throw new Error("The npm Codex CLI requires Node");
    return [node, entry];
  }
  return extension === ".js" || extension === ".mjs" ? [Bun.which("node") || process.execPath, executable] : [executable];
}

export function devCodexEnvironment(paths: DevProfilePaths, environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...environment };
  // No inherited active-task identity, route override, or credential may bridge back to production.
  for (const key of Object.keys(env)) {
    if (/^CODEX_/.test(key) || /^(OPENAI_API_KEY|OPENAI_BASE_URL|CHATGPT_BASE_URL|ELECTRON_RUN_AS_NODE)$/.test(key)) delete env[key];
  }
  return {
    ...env,
    WEB2HARNESS_DEV_HOME: paths.home,
    WEB2HARNESS_HOME: paths.home,
    CODEX_HOME: paths.codexHome,
  };
}

/** Run the installed, real Codex agent. This module never executes tools on its behalf. */
export async function runDevCodex(paths: DevProfilePaths, args: string[], workspace = join(paths.home, "workspace")): Promise<number> {
  assertDevRuntimeIsolation();
  if (!devPathContains(paths.home, workspace)) throw new Error("DEV default workspace escapes its isolated home");
  const command = devCodexCommand();
  mkdirSync(paths.codexHome, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const env = devCodexEnvironment(paths);
  // File credentials keep a DEV login/logout from changing a shared OS keychain entry.
  const child = spawn(command[0]!, [
    ...command.slice(1), "-c", 'cli_auth_credentials_store="file"', ...args,
  ], { cwd: resolve(workspace), env, stdio: "inherit", windowsHide: true });
  const interrupt = () => { if (child.exitCode === null) child.kill("SIGINT"); };
  const terminate = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await new Promise<number>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => resolveExit(code ?? (signal === "SIGINT" ? 130 : 1)));
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

