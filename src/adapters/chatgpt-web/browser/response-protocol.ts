const removableMetadataPaths = new Set(["citations", "content_references", "model_dil_v2", "is_complete", "finish_details"]
  .map(key => `/message/metadata/${key}`));
export function isResponseMetadataRemoval(path: unknown, operation: unknown): boolean {
  return operation === "remove" && typeof path === "string" && removableMetadataPaths.has(path);
}
// These removals already work inside patch arrays. Their top-level form has no value.
// Do not infer removal from an inherited operation or accept arbitrary empty frames.
export function isValuelessResponseRemoval(frame: Record<string, unknown>): boolean {
  return isResponseMetadataRemoval(frame.p, frame.o) && Object.keys(frame).every(key => ["p", "o", "c"].includes(key));
}

/** Observed v1 frame context and inherited operation cursor. No payload is retained here. */
export class ChatGptDeltaCursor<T> {
  path = "";
  operation = "add";
  private context: number | undefined;
  private readonly values = new Map<number | undefined, T>();
  get current(): T | undefined { return this.values.get(this.context); }
  set current(value: T | undefined) {
    if (value === undefined) this.values.delete(this.context);
    else this.values.set(this.context, value);
  }
  select(frame: Record<string, unknown>): void {
    if (Object.hasOwn(frame, "c")) {
      if (!Number.isSafeInteger(frame.c) || (frame.c as number) < 0 || (frame.c as number) > 4095) throw Error("response_context_unsupported");
      this.context = frame.c as number;
    }
    if (Object.hasOwn(frame, "p")) {
      if (typeof frame.p !== "string") throw Error("response_patch_unsupported");
      this.path = frame.p;
    }
    if (Object.hasOwn(frame, "o")) {
      if (!["add", "replace", "append", "remove", "patch"].includes(frame.o as string)) throw Error("response_patch_unsupported");
      this.operation = frame.o as string;
    }
  }
  reset(): void { this.context = undefined; this.values.clear(); this.path = ""; this.operation = "add"; }
}

/** Apply a known structured metadata patch without prototype traversal or missing-base guesses. */
export function patchResponseValue(target: unknown, path: string[], operation: string, value: unknown): unknown {
  if (path.some(key => ["__proto__", "prototype", "constructor"].includes(key))) throw Error("response_patch_unsupported");
  if (!path.length) {
    if (operation === "remove") return undefined;
    if (operation === "add" || operation === "replace") return structuredClone(value);
    if (operation === "append") {
      if (typeof target === "string" && typeof value === "string") return target + value;
      if (Array.isArray(target) && Array.isArray(value)) return [...target, ...structuredClone(value)];
      if (target && value && typeof target === "object" && typeof value === "object" && !Array.isArray(target) && !Array.isArray(value)) {
        return { ...target, ...structuredClone(value) };
      }
    }
    throw Error("response_patch_unsupported");
  }
  if (!target || typeof target !== "object") throw Error("response_patch_unbound");
  const [key, ...rest] = path;
  if (Array.isArray(target) && (!/^(0|[1-9]\d*)$/.test(key!) || Number(key) > target.length)) throw Error("response_patch_unbound");
  const clone = structuredClone(target) as Record<string, unknown>;
  const updated = patchResponseValue(clone[key!], rest, operation, value);
  if (updated === undefined) {
    if (Array.isArray(clone)) clone.splice(Number(key), 1);
    else delete clone[key!];
  } else clone[key!] = updated;
  return clone;
}
