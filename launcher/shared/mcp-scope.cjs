const { createHash } = require("node:crypto");

function mcpScope(tunnelId, connectorName) {
  return createHash("sha256").update(JSON.stringify([tunnelId, connectorName])).digest("hex");
}

function currentMcpScope(config) {
  if (config?.mode !== "mcp-bridge" || config.browserInteractionMode === "manual"
    || !config.tunnel?.tunnelId || !config.automaticAppName) return null;
  return mcpScope(config.tunnel.tunnelId, config.automaticAppName);
}

module.exports = { mcpScope, currentMcpScope };
