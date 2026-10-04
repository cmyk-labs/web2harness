const fs = require('node:fs');
const path = require('node:path');

// Read only the current launcher's managed files, and expose no config or credential contents.
function workspaceStatus(runtimeHost) {
  const current = runtimeHost.runtimeConfigSnapshot();
  let runtimeStatus = 'unknown';
  try {
    const state = runtimeHost.supervisor.readState();
    if (state?.ownerPid === process.pid) runtimeStatus = state.status;
  } catch { /* An unreadable ownership record is unknown, never healthy. */ }
  return {
    configured: current.configured, mode: current.configured ? current.mode : null,
    interactionMode: current.config?.browserInteractionMode ?? runtimeHost.browserInteractionMode(),
    runtimeStatus,
    capabilities: current.configured ? {
      solAvailable: current.config?.solAvailable !== false,
      extraHighAvailable: current.config?.extraHighAvailable === true,
      proAvailable: current.config?.proAvailable === true,
      experimentalContextFiles: current.config?.experimentalContextFiles === true,
      experimentalContextTripleBudget: current.config?.experimentalContextFiles === true && current.config?.experimentalContextTripleBudget === true,
      browserInteractionMode: current.config?.browserInteractionMode ?? "automatic",
      zeroRiskProEnabled: current.config?.zeroRiskProEnabled === true,
    } : null,
    credentials: { automatic: runtimeHost.mcpCredentialsConfigured('automatic'), manual: runtimeHost.mcpCredentialsConfigured('manual') },
  };
}

function readRuntimeKeyFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Choose an absolute runtime key file path');
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 20 || stat.size > 16384) throw new Error('Invalid runtime key file');
  const value = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  if (value.length < 20 || /[\r\n]/.test(value)) throw new Error('Runtime key file must contain a single key');
  return value;
}
module.exports = { workspaceStatus, readRuntimeKeyFile };
