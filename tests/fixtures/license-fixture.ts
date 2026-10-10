import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDeviceCode } from "../../src/licensing/device";
import { LICENSE_DOMAIN, type TrustedLicenseKeys } from "../../src/licensing/schema";

/** Real signatures under an ephemeral test-only key. Never imported by client code. */
export async function createLicenseFixture(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys: TrustedLicenseKeys = { version: 1, purpose: "development", keys: {
    "fixture-key": publicKey.export({ format: "pem", type: "spki" }).toString(),
  } };
  const deviceCode = await getDeviceCode();
  const payload = { version: 1, product: "web2harness", keyId: "fixture-key", licenseId: randomUUID(), deviceCode,
    issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: null };
  const raw = Buffer.from(JSON.stringify(payload));
  const code = `W2H1.${raw.toString("base64url")}.${sign(null, Buffer.concat([Buffer.from(LICENSE_DOMAIN), raw]), privateKey).toString("base64url")}`;
  const keyFile = join(directory, "public-keys.json"), licenseFile = join(directory, "license.w2h");
  writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600 });
  writeFileSync(licenseFile, code, { mode: 0o600 });
  return { keys, keyFile, licenseFile, code, deviceCode };
}
