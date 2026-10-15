import { createHash } from "node:crypto";

/** JSON value identity only: object order is immaterial; arrays and strings remain exact.
 * JSON serialization first preserves omission of optional/undefined object properties.
 * This is an internal versioned format, not an implementation of RFC 8785.
 */
export function requestFingerprint(domain: string, value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Request identity requires a JSON value");
  function canonical(item: unknown): string {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item !== null && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(item)!;
  }
  return createHash("sha256").update(`${domain}:v1\n`).update(canonical(JSON.parse(json))).digest("hex");
}
