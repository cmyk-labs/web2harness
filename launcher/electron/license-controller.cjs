const { diagnosticError } = require("../shared/diagnostic-event.cjs");
const { spawn } = require("node:child_process");
const { embeddedRuntimeInvocation } = require("./runtime/runtime-command.cjs");

const STATES = new Set(["active", "missing", "expired", "invalid", "wrong-device", "clock-error", "device-unavailable", "unconfigured", "storage-error"]);

function createLicenseController({ app, sourceRoot, coreHome, log = () => {}, spawnChild = spawn }) {
  const waiters = new Set();
  let checking;
  let previousState;
  async function run(code) {
    if (code !== undefined && (typeof code !== "string" || !code.trim() || Buffer.byteLength(code) > 8192)) throw new Error("Invalid license input");
    const invocation = embeddedRuntimeInvocation({ app, sourceRoot,
      args: ["--home", coreHome, "license", ...(code === undefined ? ["status", "--json"] : ["import", "--stdin"])] });
    const started = performance.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawnChild(invocation.executable, invocation.args, { cwd: invocation.cwd,
        env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let output = "", bytes = 0, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => { child.kill(); finish(new Error("License verification timed out")); }, 20_000);
      child.once("error", () => finish(new Error("Unable to start license verification")));
      child.stdout.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 16_384) { child.kill(); finish(new Error("Invalid license verifier response")); }
        else output += chunk.toString();
      });
      // Neither stdout/stderr nor submitted credentials go into the application's logs.
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.stdin.end(code || "");
      child.once("close", exitCode => {
        try {
          const status = JSON.parse(output);
          if (!STATES.has(status.state) || (status.deviceCode !== null && typeof status.deviceCode !== "string")
            || (status.state === "active" && exitCode !== 0)) throw new Error();
          finish(null, status);
        } catch { finish(new Error("Unable to read license verification result")); }
      });
    }).catch(error => {
      try { log("error", "launcher.license_verification_failed", { operation: code === undefined ? "verify" : "import", error: diagnosticError(error), durationMs: Math.round(performance.now() - started) }); } catch {}
      throw error;
    });
    if (code !== undefined || previousState !== result.state) try { log(result.state === "active" ? "info" : "warning", "launcher.license_state", { previous: previousState ?? "unknown", status: result.state, operation: code === undefined ? "verify" : "import", durationMs: Math.round(performance.now() - started) }); } catch {}
    previousState = result.state;
    if (result.state === "active") { for (const resolve of waiters) resolve(); waiters.clear(); }
    return result;
  }
  const status = () => checking ??= run().finally(() => { checking = undefined; });
  return {
    status,
    assertActive: async () => {
      const result = await status();
      if (result.state !== "active") throw new Error(`Web2Harness license: ${result.state}. Open License to activate.`);
    },
    import: code => run(code),
    waitForActivation: () => new Promise((resolve, reject) => {
      waiters.add(resolve);
      status().catch(error => { waiters.delete(resolve); reject(error); });
    }),
  };
}

module.exports = { createLicenseController };
