import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLicenseFixture } from "./license-fixture";

const directory = mkdtempSync(join(tmpdir(), "web2harness-license-tests-"));
const fixture = await createLicenseFixture(directory);
process.env.WEB2HARNESS_LICENSE_KEYS_FILE = fixture.keyFile;
process.env.WEB2HARNESS_LICENSE_FILE = fixture.licenseFile;
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
