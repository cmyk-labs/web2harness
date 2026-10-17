import { isAbsolute } from "node:path";
import { interruptHookCommand } from "./interrupt-command";

// Interrupt has a native three-second deadline. Avoid loading browser/server/CLI commands
// before acknowledging it; both source and packaged runtimes use the same implementation.
async function main(): Promise<void> {
  const [flag, home, command, action, ...extra] = process.argv.slice(2);
  if (flag !== "--home" || !home || !isAbsolute(home) || command !== "hook" || action !== "interrupt") {
    throw new Error("Interrupt entry requires --home ABSOLUTE_PATH hook interrupt");
  }
  process.env.WEB2HARNESS_HOME = home;
  await interruptHookCommand(extra);
}

main().catch(error => {
  process.stderr.write(`web2harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
