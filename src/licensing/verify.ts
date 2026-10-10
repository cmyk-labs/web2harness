import { verify } from "node:crypto";
import { CLOCK_TOLERANCE_MS, isDeviceCode, LICENSE_DOMAIN, LicenseError, MAX_LICENSE_BYTES,
  type LicensePayload, type TrustedLicenseKeys } from "./schema";

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new LicenseError("invalid");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new LicenseError("invalid");
  return decoded;
}

function utcDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function validateLicensePayload(value: unknown): LicensePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LicenseError("invalid");
  const p = value as LicensePayload;
  const fields = ["version", "product", "keyId", "licenseId", "deviceCode", "issuedAt", "expiresAt"];
  if (Object.keys(p).length !== fields.length || Object.keys(p).some(key => !fields.includes(key))
    || p.version !== 1 || p.product !== "web2harness"
    || typeof p.keyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(p.keyId)
    || typeof p.licenseId !== "string" || !/^[0-9a-f-]{36}$/.test(p.licenseId)
    || !isDeviceCode(p.deviceCode) || !utcDate(p.issuedAt)
    || (p.expiresAt !== null && (!utcDate(p.expiresAt) || Date.parse(p.expiresAt) <= Date.parse(p.issuedAt)))) {
    throw new LicenseError("invalid");
  }
  return p;
}

export function verifyLicense(code: string, keys: TrustedLicenseKeys, deviceCode: string, now = Date.now()): LicensePayload {
  if (typeof code !== "string" || Buffer.byteLength(code) > MAX_LICENSE_BYTES || !Number.isFinite(now)) throw new LicenseError("invalid");
  const parts = code.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "W2H1") throw new LicenseError("invalid");
  const bytes = decode(parts[1]!);
  const signature = decode(parts[2]!);
  let p: LicensePayload;
  try { p = validateLicensePayload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { throw new LicenseError("invalid"); }
  const publicKey = Object.hasOwn(keys.keys, p.keyId) ? keys.keys[p.keyId] : undefined;
  if (!publicKey || signature.length !== 64
    || !verify(null, Buffer.concat([Buffer.from(LICENSE_DOMAIN), bytes]), publicKey, signature)) throw new LicenseError("invalid");
  if (p.deviceCode !== deviceCode) throw new LicenseError("wrong-device");
  if (Date.parse(p.issuedAt) > now + CLOCK_TOLERANCE_MS) throw new LicenseError("clock-error");
  if (p.expiresAt !== null && now >= Date.parse(p.expiresAt)) throw new LicenseError("expired");
  return p;
}
