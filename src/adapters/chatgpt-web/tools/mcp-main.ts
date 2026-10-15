import { defaultBrokerEndpoint, resolveBrokerEndpoint } from "../../../config";
import { runChatGptMcpServer, type ChatGptMcpContract } from "./mcp-server";
import { TOOL_BATCH_HANDOFF_PROTOCOL } from "./tool-batch-handoff";

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export async function runChatGptMcpMain(args: string[]): Promise<void> {
  const remaining = [...args];
  const brokerSocketPath = resolveBrokerEndpoint(option(remaining, "--broker-socket", defaultBrokerEndpoint()));
  const requestedContract = option(remaining, "--contract", "native");
  const protocol = option(remaining, "--protocol", "synchronous");
  if (protocol !== "synchronous" && protocol !== TOOL_BATCH_HANDOFF_PROTOCOL) {
    throw new Error(`Unsupported MCP protocol: ${protocol}`);
  }
  if (requestedContract !== "native" && requestedContract !== "safe") {
    throw new Error(`--contract must be native or safe, received ${requestedContract}`);
  }
  if (remaining.length > 0) throw new Error(`Unknown MCP arguments: ${remaining.join(" ")}`);
  await runChatGptMcpServer({
    brokerSocketPath,
    contract: requestedContract as ChatGptMcpContract,
    ...(protocol === TOOL_BATCH_HANDOFF_PROTOCOL ? { protocol } : {}),
  });
}
