import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { LicenseError } from "./schema";

const execute = promisify(execFile);

export function deviceCodeFromId(platform: NodeJS.Platform, raw: string): string {
  const tag = { win32: "WIN", darwin: "MAC", linux: "LIN" }[platform as "win32" | "darwin" | "linux"];
  const normalized = raw.trim().toLowerCase();
  if (!tag || !/^[a-f0-9-]{16,64}$/.test(normalized) || /^[-0]+$/.test(normalized) || /^[-f]+$/.test(normalized)) {
    throw new LicenseError("device-unavailable");
  }
  return `W2D1-${tag}-${createHash("sha256").update(`web2harness:device:v1\0${platform}\0${normalized}`).digest("hex")}`;
}

let cached: Promise<string> | undefined;
export function getDeviceCode(): Promise<string> {
  return cached ??= readDeviceCode().catch(error => { cached = undefined; throw error; });
}

async function readDeviceCode(): Promise<string> {
  try {
    if (process.platform === "win32") {
      const command = join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
      const { stdout } = await execute(command, ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"],
        { windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
      const id = /MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/i.exec(stdout)?.[1];
      return deviceCodeFromId("win32", id || "");
    }
    if (process.platform === "darwin") {
      const { stdout } = await execute("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { timeout: 10_000, maxBuffer: 131_072 });
      return deviceCodeFromId("darwin", /"IOPlatformUUID"\s*=\s*"([a-fA-F0-9-]+)"/.exec(stdout)?.[1] || "");
    }
    if (process.platform === "linux") return deviceCodeFromId("linux", await readFile("/etc/machine-id", "utf8"));
  } catch { throw new LicenseError("device-unavailable"); }
  throw new LicenseError("device-unavailable");
}
