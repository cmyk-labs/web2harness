import { readTrustedKeysFile, parseTrustedKeys } from "./keys";
import { LicenseError, type TrustedLicenseKeys } from "./schema";

declare const __WEB2HARNESS_LICENSE_KEYS__: TrustedLicenseKeys;

export function trustedLicenseKeys(): TrustedLicenseKeys {
  // Bundles never read environment-provided keys. Source/DEV uses the same verifier
  // with an explicitly supplied public manifest, not an activation bypass.
  try {
    if (typeof __WEB2HARNESS_LICENSE_KEYS__ !== "undefined") return parseTrustedKeys(__WEB2HARNESS_LICENSE_KEYS__);
    const path = process.env.WEB2HARNESS_LICENSE_KEYS_FILE;
    if (path) return readTrustedKeysFile(path);
  } catch { throw new LicenseError("unconfigured"); }
  throw new LicenseError("unconfigured");
}
