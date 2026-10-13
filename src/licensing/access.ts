// Read-only inspection, activation and stopping/removing work remain available.
// All other CLI commands must verify before they touch configuration or services.
export function cliCommandRequiresLicense(command: string, args: string[]): boolean {
  if (["help", "license", "doctor", "status", "open", "uninstall", "dev", "mcp"].includes(command)) return false;
  // MCP stdio only transports calls for an existing broker-bound turn. License
  // admission belongs to that broker's register/registerSafe in its own home;
  // tunnel processes need not inherit the launcher's environment. Keeping the
  // transport available also lets already admitted turns deliver results/close.
  const action = args[0] ?? "status";
  if (command === "route") return !["status", "disconnect"].includes(action);
  if (command === "subagents") return action !== "status";
  if (command === "service") return !["status", "stop", "cancel-turns"].includes(action);
  if (command === "tunnel") return !["status", "stop"].includes(action);
  if (command === "hook") return action !== "interrupt";
  return true;
}
