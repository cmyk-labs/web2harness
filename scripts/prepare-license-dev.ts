import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createLicenseFixture } from "../tests/fixtures/license-fixture";

const output = resolve(import.meta.dir, "..", "output");
const devHome = resolve(process.argv[2] || join(output, "licensed-dev"));
if (!devHome.startsWith(`${output}${sep}`)) throw new Error("License DEV fixtures must be inside this checkout's output directory");
const directory = join(devHome, "licensing");
if (existsSync(directory)) throw new Error("This DEV license directory already exists; select a new fixture directory");
mkdirSync(devHome, { recursive: true });
const fixture = await createLicenseFixture(directory);
process.stdout.write(`DEV license prepared. The ephemeral private key was not saved.\nWEB2HARNESS_DEV_HOME=${devHome}\nWEB2HARNESS_LICENSE_KEYS_FILE=${fixture.keyFile}\nStart with bun run dev:launcher in that environment.\n`);
