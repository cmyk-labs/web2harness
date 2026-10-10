import { afterAll, expect, test } from "bun:test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deviceCodeFromId } from "../../src/licensing/device";
import { parseTrustedKeys } from "../../src/licensing/keys";
import { LICENSE_DOMAIN, type LicensePayload, type TrustedLicenseKeys } from "../../src/licensing/schema";
import { licenseStatus } from "../../src/licensing/service";
import { verifyLicense } from "../../src/licensing/verify";
import { removeApplicationData } from "../../src/application-data";

const root = mkdtempSync(join(tmpdir(), "w2h-verification-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const device = deviceCodeFromId("win32", "12345678-1234-1234-1234-123456789abc");
const now = Date.parse("2026-01-31T08:15:30.000Z");
// Disposable cryptographic fixture, unrelated to the publisher's private issuer.
const pair = generateKeyPairSync("ed25519");
const keys: TrustedLicenseKeys = { version: 1, purpose: "development", keys: { fixture: pair.publicKey.export({ format: "pem", type: "spki" }).toString() } };
const payload: LicensePayload = { version: 1, product: "web2harness", keyId: "fixture", licenseId: randomUUID(), deviceCode: device,
  issuedAt: new Date(now).toISOString(), expiresAt: null };
function signedFixture(value: unknown = payload): string {
  const bytes = Buffer.from(JSON.stringify(value));
  return `W2H1.${bytes.toString("base64url")}.${sign(null, Buffer.concat([Buffer.from(LICENSE_DOMAIN), bytes]), pair.privateKey).toString("base64url")}`;
}

test("perpetual license verifies; device identity is normalized and excludes raw IDs", () => {
  expect(verifyLicense(signedFixture(), keys, device, now)).toEqual(payload);
  expect(deviceCodeFromId("win32", " 12345678-1234-1234-1234-123456789ABC ")).toBe(device);
  expect(device).not.toContain("12345678");
  for (const raw of ["", "unknown", "00000000-0000-0000-0000-000000000000", "ffffffffffffffffffffffffffffffff"]) expect(() => deviceCodeFromId("win32", raw)).toThrow();
});

test("signed license is rejected on a different device, at exact expiry, or before issuance", () => {
  const expires = "2026-02-01T08:15:30.000Z";
  const code = signedFixture({ ...payload, expiresAt: expires });
  expect(verifyLicense(code, keys, device, Date.parse(expires) - 1).expiresAt).toBe(expires);
  expect(() => verifyLicense(code, keys, device, Date.parse(expires))).toThrow("expired");
  expect(() => verifyLicense(code, keys, device + "wrong", now)).toThrow("wrong-device");
  expect(() => verifyLicense(code, keys, device, now - 600_000)).toThrow("clock-error");
});

test("tampered payloads and signatures, unknown versions and noncanonical encodings fail", () => {
  const code = signedFixture(), parts = code.split(".");
  for (const changed of [
    `W2H1.${Buffer.from(JSON.stringify({ ...payload, expiresAt: "2099-01-01T00:00:00.000Z" })).toString("base64url")}.${parts[2]}`,
    `W2H1.${parts[1]}.${Buffer.alloc(64).toString("base64url")}`, code.replace("W2H1", "W2H2"),
    `${code}.extra`, `W2H1.${parts[1]}=.${parts[2]}`, `W2H1.${parts[1]}.${parts[2]}=`, "x".repeat(8193), "",
  ]) expect(() => verifyLicense(changed, keys, device, now)).toThrow();
  expect(() => verifyLicense(code, { ...keys, keys: {} }, device, now)).toThrow();
});

test("signed unsupported schemas, products and impossible dates remain invalid", () => {
  for (const changed of [ { ...payload, extra: true }, { ...payload, product: "other" },
    { ...payload, issuedAt: "2026-02-30T00:00:00.000Z" }, { ...payload, version: 2 },
    { ...payload, expiresAt: payload.issuedAt }, { ...payload, keyId: "unknown-key" },
  ]) expect(() => verifyLicense(signedFixture(changed), keys, device, now)).toThrow();
});

test("public manifest rejects private key material, empty keys and alternate algorithms", () => {
  const pem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  expect(() => parseTrustedKeys({ ...keys, keys: { private: pem } })).toThrow("PUBLIC KEY");
  expect(() => parseTrustedKeys({ ...keys, keys: {} })).toThrow();
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  expect(() => parseTrustedKeys({ ...keys, keys: { ec: ec.publicKey.export({ format: "pem", type: "spki" }).toString() } })).toThrow("Ed25519");
});

test("invalid imports preserve prior activation; altered storage and time rollback are detected", async () => {
  const file = join(root, "storage", "license.w2h");
  let time = now;
  const context = { file, keys, device: async () => device, now: () => time };
  expect((await licenseStatus(context)).state).toBe("missing");
  expect((await licenseStatus(context, signedFixture())).state).toBe("active");
  const previous = readFileSync(file, "utf8");
  expect((await licenseStatus(context, "bad-code")).state).toBe("invalid");
  expect(readFileSync(file, "utf8")).toBe(previous);
  time += 3_600_000;
  expect((await licenseStatus(context)).state).toBe("active");
  time -= 3_600_000;
  expect((await licenseStatus(context)).state).toBe("clock-error");
  writeFileSync(`${file}.clock`, "broken");
  expect((await licenseStatus(context)).state).toBe("clock-error");
  writeFileSync(file, "tampered");
  expect((await licenseStatus(context)).state).toBe("invalid");
});

test("disconnect preserves the license while explicit full data removal deletes it", async () => {
  const home = join(root, "disconnect"), file = join(home, "licensing", "license.w2h");
  expect((await licenseStatus({ file, keys, device: async () => device, now: () => now }, signedFixture())).state).toBe("active");
  writeFileSync(join(home, "config.json"), "{}");
  removeApplicationData(home, true);
  expect(existsSync(file)).toBe(true);
  expect(existsSync(join(home, "config.json"))).toBe(false);
  removeApplicationData(home);
  expect(existsSync(file)).toBe(false);
});
