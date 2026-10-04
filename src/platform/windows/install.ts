import { homedir } from "node:os";
const { beginInstall, commitInstall, rollbackInstall } = require("../../../launcher/electron/installation/windows-install.cjs");
const { assertLauncherClosed, stopOwnedRuntime } = require("../../../launcher/electron/installation/windows-uninstall.cjs");
const { captureRegistration, restoreRegistration } = require("../../../launcher/electron/installation/windows-registration.cjs");
const { redactText } = require("../../../launcher/electron/logging.cjs");

async function main(): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows setup helper only");
  const args = process.argv.slice(2);
  const command = args.shift();
  const commands = { begin: beginInstall, commit: commitInstall, rollback: rollbackInstall };
  if (!command || !Object.hasOwn(commands, command)) throw new Error("Expected begin, commit or rollback");
  const values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift()!;
    if (!["--install-root", "--app-data", "--local-app-data", "--owner-pid", "--version"].includes(key)
      || values[key] !== undefined || !args.length) throw new Error("Invalid setup arguments");
    values[key] = args.shift()!;
  }
  const options = { installRoot: values["--install-root"], appData: values["--app-data"], localAppData: values["--local-app-data"],
    ownerPid: Number(values["--owner-pid"]), version: values["--version"], homeDir: homedir() };
  const logger = Object.fromEntries(["info", "warn", "error"].map(level => [level, (event: string) => process.stdout.write(`${event}\n`)]));
  await commands[command as keyof typeof commands](options, {
    assertLauncherClosed, captureRegistration, restoreRegistration,
    stopRuntime: (record: { coreHome: string; codexHome: string }) => {
      process.env.WEB2HARNESS_HOME = record.coreHome;
      process.env.CODEX_HOME = record.codexHome;
      return stopOwnedRuntime(record, logger);
    },
    onProgress: (progress: { stage: string; status: string }) => {
      if (progress.status === "completed") process.stdout.write(`${progress.stage}\n`);
    },
  });
}

void main().catch(error => {
  process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
