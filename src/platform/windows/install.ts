import { homedir } from "node:os";
const { beginInstall, commitInstall, rollbackInstall } = require("../../../launcher/electron/installation/windows-install.cjs");
const { assertLauncherClosed, stopOwnedRuntime } = require("../../../launcher/electron/installation/windows-uninstall.cjs");
const { captureRegistration, restoreRegistration } = require("../../../launcher/electron/installation/windows-registration.cjs");
const { setShortcutIcons } = require("../../../launcher/electron/installation/windows-shortcuts.cjs");
const { createSetupReporter } = require("../../../launcher/electron/installation/setup-progress.cjs");
const { redactText } = require("../../../launcher/electron/logging.cjs");

// Unicode NSIS detects UTF-16LE. UTF-8 would be decoded using the Windows ANSI
// codepage and corrupt Chinese progress text on many machines.
const nsisOutput = process.argv.includes("--nsis-output");
let firstOutput = true;
const write = (line: string): void => {
  if (nsisOutput) process.stdout.write(Buffer.from((firstOutput ? "\uFEFF" : "") + line, "utf16le"));
  else process.stdout.write(line);
  firstOutput = false;
};

async function main(): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows setup helper only");
  const args = process.argv.slice(2);
  const command = args.shift();
  if (nsisOutput) args.splice(args.indexOf("--nsis-output"), 1);
  const commands = { begin: beginInstall, commit: commitInstall, rollback: rollbackInstall };
  if (!command || !Object.hasOwn(commands, command)) throw new Error("Expected begin, commit or rollback");
  const values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift()!;
    if (!["--install-root", "--app-data", "--local-app-data", "--owner-pid", "--version", "--shortcut-icon-source", "--language"].includes(key)
      || values[key] !== undefined || !args.length) throw new Error("Invalid setup arguments");
    values[key] = args.shift()!;
  }
  const options = { installRoot: values["--install-root"], appData: values["--app-data"], localAppData: values["--local-app-data"],
    ownerPid: Number(values["--owner-pid"]), version: values["--version"], homeDir: homedir(),
    shortcutIconSource: values["--shortcut-icon-source"], language: values["--language"] === "2052" ? "zh-CN" : "en" };
  const logger = Object.fromEntries(["info", "warn", "error"].map(level => [level, (event: string) => write(`${event}\n`)]));
  await commands[command as keyof typeof commands](options, {
    assertLauncherClosed, captureRegistration, restoreRegistration, setShortcutIcons,
    stopRuntime: (record: { coreHome: string; codexHome: string }) => {
      process.env.WEB2HARNESS_HOME = record.coreHome;
      process.env.CODEX_HOME = record.codexHome;
      return stopOwnedRuntime(record, logger);
    },
    onProgress: createSetupReporter(options, write),
  });
}

void main().catch(error => {
  write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
