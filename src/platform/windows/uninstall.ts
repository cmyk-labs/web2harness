import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { getCodexConfigPath, getCodexJournalPath, getCodexJournalRecoveryPath } from "../../codex/integration-shared";
import { preflightUninstallCodexIntegration, uninstallCodexIntegration } from "../../codex/integration";
const { prepareUninstall, finishUninstall, assertLauncherClosed, removeAutostart, stopOwnedRuntime } = require("../../../launcher/electron/installation/windows-uninstall.cjs");
const { redactText } = require("../../../launcher/electron/logging.cjs");

type Profile = { coreHome: string; codexHome: string };
function selectProfile(record: Profile): void {
  process.env.WEB2HARNESS_HOME = record.coreHome;
  process.env.CODEX_HOME = record.codexHome;
}

async function main(): Promise<void> {
  if (process.platform !== "win32") throw new Error("This helper is for Windows uninstall only");
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!["prepare", "finish"].includes(command || "")) throw new Error("Expected prepare or finish");
  const values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift()!;
    if (!["--install-root", "--app-data", "--local-app-data", "--owner-pid", "--purge"].includes(key) || values[key] !== undefined || !args.length) {
      throw new Error("Invalid uninstaller arguments");
    }
    values[key] = args.shift()!;
  }
  if (!values["--install-root"] || !isAbsolute(values["--install-root"])
    || !values["--app-data"] || !isAbsolute(values["--app-data"])
    || !values["--local-app-data"] || !isAbsolute(values["--local-app-data"])) throw new Error("Explicit absolute installation paths are required");
  if (values["--purge"] !== undefined && !["0", "1"].includes(values["--purge"])) throw new Error("Invalid cleanup choice");
  const options = { installRoot: values["--install-root"], appData: values["--app-data"],
    localAppData: values["--local-app-data"], homeDir: homedir(),
    ownerPid: Number(values["--owner-pid"]), purge: values["--purge"] === "1" };
  if (command === "finish") { finishUninstall(options); return; }
  const logger = Object.fromEntries(["info", "warn", "error"].map(level => [level, (event: string) => process.stdout.write(`${event}\n`)]));
  await prepareUninstall(options, {
    assertLauncherClosed, removeAutostart,
    stopRuntime: (record: Profile) => stopOwnedRuntime(record, logger),
    preflightIntegration(record: Profile) {
      selectProfile(record);
      if (!existsSync(getCodexJournalPath()) && !existsSync(getCodexJournalRecoveryPath())
        && existsSync(getCodexConfigPath()) && /# Managed by web2harness/.test(readFileSync(getCodexConfigPath(), "utf8"))) {
        throw new Error("Codex still has Web2Harness configuration but its restoration record is missing. Repair the integration before uninstalling.");
      }
      preflightUninstallCodexIntegration();
    },
    removeIntegration(record: Profile) { selectProfile(record); uninstallCodexIntegration(); },
  });
}

void main().catch(error => {
  process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
