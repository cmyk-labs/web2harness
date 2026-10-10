import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicWriteFile, getConfigDir } from "../config";
import { getDeviceCode } from "./device";
import { CLOCK_TOLERANCE_MS, LicenseError, MAX_LICENSE_BYTES, type LicenseStatus, type TrustedLicenseKeys } from "./schema";
import { trustedLicenseKeys } from "./trusted-keys";
import { verifyLicense } from "./verify";

export interface LicenseContext {
  file?: string;
  keys?: TrustedLicenseKeys;
  device?: () => Promise<string>;
  now?: () => number;
}

export function licenseFile(): string {
  // Alternate files still require an authentic, device-bound signature; useful for
  // portable deployments and isolated test fixtures without copying credentials.
  return process.env.WEB2HARNESS_LICENSE_FILE
    ? resolve(process.env.WEB2HARNESS_LICENSE_FILE)
    : join(getConfigDir(), "licensing", "license.w2h");
}

function readSmallFile(file: string, limit: number): string {
  if (statSync(file).size > limit) throw new LicenseError("invalid");
  return readFileSync(file, "utf8");
}

function observeClock(file: string, now: number): void {
  let previous = 0;
  try {
    const state = JSON.parse(readSmallFile(`${file}.clock`, 256));
    if (state.version !== 1 || !Number.isSafeInteger(state.lastSeen) || state.lastSeen < 0) throw new LicenseError("clock-error");
    previous = state.lastSeen;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new LicenseError("clock-error");
  }
  if (now + CLOCK_TOLERANCE_MS < previous) throw new LicenseError("clock-error");
  if (now > previous) atomicWriteFile(`${file}.clock`, JSON.stringify({ version: 1, lastSeen: Math.max(now, previous) }));
}

export async function licenseStatus(context: LicenseContext = {}, importCode?: string): Promise<LicenseStatus> {
  let deviceCode: string | null = null;
  try {
    deviceCode = await (context.device || getDeviceCode)();
    const keys = context.keys || trustedLicenseKeys();
    const file = context.file || licenseFile();
    let code = importCode;
    if (code === undefined) {
      try { code = readSmallFile(file, MAX_LICENSE_BYTES); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LicenseError("missing");
        throw error;
      }
    }
    const now = (context.now || Date.now)();
    const payload = verifyLicense(code, keys, deviceCode, now);
    observeClock(file, now);
    // Invalid imports never replace the existing license. No persisted activation flag.
    if (importCode !== undefined) atomicWriteFile(file, `${code.trim()}\n`);
    return { state: "active", deviceCode, licenseId: payload.licenseId, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt };
  } catch (error) {
    return { state: error instanceof LicenseError ? error.state : "storage-error", deviceCode };
  }
}

export async function requireLicense(): Promise<LicenseStatus> {
  const status = await licenseStatus();
  if (status.state !== "active") throw new LicenseError(status.state);
  return status;
}
