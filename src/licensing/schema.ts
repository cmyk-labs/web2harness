export const LICENSE_DOMAIN = "web2harness:offline-license:v1\0";
export const MAX_LICENSE_BYTES = 8192;
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

export interface LicensePayload {
  version: 1;
  product: "web2harness";
  keyId: string;
  licenseId: string;
  deviceCode: string;
  issuedAt: string;
  expiresAt: string | null;
}

export type LicenseState = "active" | "missing" | "expired" | "invalid" | "wrong-device"
  | "clock-error" | "device-unavailable" | "unconfigured" | "storage-error";

export interface LicenseStatus {
  state: LicenseState;
  deviceCode: string | null;
  licenseId?: string;
  issuedAt?: string;
  expiresAt?: string | null;
}

export interface TrustedLicenseKeys {
  version: 1;
  purpose: "production" | "development";
  keys: Record<string, string>;
}

export class LicenseError extends Error {
  constructor(readonly state: Exclude<LicenseState, "active">) {
    super(`Web2Harness license: ${state}. Open License in the launcher or run web2harness license status.`);
    this.name = "LicenseError";
  }
}

export function isDeviceCode(value: unknown): value is string {
  return typeof value === "string" && /^W2D1-(WIN|MAC|LIN)-[a-f0-9]{64}$/.test(value);
}
