import { RemoteTurnBroker } from "../adapters/chatgpt-web/tools/turn-broker";
import type { AppConfig } from "../config";
import { tunnelStatus, type TunnelRuntimeStatus } from "../runtime/tunnel";
import { DEV_CONFIG_PURPOSE } from "./constants";

interface DevTransportDependencies {
  status?: (config: AppConfig) => TunnelRuntimeStatus;
}

export interface DevChatTransport {
  config: AppConfig;
  broker: RemoteTurnBroker;
  close(): Promise<void>;
}

function assertDevTransportConfig(config: AppConfig): void {
  if (config.purpose !== DEV_CONFIG_PURPOSE) {
    throw new Error("Repository DEV transport requires an isolated dev-harness configuration");
  }
  if (config.mode !== "mcp-bridge" || !config.tunnel) {
    throw new Error("Repository DEV chat requires completed MCP Bridge tunnel credentials");
  }
}

/**
 * Attach a named repository DEV chat to the broker endpoint owned by the already-running isolated
 * launcher runtime. The daemon owns the broker and the launcher owns tunnel supervision.
 */
export async function startDevChatTransport(
  config: AppConfig,
  _devRoot: string,
  dependencies: DevTransportDependencies = {},
): Promise<DevChatTransport> {
  assertDevTransportConfig(config);
  const inspect = dependencies.status ?? tunnelStatus;
  const runtime = inspect(config);
  if (!runtime.ok || !runtime.ready) {
    throw new Error(
      `The launcher-owned DEV MCP tunnel is not ready: ${runtime.detail}. Open the DEV launcher and complete MCP setup first`,
    );
  }

  // The DEV daemon owns the broker, just as production does. A simulator is an outer client.
  const broker = new RemoteTurnBroker(config.brokerSocketPath);
  await broker.assertCompatible();
  const close = async (): Promise<void> => {};

  return { config, broker, close };
}
