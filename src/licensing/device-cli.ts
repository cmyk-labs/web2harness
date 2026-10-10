import { getDeviceCode } from "./device";

try { process.stdout.write(`${await getDeviceCode()}\n`); }
catch { process.stderr.write("Unable to read a stable device identity. Contact the publisher.\n"); process.exitCode = 1; }
