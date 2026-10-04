"use strict";

// Keep retired persisted values at this boundary. Runtime consumers receive only current IDs.
const CURRENT_CONFIG_VERSION = 5;
const LEGACY_MCP_BRIDGE_MODE = "full";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Upgrade supported persisted schemas without mutating the caller or writing to disk.
 * Core validation remains authoritative; unknown schemas and invalid values are not repaired.
 * Setup may additionally upgrade the earliest browser-host schemas.
 */
function migrateRuntimeConfig(value, { forSetup = false } = {}) {
  if (!isRecord(value)) return value;
  let config = value;
  if (forSetup && config.version === 1 && config.mode === "pro-only") {
    config = { ...config, version: 2, mode: "browser-only" };
  }
  if (forSetup && config.version === 2) {
    config = { ...config, version: 3, browserHost: "managed-chrome" };
  }
  if (config.version !== 3 && config.version !== 4) return config;

  let mode = config.mode;
  if (config.version === 3 && mode === "browser-only") mode = "native-tools";
  if (mode === LEGACY_MCP_BRIDGE_MODE) mode = "mcp-bridge";
  return { ...config, version: CURRENT_CONFIG_VERSION, mode };
}

function needsRuntimeConfigMigration(value) {
  return migrateRuntimeConfig(value, { forSetup: true }) !== value;
}

module.exports = { CURRENT_CONFIG_VERSION, migrateRuntimeConfig, needsRuntimeConfigMigration };
