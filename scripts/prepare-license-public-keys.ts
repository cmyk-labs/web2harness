import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseTrustedKeys } from "../src/licensing/keys";

// CI receives public data only; the publisher's private key never belongs in CI.
const raw = process.env.WEB2HARNESS_LICENSE_PUBLIC_KEYS_JSON;
if (!raw) throw new Error("Set the repository variable WEB2HARNESS_LICENSE_PUBLIC_KEYS_JSON before releasing");
const keys = parseTrustedKeys(JSON.parse(raw));
if (keys.purpose !== "production") throw new Error("Releases require production public keys");
const directory = resolve("output", "release-keys");
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "public-keys.json"), JSON.stringify(keys));
