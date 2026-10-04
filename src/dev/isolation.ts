import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defaultBrokerEndpoint, expandUserPath, getConfigDir, type AppConfig } from "../config";

// Resolve existing ancestors as well: a not-yet-created directory under a junction is not isolated.
export function canonicalDevPath(value: string): string {
  let current = resolve(expandUserPath(value));
  const tail: string[] = [];
  while (!existsSync(current) && dirname(current) !== current) {
    tail.unshift(basename(current));
    current = dirname(current);
  }
  const result = join(realpathSync(current), ...tail);
  return process.platform === "win32" ? result.toLowerCase() : result;
}

export function devPathContains(parent: string, child: string): boolean {
  const suffix = relative(canonicalDevPath(parent), canonicalDevPath(child));
  return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

export function assertSeparateDevHome(home: string, productionPaths: string[]): void {
  for (const production of productionPaths) {
    if (devPathContains(home, production) || devPathContains(production, home)) {
      throw new Error("DEV profile home must differ from the production directories and must not overlap them");
    }
  }
}

/** Gate the production setup/server implementation before any DEV writes, binds or tool turns. */
export function assertDevRuntimeIsolation(config?: AppConfig): string {
  const home = process.env.WEB2HARNESS_DEV_HOME;
  if (!home) throw new Error("DEV runtime requires an explicit isolated DEV home");
  assertSeparateDevHome(home, [
    join(homedir(), ".codex"),
    join(homedir(), ".web2harness"),
    ...(process.env.APPDATA ? [join(process.env.APPDATA, "Web2Harness")] : []),
  ]);
  if (canonicalDevPath(getConfigDir()) !== canonicalDevPath(home)
    || !process.env.CODEX_HOME
    || canonicalDevPath(process.env.CODEX_HOME) !== canonicalDevPath(join(home, "codex-home"))) {
    throw new Error("DEV runtime requires isolated bridge and Codex configuration directories");
  }
  for (const path of ["config.json", "codex-home", "codex-home/config.toml", "codex", "runtime", "browser", "launcher"]) {
    if (!devPathContains(home, join(home, path))) throw new Error(`DEV path escapes its isolated home: ${path}`);
  }
  if (config) {
    if (config.purpose !== "dev-harness" || config.browserHost !== "launcher"
      || config.host !== "127.0.0.1" || config.port === 17841
      || !config.browserHostDescriptorPath
      || canonicalDevPath(config.browserHostDescriptorPath) !== canonicalDevPath(join(home, "runtime", "launcher-browser.json"))
      || config.brokerSocketPath !== defaultBrokerEndpoint(home)
      || !devPathContains(home, config.storageStatePath)) {
      throw new Error("DEV runtime configuration is not isolated; rerun DEV setup");
    }
    for (const tunnel of [config.tunnel, config.automaticTunnel, config.manualTunnel]) {
      if (tunnel && (!devPathContains(home, tunnel.runtimeKeyFile) || !devPathContains(home, tunnel.profileDir))) {
        throw new Error("DEV tunnel data must stay inside its isolated home");
      }
    }
  }
  return home;
}
