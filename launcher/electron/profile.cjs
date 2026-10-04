const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_PROFILE = "production";
const DEVELOPMENT_PROFILE = "development";

function resolveUserPath(value, homeDir = os.homedir()) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(homeDir, value.slice(2));
  }
  return path.resolve(value);
}

function canonicalPath(value) {
  let current = path.resolve(value);
  const tail = [];
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    tail.unshift(path.basename(current));
    current = path.dirname(current);
  }
  const result = path.join(fs.realpathSync(current), ...tail);
  return process.platform === "win32" ? result.toLowerCase() : result;
}

function contains(parent, child) {
  const suffix = path.relative(canonicalPath(parent), canonicalPath(child));
  return !suffix || (suffix !== ".." && !suffix.startsWith(".." + path.sep) && !path.isAbsolute(suffix));
}

function resolveLauncherProfile({
  argv = process.argv,
  env = process.env,
  homeDir = os.homedir(),
  appData,
} = {}) {
  if (typeof appData !== "string" || !path.isAbsolute(appData)) {
    throw new Error("Launcher profile resolution requires an absolute appData path");
  }
  const development = argv.includes("--dev-profile");
  if (!development) {
    const coreHome = env.WEB2HARNESS_HOME?.trim()
      ? resolveUserPath(env.WEB2HARNESS_HOME.trim(), homeDir)
      : path.join(homeDir, ".web2harness");
    const userData = env.WEB2HARNESS_LAUNCHER_DATA_DIR?.trim()
      ? resolveUserPath(env.WEB2HARNESS_LAUNCHER_DATA_DIR.trim(), homeDir)
      : path.join(appData, "Web2Harness");
    return {
      kind: PRODUCTION_PROFILE,
      displayName: "Web2Harness",
      coreHome,
      codexHome: env.CODEX_HOME?.trim()
        ? resolveUserPath(env.CODEX_HOME.trim(), homeDir)
        : path.join(homeDir, ".codex"),
      userData,
      browserPartition: "persist:web2harness-chatgpt",
    };
  }

  const coreHome = env.WEB2HARNESS_DEV_HOME?.trim()
    ? resolveUserPath(env.WEB2HARNESS_DEV_HOME.trim(), homeDir)
    : path.join(homeDir, ".web2harness-dev");
  const productionHome = env.WEB2HARNESS_HOME?.trim()
    ? resolveUserPath(env.WEB2HARNESS_HOME.trim(), homeDir)
    : path.join(homeDir, ".web2harness");
  const productionPaths = [productionHome, path.join(homeDir, ".web2harness"),
    path.join(homeDir, ".codex"), path.join(appData, "Web2Harness"),
    ...[env.CODEX_HOME, env.WEB2HARNESS_LAUNCHER_DATA_DIR].filter(Boolean).map(value => resolveUserPath(value, homeDir))];
  if (productionPaths.some(target => contains(coreHome, target) || contains(target, coreHome))) {
    throw new Error("DEV profile home must differ from the production directories and must not overlap them");
  }
  for (const child of ["launcher", "codex-home", "runtime", "config.json"]) {
    if (!contains(coreHome, path.join(coreHome, child))) throw new Error("DEV profile path escapes its home");
  }
  return {
    kind: DEVELOPMENT_PROFILE,
    displayName: "Web2Harness DEV",
    coreHome,
    codexHome: path.join(coreHome, "codex-home"),
    userData: path.join(coreHome, "launcher"),
    browserPartition: "persist:web2harness-dev-chatgpt",
  };
}

module.exports = {
  DEVELOPMENT_PROFILE,
  PRODUCTION_PROFILE,
  resolveLauncherProfile,
};
