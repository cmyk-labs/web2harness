import { getDeviceCode } from "./device";
import { licenseStatus } from "./service";
import { MAX_LICENSE_BYTES } from "./schema";

export async function licenseCommand(args: string[]): Promise<void> {
  const [action = "status", ...rest] = args;
  if (action === "device" && rest.length === 0) {
    process.stdout.write(`${await getDeviceCode()}\n`);
    return;
  }
  if (action === "status" && (rest.length === 0 || rest.join() === "--json")) {
    process.stdout.write(`${JSON.stringify(await licenseStatus())}\n`);
    return;
  }
  if (action === "import" && rest.join() === "--stdin") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_LICENSE_BYTES) throw new Error("License is too large");
      chunks.push(bytes);
    }
    const status = await licenseStatus({}, Buffer.concat(chunks).toString("utf8"));
    process.stdout.write(`${JSON.stringify(status)}\n`);
    if (status.state !== "active") process.exitCode = 1;
    return;
  }
  throw new Error("Usage: license device | status [--json] | import --stdin");
}
