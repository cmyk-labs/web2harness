export function mcpScope(tunnelId: string, connectorName?: string): string;
export function currentMcpScope(config?: { mode?: string; browserInteractionMode?: string; tunnel?: { tunnelId?: string }; automaticAppName?: string }): string | null;
