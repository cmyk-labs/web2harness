import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TrustedLicenseKeys } from "./schema";

export function parseTrustedKeys(value: unknown): TrustedLicenseKeys {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid license public-key manifest");
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || !["development", "production"].includes(String(input.purpose))
    || !input.keys || typeof input.keys !== "object" || Array.isArray(input.keys)
    || Object.keys(input).some(key => !["version", "purpose", "keys"].includes(key))) {
    throw new Error("Invalid license public-key manifest");
  }
  const keys: Record<string, string> = Object.create(null);
  const entries = Object.entries(input.keys);
  if (entries.length === 0 || entries.length > 16) throw new Error("License manifest requires 1–16 public keys");
  for (const [id, pem] of entries) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)
      || typeof pem !== "string" || pem.length > 1024
      || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem)) {
      throw new Error("Only named Ed25519 PUBLIC KEY entries are accepted; never supply a private key");
    }
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("License public keys must use Ed25519");
    keys[id] = key.export({ format: "pem", type: "spki" }).toString();
  }
  return { version: 1, purpose: input.purpose as TrustedLicenseKeys["purpose"], keys };
}

export function readTrustedKeysFile(path: string): TrustedLicenseKeys {
  const raw = readFileSync(path);
  if (raw.length > 32_768) throw new Error("License public-key manifest is too large");
  return parseTrustedKeys(JSON.parse(raw.toString("utf8")));
}
