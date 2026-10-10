import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = join(root, "output", "device-code");
mkdirSync(output, { recursive: true });
const result = await Bun.build({ entrypoints: [join(root, "src", "licensing", "device-cli.ts")], minify: true, target: "bun",
  compile: { outfile: join(output, `Web2Harness-DeviceCode${process.platform === "win32" ? ".exe" : ""}`) } });
if (!result.success) throw new Error("Unable to build the device-code utility");
process.stdout.write(`Device-code utility built in ${output}\n`);
