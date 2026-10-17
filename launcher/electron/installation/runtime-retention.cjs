const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { assertPlainPath } = require("./installation-record.cjs");
const { validateRuntimeBundle } = require("./runtime-install.cjs");

const normalized = value => value.replace(/\\\\/g, "\\").replace(/\\/g, "/").toLowerCase();
function readSmall(file, limit = 4 * 1024 * 1024) {
  assertPlainPath(file);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new Error("Unsafe retention reference");
    return fs.readFileSync(file, "utf8");
  } catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

// Collected only inside the background worker, never logged or sent to the renderer.
function processReferences() {
  if (process.platform !== "win32") {
    const commands = execFileSync("ps", ["-axww", "-o", "pid=,comm=,args="], { encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    if (process.platform === "darwin") {
      // Include relative invocations and open executable mappings, not just argv text.
      return commands + execFileSync("/usr/sbin/lsof", ["-n", "-P", "-a", "-u", String(process.getuid()), "-d", "cwd,txt", "-F", "n"], {
        encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024,
      });
    }
    const paths = [];
    for (const line of commands.split("\n")) {
      const match = /^\s*(\d+)\s+(\S+)\s+/.exec(line);
      if (!match || !/(?:^|\/)(?:bun|node|web2harness)$/i.test(match[2])) continue;
      try { paths.push(fs.readlinkSync(`/proc/${match[1]}/exe`), fs.readlinkSync(`/proc/${match[1]}/cwd`)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return commands + "\n" + paths.join("\n");
  }
  const shell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Select-Object Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress";
  const records = JSON.parse(execFileSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
  }).replace(/^\uFEFF/, ""));
  if (!Array.isArray(records) || !records.length) throw new Error("Process inventory unavailable");
  if (records.some(row => /^(?:bun|node|Web2Harness)\.exe$/i.test(row.Name)
    && (!row.ExecutablePath || !row.CommandLine))) throw new Error("Runtime process identity unavailable");
  return records.map(row => `${row.ExecutablePath || ""}\n${row.CommandLine || ""}`).join("\n");
}

function recoveryReferences({ coreHome, codexHome, appData, serviceDefinitions = [] }, names) {
  const versions = path.join(coreHome, "versions");
  // In-progress and interrupted runtime replacements retain their original evidence.
  if (fs.readdirSync(versions).some(name => /\.(?:tmp-|previous-)/.test(name))) {
    throw new Error("Runtime replacement requires recovery");
  }
  const installationRoot = path.join(appData, "Web2Harness-installations");
  assertPlainPath(installationRoot);
  if (fs.existsSync(installationRoot)) {
    for (const entry of fs.readdirSync(installationRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Installation inventory unavailable");
      // Any pending setup may restore an older application pointing to this core home.
      // Defer collection rather than trying to interpret a partially written journal.
      if (fs.existsSync(path.join(installationRoot, entry.name, "setup-transaction"))) {
        throw new Error("Installation recovery pending");
      }
    }
  }
  const references = [];
  for (const file of ["config.json", "codex/integration-journal.json", "codex/integration-journal.recovery.json"]) {
    references.push(readSmall(path.join(coreHome, file)));
  }
  for (const file of ["config.toml", "hooks.json"]) references.push(readSmall(path.join(codexHome, file)));
  for (const file of serviceDefinitions) references.push(readSmall(file));
  const text = normalized(references.join("\n"));
  return names.filter(name => text.includes(normalized(name)));
}

function inspectPlainTree(directory, root = fs.realpathSync(directory)) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const relative = path.relative(root, fs.realpathSync(file));
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
        || !fs.statSync(file).isFile()) throw new Error("Runtime contains redirected entries");
      continue; // Package-manager executable links within this validated bundle are safe to unlink.
    }
    if (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) {
      throw new Error("Runtime contains redirected or unrecognized entries");
    }
    if (stat.isDirectory()) inspectPlainTree(file, root);
  }
}

function collectRuntimeVersions(options, dependencies = {}) {
  const { coreHome, currentRoot, platform = process.platform, arch = process.arch } = options;
  const root = path.resolve(coreHome, "versions");
  const result = { removed: [], retained: [], skipped: [], deferred: null };
  try {
    assertPlainPath(root);
    if (path.dirname(path.resolve(currentRoot)) !== root) throw new Error("Current runtime is outside the version store");
    const currentName = path.basename(currentRoot);
    const candidates = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const suffix = `-${platform}-${arch}`;
      if (!entry.name.endsWith(suffix)) continue;
      const version = entry.name.slice(0, -suffix.length);
      if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) continue;
      const directory = path.join(root, entry.name);
      try {
        const manifest = JSON.parse(readSmall(path.join(directory, "manifest.json")));
        const receiptText = readSmall(directory + ".verified.json");
        const receipt = receiptText ? JSON.parse(receiptText) : null;
        if (manifest.schemaVersion !== 2 || manifest.appVersion !== version || manifest.platform !== platform || manifest.arch !== arch
          || (receipt && (receipt.schemaVersion !== 1 || !Number.isFinite(Date.parse(receipt.verifiedAt))
          || receipt.appVersion !== version || receipt.platform !== platform || receipt.arch !== arch
          || receipt.bundleId !== manifest.bundleId))) throw new Error("Unverified runtime");
        if (entry.name === currentName && !receipt) throw new Error("Current receipt missing");
        // Legacy bundles predate startup receipts; full manifest verification is still mandatory below.
        candidates.push({ name: entry.name, directory, version,
          at: receipt ? Date.parse(receipt.verifiedAt) : fs.statSync(path.join(directory, "manifest.json")).mtimeMs,
          bundleId: manifest.bundleId });
      } catch { result.skipped.push(entry.name); }
    }
    if (!candidates.some(item => item.name === currentName)) throw new Error("Current runtime has no verified installation receipt");
    result.retained.push(currentName);
    if (candidates.length <= 2) { result.retained.push(...candidates.filter(item => item.name !== currentName).map(item => item.name)); return result; }
    const references = dependencies.processReferences || processReferences;
    const recovery = () => recoveryReferences(options, candidates.map(item => item.name));
    let active = normalized(references());
    const protectedNames = new Set(recovery());
    // A receipt's installation time records actual rollback order, including downgrades.
    let rollback;
    for (const candidate of candidates.filter(item => item.name !== currentName).sort((a, b) => b.at - a.at || b.name.localeCompare(a.name))) {
      try {
        inspectPlainTree(candidate.directory);
        validateRuntimeBundle(candidate.directory, { version: candidate.version, platform, arch, bundleId: candidate.bundleId });
      } catch { result.skipped.push(candidate.name); continue; }
      if (!rollback) { rollback = candidate; result.retained.push(candidate.name); continue; }
      // Recheck references immediately before each destructive operation, after validation.
      active = normalized(references());
      for (const name of recovery()) protectedNames.add(name);
      if (protectedNames.has(candidate.name) || active.includes(normalized(candidate.directory))
        || active.includes(candidate.name.toLowerCase())) { result.retained.push(candidate.name); continue; }
      assertPlainPath(candidate.directory);
      if (path.dirname(fs.realpathSync(candidate.directory)) !== fs.realpathSync(root)) throw new Error("Runtime escaped version store");
      fs.rmSync(candidate.directory, { recursive: true });
      fs.rmSync(candidate.directory + ".verified.json", { force: true });
      result.removed.push(candidate.name);
    }
  } catch (error) { result.deferred = error.code || error.message; }
  return result;
}
module.exports = { collectRuntimeVersions, processReferences };
